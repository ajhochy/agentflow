import type { AgentDef } from '../types.js';
import type { AgentExecutor, ExecutionContext } from '../runtime.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

const HERMES_BASE_URL = process.env.HERMES_API_URL ?? 'http://localhost:5000/v1';
const HERMES_TIMEOUT_MS = 5 * 60 * 1000;

export class HermesExecutor implements AgentExecutor {
  private baseUrl: string;

  constructor() {
    this.baseUrl = HERMES_BASE_URL.replace(/\/+$/, '');
  }

  async execute(
    agent: AgentDef,
    input: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<{
    output: Record<string, unknown>;
    metrics?: import('../types.js').ExecutionMetrics;
  }> {
    logger.info(`Executing agent: ${agent.id} (provider: hermes, mode: ${agent.mode})`);
    const system = this.buildSystemPrompt(agent, context);

    const fields = (agent.must_produce ?? []).filter((i) => i.name !== 'code');
    const codeFields = (agent.must_produce ?? []).filter((i) => i.name === 'code');

    const textOutput = await this.fetchJson(agent, system, input, fields);

    if (codeFields.length > 0) {
      const code = await this.fetchCode(agent, system, input);
      textOutput['code'] = code;
    }

    return { output: this.normalizeOutput(textOutput), metrics: { tool_calls: 0 } };
  }

  private async fetchWithTimeout(body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HERMES_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Hermes ${response.status}: ${errBody.slice(0, 300)}`);
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
    logger.debug(`[${agent.id}] hermes fetchJson: ${fields.map((f) => f.name).join(', ')}`);

    const fieldList = fields.map((i) => `"${i.name}": "<${i.type ?? 'string'}>"`).join(',\n  ');

    const userPrompt = `Input:\n${JSON.stringify(input, null, 2)}\n\nYou must produce EXACTLY these JSON fields, no more, no less:\n{\n  ${fieldList}\n}\n\nIMPORTANT: brief and concise values. No additional text outside the JSON.`;

    const response = await withRetry(
      () =>
        this.fetchWithTimeout({
          model: 'hermes-agent',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userPrompt },
          ],
        }),
      `${agent.id}/hermes-chat`,
    );

    logger.debug(`[${agent.id}] hermes response received`);

    const data = (await response.json()) as {
      choices?: Array<{ message: { content: string } }>;
      error?: { message: string };
    };

    if (!data.choices) {
      logger.error(
        `[${agent.id}] hermes unexpected response: ${JSON.stringify(data).slice(0, 300)}`,
      );
      throw new Error(
        `Hermes response without choices: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }

    const content = data.choices[0]?.message?.content ?? '{}';
    const rawJson = this.extractJson(content);

    try {
      return JSON.parse(rawJson);
    } catch {
      try {
        const repaired = this.repairTruncatedJson(rawJson);
        const parsed = JSON.parse(repaired);
        logger.warn(`[${agent.id}] Hermes JSON was truncated — repaired automatically`);
        return parsed;
      } catch {
        throw new Error(`[${agent.id}] Hermes unparseable JSON:\n${content.slice(0, 200)}`);
      }
    }
  }

  private async fetchCode(
    agent: AgentDef,
    system: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    logger.debug(`[${agent.id}] hermes fetchCode...`);

    const response = await withRetry(
      () =>
        this.fetchWithTimeout({
          model: 'hermes-agent',
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `Input:\n${JSON.stringify(input, null, 2)}\n\nRespond with a TypeScript code block:\n\`\`\`typescript\n// your code here\n\`\`\``,
            },
          ],
        }),
      `${agent.id}/hermes-code`,
    );

    logger.debug(`[${agent.id}] hermes fetchCode response received`);

    const data = (await response.json()) as {
      choices?: Array<{ message: { content: string } }>;
      error?: { message: string };
    };

    if (!data.choices) {
      throw new Error(
        `Hermes response without choices: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`,
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

  private extractJson(raw: string): string {
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

  private repairTruncatedJson(raw: string): string {
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      /* needs repair */
    }

    let result = raw;
    const lastQuote = result.lastIndexOf('"');
    const lastColon = result.lastIndexOf(':');
    if (lastQuote > lastColon) {
      const afterQuote = result.slice(lastQuote + 1);
      if (!afterQuote.includes('"') && !afterQuote.includes('}')) {
        result = result + '"';
      }
    }

    let depth = 0;
    for (const ch of result) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    result += '}'.repeat(Math.max(0, depth));

    return result;
  }

  private buildSystemPrompt(agent: AgentDef, context?: ExecutionContext): string {
    const modeMap: Record<string, string> = {
      adversarial:
        'You are a critical reviewer. Find bugs and issues. Do not approve without concrete evidence.',
      focused: 'Focus only on the task. No digressions.',
      reliable: 'Priority: correctness. No shortcuts.',
      precise: 'Exact output. No ambiguity.',
      strict: 'Apply all rules without exceptions.',
      patient: 'Analyze carefully before responding.',
    };

    const lines: string[] = [];
    if (modeMap[agent.mode]) lines.push(modeMap[agent.mode]);
    if (agent.constraints?.length)
      lines.push(`Constraints:\n${agent.constraints.map((c) => `- ${c}`).join('\n')}`);
    if (agent.rules?.length) lines.push(`Rules:\n${agent.rules.map((r) => `- ${r}`).join('\n')}`);
    if (context?.rollback)
      lines.push(
        `ROLLBACK MODE: You are UNDOING the effects of phase "${context.rollback.undoing}". Do NOT repeat the original action — reverse it (delete, deprovision, revert) and report what you undid.`,
      );
    if (context?.injectedContext) lines.push(`Project context:\n${context.injectedContext}`);

    if (context?.loop) {
      const lc = context.loop;
      lines.push(
        `Iteration ${lc.iteration} of a loop${lc.max_iterations ? ` (max ${lc.max_iterations})` : ''}.`,
      );
      if (lc.acceptance_criteria) lines.push(`Acceptance criteria: ${lc.acceptance_criteria}`);
    }

    lines.push('ALWAYS respond with valid JSON only. No additional text.');
    if (agent.must_produce?.length) {
      const required = agent.must_produce
        .filter((f) => f.name !== 'code')
        .map((f) => `"${f.name}"`)
        .join(', ');
      if (required)
        lines.push(
          `You MUST produce these fields: ${required}. Do NOT include "code" fields in the JSON — code is requested separately.`,
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
