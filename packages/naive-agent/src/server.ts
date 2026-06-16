/**
 * Pattern 1 — Naive agent.
 *
 * One web service. The entire code-review pipeline runs **in-process, inside
 * the HTTP request handler**. The POST handler composes the same building blocks
 * as Patterns 2 and 3:
 *
 *   prepareDiff → filterDiff → selectReviewers → [reviewers…] (Promise.all) → judge
 *
 * Every `await` below blocks this request. A big PR ties up the connection,
 * a redeploy kills in-flight reviews, and concurrent users compete for one
 * process. Compare with queue-agents (queue) and workflow-agents (Render
 * Workflows) to see the same agents on different substrates.
 */
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  prepareDiff,
  filterDiff,
  selectReviewers,
  judge,
  parseDecision,
  toReviewSummary,
} from '@workshop/agent'
import { createReview, migrate, persistReview, setReviewResult, storeTracer } from '@workshop/db'
import { createUiRouter } from '@workshop/ui'

/** Build the Hono app. Exported so tests can drive it via `app.fetch`. */
export function createApp(): Hono {
  const app = new Hono()

  app.get('/healthz', (c) => c.text('ok'))

  app.post('/api/reviews', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { prUrl?: string }
    if (!body.prUrl) return c.json({ error: 'prUrl is required' }, 400)

    const id = await createReview(body.prUrl, { source: 'naive-agent', workflow: 'code-review' })
    const ctx = { tracer: storeTracer(), runId: id }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  BLOCKING: every `await` below holds the HTTP connection open.     │
    // │  The client cannot get a response until the *entire* pipeline      │
    // │  finishes — including multiple LLM round-trips. This is the core   │
    // │  trade-off of Pattern 1: zero infrastructure, zero resilience.     │
    // └─────────────────────────────────────────────────────────────────────┘
    try {
      // Step 1 — Fetch the PR diff from GitHub. This `await` blocks the request.
      const allPatches = await prepareDiff({ url: body.prUrl, labels: [] })

      // Step 2 — Drop noise (lock files, minified bundles) before the expensive
      // LLM fan-out. Deterministic, in-process — no network call.
      const { patches } = filterDiff(allPatches)

      // Step 3 — Decide which reviewers to run. Security + performance always;
      // UX joins only when the diff touches frontend files (.tsx, .css, etc.).
      const reviewers = selectReviewers(patches)

      // Step 4 — Fan out reviewers in parallel. Each `agent.run()` is one or more
      // LLM calls. This `await Promise.all` blocks the request until *every*
      // reviewer finishes — if one is slow, the whole response waits.
      const reviews = await Promise.all(
        reviewers.map(async (agent) => {
          const result = await agent.run({ patches }, ctx)
          return { agent: agent.name, note: result.text, usage: result.usage }
        }),
      )

      // Step 5 — The judge weighs all reviewer findings and produces a single
      // approve / request-changes verdict. Another LLM call, still blocking.
      const judgeResult = await judge.run(
        { findings: reviews.map(({ agent, note }) => ({ agent, note })) },
        ctx,
      )

      // Step 6 — Summarize: parse the verdict, flatten reviewer notes, total
      // tokens. This helper is shared across all three patterns.
      const summary = toReviewSummary(reviews, judgeResult)

      await persistReview(id, summary)
      return c.json({ id, verdict: summary.verdict })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await setReviewResult(id, { status: 'error', reason: message })
      return c.json({ id, error: message }, 500)
    }
  })

  // Telemetry viewer (page + read APIs) at the root.
  app.route('/', createUiRouter('localhost Workshop: Naive Agent'))

  return app
}

// Run as a server only when invoked directly (not when imported by tests).
if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  await migrate()
  const port = Number(process.env.PORT ?? 3000)
  serve({ fetch: createApp().fetch, port }, (info) => {
    console.info(`[naive-agent] listening on http://localhost:${info.port}`)
  })
}
