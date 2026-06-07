import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowRunner, MockAgentExecutor } from '../src/runtime.js';
import { compileSource } from '../src/compiler.js';
import type { AgentDef } from '../src/types.js';
import type { AgentExecutor, ExecutionContext } from '../src/runtime.js';

const SIMPLE_WORKFLOW = `workflow async_test
  agents:
    agent writer
      model: "mock"
      mode: focused
      must_produce:
        - summary

  phases:
    phase write
      agent: writer
      input: [trigger.task]
      output: [summary]
`;

/** Mock executor that resolves only when released — simulates a slow LLM call. */
class SlowExecutor implements AgentExecutor {
  release!: () => void;
  private gate: Promise<void>;

  constructor() {
    this.gate = new Promise((res) => {
      this.release = res;
    });
  }

  async execute(
    _agent: AgentDef,
    _input: Record<string, unknown>,
    _context?: ExecutionContext,
  ): Promise<{ output: Record<string, unknown> }> {
    await this.gate;
    return { output: { summary: 'done after release' } };
  }
}

describe('WorkflowRunner.start (async execution)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aflow-async-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the live instance immediately, before completion', async () => {
    const slow = new SlowExecutor();
    const ir = compileSource(SIMPLE_WORKFLOW);
    const runner = new WorkflowRunner(ir, slow, { outputDir: dir });

    const { instance, done } = runner.start({ task: 'x' });

    // Instance is available right away with a valid id, not yet completed
    expect(instance.instance_id).toMatch(/[0-9a-f-]{36}/);
    expect(['pending', 'running']).toContain(instance.state);
    expect(instance.phase_states.write).not.toBe('completed');

    slow.release();
    const final = await done;

    // Same object, mutated in place — polling the instance sees progress
    expect(final).toBe(instance);
    expect(instance.state).toBe('completed');
    expect(instance.phase_states.write).toBe('completed');
    expect(instance.phase_outputs.write).toEqual({ summary: 'done after release' });
  });

  it('run() still resolves with the completed instance (backward compat)', async () => {
    const ir = compileSource(SIMPLE_WORKFLOW);
    const runner = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });
    const instance = await runner.run({ task: 'x' });
    expect(instance.state).toBe('completed');
  });

  it('done rejects are observable without crashing the caller', async () => {
    const failing: AgentExecutor = {
      async execute() {
        throw new Error('boom');
      },
    };
    const ir = compileSource(SIMPLE_WORKFLOW);
    const runner = new WorkflowRunner(ir, failing, { outputDir: dir });

    const { instance, done } = runner.start({ task: 'x' });
    await expect(done).rejects.toThrow('boom');
    expect(instance.state).toBe('failed');
  });
});
