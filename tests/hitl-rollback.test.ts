import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowRunner, MockAgentExecutor } from '../src/runtime.js';
import type { AgentExecutor, ExecutionContext } from '../src/runtime.js';
import { compileSource } from '../src/compiler.js';
import { validate } from '../src/validate.js';
import type { AgentDef } from '../src/types.js';

// ─── Human-in-the-loop ──────────────────────────────────────────────

const HITL_WORKFLOW = `workflow approval_flow
  agents:
    agent planner
      model: "mock"
      must_produce:
        - plan

    agent executor_agent
      model: "mock"
      must_produce:
        - result

  phases:
    phase plan
      agent: planner
      input: [trigger.task]
      output: [plan]

    phase human_approval
      agent: planner
      type: human_action_required
      timeout: 24h
      instruction_to_user:
        message: "Approve the plan before execution"
      input: [plan.plan]
      output: [approved]

    phase execute
      agent: executor_agent
      input: [human_approval.approved]
      output: [result]
`;

describe('Human-in-the-loop', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aflow-hitl-'));
    cwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('pausa al human_action_required, fasi successive NON eseguite', async () => {
    const ir = compileSource(HITL_WORKFLOW);
    const runner = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });

    const instance = await runner.run({ task: 'do it' });

    expect(instance.state).toBe('paused');
    expect(instance.phase_states.plan).toBe('completed');
    expect(instance.phase_states.human_approval).toBe('awaiting_user');
    expect(instance.phase_states.execute).toBe('pending');

    const receipt = instance.execution_receipt;
    expect(
      receipt?.execution_log.some(
        (s) => s.state === 'awaiting_user' && s.phase_id === 'human_approval',
      ),
    ).toBe(true);
    expect(receipt?.execution_log.find((s) => s.state === 'awaiting_user')?.error).toContain(
      'Approve the plan',
    );
  });

  test('resume con output umano: usa il valore fornito e completa', async () => {
    const ir = compileSource(HITL_WORKFLOW);
    const r1 = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });
    const paused = await r1.run({ task: 'do it' });
    expect(paused.state).toBe('paused');

    const r2 = new WorkflowRunner(ir, new MockAgentExecutor(), {
      outputDir: dir,
      userInputs: { human_approval: { approved: 'yes, ship it' } },
    });
    const resumed = await r2.resume(paused.instance_id);

    expect(resumed.state).toBe('completed');
    expect(resumed.phase_states.human_approval).toBe('completed');
    expect(resumed.phase_outputs.human_approval).toEqual({ approved: 'yes, ship it' });
    expect(resumed.phase_states.execute).toBe('completed');
  });

  test('S12: human_action_required NON è più segnalato come non eseguito', () => {
    const ir = compileSource(HITL_WORKFLOW);
    const result = validate(ir);
    const s12 = result.warnings.filter((w) => w.rule === 'S12' && w.phase === 'human_approval');
    // type human_action_required + instruction_to_user are now executed → only `timeout` remains
    expect(s12.every((w) => !w.message.includes('human_action_required'))).toBe(true);
    expect(s12.some((w) => w.message.includes('timeout'))).toBe(true);
  });
});

// ─── Rollback ───────────────────────────────────────────────────────

const ROLLBACK_WORKFLOW = `workflow provision_flow
  agents:
    agent provisioner
      model: "mock"
      must_produce:
        - resource_id

    agent finalizer
      model: "mock"
      must_produce:
        - status

  phases:
    phase provision
      agent: provisioner
      input: [trigger.name]
      output: [resource_id]

    phase finalize
      agent: finalizer
      input: [provision.resource_id]
      output: [status]
      rollback_on_fail:
        undo: [provision]
`;

/** Executor that fails for a specific phase's agent, succeeds (and records calls) otherwise. */
class SelectiveExecutor implements AgentExecutor {
  rollbackCalls: string[] = [];

  constructor(private failAgent: string) {}

  async execute(
    agent: AgentDef,
    _input: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<{ output: Record<string, unknown> }> {
    if (context?.rollback) {
      this.rollbackCalls.push(context.rollback.undoing);
      return { output: { undone: true } };
    }
    if (agent.id === this.failAgent) {
      throw new Error(`simulated failure in ${agent.id}`);
    }
    const output: Record<string, unknown> = {};
    for (const item of agent.must_produce ?? []) output[item.name] = `mock-${item.name}`;
    return { output };
  }
}

describe('Rollback on failure', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aflow-rb-'));
    cwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('fase fallita innesca undo: agente re-invocato in rollback mode', async () => {
    const ir = compileSource(ROLLBACK_WORKFLOW);
    const exec = new SelectiveExecutor('finalizer');
    const runner = new WorkflowRunner(ir, exec, { outputDir: dir });

    await expect(runner.run({ name: 'db' })).rejects.toThrow(/simulated failure/);

    // provision completed, then was rolled back; rollback executor saw the undo target
    expect(exec.rollbackCalls).toEqual(['provision']);
  });

  test('receipt registra lo step rolled_back e lo stato della fase', async () => {
    const ir = compileSource(ROLLBACK_WORKFLOW);
    const exec = new SelectiveExecutor('finalizer');
    const runner = new WorkflowRunner(ir, exec, { outputDir: dir });

    let instance;
    try {
      await runner.run({ name: 'db' });
    } catch {
      /* expected */
    }
    // Reload state to inspect the persisted instance
    const r2 = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });
    // The thrown run still saved state in finally; find it via the runner's saved file
    // Simpler: re-run and capture via the start() handle
    const handle = new WorkflowRunner(ir, new SelectiveExecutor('finalizer'), {
      outputDir: dir,
    }).start({ name: 'db' });
    await handle.done.catch(() => {});
    const inst = handle.instance;
    expect(inst.phase_states.provision).toBe('rolled_back');
    expect(inst.execution_receipt?.execution_log.some((s) => s.state === 'rolled_back')).toBe(true);
    void r2;
    void instance;
  });

  test('undo salta le fasi non completate', async () => {
    // provision itself fails → its own rollback (none) ; finalize never runs
    const ir = compileSource(ROLLBACK_WORKFLOW);
    const exec = new SelectiveExecutor('provisioner');
    const runner = new WorkflowRunner(ir, exec, { outputDir: dir });

    await expect(runner.run({ name: 'db' })).rejects.toThrow(/simulated failure/);
    expect(exec.rollbackCalls).toEqual([]); // nothing to undo
  });

  test('S12: rollback_on_fail NON è più segnalato come non eseguito', () => {
    const ir = compileSource(ROLLBACK_WORKFLOW);
    const result = validate(ir);
    expect(
      result.warnings.some((w) => w.rule === 'S12' && w.message.includes('rollback_on_fail')),
    ).toBe(false);
  });
});
