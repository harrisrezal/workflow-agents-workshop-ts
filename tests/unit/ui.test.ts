delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUiRouter, dashboardHtml } from '@workshop/ui'
import { addFinding, createReview, setReviewResult } from '@workshop/db'

const app = createUiRouter('Test Viewer')

test('GET / serves the dashboard HTML with the title', async () => {
  const res = await app.fetch(new Request('http://test/'))
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /Test Viewer/)
  assert.match(html, /<img class="brand-logo" src="\/render-logo.svg"/)
  assert.match(html, /<main class="shell">/)
  assert.match(html, /<link rel="stylesheet" href="\/dashboard.css" \/>/)
  assert.doesNotMatch(html, /<style>/)
})

test('GET /dashboard.css serves the extracted dashboard stylesheet', async () => {
  const res = await app.fetch(new Request('http://test/dashboard.css'))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /text\/css/)
  const css = await res.text()
  assert.match(css, /--bg: #050505/)
  assert.match(css, /--surface: #111111/)
  assert.match(css, /padding: 48px 24px 24px/)
  assert.match(css, /\.shell \{/)
  assert.match(css, /width: min\(100%, 1280px\)/)
  assert.match(css, /margin: 0 auto/)
  assert.match(css, /font-size: 32px/)
  assert.match(css, /\.status-line:not\(:empty\)/)
  assert.match(css, /\.brand-logo/)
  assert.match(css, /form \{ margin: 0 0 48px; \}/)
  assert.match(css, /padding: 22px 24px/)
  assert.match(css, /\.finding \{/)
  assert.match(css, /tr\.review \{ background: rgba\(22, 22, 22, 0\.96\); \}/)
  assert.match(css, /\.detail \{\n  background: #0b0b0b;/)
  assert.match(css, /background: #101010/)
  assert.match(css, /grid-template-columns: minmax\(280px, 1fr\) auto auto/)
  assert.match(css, /linear-gradient\(rgba\(255, 255, 255, 0\.035\) 1px, transparent 1px\)/)
  assert.match(css, /border-radius: 0/)
  assert.match(css, /border: 1px solid currentColor/)
  assert.match(css, /color-mix\(in srgb, var\(--pill-success-bg\) 14%, transparent\)/)
  assert.match(css, /-webkit-appearance: none/)
  assert.match(css, /z-index: 1/)
  assert.match(css, /\.input-picker/)
  assert.match(css, /\.pr-options/)
  assert.match(css, /padding: 18px 18px/)
  assert.match(css, /\.pr-option-note/)
  assert.match(css, /\.loading \.icon/)
  assert.match(css, /transform-origin: center/)
})

test('GET /render-logo.svg serves the Render logo asset', async () => {
  const res = await app.fetch(new Request('http://test/render-logo.svg'))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/)
  assert.match(await res.text(), /<svg/)
})

test('dashboard HTML escapes titles in the external template', async () => {
  const html = await dashboardHtml('<Test Viewer>')
  assert.match(html, /&lt;Test Viewer&gt;/)
  assert.doesNotMatch(html, /<title><Test Viewer><\/title>/)
})

test('dashboard HTML exposes review progress UI and active-run polling', async () => {
  const html = await dashboardHtml('Test Viewer')
  assert.doesNotMatch(html, /Localhost workshop dashboard/)
  assert.match(html, /id="submit-status"/)
  assert.match(html, /id="workflow-control" class="workflow-control" hidden/)
  assert.match(html, /class="workflow-chevron icon"/)
  assert.match(html, /workflowControl\.parentElement\.classList\.add\('has-workflows'\)/)
  assert.match(html, /setSubmitting\(true\)/)
  assert.match(html, /classList\.toggle\('loading', isSubmitting\)/)
  assert.match(html, /tr\.onclick = \(\) => \{ togglePrOptions\(false\); void toggle\(rv\.id, tr\) \}/)
  assert.doesNotMatch(html, /Starting review/)
  assert.doesNotMatch(html, /Review accepted/)
  assert.doesNotMatch(html, /Auto-refreshing status/)
  assert.match(html, /scheduleActiveRefresh/)
  assert.doesNotMatch(html, /if \(openId\) return/)
  assert.match(html, /void refreshActiveRows\(\)/)
  assert.match(html, /function refreshActiveRows\(\)/)
  assert.match(html, /if \(openId\) \{/)
  assert.match(html, /await toggle\(openId, tr, true\)/)
  assert.match(html, /rows\.querySelectorAll\('tr\.detail'\)\.forEach/)
  assert.match(html, /openSpans/)
  assert.match(html, /tr\.innerHTML = reviewCells\(rv\)/)
  assert.match(html, /tr\.dataset\.reviewId = rv\.id/)
  assert.match(html, /status === 'running' \|\| status === 'queued'/)
})

test('dashboard HTML includes inline Lucide-style icons without external assets', async () => {
  const html = await dashboardHtml('Test Viewer')
  assert.match(html, /class="icon"/)
  assert.match(html, /const iconPaths = /)
  assert.match(html, /function icon\(name\)/)
  assert.match(html, /loader: '<path d="M21 12a9 9 0 1 1-6\.2-8\.6/)
  assert.match(html, /review: '<path d="M2 12s3\.5-7 10-7/)
  assert.match(html, /statusIcon\(rv.status\)/)
  assert.doesNotMatch(html, /<h5>' \+ icon\('sparkles'\)/)
  assert.doesNotMatch(html, /lucide-react/)
})

test('dashboard HTML lets users paste or pick an existing PR URL from one field', async () => {
  const html = await dashboardHtml('Test Viewer')
  assert.match(html, /choose an existing PR/)
  assert.doesNotMatch(html, /demo PR/)
  assert.match(html, /<input id="pr" type="url"/)
  assert.match(html, /id="pr-picker" class="input-picker"/)
  assert.match(html, /id="pr-options" class="pr-options"/)
  assert.match(html, /togglePrOptions\(true\)/)
  assert.doesNotMatch(html, /<datalist/)
  assert.match(html, /https:\/\/github\.com\/mastra-ai\/mastra\/pull\/17704/)
  assert.match(html, /Good when you want the UX reviewer to join the fan-out/)
  assert.match(html, /https:\/\/github\.com\/run-llama\/LlamaIndexTS\/pull\/2234/)
  assert.match(html, /Good for the first Pattern 1 run/)
  assert.match(html, /https:\/\/github\.com\/openai\/openai-agents-js\/pull\/1368/)
  assert.match(html, /Good for showing an agent SDK change/)
  assert.doesNotMatch(html, /https:\/\/github\.com\/octocat\/Hello-World/)
})

test('dashboard HTML uses the black grid theme and boxed markdown content', async () => {
  const html = await dashboardHtml('Test Viewer')
  assert.match(html, /class="markdown-box"/)
  assert.match(html, /renderMarkdown/)
})

test('GET /api/reviews returns the reviews JSON', async () => {
  const id = await createReview('https://github.com/o/r/pull/10')
  const res = await app.fetch(new Request('http://test/api/reviews'))
  assert.equal(res.status, 200)
  const rows = (await res.json()) as Array<{ id: string }>
  assert.ok(rows.some((r) => r.id === id))
})

test('GET /api/reviews/:id returns review + findings', async () => {
  const id = await createReview('https://github.com/o/r/pull/11')
  await addFinding(id, 'security', 'looks fine')
  await setReviewResult(id, { status: 'done', verdict: 'approve' })

  const res = await app.fetch(new Request(`http://test/api/reviews/${id}`))
  assert.equal(res.status, 200)
  const body = (await res.json()) as {
    review: { verdict: string }
    findings: unknown[]
    spans: unknown[]
  }
  assert.equal(body.review.verdict, 'approve')
  assert.equal(body.findings.length, 1)
})

test('GET /api/reviews/:id returns 404 for an unknown id', async () => {
  const res = await app.fetch(new Request('http://test/api/reviews/does-not-exist'))
  assert.equal(res.status, 404)
})
