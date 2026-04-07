import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
// ─── Mock Agent Executor ────────────────────────────────────────────
export class MockAgentExecutor {
    iterationCount = 0;
    setIteration(n) {
        this.iterationCount = n;
    }
    async execute(agent, _input) {
        const output = {};
        if (agent.must_produce) {
            for (const item of agent.must_produce) {
                if (item.name === 'verdict') {
                    output[item.name] = this.iterationCount >= 2 ? 'approved' : 'needs_work';
                }
                else if (item.name === 'confidence') {
                    output[item.name] = this.iterationCount >= 2 ? 0.9 : 0.5;
                }
                else {
                    output[item.name] = this.mockValue(item.type);
                }
            }
        }
        return output;
    }
    mockValue(type) {
        switch (type) {
            case 'bool': return true;
            case 'float': return 0.9;
            case 'int': return 42;
            case 'datetime': return new Date().toISOString();
            case 'date': return new Date().toISOString().split('T')[0];
            case 'array': return [];
            case 'object': return {};
            default: return 'mock_value';
        }
    }
}
// ─── Workflow Runner ────────────────────────────────────────────────
export class WorkflowRunner {
    ir;
    executor;
    constructor(ir, executor) {
        this.ir = ir;
        this.executor = executor;
    }
    async run(triggerInput) {
        const instance = {
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
        // Initialize phase states
        for (const phase of this.ir.workflow.phases) {
            instance.phase_states[phase.id] = 'pending';
        }
        instance.state = 'running';
        try {
            const loop = this.ir.workflow.loop;
            const loopPhaseIds = new Set(loop?.phases ?? []);
            // Execute non-loop phases that come before loop phases
            for (const phase of this.ir.workflow.phases) {
                if (loopPhaseIds.has(phase.id))
                    continue;
                // Check if this phase should run before the loop
                const phaseIdx = this.ir.workflow.phases.indexOf(phase);
                const firstLoopPhaseIdx = loop
                    ? this.ir.workflow.phases.findIndex(p => loopPhaseIds.has(p.id))
                    : -1;
                if (firstLoopPhaseIdx === -1 || phaseIdx < firstLoopPhaseIdx) {
                    await this.executePhase(phase, instance);
                }
            }
            // Execute loop if present
            if (loop) {
                await this.executeLoop(loop, instance);
            }
            // Execute non-loop phases that come after loop phases
            for (const phase of this.ir.workflow.phases) {
                if (loopPhaseIds.has(phase.id))
                    continue;
                if (instance.phase_states[phase.id] === 'completed')
                    continue;
                await this.executePhase(phase, instance);
            }
            // Evaluate done_when
            if (this.ir.workflow.done_when) {
                const done = this.evaluateCondition(this.ir.workflow.done_when, instance);
                if (done) {
                    instance.state = 'completed';
                }
                else {
                    instance.state = 'failed';
                }
            }
            else {
                instance.state = 'completed';
            }
        }
        catch (err) {
            instance.state = 'failed';
            throw err;
        }
        finally {
            instance.completed_at = new Date().toISOString();
            this.saveState(instance);
        }
        return instance;
    }
    async executePhase(phase, instance) {
        const agent = this.ir.workflow.agents[phase.agent];
        if (!agent) {
            throw new Error(`Agent "${phase.agent}" not found for phase "${phase.id}"`);
        }
        instance.phase_states[phase.id] = 'running';
        // Resolve inputs
        const input = this.resolveInputs(phase.input ?? [], instance, phase.id);
        // Log feedback se presente
        if (input['feedback']) {
            process.stderr.write(`  📨 [${phase.agent}] Feedback ricevuto: ${JSON.stringify(input['feedback']).slice(0, 100)}\n`);
        }
        // Execute agent
        const output = await this.executor.execute(agent, input);
        // Verify must_produce
        if (agent.must_produce) {
            const missing = agent.must_produce
                .filter(item => !(item.name in output))
                .map(item => item.name);
            if (missing.length > 0) {
                instance.phase_states[phase.id] = 'failed';
                throw new Error(`missing_output: Agent "${agent.id}" in phase "${phase.id}" did not produce: ${missing.join(', ')}`);
            }
        }
        // Save output
        instance.phase_outputs[phase.id] = output;
        instance.phase_states[phase.id] = 'completed';
    }
    async executeLoop(loop, instance) {
        const maxIter = loop.max_iterations ?? Infinity;
        let iteration = 0;
        instance.loop_iterations[loop.id] = 0;
        // Get ordered loop phases
        const loopPhases = loop.phases
            .map(id => this.ir.workflow.phases.find(p => p.id === id))
            .filter((p) => p !== undefined);
        do {
            iteration++;
            instance.loop_iterations[loop.id] = iteration;
            // Set iteration on mock executor if applicable
            if (this.executor instanceof MockAgentExecutor) {
                this.executor.setIteration(iteration);
            }
            // Execute each phase in the loop
            for (const phase of loopPhases) {
                instance.phase_states[phase.id] = 'pending'; // Reset for re-execution
                // Inietta il feedback del loop come input extra
                if (iteration > 1 && loop.on_each_iteration && phase.agent === loop.on_each_iteration.send_to) {
                    const payloadRef = loop.on_each_iteration.payload;
                    if (payloadRef) {
                        const feedbackValue = this.resolveValue({ kind: 'ref', path: payloadRef }, instance);
                        if (!instance.loop_feedback)
                            instance.loop_feedback = {};
                        instance.loop_feedback[phase.id] = feedbackValue;
                    }
                }
                await this.executePhase(phase, instance);
            }
            // Evaluate repeat_while
            if (loop.repeat_while) {
                const shouldRepeat = this.evaluateCondition(loop.repeat_while, instance);
                if (!shouldRepeat)
                    break;
            }
            else {
                break;
            }
            if (iteration >= maxIter) {
                if (loop.on_max_exceeded) {
                    console.error(`[loop:${loop.id}] Max iterations (${maxIter}) exceeded. ` +
                        `Escalating to: ${loop.on_max_exceeded.escalate_to ?? 'unknown'}. ` +
                        `Message: ${loop.on_max_exceeded.message ?? ''}`);
                }
                break;
            }
        } while (true);
    }
    resolveInputs(inputRefs, instance, phaseId) {
        const result = {};
        for (const ref of inputRefs) {
            const parts = ref.split('.');
            if (parts[0] === 'trigger') {
                const key = parts.slice(1).join('.');
                result[key] = instance.trigger_input[key];
            }
            else {
                // phase.field reference
                const phaseId = parts[0];
                const field = parts.slice(1).join('.');
                const phaseOutput = instance.phase_outputs[phaseId];
                if (phaseOutput && field) {
                    result[field] = phaseOutput[field];
                }
                else if (phaseOutput) {
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
    evaluateCondition(condition, instance) {
        switch (condition.kind) {
            case 'compare': {
                const left = this.resolveValue(condition.left, instance);
                const right = this.resolveValue(condition.right, instance);
                switch (condition.op) {
                    case '==': return left === right;
                    case '!=': return left !== right;
                    case '>': return Number(left) > Number(right);
                    case '<': return Number(left) < Number(right);
                    case '>=': return Number(left) >= Number(right);
                    case '<=': return Number(left) <= Number(right);
                    default: return false;
                }
            }
            case 'and':
                return condition.conditions.every(c => this.evaluateCondition(c, instance));
            case 'or':
                return condition.conditions.some(c => this.evaluateCondition(c, instance));
            case 'not':
                return !this.evaluateCondition(condition.condition, instance);
            default:
                return false;
        }
    }
    resolveValue(expr, instance) {
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
    saveState(instance) {
        try {
            const filename = `${instance.instance_id}.state.json`;
            writeFileSync(filename, JSON.stringify(instance, null, 2));
        }
        catch {
            // Silent fail for state persistence — it's non-critical
        }
    }
}
