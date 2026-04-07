import type { AgentDef } from '../types.js';
import type { AgentExecutor } from '../runtime.js';
export declare class OllamaExecutor implements AgentExecutor {
    execute(agent: AgentDef, input: Record<string, unknown>): Promise<Record<string, unknown>>;
    private fetchJson;
    private fetchCode;
    private buildSystemPrompt;
    private normalizeOutput;
}
