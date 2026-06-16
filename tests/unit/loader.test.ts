import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadWorkflows } from '../../packages/workflow-agents/src/workflows/loader.js'

const workflowsDir = new URL(
  '../../packages/workflow-agents/src/workflows',
  import.meta.url,
).pathname

test('loadWorkflows auto-discovers the workflow folders', async () => {
  const { mapping, localTasks } = await loadWorkflows(workflowsDir)
  assert.deepEqual(Object.keys(mapping).sort(), ['code-review', 'your-review'])
  assert.equal(typeof localTasks['code-review'], 'function')
  assert.equal(typeof localTasks['your-review'], 'function')
  // Without RENDER_WORKFLOW_SLUG the mapping value is the bare folder name;
  // with it, slugs are "{service}/{folder}" (covered by the integration test).
  assert.equal(mapping['code-review'], 'code-review')
})
