/**
 * YOUR REVIEW — a sandbox workflow for Session 2.
 *
 * This file is *yours* to experiment with. It auto-discovers as the
 * `your-review` workflow — no registration step. Run it, break it, extend it,
 * compare traces against the finished `code-review` workflow next door.
 *
 * What's here: a working custom agent defined with `defineAgent()`, wrapped in
 * a `task()` for isolation and retries, and called from the root workflow. This
 * is the minimum viable agent-in-a-workflow — modify it freely.
 */
import { task } from "@renderinc/sdk/workflows";
import {
  defineAgent,
  prepareDiff,
  filterDiff,
  resolveModelSpec,
} from "@workshop/agent";
import { storeTracer } from "@workshop/db";

// ┌─────────────────────────────────────────────────────────────────────────┐
// │  YOUR AGENT — defined inline with defineAgent().                       │
// │                                                                        │
// │  Try changing:                                                         │
// │    • The systemPrompt — focus on docs, naming, error handling, etc.    │
// │    • The model tier — 'small' is fast/cheap, 'large' is thorough      │
// │    • The tools — try 'scan_for_secrets', 'contrast_ratio', or add     │
// │      your own in shared/agent/src/tools/                              │
// └─────────────────────────────────────────────────────────────────────────┘
const myReviewer = defineAgent({
  name: "my-reviewer",
  model: resolveModelSpec("medium"),
  tools: ["diff_stats"],
  systemPrompt: `# Code clarity reviewer

You review a pull request's per-file patches for clarity and maintainability.

Focus on:
- Confusing variable or function names
- Missing or misleading comments on non-obvious logic
- Functions doing too many things (suggest splits)
- Dead code or unreachable branches
- Inconsistent patterns across the changed files

Do NOT comment on security, performance, or style-only issues — other
reviewers handle those.

## Output format

Return a short list of findings. Each finding has:
- **severity**: \`info\` | \`warn\` | \`block\`
- **location**: \`path/to/file:line\`
- **note**: 1–3 sentences. State the problem and the fix.

If you find nothing, say so explicitly.`,
});

// ┌─────────────────────────────────────────────────────────────────────────┐
// │  TASK WRAPPING — same pattern as code-review/index.ts.                │
// │                                                                        │
// │  Wrapping the agent in task() gives you:                               │
// │    • Isolation — runs in its own Render instance                       │
// │    • Retries — transient LLM failures retry automatically             │
// │    • Traces — appears in the Render Dashboard with duration + logs     │
// │                                                                        │
// │  Try: add retry config, change the timeout, or force a failure:       │
// │    if (Math.random() < 0.5) throw new Error("flaky!");                │
// └─────────────────────────────────────────────────────────────────────────┘
type Patches = Array<{ file: string; diff: string }>;

const myReviewerTask = task(
  {
    name: "my-reviewer",
    timeoutSeconds: 120,
    retry: { maxRetries: 2, waitDurationMs: 1000, backoffScaling: 2 },
  },
  async (input: { patches: Patches }, runId?: string) => {
    return myReviewer.run(input, {
      tracer: storeTracer(),
      ...(runId ? { runId } : {}),
    });
  },
);

interface YourReviewInput {
  url: string;
  _runId?: string;
}

export default task(
  {
    name: "your-review",
    timeoutSeconds: 300,
    retry: { maxRetries: 2, waitDurationMs: 2000, backoffScaling: 2 },
  },
  async function yourReview(input: YourReviewInput) {
    const runId = input._runId;

    // Step 1 — Fetch the PR diff from GitHub.
    const allPatches = await prepareDiff({ url: input.url, labels: [] });

    // Step 2 — Drop noise (lock files, minified bundles).
    const { patches } = filterDiff(allPatches);

    // Step 3 — Run your custom agent as its own Render task.
    const result = await myReviewerTask({ patches }, runId);

    // Return a result the gateway can persist. Including `verdict` and `reviews`
    // tells the server to use the standard persistReview path — same as
    // code-review. Change the shape freely; the server also handles freeform
    // results (see server.ts).
    return {
      verdict: "approve",
      reason: result.text,
      reviews: [{ agent: myReviewer.name, note: result.text }],
      usage: result.usage,
    };
  },
);

// ── What to try next ─────────────────────────────────────────────────────
//
// 1. CHANGE THE FOCUS — rewrite the systemPrompt to review for error handling,
//    naming conventions, test coverage, or whatever you care about.
//
// 2. ADD ANOTHER AGENT — define a second agent with defineAgent(), wrap it in
//    task(), and fan out both with Promise.all:
//
//      const [clarity, errors] = await Promise.all([
//        myReviewerTask({ patches }, runId),
//        errorHandlingTask({ patches }, runId),
//      ]);
//
// 3. ADD A JUDGE — import `judge` from @workshop/agent and wire it after the
//    fan-out to consolidate findings into a single verdict:
//
//      import { judge } from "@workshop/agent";
//      const judgeTask = task(
//        { name: "judge", timeoutSeconds: 120 },
//        async (input, runId?) => judge.run(input, { tracer: storeTracer(), runId }),
//      );
//      const decision = await judgeTask({ findings }, runId);
//
// 4. FORCE A FAILURE — uncomment the line below inside the task to watch
//    Render retry in a fresh instance (then remove it):
//
//      if (Math.random() < 0.5) throw new Error("flaky!");
//
// 5. ADD A TOOL — drop a new file in shared/agent/src/tools/ and list its
//    name in your agent's `tools` array. It auto-discovers.
//
// See code-review/index.ts for the full pipeline with fan-out + judge.
// ──────────────────────────────────────────────────────────────────────────
