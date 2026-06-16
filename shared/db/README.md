# @workshop/db

The **telemetry store** shared by all three patterns — the durable record the
viewer reads, and the span sink the agent loop writes through.

Three tables (see [`schema.sql`](schema.sql)): `reviews`, `findings`, `spans`.

## Backend selection (automatic)

- `DATABASE_URL` **set** → Postgres (durable; required for multi-process
  queue-agents, where web and worker share state).
- `DATABASE_URL` **unset** → in-memory (keyless, zero-setup local dev).

The public functions have the same shape regardless of backend; the pg path keeps
an optional `pool` parameter for test injection.

## Key exports

- `migrate()` — create the tables (no-op on the in-memory backend).
- Reviews: `createReview`, `setReviewResult`, `getReview`, `listReviews`.
- Findings: `addFinding`, `getFindings`.
- Spans: `getSpans`, and `storeTracer()` — a `Tracer` (from `@workshop/agent`)
  that records agent/LLM/tool spans against a run id.
- Row types: `ReviewRow`, `FindingRow`, `SpanRow`, `ReviewResultUpdate`.

## Layout

```
schema.sql       reviews / findings / spans
src/
  index.ts       public functions; routes to the active backend
  memory.ts      in-memory backend (per-process)
  types.ts       row shapes shared by both backends
```
