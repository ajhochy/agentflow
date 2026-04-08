import type { AgentDef } from '../types.js';
import type { AgentExecutor, ExecutionContext } from '../runtime.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_TIMEOUT_MS = 3 * 60 * 1000;

export class OpenRouterExecutor implements AgentExecutor {
  private apiKey: string;
  private model: string;

  constructor(model: string) {
    const key = process.env.OPENROUTER_API_KEY?.trim() ?? '';
    if (!key) {
      throw new Error('OPENROUTER_API_KEY non impostata');
    }
    this.apiKey = key;
    this.model = model;
  }

  async execute(
    agent: AgentDef,
    input: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<Record<string, unknown>> {
    logger.info(`Esecuzione agente: ${agent.id} (model: ${this.model}, mode: ${agent.mode})`);
    const system = this.buildSystemPrompt(agent, context);

    const codeFields = (agent.must_produce ?? []).filter((i) => i.name === 'code');
    const textFields = (agent.must_produce ?? []).filter((i) => i.name !== 'code');

    const textOutput = await this.fetchJson(agent, system, input, textFields);

    if (codeFields.length > 0) {
      const code = await this.fetchCode(agent, system, input);
      textOutput['code'] = code;
    }

    return this.normalizeOutput(textOutput);
  }

  private async fetchWithTimeout(body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/anhonestboy/MCP-DSL',
          'X-Title': 'AgentFlow',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${errBody.slice(0, 300)}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
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

    const response = await withRetry(
      () =>
        this.fetchWithTimeout({
          model: this.model,
          max_tokens: 1024,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `Input:\n${JSON.stringify(input, null, 2)}\n\nDevi produrre ESATTAMENTE questi campi JSON, nessuno di più, nessuno di meno:\n{\n  ${fieldList}\n}\n\nIMPORTANTE: valori brevi e concisi (max 100 caratteri per campo). Nessun testo aggiuntivo.`,
            },
          ],
        }),
      `${agent.id}/openrouter-chat`,
    );

    logger.debug(`[${agent.id}] fetchJson risposta ricevuta`);

    const data = (await response.json()) as {
      choices?: Array<{ message: { content: string } }>;
      error?: { message: string };
    };

    if (!data.choices) {
      logger.error(`[${agent.id}] risposta inattesa: ${JSON.stringify(data).slice(0, 300)}`);
      throw new Error(
        `OpenRouter risposta senza choices: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }

    const content = data.choices[0]?.message?.content ?? '{}';

    // Estrai il primo blocco JSON valido dal contenuto
    function extractJson(raw: string): string {
      const fenced = raw.match(/```json\s*([\s\S]*?)```/);
      if (fenced) return fenced[1].trim();

      const start = raw.indexOf('{');
      if (start === -1) return '{}';

      let depth = 0;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') {
          depth--;
          if (depth === 0) return raw.slice(start, i + 1);
        }
      }
      return raw.slice(start);
    }

    try {
      const parsed = JSON.parse(extractJson(content));

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
      throw new Error(`[${agent.id}] JSON non parsabile:\n${content.slice(0, 200)}`);
    }
  }

  private async fetchCode(
    agent: AgentDef,
    system: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    logger.debug(`[${agent.id}] fetchCode...`);

    const response = await withRetry(
      () =>
        this.fetchWithTimeout({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `Input:\n${JSON.stringify(input, null, 2)}\n\nRispondi con un blocco di codice TypeScript:\n\`\`\`typescript\n// il tuo codice qui\n\`\`\``,
            },
          ],
        }),
      `${agent.id}/openrouter-code`,
    );

    logger.debug(`[${agent.id}] fetchCode risposta ricevuta`);

    const data = (await response.json()) as {
      choices?: Array<{ message: { content: string } }>;
      error?: { message: string };
    };

    if (!data.choices) {
      logger.error(`[${agent.id}] risposta inattesa: ${JSON.stringify(data).slice(0, 300)}`);
      throw new Error(
        `OpenRouter risposta senza choices: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }

    const content = data.choices[0]?.message?.content ?? '';

    const match = content.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (match) return match[1].trim();

    return content
      .replace(/^```[\w]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
  }

  private buildSystemPrompt(agent: AgentDef, context?: ExecutionContext): string {
    const modeMap: Record<string, string> = {
      adversarial:
        'Sei un revisore critico. Trova bug e problemi. Non approvare senza prove concrete.',
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
    if (context?.injectedContext) lines.push(`Contesto del progetto:\n${context.injectedContext}`);

    if (context?.loop) {
      const lc = context.loop;
      lines.push(
        `Iterazione ${lc.iteration} di un loop${lc.max_iterations ? ` (max ${lc.max_iterations})` : ''}.`,
      );
      if (lc.acceptance_criteria) lines.push(`Criteri di accettazione: ${lc.acceptance_criteria}`);
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
      const raw = output['confidence'];
      if (typeof raw === 'string') {
        const n = parseFloat(raw.replace(',', '.'));
        output['confidence'] = isNaN(n) ? 0.5 : Math.min(1, Math.max(0, n));
      } else if (typeof raw === 'number') {
        output['confidence'] = raw > 1 ? raw / 100 : raw;
      }
    }

    return output;
  }
}
