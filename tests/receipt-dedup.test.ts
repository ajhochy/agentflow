import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowRunner, MockAgentExecutor } from '../src/runtime.js';
import { compileSource } from '../src/compiler.js';

// A loop that rewrites the same phase output files on every iteration.
const LOOP_WORKFLOW = `workflow dedup_test
  agents:
    agent writer
      model: "mock"
      must_produce:
        - draft

    agent editor
      model: "mock"
      mode: adversarial
      must_produce:
        - verdict
        - confidence: float

  phases:
    phase write
      agent: writer
      input: [trigger.task]
      output: [draft]

    phase edit
      agent: editor
      input: [write.draft]
      output: [verdict, confidence]

  loop revise
    phases: [write, edit]
    repeat_while: edit.verdict == "needs_work"
    max_iterations: 3

  done when: edit.confidence >= 0.8
`;

describe('Receipt side_effects dedup', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aflow-dedup-'));
    cwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('files rewritten across loop iterations appear once', async () => {
    const ir = compileSource(LOOP_WORKFLOW);
    const runner = new WorkflowRunner(ir, new MockAgentExecutor(), { outputDir: dir });

    const instance = await runner.run({ task: 'x' });

    // Mock flips verdict → approved at iteration 2, so the loop runs 2 iterations:
    // write.json and edit.json are each written twice but must be deduplicated.
    const written = instance.execution_receipt!.side_effects.files_written;
    const unique = new Set(written);
    expect(written.length).toBe(unique.size); // no duplicates
    expect(instance.loop_iterations.revise).toBeGreaterThanOrEqual(2);

    // Both phase files plus the manifest are present
    expect(written.some((p) => p.endsWith('write.json'))).toBe(true);
    expect(written.some((p) => p.endsWith('edit.json'))).toBe(true);
    expect(written.some((p) => p.endsWith('manifest.json'))).toBe(true);
  });
});
