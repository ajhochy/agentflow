import type { AgentDef } from '../types.js';
import type { AgentExecutor, ExecutionContext } from '../runtime.js';
import type { ModelConfig } from '../model-resolver.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:e4b';

export class OllamaExecutor implements AgentExecutor {
  private model: string;
  private baseUrl: string;
  private options: Record<string, unknown>;

  constructor(modelConfig?: ModelConfig, baseUrl?: string) {
    this.model = modelConfig?.model ?? DEFAULT_MODEL;
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL;
    this.options = (modelConfig?.options ?? {}) as Record<string, unknown>;
  }

  async execute(
    agent: AgentDef,
    input: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<Record<string, unknown>> {
    logger.info(`Esecuzione agente: ${agent.id} (model: ${this.model}, mode: ${agent.mode})`);
    const system = this.buildSystemPrompt(agent, context);

    // Separa i campi "codice" dagli altri
    const codeFields = (agent.must_produce ?? []).filter((i) => i.name === 'code');
    const textFields = (agent.must_produce ?? []).filter((i) => i.name !== 'code');

    // Chiama il modello per i campi testuali
    const textOutput = await this.fetchJson(agent, system, input, textFields);

    // Se c'è un campo code, chiama separatamente in plain text
    if (codeFields.length > 0) {
      const code = await this.fetchCode(agent, system, input);
      textOutput['code'] = code;
    }

    return this.normalizeOutput(textOutput);
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
        fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            format: 'json',
            options: { temperature: 0, ...this.options },
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: `Input:\n${JSON.stringify(input, null, 2)}\n\nDevi produrre ESATTAMENTE questi campi JSON, nessuno di più, nessuno di meno:\n{\n  ${fieldList}\n}\n\nIMPORTANTE: rispondi SOLO con questi campi esatti. Non aggiungere "verdict" o altri campi non richiesti.`,
              },
            ],
          }),
        }),
      `${agent.id}/ollama-chat`,
    );

    logger.debug(`[${agent.id}] fetchJson risposta ricevuta`);

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = (await response.json()) as { message: { content: string } };

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

    const response = await withRetry(
      () =>
        fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            format: 'json',
            options: { temperature: 0, ...this.options },
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: `Input:\n${JSON.stringify(input, null, 2)}\n\nRispondi con JSON: { "code": "<codice TypeScript completo>" }\nIl campo code deve contenere SOLO il codice, niente altro.`,
              },
            ],
          }),
        }),
      `${agent.id}/ollama-code`,
    );

    logger.debug(`[${agent.id}] fetchCode risposta ricevuta`);

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = (await response.json()) as { message: { content: string } };

    try {
      const parsed = JSON.parse(data.message.content);
      if (typeof parsed === 'object' && parsed !== null) {
        const code =
          parsed.code ??
          parsed.implementation ??
          parsed.typescript ??
          Object.values(parsed).find(
            (v) => typeof v === 'string' && (v.includes('=>') || v.includes('function')),
          );
        if (code) return String(code);
      }
      return data.message.content;
    } catch {
      return data.message.content
        .replace(/^```[\w]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
    }
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
      const lc = context.loop;
      lines.push(
        `Iterazione ${lc.iteration} di un loop${lc.max_iterations ? ` (max ${lc.max_iterations})` : ''}.`,
      );
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
    // Normalizza verdict a lowercase con underscore
    if (typeof output['verdict'] === 'string') {
      const v = output['verdict'].toLowerCase().replace(/\s+/g, '_');
      output['verdict'] = v.includes('approv') ? 'approved' : 'needs_work';
    }
    return output;
  }
}
