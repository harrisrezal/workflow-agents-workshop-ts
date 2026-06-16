/**
 * Pattern 3 — Code-review workflow (Render Workflows).
 *
 * The **same building blocks** as naive-agent and queue-agents:
 *
 *   prepareDiff → filterDiff → selectReviewers → [reviewers…] (Promise.all) → judge
 *
 * But each step is wrapped in `task()`, which gives you:
 *   - **Isolation**: each reviewer runs in its own Render instance, so a crash
 *     or OOM in one doesn't take down the others.
 *   - **Automatic retries**: the `retry` config handles transient LLM failures
 *     without any hand-rolled retry logic (compare with kv.ts in queue-agents).
 *   - **Observability**: every task appears in the Render Dashboard with its
 *     own duration, logs, and traces — no pub/sub plumbing needed.
 *   - **Timeouts**: per-task and per-workflow timeouts prevent runaway reviews.
 *
 * The agents themselves come from @workshop/agent — identical to the ones the
 * naive and queue patterns run. Only the substrate differs.
 */
import { task } from "@renderinc/sdk/workflows";
import {
  prepareDiff,
  filterDiff,
  toReviewSummary,
  securityReviewer,
  performanceReviewer,
  uxReviewer,
  hasFrontendFiles,
  judge,
} from "@workshop/agent";
import { storeTracer } from "@workshop/db";

// ┌─────────────────────────────────────────────────────────────────────────┐
// │  TASK REGISTRATION: each shared agent becomes its own Render task.     │
// │  `agent.run()` is the same call naive-agent and queue-agents make;     │
// │  wrapping it in `task()` buys isolation, retries, timeouts, and        │
// │  per-task traces in the Render Dashboard — for free.                   │
// └─────────────────────────────────────────────────────────────────────────┘
type Patches = Array<{ file: string; diff: string }>;
type Findings = Array<{ agent: string; note: string }>;
const ctx = (runId?: string) => ({ tracer: storeTracer(), ...(runId ? { runId } : {}) });

const agentTaskOptions = {
  timeoutSeconds: 120,
  retry: { maxRetries: 2, waitDurationMs: 1000, backoffScaling: 2 },
};

const securityTask = task(
  { name: "security", ...agentTaskOptions },
  async (input: { patches: Patches }, runId?: string) => securityReviewer.run(input, ctx(runId)),
);

const performanceTask = task(
  { name: "performance", ...agentTaskOptions },
  async (input: { patches: Patches }, runId?: string) => performanceReviewer.run(input, ctx(runId)),
);

const uxTask = task(
  { name: "ux", ...agentTaskOptions },
  async (input: { patches: Patches }, runId?: string) => uxReviewer.run(input, ctx(runId)),
);

const judgeTask = task(
  { name: "judge", ...agentTaskOptions },
  async (input: { findings: Findings }, runId?: string) => judge.run(input, ctx(runId)),
);

interface CodeReviewInput {
  url: string;
  labels?: string[];
  _runId?: string;
}

export default task(
  {
    name: "code-review",
    timeoutSeconds: 600,
    retry: { maxRetries: 2, waitDurationMs: 2000, backoffScaling: 2 },
  },
  async function codeReview(input: CodeReviewInput) {
    const runId = input._runId;

    // Step 1 — Fetch the PR diff from GitHub. Runs in-process inside the root
    // task (no need for its own isolated task — it's a single HTTP call).
    const allPatches = await prepareDiff({ url: input.url, labels: input.labels ?? [] });

    // Step 2 — Drop noise (lock files, minified bundles). Deterministic,
    // in-process — same as naive-agent and queue-agents.
    const { patches } = filterDiff(allPatches);

    // Step 3 — Conditional fan-out: security + performance always; UX only for
    // frontend. Each reviewer is a separate Render task — if one crashes or
    // times out, the others are unaffected (compare with naive-agent where a
    // single failure kills the entire HTTP response).
    const reviewerTasks = [
      { name: securityReviewer.name, run: securityTask },
      { name: performanceReviewer.name, run: performanceTask },
    ];
    if (hasFrontendFiles(patches)) {
      reviewerTasks.push({ name: uxReviewer.name, run: uxTask });
    }

    // Step 4 — Fan out in parallel. Same `Promise.all` as the other patterns,
    // but each `run()` dispatches to its own Render task instance with its own
    // retry budget and timeout.
    const reviewerResults = await Promise.all(
      reviewerTasks.map(async ({ name, run }) => {
        const result = await run({ patches }, runId);
        return { agent: name, note: result.text, usage: result.usage };
      }),
    );

    // Step 5 — Judge: weigh findings and produce a verdict. Also its own task.
    const decision = await judgeTask({ findings: reviewerResults.map(({ agent, note }) => ({ agent, note })) }, runId);

    // Step 6 — Summarize (shared helper across all three patterns).
    return toReviewSummary(reviewerResults, decision);
  },
);
