/**
 * defineAgent — turn a plain AgentDefinition into a runnable Agent.
 *
 * `agent.run(input, ctx)` runs the loop *in-process*:
 *   1. resolve the agent's tools/MCP sources from the registry (connecting MCP)
 *   2. emit an "agent" span (if a tracer + runId are provided)
 *   3. run the LLM loop
 *   4. close any MCP connections
 *
 * This is the one execution path every substrate shares. naive-agent and
 * queue-agents call `agent.run()` directly; workflow-agents wraps it:
 * `task(agent.name, ({input}) => agent.run(input, ctx))`. No Render coupling
 * lives here.
 */
import { runLoop } from './loop.js'
import { resolveClient } from './model.js'
import { createLogger } from './logger.js'
import { resolveTools } from './tool-registry.js'
import type { Agent, AgentDefinition, AgentInput, AgentResult, RunContext, ToolContext } from './types.js'

export function defineAgent(def: AgentDefinition): Agent {
  return {
    ...def,
    run: (input, ctx = {}) => runAgent(def, input, ctx),
  }
}

async function runAgent(
  def: AgentDefinition,
  input: AgentInput,
  ctx: RunContext,
): Promise<AgentResult> {
  const client = resolveClient(def.model)
  const logger = createLogger({ agent: def.name })
  const signal = ctx.signal ?? new AbortController().signal
  const env = (name: string) => process.env[name]

  const toolCtx: ToolContext = { env, signal, logger }
  const { tools, close } = await resolveTools(def.tools ?? [], toolCtx)

  // Wrap the loop in an "agent" span so telemetry can group each agent's turns.
  const emitsSpans = Boolean(ctx.tracer && ctx.runId)
  const agentSpanId = globalThis.crypto.randomUUID()
  if (emitsSpans) {
    ctx.tracer!.onStart(
      {
        spanId: agentSpanId,
        ...(ctx.parentSpanId ? { parentSpanId: ctx.parentSpanId } : {}),
        runId: ctx.runId!,
        name: def.name,
        kind: 'agent',
      },
      input,
    )
  }

  try {
    const result = await runLoop({
      client,
      model: def.model,
      systemPrompt: def.systemPrompt,
      tools,
      input,
      signal,
      logger,
      env,
      ...(ctx.tracer ? { tracer: ctx.tracer } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      ...(emitsSpans ? { parentSpanId: agentSpanId } : {}),
      ...(def.budget ? { budget: def.budget } : {}),
      ...(def.permissions ? { permissions: def.permissions } : {}),
      ...(def.sampling ? { sampling: def.sampling } : {}),
    })

    if (emitsSpans) {
      ctx.tracer!.onEnd(
        { spanId: agentSpanId, runId: ctx.runId!, name: def.name, kind: 'agent' },
        { ok: true, output: { text: result.text, usage: result.usage } },
      )
    }
    return { text: result.text, usage: result.usage }
  } catch (err) {
    if (emitsSpans) {
      ctx.tracer!.onEnd(
        { spanId: agentSpanId, runId: ctx.runId!, name: def.name, kind: 'agent' },
        { ok: false, error: err instanceof Error ? err.message : String(err) },
      )
    }
    throw err
  } finally {
    await close()
  }
}
