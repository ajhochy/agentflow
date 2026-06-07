import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowRunner, MockAgentExecutor } from '../src/runtime.js';
import { compileSource } from '../src/compiler.js';
import { validate } from '../src/validate.js';

const GATED_WORKFLOW = `workflow deploy_test
  agents:
    agent builder
      model: "mock"
      mode: focused
      must_produce:
        - artifact

    agent deployer
      model: "mock"
      mode: reliable
      must_produce:
        - deploy_url

  phases:
    phase build
      agent: builder
      input: [trigger.task]
      output: [artifact]

    phase deploy
      agent: deployer
      irreversible: true
      input: [build.artifact]
      output: [deploy_url]
`;

describe('Irreversibility gate', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aflow-gate-'));
    // saveState writes to cwd — isolate per test
    cwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test("parser: irreversible: true finisce nell'IR", () => {
    const ir = compileSource(GATED_WORKFLOW);
    const deploy = ir.workflow.phases.find((p) => p.id === 'deploy');
    expect(deploy?.irreversible).toBe(true);
    const build = ir.workflow.phases.find((p) => p.id === 'build');
    expect(build?.irreversible).toBeUndefined();
  });

  test('senza approvazione: pausa al gate, fase irreversibile NON eseguita', async () => {
    const ir = compileSource(GATED_WORKFLOW);
    const runner = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });

    const instance = await runner.run({ task: 'ship it' });

    expect(instance.state).toBe('paused');
    expect(instance.phase_states.build).toBe('completed');
    expect(instance.phase_states.deploy).toBe('pending'); // mai partita
    expect(instance.phase_outputs.deploy).toBeUndefined();

    // Receipt: evento gated + resumability
    const receipt = instance.execution_receipt;
    expect(receipt?.execution_log.some((s) => s.state === 'gated' && s.phase_id === 'deploy')).toBe(
      true,
    );
    expect(receipt?.resumable).toBe(true);
    expect(receipt?.resume_from_phase).toBe('deploy');
  });

  test('con approvazione: il workflow completa, fase eseguita', async () => {
    const ir = compileSource(GATED_WORKFLOW);
    const runner = new WorkflowRunner(ir, new MockAgentExecutor(), {
      outputDir: dir,
      approveIrreversible: true,
    });

    const instance = await runner.run({ task: 'ship it' });

    expect(instance.state).toBe('completed');
    expect(instance.phase_states.deploy).toBe('completed');
    expect(instance.phase_outputs.deploy).toBeDefined();
    expect(instance.execution_receipt?.execution_log.some((s) => s.state === 'gated')).toBe(false);
  });

  test('pausa → resume con approvazione: completa senza rieseguire le fasi fatte', async () => {
    const ir = compileSource(GATED_WORKFLOW);

    // 1) run senza approvazione → pausa
    const r1 = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });
    const paused = await r1.run({ task: 'ship it' });
    expect(paused.state).toBe('paused');
    const buildOutput = paused.phase_outputs.build;

    // 2) resume con approvazione → completa
    const r2 = new WorkflowRunner(ir, new MockAgentExecutor(), {
      outputDir: dir,
      approveIrreversible: true,
    });
    const resumed = await r2.resume(paused.instance_id);

    expect(resumed.state).toBe('completed');
    expect(resumed.phase_states.deploy).toBe('completed');
    // build non rieseguita: output identico dal saved state
    expect(resumed.phase_outputs.build).toEqual(buildOutput);
  });

  test('pausa → resume SENZA approvazione: si ferma di nuovo al gate', async () => {
    const ir = compileSource(GATED_WORKFLOW);

    const r1 = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });
    const paused = await r1.run({ task: 'ship it' });

    const r2 = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });
    const stillPaused = await r2.resume(paused.instance_id);

    expect(stillPaused.state).toBe('paused');
    expect(stillPaused.phase_states.deploy).not.toBe('completed');
  });

  test('S13: fase irreversibile dentro un loop → warning', () => {
    const ir = compileSource(`workflow loop_gate
  agents:
    agent worker
      must_produce:
        - result

  phases:
    phase charge
      agent: worker
      irreversible: true
      input: [trigger.amount]
      output: [result]

  loop retry_charge
    phases: [charge]
    max_iterations: 3
`);
    const result = validate(ir);
    expect(result.warnings.some((w) => w.rule === 'S13')).toBe(true);
  });

  test('S13: fase irreversibile fuori dal loop → nessun warning', () => {
    const ir = compileSource(GATED_WORKFLOW);
    const result = validate(ir);
    expect(result.warnings.some((w) => w.rule === 'S13')).toBe(false);
  });
});
