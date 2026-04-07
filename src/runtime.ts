import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  WorkflowIR,
  AgentDef,
  PhaseDef,
  Condition,
  ValueExpr,
  WorkflowInstance,
  PhaseState,
  WorkflowState,
} from './types.js';
import { logger } from './logger.js';

// ─── Execution Context ─────────────────────────────────────────────

export type ExecutionContext = {
  loop?: {
    iteration: number;
    max_iterations?: number;
    acceptance_criteria?: string;
  };
  injectedContext?: string;
};

// ─── Agent Executor Interface ───────────────────────────────────────

export interface AgentExecutor {
  execute(
    agent: AgentDef,
    input: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<Record<string, unknown>>;
}

// Factory che risolve l'executor giusto per ogni agente (in base al suo model)
export type ExecutorResolver = (agent: AgentDef) => AgentExecutor;

// ─── Mock Agent Executor ────────────────────────────────────────────

export class MockAgentExecutor implements AgentExecutor {
  private iterationCount = 0;

  setIteration(n: number): void {
    this.iterationCount = n;
  }

  async execute(
    agent: AgentDef,
    _input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const output: Record<string, unknown> = {};

    if (agent.must_produce) {
      for (const item of agent.must_produce) {
        if (item.name === 'verdict') {
          output[item.name] = this.iterationCount >= 2 ? 'approved' : 'needs_work';
        } else if (item.name === 'confidence') {
          output[item.name] = this.iterationCount >= 2 ? 0.9 : 0.5;
        } else {
          output[item.name] = this.mockValue(item.type);
        }
      }
    }

    return output;
  }

  private mockValue(type?: string): unknown {
    switch (type) {
      case 'bool':
        return true;
      case 'float':
        return 0.9;
      case 'int':
        return 42;
      case 'datetime':
        return new Date().toISOString();
      case 'date':
        return new Date().toISOString().split('T')[0];
      case 'array':
        return [];
      case 'object':
        return {};
      default:
        return 'mock_value';
    }
  }
}

// ─── Workflow Runner ────────────────────────────────────────────────

export class WorkflowRunner {
  private ir: WorkflowIR;
  private resolveExecutor: ExecutorResolver;
  private outputDir?: string;
  private aborted = false;

  constructor(
    ir: WorkflowIR,
    executor: AgentExecutor | ExecutorResolver,
    options?: { outputDir?: string },
  ) {
    this.ir = ir;
    this.resolveExecutor = typeof executor === 'function' ? executor : () => executor;
    this.outputDir = options?.outputDir;
  }

  /** Register signal handlers for graceful shutdown. Call once before run(). */
  enableGracefulShutdown(): void {
    const handler = () => {
      logger.warn('Shutdown signal received — completing current phase then stopping');
      this.aborted = true;
    };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  }

  async run(triggerInput: Record<string, unknown>): Promise<WorkflowInstance> {
    const instance = this.createInstance(triggerInput);
    return this.execute(instance);
  }

  async resume(instanceId: string): Promise<WorkflowInstance> {
    const instance = this.loadState(instanceId);

    if (instance.workflow_id !== this.ir.workflow.id) {
      throw new Error(
        `workflow_id mismatch: state has "${instance.workflow_id}", IR has "${this.ir.workflow.id}"`,
      );
    }
    if (instance.state === 'completed') {
      throw new Error(`instance "${instanceId}" is already completed`);
    }

    instance.state = 'running';
    return this.execute(instance);
  }

  private createInstance(triggerInput: Record<string, unknown>): WorkflowInstance {
    const instance: WorkflowInstance = {
      instance_id: randomUUID(),
      workflow_id: this.ir.workflow.id,
      state: 'pending',
      trigger_input: triggerInput,
      phase_states: {},
      phase_outputs: {},
      loop_iterations: {},
      loop_feedback: {},
      started_at: new Date().toISOString(),
    };

    for (const phase of this.ir.workflow.phases) {
      instance.phase_states[phase.id] = 'pending';
    }

    return instance;
  }

  private async execute(instance: WorkflowInstance): Promise<WorkflowInstance> {
    instance.state = 'running';

    try {
      const loop = this.ir.workflow.loop;
      const loopPhaseIds = new Set(loop?.phases ?? []);

      // Execute non-loop phases that come before loop phases
      for (const phase of this.ir.workflow.phases) {
        if (this.aborted) break;
        if (loopPhaseIds.has(phase.id)) continue;
        if (instance.phase_states[phase.id] === 'completed') continue;

        const phaseIdx = this.ir.workflow.phases.indexOf(phase);
        const firstLoopPhaseIdx = loop
          ? this.ir.workflow.phases.findIndex((p) => loopPhaseIds.has(p.id))
          : -1;

        if (firstLoopPhaseIdx === -1 || phaseIdx < firstLoopPhaseIdx) {
          await this.executePhase(phase, instance);
        }
      }

      // Execute loop if present
      if (loop && !this.aborted) {
        await this.executeLoop(loop, instance);
      }

      // Execute non-loop phases that come after loop phases
      for (const phase of this.ir.workflow.phases) {
        if (this.aborted) break;
        if (loopPhaseIds.has(phase.id)) continue;
        if (instance.phase_states[phase.id] === 'completed') continue;
        await this.executePhase(phase, instance);
      }

      if (this.aborted) {
        instance.state = 'paused';
        logger.info(`Workflow paused — can be resumed with instance ID ${instance.instance_id}`);
        return instance;
      }

      // Evaluate done_when
      if (this.ir.workflow.done_when) {
        const done = this.evaluateCondition(this.ir.workflow.done_when, instance);
        instance.state = done ? 'completed' : 'failed';
        if (!done) {
          this.logConditionFailure(this.ir.workflow.done_when, instance);
        }
      } else {
        instance.state = 'completed';
      }
    } catch (err) {
      instance.state = 'failed';
      throw err;
    } finally {
      instance.completed_at = new Date().toISOString();
      this.saveState(instance);
      this.writeManifest(instance);
    }

    return instance;
  }

  private async executePhase(
    phase: PhaseDef,
    instance: WorkflowInstance,
    context?: ExecutionContext,
  ): Promise<void> {
    const agent = this.ir.workflow.agents[phase.agent];
    if (!agent) {
      throw new Error(`Agent "${phase.agent}" not found for phase "${phase.id}"`);
    }

    instance.phase_states[phase.id] = 'running';

    // Resolve inputs
    const input = this.resolveInputs(phase.input ?? [], instance, phase.id);

    // Log feedback se presente
    if (input['feedback']) {
      logger.info(
        `[${phase.agent}] Feedback ricevuto: ${JSON.stringify(input['feedback']).slice(0, 100)}`,
      );
    }

    // Resolve inject_context: read referenced file and attach to execution context
    const resolvedContext = this.resolveInjectedContext(agent.inject_context, context);

    // Risolvi l'executor giusto per questo agente (in base al suo model)
    const executor = this.resolveExecutor(agent);

    // Execute agent
    const output = await executor.execute(agent, input, resolvedContext);

    // Verify must_produce
    if (agent.must_produce) {
      const missing = agent.must_produce
        .filter((item) => !(item.name in output))
        .map((item) => item.name);

      if (missing.length > 0) {
        instance.phase_states[phase.id] = 'failed';
        this.saveState(instance);
        throw new Error(
          `missing_output: Agent "${agent.id}" in phase "${phase.id}" did not produce: ${missing.join(', ')}`,
        );
      }
    }

    // Save output
    instance.phase_outputs[phase.id] = output;
    instance.phase_states[phase.id] = 'completed';
    this.saveState(instance);
    this.writePhaseOutput(phase.id, output);
  }

  private async executeLoop(
    loop: import('./types.js').LoopDef,
    instance: WorkflowInstance,
  ): Promise<void> {
    const maxIter = loop.max_iterations ?? Infinity;
    const startIteration = instance.loop_iterations[loop.id] ?? 0;
    let iteration = startIteration > 0 ? startIteration - 1 : 0;
    if (startIteration === 0) instance.loop_iterations[loop.id] = 0;

    // Get ordered loop phases
    const loopPhases = loop.phases
      .map((id) => this.ir.workflow.phases.find((p) => p.id === id))
      .filter((p): p is PhaseDef => p !== undefined);

    do {
      if (this.aborted) break;
      iteration++;
      instance.loop_iterations[loop.id] = iteration;

      // Set iteration on mock executor if applicable
      // Prova con il primo agente del loop per controllare se è un MockAgentExecutor
      const firstLoopAgent = this.ir.workflow.agents[loopPhases[0]?.agent];
      if (firstLoopAgent) {
        const testExecutor = this.resolveExecutor(firstLoopAgent);
        if (testExecutor instanceof MockAgentExecutor) {
          testExecutor.setIteration(iteration);
        }
      }

      // Execute each phase in the loop
      for (const phase of loopPhases) {
        // During a resume iteration, skip already-completed phases
        if (iteration === startIteration && instance.phase_states[phase.id] === 'completed') {
          continue;
        }
        instance.phase_states[phase.id] = 'pending';

        // Inietta il feedback del loop come input extra
        if (
          iteration > 1 &&
          loop.on_each_iteration &&
          phase.agent === loop.on_each_iteration.send_to
        ) {
          const payloadRef = loop.on_each_iteration.payload;
          if (payloadRef) {
            const feedbackValue = this.resolveValue(
              { kind: 'ref', path: payloadRef } as ValueExpr,
              instance,
            );
            if (!instance.loop_feedback) instance.loop_feedback = {};
            instance.loop_feedback[phase.id] = feedbackValue;
          }
        }

        const loopContext: ExecutionContext = {
          loop: {
            iteration,
            max_iterations: maxIter === Infinity ? undefined : maxIter,
            acceptance_criteria: this.ir.workflow.done_when
              ? this.conditionToText(this.ir.workflow.done_when)
              : undefined,
          },
        };
        await this.executePhase(phase, instance, loopContext);
      }

      // Early exit: if done_when is already satisfied, break immediately
      if (this.ir.workflow.done_when) {
        const doneEarly = this.evaluateCondition(this.ir.workflow.done_when, instance);
        if (doneEarly) {
          logger.info(
            `[loop:${loop.id}] done_when satisfied at iteration ${iteration} — exiting early`,
          );
          break;
        }
      }

      // Evaluate repeat_while
      if (loop.repeat_while) {
        const shouldRepeat = this.evaluateCondition(loop.repeat_while, instance);
        if (!shouldRepeat) break;
      } else {
        break;
      }

      if (iteration >= maxIter) {
        if (loop.on_max_exceeded) {
          console.error(
            `[loop:${loop.id}] Max iterations (${maxIter}) exceeded. ` +
              `Escalating to: ${loop.on_max_exceeded.escalate_to ?? 'unknown'}. ` +
              `Message: ${loop.on_max_exceeded.message ?? ''}`,
          );
        }
        break;
      }
    } while (true);
  }

  private resolveInputs(
    inputRefs: string[],
    instance: WorkflowInstance,
    phaseId?: string,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const ref of inputRefs) {
      const parts = ref.split('.');
      if (parts[0] === 'trigger') {
        const key = parts.slice(1).join('.');
        result[key] = instance.trigger_input[key];
      } else {
        // phase.field reference
        const phaseId = parts[0];
        const field = parts.slice(1).join('.');
        const phaseOutput = instance.phase_outputs[phaseId];
        if (phaseOutput && field) {
          result[field] = phaseOutput[field];
        } else if (phaseOutput) {
          Object.assign(result, phaseOutput);
        }
      }
    }

    // Inietta feedback loop se presente per questa fase
    if (phaseId && instance.loop_feedback?.[phaseId]) {
      result['feedback'] = instance.loop_feedback[phaseId];
      result['improvement_list'] = instance.loop_feedback[phaseId];
    }

    return result;
  }

  private evaluateCondition(condition: Condition, instance: WorkflowInstance): boolean {
    switch (condition.kind) {
      case 'compare': {
        const left = this.resolveValue(condition.left, instance);
        const right = this.resolveValue(condition.right, instance);

        switch (condition.op) {
          case '==':
            return left === right;
          case '!=':
            return left !== right;
          case '>':
            return Number(left) > Number(right);
          case '<':
            return Number(left) < Number(right);
          case '>=':
            return Number(left) >= Number(right);
          case '<=':
            return Number(left) <= Number(right);
          default:
            return false;
        }
      }
      case 'and':
        return condition.conditions.every((c) => this.evaluateCondition(c, instance));
      case 'or':
        return condition.conditions.some((c) => this.evaluateCondition(c, instance));
      case 'not':
        return !this.evaluateCondition(condition.condition, instance);
      default:
        return false;
    }
  }

  private resolveValue(expr: ValueExpr, instance: WorkflowInstance): unknown {
    if (expr.kind === 'literal') {
      return expr.value;
    }

    // Ref resolution
    const parts = expr.path.split('.');
    if (parts[0] === 'trigger') {
      return instance.trigger_input[parts.slice(1).join('.')];
    }

    // Check phase outputs first
    const phaseOutput = instance.phase_outputs[parts[0]];
    if (phaseOutput) {
      return phaseOutput[parts.slice(1).join('.')];
    }

    // Check agent-named outputs (e.g. health_checker.domain_resolves)
    // Look through all phase outputs for a phase that uses this agent
    for (const phase of this.ir.workflow.phases) {
      if (phase.agent === parts[0] && instance.phase_outputs[phase.id]) {
        return instance.phase_outputs[phase.id][parts.slice(1).join('.')];
      }
    }

    return undefined;
  }

  private loadState(instanceId: string): WorkflowInstance {
    try {
      const raw = readFileSync(`${instanceId}.state.json`, 'utf-8');
      return JSON.parse(raw) as WorkflowInstance;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`state file not found for instance "${instanceId}"`);
      }
      throw new Error(`failed to load state for "${instanceId}": ${(err as Error).message}`);
    }
  }

  private writePhaseOutput(phaseId: string, output: Record<string, unknown>): void {
    if (!this.outputDir) return;
    try {
      mkdirSync(this.outputDir, { recursive: true });

      // Write full phase output as JSON
      writeFileSync(join(this.outputDir, `${phaseId}.json`), JSON.stringify(output, null, 2));

      // Extract code fields as standalone files
      if (typeof output['code'] === 'string') {
        writeFileSync(join(this.outputDir, `${phaseId}.code.ts`), output['code']);
      }
    } catch {
      // Non-critical — don't break workflow for output persistence
    }
  }

  private writeManifest(instance: WorkflowInstance): void {
    if (!this.outputDir) return;
    try {
      mkdirSync(this.outputDir, { recursive: true });
      const manifest = {
        instance_id: instance.instance_id,
        workflow_id: instance.workflow_id,
        state: instance.state,
        started_at: instance.started_at,
        completed_at: instance.completed_at,
        phases: Object.keys(instance.phase_states).map((id) => ({
          id,
          state: instance.phase_states[id],
          outputs: Object.keys(instance.phase_outputs[id] ?? {}),
        })),
      };
      writeFileSync(join(this.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      // Non-critical
    }
  }

  private resolveInjectedContext(
    injectKey: string | undefined,
    baseContext?: ExecutionContext,
  ): ExecutionContext | undefined {
    if (!injectKey) return baseContext;

    const workflowContext = this.ir.workflow.context as Record<string, unknown> | undefined;
    const filePath = workflowContext?.[injectKey];

    if (typeof filePath !== 'string') {
      logger.warn(`[inject_context] chiave "${injectKey}" non trovata nel workflow context`);
      return baseContext;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return { ...baseContext, injectedContext: content };
    } catch {
      logger.warn(`[inject_context] file "${filePath}" non trovato — skipping`);
      return baseContext;
    }
  }

  private conditionToText(condition: Condition): string {
    switch (condition.kind) {
      case 'compare': {
        const left =
          condition.left.kind === 'ref' ? condition.left.path : String(condition.left.value);
        const right =
          condition.right.kind === 'ref' ? condition.right.path : String(condition.right.value);
        return `${left} ${condition.op} ${right}`;
      }
      case 'and':
        return condition.conditions.map((c) => this.conditionToText(c)).join(' AND ');
      case 'or':
        return condition.conditions.map((c) => this.conditionToText(c)).join(' OR ');
      case 'not':
        return `NOT (${this.conditionToText(condition.condition)})`;
    }
  }

  private logConditionFailure(condition: Condition, instance: WorkflowInstance, prefix = ''): void {
    if (condition.kind === 'compare') {
      const left = this.resolveValue(condition.left, instance);
      const right = this.resolveValue(condition.right, instance);
      const passed = this.evaluateCondition(condition, instance);
      if (!passed) {
        const leftLabel =
          condition.left.kind === 'ref'
            ? condition.left.path
            : JSON.stringify(condition.left.value);
        const rightLabel =
          condition.right.kind === 'ref'
            ? condition.right.path
            : JSON.stringify(condition.right.value);
        logger.warn(
          `[done_when] ${prefix}${leftLabel} ${condition.op} ${rightLabel} → ${JSON.stringify(left)} ${condition.op} ${JSON.stringify(right)} = false`,
        );
      }
    } else if (condition.kind === 'and') {
      for (const c of condition.conditions) {
        this.logConditionFailure(c, instance, prefix);
      }
    } else if (condition.kind === 'or') {
      logger.warn(`[done_when] ${prefix}OR block failed (all conditions false):`);
      for (const c of condition.conditions) {
        this.logConditionFailure(c, instance, prefix + '  ');
      }
    } else if (condition.kind === 'not') {
      this.logConditionFailure(condition.condition, instance, prefix + 'NOT ');
    }
  }

  private saveState(instance: WorkflowInstance): void {
    try {
      const filename = `${instance.instance_id}.state.json`;
      writeFileSync(filename, JSON.stringify(instance, null, 2));
    } catch {
      // Silent fail for state persistence — it's non-critical
    }
  }
}
