export type ValueExpr = {
    kind: 'ref';
    path: string;
} | {
    kind: 'literal';
    value: string | number | boolean;
};
export type Condition = {
    kind: 'compare';
    left: ValueExpr;
    op: '==' | '!=' | '>' | '<' | '>=' | '<=';
    right: ValueExpr;
} | {
    kind: 'and';
    conditions: Condition[];
} | {
    kind: 'or';
    conditions: Condition[];
} | {
    kind: 'not';
    condition: Condition;
};
export type Duration = {
    value: number;
    unit: 's' | 'min' | 'h' | 'd';
};
export type MustProduceItem = {
    name: string;
    type?: string;
};
export type AgentDef = {
    id: string;
    model?: string;
    mode: string;
    tools?: string[];
    must_produce?: MustProduceItem[];
    inject_context?: string;
    fail_fast?: boolean;
    constraints?: string[];
    rules?: string[];
    has_side_effects?: boolean;
};
export type PollConfig = {
    interval?: Duration;
    backoff?: string;
    max_wait?: Duration;
    condition?: Condition;
};
export type RetryConfig = {
    max_attempts?: number;
    backoff?: Duration | string;
    condition?: Condition;
    on_all_failed?: {
        escalate_to?: string;
        reschedule?: Duration;
    };
};
export type RollbackOnFail = {
    undo: string[];
};
export type OnFailConfig = {
    condition?: Condition;
    action?: string;
    message?: string;
    then?: string;
};
export type InstructionToUser = {
    message: string;
    data?: string;
    format?: string;
};
export type OnTimeoutConfig = {
    action?: string;
    then?: string;
};
export type PhaseDef = {
    id: string;
    agent: string;
    input?: string[];
    output?: string[];
    type: string;
    timeout?: Duration;
    poll?: PollConfig;
    retry?: RetryConfig;
    rollback_on_fail?: RollbackOnFail;
    on_fail?: OnFailConfig;
    instruction_to_user?: InstructionToUser;
    completes_when?: string | Condition;
    on_timeout?: OnTimeoutConfig;
};
export type LoopDef = {
    id: string;
    phases: string[];
    repeat_while?: Condition;
    max_iterations?: number;
    on_each_iteration?: {
        send_to?: string;
        payload?: string;
    };
    on_max_exceeded?: {
        escalate_to?: string;
        message?: string;
        attach?: string[];
    };
};
export type TriggerDef = {
    on_event?: string;
    input?: Array<{
        name: string;
        type: string;
    }>;
};
export type RollbackConfig = {
    priority_order?: string[];
    notify_user?: boolean;
    log_to?: string;
};
export type OnSuccessConfig = {
    notify_user?: {
        message: string;
        attach?: string[];
    };
};
export type WorkflowIR = {
    $schema: string;
    $agentflow_version: string;
    compiled_at: string;
    workflow: {
        id: string;
        description?: string;
        version?: string;
        trigger?: TriggerDef;
        context?: Record<string, ValueExpr | string>;
        agents: Record<string, AgentDef>;
        phases: PhaseDef[];
        loop?: LoopDef;
        done_when?: Condition;
        rollback?: RollbackConfig;
        on_success?: OnSuccessConfig;
    };
};
export type ASTLiteral = {
    kind: 'literal';
    value: string | number | boolean;
    rawType: 'string' | 'number' | 'bool' | 'identifier';
};
export type ASTRef = {
    kind: 'ref';
    path: string;
};
export type ASTList = {
    kind: 'list';
    items: ASTValue[];
};
export type ASTBlock = {
    kind: 'block';
    properties: ASTProperty[];
};
export type ASTCondition = {
    kind: 'condition';
    left: ASTValue;
    op: string;
    right: ASTValue;
    logic?: 'and' | 'or';
    next?: ASTCondition;
};
export type ASTValue = ASTLiteral | ASTRef | ASTList | ASTBlock | ASTCondition;
export type ASTProperty = {
    kind: 'property';
    key: string;
    value: ASTValue;
};
export type ASTAgent = {
    kind: 'agent';
    id: string;
    properties: ASTProperty[];
};
export type ASTPhase = {
    kind: 'phase';
    id: string;
    properties: ASTProperty[];
};
export type ASTLoop = {
    kind: 'loop';
    id: string;
    properties: ASTProperty[];
};
export type ASTWorkflow = {
    kind: 'workflow';
    id: string;
    properties: ASTProperty[];
    agents: ASTAgent[];
    phases: ASTPhase[];
    loop?: ASTLoop;
};
export type ValidationIssue = {
    rule: string;
    message: string;
    phase?: string;
    agent?: string;
};
export type ValidationResult = {
    ok: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
};
export type TokenKind = 'KEYWORD' | 'IDENTIFIER' | 'STRING' | 'NUMBER' | 'BOOL' | 'COLON' | 'LBRACKET' | 'RBRACKET' | 'DOT' | 'PIPE' | 'COMMA' | 'INDENT' | 'DEDENT' | 'NEWLINE' | 'OPERATOR' | 'AND' | 'OR' | 'NOT' | 'DASH' | 'EOF';
export type Token = {
    kind: TokenKind;
    value: string;
    line: number;
    col: number;
};
export type PhaseState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type WorkflowState = 'pending' | 'running' | 'completed' | 'failed';
export type WorkflowInstance = {
    instance_id: string;
    workflow_id: string;
    state: WorkflowState;
    trigger_input: Record<string, unknown>;
    phase_states: Record<string, PhaseState>;
    phase_outputs: Record<string, Record<string, unknown>>;
    loop_iterations: Record<string, number>;
    loop_feedback?: Record<string, unknown>;
    started_at?: string;
    completed_at?: string;
};
