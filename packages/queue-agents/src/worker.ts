/**
 * Pattern 2 — queue-agents: background worker (consumer).
 *
 * Pulls review jobs off the Valkey stream and composes the **same building
 * blocks** as naive-agent — the only change is *where* they run. The pipeline
 * is identical:
 *
 *   prepareDiff → filterDiff → selectReviewers → [reviewers…] (Promise.all) → judge
 *
 * But here it executes inside a long-lived queue consumer instead of an HTTP
 * handler, so no request is blocked, a redeploy is drained gracefully, and you
 * can scale workers independently. Progress is published over Valkey pub/sub so
 * the web tier can stream it live to the browser.
 *
 * Note what we're hand-rolling here that workflow-agents (Render Workflows)
 * gives for free: the queue, consumer groups, acks, retry-on-failure, and
 * progress plumbing.
 */
import {
  prepareDiff,
  filterDiff,
  selectReviewers,
  judge,
  toReviewSummary,
} from '@workshop/agent'
import type { ReviewEvent } from '@workshop/agent'
import { migrate, persistReview, setReviewResult, storeTracer } from '@workshop/db'
import { consumeReviews, publishProgress } from './kv.js'

const controller = new AbortController()
process.on('SIGTERM', () => controller.abort())
process.on('SIGINT', () => controller.abort())

await migrate()
console.info(`[queue-agents:worker] ready (pid ${process.pid}), waiting for jobs…`)

await consumeReviews(
  async (job) => {
    console.info(`[queue-agents:worker] picked up review ${job.reviewId} (${job.prUrl})`)

    const emit = (event: ReviewEvent) => publishProgress(job.reviewId, event)
    const ctx = { tracer: storeTracer(), runId: job.reviewId }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  BACKGROUND: these awaits run in a queue consumer, not an HTTP     │
    // │  handler. The web tier already returned 202 to the client. A slow  │
    // │  PR doesn't block any request — it just takes longer in this       │
    // │  worker. Compare with naive-agent (blocking) and workflow-agents   │
    // │  (each step in its own isolated Render task).                      │
    // └─────────────────────────────────────────────────────────────────────┘
    try {
      // Step 1 — Fetch the PR diff from GitHub.
      await emit({ type: 'phase', phase: 'prepare' })
      const allPatches = await prepareDiff({ url: job.prUrl, labels: [] })

      // Step 2 — Drop noise before the expensive fan-out.
      const { patches, dropped } = filterDiff(allPatches)
      await emit({
        type: 'phase',
        phase: 'filter',
        detail: `${patches.length} files (${dropped.length} noise dropped)`,
      })

      // Step 3 — Select reviewers (UX joins when frontend files are present).
      const reviewers = selectReviewers(patches)
      await emit({ type: 'phase', phase: 'review', detail: reviewers.map((r) => r.name).join(', ') })

      // Step 4 — Fan out reviewers in parallel. Progress events stream to the
      // browser via pub/sub — the hand-rolled equivalent of Render Workflow
      // traces. If a reviewer is slow, the others still finish independently.
      const reviews = await Promise.all(
        reviewers.map(async (agent) => {
          await emit({ type: 'agent_start', agent: agent.name })
          const result = await agent.run({ patches }, ctx)
          await emit({ type: 'agent_done', agent: agent.name, note: result.text })
          return { agent: agent.name, note: result.text, usage: result.usage }
        }),
      )

      // Step 5 — Judge produces a single verdict from all findings.
      await emit({ type: 'phase', phase: 'judge' })
      const judgeResult = await judge.run(
        { findings: reviews.map(({ agent, note }) => ({ agent, note })) },
        ctx,
      )

      // Step 6 — Summarize and persist (shared helper across all patterns).
      const summary = toReviewSummary(reviews, judgeResult)
      await persistReview(job.reviewId, summary)

      await emit({ type: 'phase', phase: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await setReviewResult(job.reviewId, { status: 'queued', reason: message })
      await emit({ type: 'error', message })
      throw err // leave the message un-acked so the queue can reclaim/retry it
    }
  },
  { signal: controller.signal },
)
