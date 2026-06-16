/**
 * Integration test for the inlined review pipeline.
 *
 * Exercises the same building-block composition that naive-agent uses: import
 * the pieces from @workshop/agent, compose them in-process, and assert that the
 * full prepareDiff → filterDiff → selectReviewers → fan-out → judge pipeline
 * produces the expected result.
 */
delete (process.env as Record<string, unknown>).DATABASE_URL

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../packages/naive-agent/src/server.js'
import { installGithubStub, TEST_PR_URL, DEFAULT_FILES } from '../helpers.js'

let restore: () => void
const app = createApp()

before(() => {
  restore = installGithubStub()
})
after(() => restore())

test('naive-agent composes prepareDiff → filterDiff → reviewers → judge inline (mock model)', async () => {
  const res = await app.fetch(
    new Request('http://test/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prUrl: TEST_PR_URL }),
    }),
  )
  assert.equal(res.status, 200)
  const body = (await res.json()) as { id: string; verdict: string }

  // The mock judge approves.
  assert.equal(body.verdict, 'approve')

  // Verify the persisted review has the right shape.
  const detail = await app.fetch(new Request(`http://test/api/reviews/${body.id}`))
  const data = (await detail.json()) as {
    review: { status: string; verdict: string }
    findings: Array<{ agent: string }>
  }
  assert.equal(data.review.status, 'done')
  assert.equal(data.review.verdict, 'approve')

  // The diff has a .tsx file, so UX joins security + performance. The judge
  // verdict is persisted as its own finding alongside the specialists.
  assert.deepEqual(
    data.findings.map((f) => f.agent).sort(),
    ['judge', 'performance', 'security', 'ux'],
  )
})

test('naive-agent without frontend files skips the UX reviewer', async () => {
  restore()
  restore = installGithubStub([
    { filename: 'src/server.ts', status: 'modified', patch: '@@ -1 +1 @@\n+x\n' },
  ])

  const res = await app.fetch(
    new Request('http://test/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prUrl: TEST_PR_URL }),
    }),
  )
  assert.equal(res.status, 200)
  const body = (await res.json()) as { id: string; verdict: string }

  const detail = await app.fetch(new Request(`http://test/api/reviews/${body.id}`))
  const data = (await detail.json()) as {
    findings: Array<{ agent: string }>
  }
  assert.deepEqual(
    data.findings.map((f) => f.agent).sort(),
    ['judge', 'performance', 'security'],
  )

  // restore default stub for any later tests
  restore()
  restore = installGithubStub(DEFAULT_FILES)
})
