import type { ASTWorkflow, WorkflowIR, Duration } from './types.js';
export declare function parseDuration(s: string): Duration;
export declare function compile(ast: ASTWorkflow): WorkflowIR;
export declare function compileSource(source: string): WorkflowIR;
