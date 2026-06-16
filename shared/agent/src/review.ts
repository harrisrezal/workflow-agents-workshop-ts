/**
 * Review types and re-exports.
 *
 * The pipeline building blocks — prepareDiff, filterDiff, selectReviewers,
 * individual agents, toReviewSummary — are composed directly at each call site
 * so the architectural trade-offs are visible where the code runs:
 *
 *   naive-agent     → inline await in the HTTP handler (blocking)
 *   queue-agents    → inline await in the queue consumer (background)
 *   workflow-agents → each step wrapped in task() (isolated, retriable)
 *
 * See each pattern's entry point for the full composition.
 */
import type { TokenUsage, Tracer } from './types.js'
import type { Patch } from './prepareDiff.js'

export type { ReviewFinding, ReviewDecision, ReviewSummary } from './helpers.js'
export { sumUsage, parseDecision, toReviewSummary } from './helpers.js'

export interface ReviewResult {
  prUrl: string
  patches: Patch[]
  reviews: Array<{ agent: string; note: string }>
  decision: { verdict: string; reason: string; findings: Array<Record<string, unknown>>; raw: string }
  usage: TokenUsage
  /**
   * The flat, persist-ready shape (verdict + reason + reviews + usage). Every
   * substrate persists *this* via `persistReview`, so the bookkeeping is shared
   * and only the fan-out differs between patterns.
   */
  summary: { verdict: string; reason: string; reviews: Array<{ agent: string; note: string }>; usage: TokenUsage }
}

export type ReviewEvent =
  | { type: 'phase'; phase: 'prepare' | 'filter' | 'review' | 'judge' | 'done'; detail?: string }
  | { type: 'agent_start'; agent: string }
  | { type: 'agent_done'; agent: string; note: string }
  | { type: 'error'; message: string }

export interface RunReviewOptions {
  onEvent?: (event: ReviewEvent) => void | Promise<void>
  signal?: AbortSignal
  tracer?: Tracer
  /** Ties telemetry spans together — typically the persisted review id. */
  runId?: string
}
