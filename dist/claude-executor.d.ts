import type { AgentDef } from './types.js';
import type { AgentExecutor } from './runtime.js';
export declare class ClaudeExecutor implements AgentExecutor {
    private client;
    constructor();
    execute(agent: AgentDef, input: Record<string, unknown>): Promise<Record<string, unknown>>;
    private buildSystemPrompt;
    private buildOutputTool;
    private toJsonType;
}
