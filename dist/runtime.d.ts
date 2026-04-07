import type { WorkflowIR, AgentDef, WorkflowInstance } from './types.js';
export interface AgentExecutor {
    execute(agent: AgentDef, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export declare class MockAgentExecutor implements AgentExecutor {
    private iterationCount;
    setIteration(n: number): void;
    execute(agent: AgentDef, _input: Record<string, unknown>): Promise<Record<string, unknown>>;
    private mockValue;
}
export declare class WorkflowRunner {
    private ir;
    private executor;
    constructor(ir: WorkflowIR, executor: AgentExecutor);
    run(triggerInput: Record<string, unknown>): Promise<WorkflowInstance>;
    private executePhase;
    private executeLoop;
    private resolveInputs;
    private evaluateCondition;
    private resolveValue;
    private saveState;
}
