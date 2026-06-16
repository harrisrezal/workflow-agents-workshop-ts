# @workshop/agent

The **constant core** of the workshop — the code-review agent and its runtime,
imported unchanged by all three patterns (naive, worker, workflow). Nothing here
knows about Render; the substrate decides how the agent is invoked.

The review pipeline:

```
prepareDiff → filterDiff → [ security ‖ performance ‖ ux? ] → judge
```

## Key exports

Each pattern imports these building blocks and composes its own review pipeline
inline — see `naive-agent/src/server.ts`, `queue-agents/src/worker.ts`, and
`workflow-agents/src/workflows/code-review/index.ts`.

- **Pipeline building blocks**: `prepareDiff`, `filterDiff`, `selectReviewers`,
  `toReviewSummary`, `parseDecision`, `sumUsage`.
- `defineAgent(def)` → an `Agent` with an in-process `.run(input, ctx)`.
- The agents: `securityReviewer`, `performanceReviewer`, `uxReviewer`, `judge`,
  plus `REVIEWERS`, `selectReviewers()`, and `hasFrontendFiles()`.
- `prepareDiff(pr)` — GitHub PR URL → per-file patches (public repos, no auth).
- `filterDiff(patches)` — drop noise files before review.
- `parseDecision(text)` — judge output → `{ verdict, reason, findings }`.
- `resolveClient` / `resolveModelSpec` / `MODEL_TIERS` — provider-agnostic model
  client over `fetch` (Anthropic + OpenAI), with a deterministic **mock** client
  when no API key is set (or `AGENT_MODEL=mock`).
- Tools: `defineTool`, `defineMcpSource`, `getToolRegistry`, `loadTools`,
  `registerTool`, `resolveTools` — drop a file in `src/tools/` to register.

## Layout

```
src/
  review.ts        review types + re-exports (parseDecision, toReviewSummary)
  agents.ts        agent definitions + reviewer selection
  agent.ts         defineAgent() → in-process .run()
  loop.ts          the provider-agnostic LLM loop
  model.ts         Anthropic/OpenAI adapters + MockClient
  model-tiers.ts   small/medium/large → concrete models
  prepareDiff.ts   GitHub PR → Patch[]
  filterDiff.ts    noise filtering
  helpers.ts       shared utilities (review, patch, model tier)
  tool.ts / tool-registry.ts   tool helpers + auto-discovered registry
  tools/             one file per tool (auto-discovered by loader.ts)
  types.ts         shared contracts
  index.ts         public surface
```

No API key needed — the mock model lets the full pipeline run offline.
