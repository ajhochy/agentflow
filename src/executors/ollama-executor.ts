import type { AgentDef } from '../types.js';
import type { AgentExecutor, ExecutionContext } from '../runtime.js';
import type { ModelConfig } from '../model-resolver.js';
import { logger } from '../logger.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:30b'
const OLLAMA_TIMEOUT_MS = 5 * 60 * 1000 // 5 minuti

export class OllamaExecutor implements AgentExecutor {
  private model: string;

  constructor(modelConfig?: ModelConfig) {
    this.model = modelConfig?.model ?? OLLAMA_MODEL;
  }

  async execute(
    agent: AgentDef,
    input: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<Record<string, unknown>> {
    logger.info(`Esecuzione agente: ${agent.id} (model: ${this.model}, mode: ${agent.mode})`);
    const system = this.buildSystemPrompt(agent, context);

    // Separa i campi "codice" dagli altri
    const codeFields = (agent.must_produce ?? []).filter(i => i.name === 'code')
    const textFields = (agent.must_produce ?? []).filter(i => i.name !== 'code')

    const textOutput = await this.fetchJson(agent, system, input, textFields)

    if (codeFields.length > 0) {
      const code = await this.fetchCode(agent, system, input);
      textOutput['code'] = code;
    }

    return this.normalizeOutput(textOutput);
  }

  private async fetchWithTimeout(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errBody = await response.text()
      process.stderr.write(`  ❌ Ollama ${response.status}: ${errBody.slice(0, 500)}\n`)
    }
    return response
  } finally {
    clearTimeout(timeout)
  }
}

  private async fetchJson(
    agent: AgentDef,
    system: string,
    input: Record<string, unknown>,
    fields: Array<{ name: string; type?: string }>,
  ): Promise<Record<string, unknown>> {
    logger.debug(`[${agent.id}] fetchJson: ${fields.map((f) => f.name).join(', ')}`);

    const safeFields = fields.filter((f) => f.name !== 'code');
    const fieldList = safeFields.map((i) => `"${i.name}": "<${i.type ?? 'string'}>"`).join(',\n  ');

    const response = await this.fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      keep_alive: '10m',
      options: { temperature: 0, think: false, num_ctx: 4096 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Input:\n${JSON.stringify(input, null, 2)}\n\nRispondi con JSON con questi campi:\n{\n  ${fieldList}\n}\n\nNOTA: verdict deve essere ESATTAMENTE "approved" oppure "needs_work"` },
      ],
    })

    logger.debug(`[${agent.id}] fetchJson risposta ricevuta`);

    const data = await response.json() as { message: { content: string } }

    try {
      const parsed = JSON.parse(data.message.content);
      logger.debug(`[${agent.id}] campi ricevuti: ${Object.keys(parsed).join(', ')}`);

      // Normalizzazione fuzzy dei campi mancanti
      const aliases: Record<string, string[]> = {
        test_results: ['results', 'tests', 'test_output', 'testing_results', 'testResults'],
        edge_cases_tried: [
          'edge_cases',
          'edgeCases',
          'edge_case_tried',
          'cases_tried',
          'edgeCasesTried',
        ],
        bug_report: ['bugs', 'bug_reports', 'issues', 'bugReport', 'bugs_found'],
        user_story: ['story', 'userStory', 'user_stories'],
        progress_note: ['progress', 'note', 'notes', 'progressNote'],
        improvement_list: ['improvements', 'improvementList', 'suggestions', 'feedback'],
      };

      for (const [canonical, alts] of Object.entries(aliases)) {
        if (!(canonical in parsed)) {
          for (const alt of alts) {
            if (alt in parsed) {
              parsed[canonical] = parsed[alt];
              break;
            }
          }
        }
      }

      return parsed;
    } catch {
      throw new Error(`[${agent.id}] JSON non parsabile:\n${data.message.content.slice(0, 200)}`);
    }
  }

  private async fetchCode(
    agent: AgentDef,
    system: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    logger.debug(`[${agent.id}] fetchCode...`);

    const response = await this.fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: '10m',
      options: { temperature: 0, think: false, num_ctx: 4096 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Input:\n${JSON.stringify(input, null, 2)}\n\nRispondi con un blocco di codice TypeScript:\n\`\`\`typescript\n// il tuo codice qui\n\`\`\`` },
      ],
    })

    logger.debug(`[${agent.id}] fetchCode risposta ricevuta`);

    const data = await response.json() as { message: { content: string } }
    const content = data.message.content

    // Estrai blocco ```typescript ... ``` o ``` ... ```
    const match = content.match(/```(?:typescript|ts)?\n([\s\S]*?)```/)
    if (match) return match[1].trim()

    // Fallback: pulizia manuale
    return content
      .replace(/^```[\w]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim()
  }

  private buildSystemPrompt(agent: AgentDef, context?: ExecutionContext): string {
    const modeMap: Record<string, string> = {
      adversarial: 'Sei un revisore critico. Trova bug e problemi. Non approvare senza prove.',
      focused: 'Concentrati solo sul task. Nessuna divagazione.',
      reliable: 'Priorità: correttezza. Nessuna scorciatoia.',
      precise: 'Output esatto. Nessuna ambiguità.',
      strict: 'Applica tutte le regole senza eccezioni.',
      patient: 'Analizza con cura prima di rispondere.',
    };

    const lines: string[] = [];
    if (modeMap[agent.mode]) lines.push(modeMap[agent.mode]);
    if (agent.constraints?.length)
      lines.push(`Constraints:\n${agent.constraints.map((c) => `- ${c}`).join('\n')}`);
    if (agent.rules?.length) lines.push(`Regole:\n${agent.rules.map((r) => `- ${r}`).join('\n')}`);

    if (context?.injectedContext) {
      lines.push(`Contesto del progetto:\n${context.injectedContext}`);
    }

    if (context?.loop) {
      const lc = context.loop
      lines.push(`Iterazione ${lc.iteration} di un loop${lc.max_iterations ? ` (max ${lc.max_iterations})` : ''}.`)
      if (lc.acceptance_criteria) {
        lines.push(`Criteri di accettazione: ${lc.acceptance_criteria}`);
      }
    }

    lines.push('Rispondi SEMPRE e SOLO con JSON valido. Nessun testo aggiuntivo.');
    if (agent.must_produce?.length) {
      const required = agent.must_produce
        .filter((f) => f.name !== 'code')
        .map((f) => `"${f.name}"`)
        .join(', ');
      if (required)
        lines.push(
          `Devi produrre OBBLIGATORIAMENTE questi campi: ${required}. NON includere campi "code" nel JSON — il codice viene richiesto separatamente.`,
        );
    }
    return lines.join('\n');
  }

  private normalizeOutput(output: Record<string, unknown>): Record<string, unknown> {
    if (typeof output['verdict'] === 'string') {
      const v = output['verdict'].toLowerCase().replace(/\s+/g, '_');
      output['verdict'] = v.includes('approv') ? 'approved' : 'needs_work';
    }

    if (output['confidence'] !== undefined) {
      const raw = output['confidence']
      if (typeof raw === 'string') {
        const normalized = raw.replace(',', '.').trim()
        const parsed = parseFloat(normalized)
        if (!isNaN(parsed)) {
          output['confidence'] = Math.min(1, Math.max(0, parsed))
        } else {
          const wordMap: Record<string, number> = {
            'alta': 0.9, 'alto': 0.9, 'high': 0.9,
            'media': 0.6, 'medio': 0.6, 'medium': 0.6,
            'bassa': 0.3, 'basso': 0.3, 'low': 0.3,
          }
          output['confidence'] = wordMap[normalized.toLowerCase()] ?? 0.5
        }
      } else if (typeof raw === 'number') {
        output['confidence'] = raw > 1 ? raw / 100 : raw
      }
    }

    return output
  }
}
