# Render Workflow Agents Workshop

A hands-on workshop that deploys **one agentic code-review use case** across
**three Render execution substrates**: an in-process web service, a web service
plus queue-backed worker, and Render Workflows.

You deploy the same multi-agent PR reviewer (`security`, `performance`, `ux`, then
a `judge`) across progressively more durable execution models. Along the way, you
open live Render URLs, inspect logs and traces in the Dashboard, and use local
development for focused test loops.

The core idea stays the same from start to finish: the agent does not change. The
substrate does.

For someone facilitating this workshop, start with [`facilitator/GUIDE.md`](facilitator/GUIDE.md)
and the guided walkthrough in [`docs/`](docs).

## The three patterns

| Pattern | Package | Substrate | Render primitives | You own |
| --- | --- | --- | --- | --- |
| **1. Naive** | [`packages/naive-agent`](packages/naive-agent) | Agent runs in-process, inside the web request | Web Service + Postgres | Nothing, but no scale or durability |
| **2. Worker** | [`packages/worker-agents`](packages/worker-agents) | Thin producer + background worker over a Valkey queue | Web Service + Background Worker + Key Value + Postgres | The queue, consumer group, acks, retries, and pub/sub |
| **3. Workflows** | [`packages/workflow-agents`](packages/workflow-agents) | Each agent is a Render `task()` in its own container | Web Service + Workflows + Postgres | Nothing. Render does the coordination |

The agent code lives in the shared [`@workshop/agent`](shared/agent) package. The substrate decides how it is invoked.

## Start here

Before you begin, make sure you have:

- A Render account
- A fork or writable copy of this repo on GitHub, GitLab, or Bitbucket
- The Render CLI, for Workflow operations and deploy/log checks
- Node.js >= 22.12, for local tests and fallback runs

Install dependencies from the repo root:

```sh
npm install
```

The apps run without an LLM API key. With no key set, [`@workshop/agent`](shared/agent)
uses a deterministic **mock** model, so live deploys and local tests still work.
Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for real reviews, or force the mock
with `AGENT_MODEL=mock`.

## Workshop path

Follow the guided walkthrough in [`docs/`](docs) in order:

- [`docs/00-setup.md`](docs/00-setup.md) — Fork the repo, connect Render, install
  the CLI, and prepare local test tools
- [`docs/01-naive-agent.md`](docs/01-naive-agent.md) — Deploy Pattern 1 with a
  Blueprint, open the live web service, and see where request-bound agents break
- [`docs/02-worker-agents.md`](docs/02-worker-agents.md) — Deploy Pattern 2 with a
  Blueprint, scale the worker, and hand-write the ack/retry semantics
- [`docs/03-workflow-agents.md`](docs/03-workflow-agents.md) — Use the CLI for
  Pattern 3, create the Workflow service, trigger tasks, and inspect traces
- [`docs/04-author-a-task.md`](docs/04-author-a-task.md) — Ship your own Workflow
  task, compose agents, force retries, and watch the live run
- [`docs/05-future-iterations.md`](docs/05-future-iterations.md) — Move toward
  production with evals, guardrails, circuit breakers, and observability

Patterns 1 and 2 use Blueprints:

- [`packages/naive-agent/render.yaml`](packages/naive-agent/render.yaml) — Web Service + Postgres
- [`packages/worker-agents/render.yaml`](packages/worker-agents/render.yaml) — Web Service + Background Worker + Key Value + Postgres

Each Blueprint creates its own Render project with a `production` environment, so
the services and datastores for each pattern stay grouped in the Dashboard.

Pattern 3 uses both:

- [`packages/workflow-agents/render.yaml`](packages/workflow-agents/render.yaml) creates the web service and Postgres database
- `render workflows create` creates the Workflow service
- `render workflows start` triggers task runs
- `render logs`, `render deploys`, and the Dashboard help learners inspect what ran

## Interactive beats

- **Session 1 — hand-roll coordination.** In worker-agents, learners implement
  `processEntry` in [`packages/worker-agents/src/kv.ts`](packages/worker-agents/src/kv.ts):
  ack on success, leave un-acked for retry on failure, verify locally with
  `npm run test:worker`, and redeploy the worker.
- **Session 2 — let agents author tasks.** In workflow-agents, learners explore the
  `your-review` sandbox and work with the small `task()` API surface. The same
  durability that took a whole queue in Session 1 is now a config object, a live
  task run, and a Dashboard trace.

## Local development

Local runs are useful for tests, facilitator prep, and debugging.

For local runs, copy the example env file:

```sh
cp .env.example .env
```

Local services need only what each pattern uses:

```sh
createdb agents_workshop        # Postgres: naive-agent and worker-agents
redis-server &                  # Redis/Valkey: worker-agents only
```

Or run everything with Docker:

```sh
npm run docker:up               # builds and starts all services
# Pattern 1: http://localhost:3001
# Pattern 2: http://localhost:3002
# Pattern 3: http://localhost:3003  (Render workflow dev server on :8120)
npm run docker:down             # stop and remove containers
```

Pattern 3 in Docker runs `scripts/docker-workflow-dev.sh`. The Render CLI dev server
registers tasks on `:8120`, then the gateway on `:3003` dispatches through it.
Trigger from the UI, or run `render workflows tasks list --local` from your host
against `:8120`.

Run any pattern on the host without Docker:

```sh
# Pattern 1: in-process
npm run naive:dev               # http://localhost:3000

# Pattern 2: producer + worker
npm run worker:web              # terminal A: http://localhost:3000
npm run worker:worker           # terminal B: one worker
npm run worker:worker           # terminal C: another worker

# Pattern 3: Render Workflows
npm run dev --workspace @workshop/workflow-agents
npm run dev:workflows --workspace @workshop/workflow-agents
```

Open `http://localhost:3000/` for the shared telemetry viewer, paste a public PR
URL, and watch the review run with per-agent findings and spans.

## Repository structure

Start with the pattern you care about, then follow the shared core the patterns
all import.

```
packages/
  naive-agent/              Pattern 1: in-process web service (Hono)
                              → src/server.ts         POST /api/reviews; awaits runReview()
                              → render.yaml             single-service Blueprint

  worker-agents/            Pattern 2: producer web + background worker (Valkey)
                              → src/web.ts              enqueue jobs, stream SSE progress
                              → src/worker.ts           consume the queue, run runReview()
                              → src/kv.ts               Valkey stream + pub/sub wiring

  workflow-agents/          Pattern 3: Render Workflows gateway + workflow service
                              → src/server.ts           dispatch workflows, GitHub webhooks
                              → src/workflows/code-review/index.ts   the finished pipeline as tasks
                              → src/workflows/your-review/index.ts   sandbox for the hands-on finale

shared/
  agent/                    @workshop/agent — LLM loop, agents, runReview
                              → src/review.ts           runReview() orchestration
                              → src/agents.ts           security, performance, ux, judge definitions
                              → src/loop.ts             provider-agnostic LLM + tool loop

  db/                       @workshop/db — telemetry store (Postgres or in-memory)
                              → src/index.ts            createReview, persistReview, storeTracer
                              → src/memory.ts           in-memory backend for local dev

  ui/                       @workshop/ui — mountable Hono telemetry viewer
                              → src/index.ts            createUiRouter() + read APIs
                              → src/page.ts             dashboard HTML template

docs/                       guided walkthrough (00–05)

facilitator/                facilitator notes and exercise solutions

tests/                      unit, integration, and e2e tests (mock model, no API key)
                              → integration/run-review.test.ts      core pipeline end-to-end
                              → integration/workflow-dispatch.test.ts   Pattern 3 dispatch path
                              → helpers.ts                          GitHub stub + shared fixtures
```

### Shared packages

- **[`@workshop/agent`](shared/agent)** — The substrate-agnostic core. `runReview()`,
  the `defineAgent` reviewers (`securityReviewer`, `performanceReviewer`,
  `uxReviewer`, `judge`), `prepareDiff`/`filterDiff`, the provider-agnostic LLM loop,
  and the mock client. Nothing here knows about Render.
- **[`@workshop/db`](shared/db)** — The durable telemetry record the viewer reads.
  Auto-selects Postgres when `DATABASE_URL` is set, and uses in-memory storage
  otherwise.
- **[`@workshop/ui`](shared/ui)** — A single mountable Hono router that renders the
  reviews table with drill-in to findings and agent spans.

## The code-review pipeline

Every pattern runs the same review:

```
prepareDiff -> filterDiff -> [ security || performance || ux? ] -> judge
```

- `prepareDiff` turns a GitHub PR URL into per-file patches. Public repos need no token.
- `filterDiff` drops noise: lock files, minified assets, source maps, and bundles.
- `security` and `performance` always run in parallel. `ux` joins when the diff
  touches frontend files (`.tsx`, `.jsx`, `.vue`, `.css`, and so on).
- `judge` consolidates findings into an approve / request-changes verdict.

Trigger one against any deployed or local web service:

```sh
curl -s -X POST "$SERVICE_URL/api/reviews" \
  -H 'content-type: application/json' \
  -d '{"prUrl":"https://github.com/octocat/Hello-World/pull/9681"}'
```

## Configuration

All patterns read the same env:

| Var | Used by | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | all | Optional. Deterministic mock model if absent |
| `AGENT_MODEL=mock` | all | Force the mock model even with a key |
| `DATABASE_URL` | naive-agent, worker-agents, workflow-agents | Postgres. In-memory fallback when unset |
| `REDIS_URL` | worker-agents | Queue and pub/sub. Defaults to `redis://127.0.0.1:6379` |
| `PORT` | web tiers | Defaults to `3000` |
| `GITHUB_TOKEN` | all | Optional. Raises rate limits and enables private-repo diffs |
| `GITHUB_WEBHOOK_SECRET` | workflow-agents | HMAC secret for webhook verification |
| `WORKFLOW_API_KEY` | workflow-agents | Optional bearer token protecting `/api/reviews` and `/webhooks/*` |
| `RENDER_USE_LOCAL_DEV` | workflow-agents | Set to `true` only for local dev |
| `RENDER_LOCAL_DEV_URL` | workflow-agents | Local task server URL for Docker or `dev:workflows` |
| `RENDER_API_KEY` | workflow-agents | Required in production Workflow dispatch |

## Testing

All suites run against the deterministic mock model, so they need no LLM provider
API key:

```sh
npm test                 # everything
npm run test:unit        # pure logic
npm run test:integration # per-pattern app + worker kv contract
npm run test:e2e         # end-to-end naive + workflow flows
npm run test:worker      # worker ack/retry contract
npm run typecheck        # TypeScript across every workspace
```

Tests live under [`tests/`](tests) (`unit/`, `integration/`, `e2e/`). The
`worker-kv` integration test is the red-to-green check for the Session 1 exercise.

## Notes

- This is an **npm workspaces** monorepo (`shared/*` and the three `packages/*`).
  Install from the root with a single `npm install`.
- The mock model means the entire pipeline, all three patterns, and the full test
  suite run offline with zero credentials.
- Pattern 3 uses the Render SDK (`@renderinc/sdk/workflows`). Workflows are
  auto-discovered from `src/workflows/`. Any subfolder with an `index.ts` exporting
  a `task()` needs no manual registration.
