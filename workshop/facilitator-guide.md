# Facilitator Guide — Building Agents on Render Workflows

The teaching layer on top of the learner-facing tutorials. The tutorials carry
the deploy steps, repo layout, and code context; this guide carries the talk
tracks, timing, aha moments, hint ladders, and worked solutions.

Read once end-to-end before your first run. Keep the **Run sheet** and
**Solutions** open on a second screen while you present.

---

## 1. The spine (the one mental model to land)

```
            SAME AGENT  ───────────────────────────────────▶  (never changes)

Pattern 1   [ web request runs the agent ]                 you own: nothing
            └ breaks: timeouts, lost on deploy, no scale       scales: no

Pattern 2   [ web ] → (Valkey queue) → [ worker runs agent ] you own: queue,
            └ durable, scales by adding workers                consumer group,
                                                               acks, retries, pub/sub

Pattern 3   [ web ] → Render Workflows → [ task per agent ]  you own: nothing
            └ same durability + scale, declarative             scales: yes
```

The emotional arc you're selling:

1. **Pattern 1 feels good** ("look, it's live") → then you break it.
2. **Pattern 2 is powerful** ("now it's durable and scales!") → then they read
   the ack contract and see how much coordination they now *own*.
3. **Pattern 3 feels like cheating** ("wait, that's it?") → the guarantees from
   Pattern 2 collapse into `retry: { maxRetries: 2 }`, a CLI-created Workflow, and
   a trace.

If learners leave able to recite "the agent never changed, the substrate did the
work," the workshop succeeded.

---

## 2. Logistics

- **Total time:** ~1h 50 mins, designed as **two sessions** with a 10 minute break.
  - **Session 1 — Substrates & coordination** (~50 min): Patterns 1 & 2,
    including tracing the ack contract and scaling the worker.
  - **Session 2 — Let the platform (and agents) do it** (~50 min): Pattern 3
    and the author-a-task finale, where coding agents come out.
- **Format:** live deploys + a hands-on lab. Learners follow along on their own
  Render accounts and machines.
- **Group size:** works 1:1 up to ~30 with a helper for debugging environments.
- **Delivery:** in-person or remote. Remote works fine. Have learners share service
  URLs, CLI output, and Dashboard screenshots when they get stuck.

---

## 3. Pre-flight checklist

Do this **before** learners arrive (and have learners do the install ahead of time
if you can — environment setup is the #1 time sink).

Facilitator machine:

- [ ] Node >= 22.12 (`node -v`).
- [ ] `npm install` from the repo root completes clean.
- [ ] Render CLI installed, logged in, and pointed at the right workspace
      (`render login`, then `render workspace set`).
- [ ] A fork or workshop repo connected to Render.
- [ ] Pattern 1 and Pattern 2 Blueprints tested from that repo.
- [ ] Pattern 3 hybrid path rehearsed with the web+Postgres Blueprint and
      `render workflows create`.
- [ ] Optional local Valkey running (`valkey-server &` or
      `docker run -p 6379:6379 valkey/valkey`).
- [ ] `npm test` is green (proves the mock model path works end-to-end).
- [ ] Decide: real model or mock? With **no LLM provider API key** everything runs
      on a deterministic mock model — totally fine and fully offline. Set
      `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` only if you want live reviews. Have
      `AGENT_MODEL=mock` ready as a fallback if the gateway misbehaves on stage.

Room / screen:

- [ ] Terminal font large enough to read from the back.
- [ ] Browser tabs open to the Render Dashboard, the learner-facing docs, and one
      deployed service URL.
- [ ] Terminal tabs ready for `render services`, `render logs`, and
      `render workflows`.

Tell learners up front: **no LLM provider API key is required.** This removes the
single biggest source of "it doesn't work for me."

### Stage reliability

- **Mock model is the default.** With no API key set, every deploy and test
  runs on a deterministic mock — totally offline, totally reproducible.
- **Public PRs as input.** GitHub's unauthenticated rate limit is generous
  enough for a room of 30.
- **Pre-deployed reference instance.** Deploy all three patterns from your
  facilitator fork before the session and keep the URLs bookmarked. If a
  learner's deploy stalls, they can point at yours.
- **`AGENT_MODEL=mock` as escape hatch.** If a live model misbehaves mid-demo,
  switch and keep moving.

### Setup triage (first 10 minutes)

| Symptom | Fix | Time |
| --- | --- | --- |
| No fork yet | Fork now; run the setup-attendee Action while `npm install` runs | 2 min |
| `npm install` fails | Check Node version — need >= 22.12. `nvm install 22` | 2 min |
| Render CLI not installed | `brew install render` (macOS) or `npm install -g @render-oss/cli` | 1 min |
| Can't connect Git provider in Render | Pair with a neighbor; defer to break | 0 min |
| Blueprint names collide | They didn't run `setup-attendee.yml`. Run `npm run setup` locally, commit, push | 1 min |

**Rule of thumb:** if an attendee isn't unblocked within 3 minutes, pair them
with a neighbor and circle back at the break.

---

## 4. Run sheet

### Demo flow at a glance

```
Setup        render login → render workspace set → npm install → draw the spine
Pattern 1    Blueprint deploy → live URL → submit PR → show spans/logs → break it
Pattern 2    Blueprint deploy → submit PRs → tail worker logs → scale worker
             → open kv.ts: "this is the price"
── break ──
Pattern 3    Blueprint web+DB → workflows create → run code-review → show trace
             → side-by-side fan-out table
Lab          preview your-review → compose agent → force retry → ship live
Close        re-draw spine: "the agent never changed"
```

### Module 0 — Setup & framing (10 min)

- **Talk track:** "We're going to build a code reviewer once and run it three ways.
  Watch what *doesn't* change." Draw the spine.
- **Pitfall:** learners without Git provider access in Render. Pair them with a
  helper or have them follow the facilitator deploy while they keep coding locally.
- **CFU:** "Which folder holds the agent itself?" (`shared/agent`)

### Module 1 — Pattern 1: the naive baseline (15 min)

- **Talk track:** "Simplest thing that works: the agent runs *inside the request*."
- **On stage:** after the first successful review, show `server.ts` — every `await`
  blocks the HTTP connection. Read the file's top comment aloud.
- **Break it on stage:** submit a large PR → the request blocks. "What happens if
  I redeploy mid-review?" → in-flight work is lost. This motivates Pattern 2.
- **Pitfall:** a big PR on a real model can genuinely time out. That's the point,
  but switch to a small PR to keep pace.
- **CFU:** "Name two reasons this design fails under load." (timeouts, lost on
  deploy/crash, no independent scale.)

### Module 2 — Pattern 2: worker + queue (20 min)

- **Talk track:** "Same building blocks — same prepareDiff, same agents, same judge.
  The web tier becomes a thin producer. A background worker consumes a Valkey
  queue and runs the same pipeline out-of-band."
- **The aha:** open `worker.ts` and compare side-by-side with `naive-agent/server.ts`.
  Same imports, same pipeline. Only *where it runs* changed.
- **Now flip it:** open `kv.ts` and scroll slowly. "This is the price. The stream,
  the consumer group, blocking reads, acks, retry-on-failure, the pub/sub progress
  bus — all of this is coordination code *you* now own and debug."
- **Pitfall:** the web app can open before the worker is ready. Check service
  health and worker logs first.
- **CFU:** "What did we have to add, and what did we change in the agent?"
  (Added: queue/worker/acks/pub-sub. Changed in agent: nothing.)

> Break here between sessions.

### Module 3 — Pattern 3: Workflows (20 min)

- **Talk track:** "Same fan-out, expressed as Render tasks. The queue, retries,
  coordination, and observability you hand-rolled are now declarative. The unit you
  author is a **task**: a plain async function + a config object."
- **Show the code:** `code-review/index.ts` — each reviewer is a `task()` wrapping
  `agent.run()`. `Promise.all` fans out. `ux` is conditional.
- **The aha — the fan-out table** (this is the punchline):

  | Pattern | How fan-out is written | You maintain |
  | --- | --- | --- |
  | naive | `Promise.all([...])` in one process | nothing, but no scale/durability |
  | worker | `XADD` → consumer group → acks → pub/sub | the whole queue |
  | workflow | `Promise.all([agent.run(), ...])` where `agent` is a `task()` | nothing |

- **Pitfall:** empty task list → workflow didn't auto-discover. Must be
  `src/workflows/<name>/index.ts` exporting a `task()`.
- **Pitfall:** module resolution errors → root directory/commands wrong. Root
  should be `packages/workflow-agents`; build/start commands `cd ../..` first.
- **CFU:** "Where are the retries in Pattern 3?" (In the task's config object.)

### Lab — Author a task (25–35 min, the finale)

**Now coding agents come out.**

- **Starter:** `your-review/index.ts` is a working sandbox, auto-discovered.
- **Sequence:**
  1. **Preview:** `render workflows tasks list --local` → run `your-review`.
  2. **Compose an agent as a task.** Encourage coding agents (Cursor/Claude/etc.)
     — point them at the ideas at the bottom of the file.
  3. **Force a retry.** Add `if (Math.random() < 0.5) throw new Error("flaky!")`.
     Watch Render retry with no try/catch. **Remove when done.**
  4. **Bonus — fan out** with `Promise.all` (mirrors `code-review`).
  5. **Ship it live.** Push, release a version, start the task, open the trace.
- **Pacing:**
  - ~5 min on step 1. Buffer for stragglers.
  - ~12 min on steps 2–3 (the core). Circulate.
  - **15-min mark:** room check. If <half have a nested task, walk through step 2.
  - **20-min mark:** "5 minutes for core steps." Steps 4–5 are stretch goals.
- **Hint ladder:**
  1. "`import { securityReviewer } from '@workshop/agent'`."
  2. "Wrap in `task()`: `const securityTask = task({ name: 'security' }, async (input) => securityReviewer.run(input, { tracer: storeTracer() }))`."
  3. "Call it: `const review = await securityTask({ patches: filtered.patches })`."
  4. "For fan-out: one `task()` per reviewer, then `Promise.all`. See
     `code-review/index.ts`."
- **Common bug:** forgetting to import `task` from `@renderinc/sdk/workflows` or
  `storeTracer` from `@workshop/db`.
- **Coding agent tip:** point learners at `.agents/skills/` — the
  `render-workflows` skill is useful for `task()` patterns.
- **The aha (say this):** "You just added durable, retried, isolated, traced,
  parallel execution by writing a plain function and a config object. In Pattern 2
  that took a queue, consumer group, acks, and pub/sub. The agent never changed."
- **CFU:** "What's the difference between a step and a task?" (A step is a plain
  function. A task is wrapped in `task()` for isolation/retries/traces.)

### Module 4 — Close (10 min)

- Name what they built and shipped. They have a running fork — this is code they own.
- Point at future iterations: eval harness, guardrails, circuit breakers. "More
  steps, tasks, budgets, tracers. Still the same agent."
- The fork is the handoff. Mock model means they can keep going with zero credentials.

---

## 5. Clock-time run sheet (print this)

Adjust the start time to your slot. Everything else shifts. Modules marked with
a flex icon (~) can be shortened by the amount shown if you're running behind.
Modules marked with a lock icon (!) should never be cut — they carry the core
payoff.

**Example: 9:00 AM start, 90-minute slot**

| Clock | Dur | Module | Flex | Notes |
| --- | --- | --- | --- | --- |
| 9:00 AM | 10 min | **Module 0 — Setup & framing** | ~ can cut to 7 min | Draw the spine. Confirm `render login`. |
| 9:10 AM | 15 min | **Module 1 — Pattern 1** | ~ can cut to 10 min | Deploy, submit PR, show spans, break it on stage. |
| 9:25 AM | 20 min | **Module 2 — Pattern 2** | ~ can cut to 15 min | Deploy, tail worker logs, trace acks, scale, open `kv.ts`. |
| 9:45 AM | 10 min | **Break** | ~ can cut to 0 | Skip if running behind — but people need it. |
| 9:55 AM | 20 min | **Module 3 — Pattern 3** | ~ can cut to 12 min | Blueprint + CLI Workflow, run task, show trace, fan-out table. |
| 10:15 AM | 25 min | **Lab — Author a task** | ! never cut below 20 min | The finale. Steps 1–3 minimum; 4–5 if time allows. |
| 10:40 AM | 10 min | **Module 4 — Close** | ~ can cut to 5 min | Re-draw spine, exit ticket, point at future iterations. |
| 10:50 AM | — | **End** | | |

**If you're 10+ min behind at the break:** cut Module 3 to 12 min (skip the
Dashboard walkthrough — just show the CLI and the trace) and start the Lab with
"steps 1–3 only, ship-live is homework." Protect the Lab's minimum 20 min —
it's the reason they came.

**Transition cues (say these at each boundary):**
- Setup → Pattern 1: "Now let's see the simplest version live."
- Pattern 1 → Pattern 2: "That broke. Let's fix durability — but watch what it costs."
- Pattern 2 → Break: "That coordination is real. Hold onto that feeling."
- Break → Pattern 3: "Now watch all of that become a config object."
- Pattern 3 → Lab: "Your turn — bring out your coding agents."
- Lab → Close: "Let's zoom out. What changed in the agent? Nothing."

---

## 6. Solutions

### Lab — `your-review` (compose an agent as a task)

```ts
import { task } from "@renderinc/sdk/workflows";
import { securityReviewer } from "@workshop/agent";
import { storeTracer } from "@workshop/db";

const securityTask = task(
  { name: "security", timeoutSeconds: 120 },
  async (input: { patches: Patch[] }, runId?: string) => {
    return securityReviewer.run(input, { tracer: storeTracer(), runId });
  },
);

// inside yourReview, after you have filtered.patches:
const review = await securityTask({ patches: filtered.patches });
return { ...existingReturn, review: review.text };
```

Bonus (fan out both reviewers):

```ts
import { REVIEWERS } from "@workshop/agent";
const reviews = await Promise.all(
  REVIEWERS.map((agent) =>
    task(
      { name: agent.name },
      async (input: { patches: Patch[] }) => agent.run(input, { tracer: storeTracer() }),
    )({ patches: filtered.patches }),
  ),
);
```

---

## 7. Assessment / exit ticket

Quick checks that learners hit the objectives (use any 2–3):

1. "Give one failure mode of Pattern 1 and the Pattern 2 feature that fixes it."
2. "What two things make up a Render `task()`?" (a config object + an async fn)
3. "Where did the retry logic live in Pattern 2 vs Pattern 3?"
