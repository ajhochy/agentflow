import Anthropic from '@anthropic-ai/sdk'
import type { AgentDef } from '../types.js'
import type { AgentExecutor, ExecutionContext } from '../runtime.js'
import type { ToolRegistry } from '../tools/index.js'

type MessageParam = Anthropic.MessageParam
type ContentBlock = Anthropic.ContentBlock
type ToolParam = Anthropic.Tool

export class ClaudeExecutor implements AgentExecutor {
  private client: Anthropic
  private toolRegistry?: ToolRegistry

  constructor(options?: { toolRegistry?: ToolRegistry }) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY non impostata')
    }
    this.client = new Anthropic()
    this.toolRegistry = options?.toolRegistry
  }

  async execute(agent: AgentDef, input: Record<string, unknown>, context?: ExecutionContext): Promise<Record<string, unknown>> {
    const system = this.buildSystemPrompt(agent, context)

    // Collect real tools for this agent
    const agentTools = this.toolRegistry
      ? this.toolRegistry.getForAgent(agent.tools ?? [])
      : []

    // Build Claude tool params: real tools + produce_output
    const claudeTools: ToolParam[] = [
      ...agentTools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as ToolParam['input_schema'],
      })),
      this.buildOutputTool(agent),
    ]

    const messages: MessageParam[] = [
      { role: 'user', content: JSON.stringify(input, null, 2) },
    ]

    // If agent has real tools, use auto mode so Claude can choose when to call them
    // Otherwise force tool call (produce_output must be called)
    const hasRealTools = agentTools.length > 0
    const maxToolRounds = 10

    for (let round = 0; round < maxToolRounds; round++) {
      const response = await this.client.messages.create({
        model: agent.model ?? 'claude-opus-4-5',
        max_tokens: 8096,
        system,
        messages,
        tools: claudeTools,
        // On first round with real tools: auto. After that or without tools: any (force produce_output)
        tool_choice: hasRealTools && round === 0
          ? { type: 'auto' as const }
          : { type: 'any' as const },
      })

      // Check if produce_output was called
      const produceOutput = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'produce_output'
      )
      if (produceOutput) {
        return produceOutput.input as Record<string, unknown>
      }

      // Collect all tool calls
      const toolCalls = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      )

      if (toolCalls.length === 0) {
        // No tool calls — Claude responded with text only. Push it and ask again.
        if (response.stop_reason === 'end_turn') {
          // Force produce_output on next round
          messages.push({ role: 'assistant', content: response.content as ContentBlock[] })
          messages.push({ role: 'user', content: 'Now call produce_output with all required fields.' })
          continue
        }
        throw new Error(`[${agent.id}] Unexpected response without tool calls`)
      }

      // Execute tool calls and build results
      messages.push({ role: 'assistant', content: response.content as ContentBlock[] })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const call of toolCalls) {
        const tool = agentTools.find(t => t.name === call.name)
        if (tool) {
          process.stderr.write(`  🔧 [${agent.id}] Calling tool: ${call.name}\n`)
          const result = await tool.execute(call.input as Record<string, unknown>)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(result),
          })
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
            is_error: true,
          })
        }
      }

      messages.push({ role: 'user', content: toolResults })
    }

    throw new Error(`[${agent.id}] Max tool rounds (${maxToolRounds}) exceeded without produce_output`)
  }

  private buildSystemPrompt(agent: AgentDef, context?: ExecutionContext): string {
    const modeMap: Record<string, string> = {
      adversarial: 'Sei un revisore critico. Il tuo obiettivo è trovare bug, problemi e debolezze. Non puoi approvare senza prove concrete che tutto funzioni.',
      focused:     'Concentrati esclusivamente sul task. Nessuna divagazione.',
      reliable:    'Priorità assoluta: correttezza e idempotenza. Nessuna scorciatoia.',
      precise:     'Output esatto. Nessuna ambiguità. Nessun testo superfluo.',
      strict:      'Applica tutte le regole senza eccezioni.',
      patient:     'Analizza con attenzione prima di rispondere.',
      objective:   'Valuta i fatti senza bias.',
    }

    const lines: string[] = []

    if (modeMap[agent.mode]) lines.push(modeMap[agent.mode])
    if (agent.constraints?.length) lines.push(`\nConstraints:\n${agent.constraints.map(c => `- ${c}`).join('\n')}`)
    if (agent.rules?.length) lines.push(`\nRegole:\n${agent.rules.map(r => `- ${r}`).join('\n')}`)

    // Inform Claude about available tools
    if (agent.tools?.length) {
      lines.push(`\nHai a disposizione i seguenti tool: ${agent.tools.join(', ')}.`)
      lines.push('Usali quando necessario per completare il task.')
    }

    // Inject rules/context file content
    if (context?.injectedContext) {
      lines.push(`\n--- Contesto del progetto ---\n${context.injectedContext}\n--- Fine contesto ---`)
    }

    // Inject loop context with acceptance criteria
    if (context?.loop) {
      const lc = context.loop;
      lines.push(`\nSei nell'iterazione ${lc.iteration} di un loop${lc.max_iterations ? ` (max ${lc.max_iterations})` : ''}.`)
      if (lc.acceptance_criteria) {
        lines.push(`Criteri di accettazione del workflow: ${lc.acceptance_criteria}`)
        lines.push('Quando questi criteri sono soddisfatti, puoi dare "approved" con la confidence appropriata.')
      }
    }

    lines.push('\nQuando hai completato il lavoro, chiama produce_output con tutti i campi richiesti.')

    return lines.join('\n')
  }

  private buildOutputTool(agent: AgentDef): ToolParam {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const item of agent.must_produce ?? []) {
      const jsonType = this.toJsonType(item.type)
      properties[item.name] = { type: jsonType, description: `Campo richiesto: ${item.name}` }
      required.push(item.name)
    }

    return {
      name: 'produce_output',
      description: `Produci l'output richiesto per l'agente ${agent.id}. Chiama questo tool DOPO aver completato il lavoro.`,
      input_schema: {
        type: 'object' as const,
        properties,
        required,
      }
    }
  }

  private toJsonType(type?: string): string {
    switch (type) {
      case 'bool':                 return 'boolean'
      case 'float': case 'int':   return 'number'
      case 'array':                return 'array'
      case 'object':               return 'object'
      default:                     return 'string'
    }
  }
}
