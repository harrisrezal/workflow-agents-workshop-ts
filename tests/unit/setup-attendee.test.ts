import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)
const repoRoot = new URL('../..', import.meta.url).pathname
const setupScript = join(repoRoot, 'scripts/setup-attendee.js')
const blueprintPaths = [
  'packages/naive-agent/render.yaml',
  'packages/queue-agents/render.yaml',
  'packages/workflow-agents/render.yaml',
]
const blueprintFixtures: Record<string, string> = {
  'packages/naive-agent/render.yaml': `projects:
  - name: agents-workshop-naive
    environments:
      - name: production
        databases:
          - name: naive-agent-db
        services:
          - type: web
            name: naive-agent
            envVars:
              - key: DATABASE_URL
                fromDatabase:
                  name: naive-agent-db
                  property: connectionString
`,
  'packages/queue-agents/render.yaml': `projects:
  - name: agents-workshop-queue
    environments:
      - name: production
        databases:
          - name: queue-agents-db
        services:
          - type: keyvalue
            name: queue-agents-valkey
          - type: web
            name: queue-agents-web
            envVars:
              - key: VALKEY_URL
                fromService:
                  name: queue-agents-valkey
                  type: keyvalue
                  property: connectionString
          - type: worker
            name: queue-agents-worker
`,
  'packages/workflow-agents/render.yaml': `projects:
  - name: agents-workshop-workflows
    environments:
      - name: production
        databases:
          - name: workflow-agents-db
        services:
          - type: web
            name: workflow-agents
            envVars:
              - key: DATABASE_URL
                fromDatabase:
                  name: workflow-agents-db
                  property: connectionString
`,
}

async function copyBlueprintsToTempRepo() {
  const root = await mkdtemp(join(tmpdir(), 'attendee-setup-'))

  for (const relativePath of blueprintPaths) {
    const destination = join(root, relativePath)
    const fixture = blueprintFixtures[relativePath]
    assert.ok(fixture)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, fixture)
  }

  return root
}

async function runSetup(root: string, namespace = 'Octo.User') {
  return execFileAsync(process.execPath, [
    setupScript,
    '--root',
    root,
    '--namespace',
    namespace,
  ])
}

async function runSetupWithPositionalNamespace(root: string, namespace: string) {
  return execFileAsync(process.execPath, [setupScript, '--root', root, namespace])
}

async function runSetupWithEqualsNamespace(root: string, namespace: string) {
  return execFileAsync(process.execPath, [
    setupScript,
    '--root',
    root,
    `--namespace=${namespace}`,
  ])
}

async function runSetupWithGithubActor(root: string, actor: string) {
  return execFileAsync(process.execPath, [setupScript, '--root', root], {
    env: {
      ...process.env,
      GITHUB_ACTOR: actor,
    },
  })
}

test('setup script namespaces all blueprint resources and references', async () => {
  const root = await copyBlueprintsToTempRepo()

  await runSetup(root)

  const naive = await readFile(
    join(root, 'packages/naive-agent/render.yaml'),
    'utf8',
  )
  assert.match(naive, /name: octo-user-agents-workshop-naive/)
  assert.match(naive, /name: production/)
  assert.match(naive, /name: octo-user-naive-agent-db/)
  assert.match(naive, /name: octo-user-naive-agent/)
  assert.match(naive, /fromDatabase:\n\s+name: octo-user-naive-agent-db/)

  const worker = await readFile(
    join(root, 'packages/queue-agents/render.yaml'),
    'utf8',
  )
  assert.match(worker, /name: octo-user-queue-agents-valkey/)
  assert.match(worker, /name: octo-user-queue-agents-web/)
  assert.match(worker, /name: octo-user-queue-agents-worker/)
  assert.match(worker, /fromService:\n\s+name: octo-user-queue-agents-valkey/)

  const workflow = await readFile(
    join(root, 'packages/workflow-agents/render.yaml'),
    'utf8',
  )
  assert.match(workflow, /name: octo-user-agents-workshop-workflows/)
  assert.match(workflow, /name: octo-user-workflow-agents-db/)
  assert.match(workflow, /name: octo-user-workflow-agents/)
  assert.match(workflow, /fromDatabase:\n\s+name: octo-user-workflow-agents-db/)
})

test('setup script is idempotent for the same namespace', async () => {
  const root = await copyBlueprintsToTempRepo()

  await runSetup(root)
  await runSetup(root)

  const naive = await readFile(
    join(root, 'packages/naive-agent/render.yaml'),
    'utf8',
  )
  assert.doesNotMatch(naive, /octo-user-octo-user-/)
})

test('setup script uses GITHUB_ACTOR when namespace is omitted', async () => {
  const root = await copyBlueprintsToTempRepo()

  await runSetupWithGithubActor(root, 'Button.User')

  const naive = await readFile(
    join(root, 'packages/naive-agent/render.yaml'),
    'utf8',
  )
  assert.match(naive, /name: button-user-agents-workshop-naive/)
})

test('setup script replaces a previous attendee prefix', async () => {
  const root = await copyBlueprintsToTempRepo()

  await runSetup(root, 'First.User')
  await runSetup(root, 'Second.User')

  const naive = await readFile(
    join(root, 'packages/naive-agent/render.yaml'),
    'utf8',
  )
  assert.match(naive, /name: second-user-agents-workshop-naive/)
  assert.doesNotMatch(naive, /second-user-first-user-/)
})

test('setup script accepts a positional namespace for npm run setup', async () => {
  const root = await copyBlueprintsToTempRepo()

  await runSetupWithPositionalNamespace(root, 'Positional.User')

  const naive = await readFile(
    join(root, 'packages/naive-agent/render.yaml'),
    'utf8',
  )
  assert.match(naive, /name: positional-user-agents-workshop-naive/)
})

test('setup script accepts --namespace=value', async () => {
  const root = await copyBlueprintsToTempRepo()

  await runSetupWithEqualsNamespace(root, 'Equals.User')

  const naive = await readFile(
    join(root, 'packages/naive-agent/render.yaml'),
    'utf8',
  )
  assert.match(naive, /name: equals-user-agents-workshop-naive/)
})
