import { validate } from '../src/validate.js';
import type { WorkflowIR, AgentDef, PhaseDef, LoopDef } from '../src/types.js';

function makeIR(overrides: Partial<WorkflowIR['workflow']> = {}): WorkflowIR {
  return {
    $schema: 'https://agentflow.dev/ir/v0.1.schema.json',
    $agentflow_version: '0.1.0',
    compiled_at: new Date().toISOString(),
    workflow: {
      id: 'test',
      agents: {},
      phases: [],
      ...overrides,
    },
  };
}

function makeAgent(id: string, overrides: Partial<AgentDef> = {}): AgentDef {
  return { id, mode: 'focused', ...overrides };
}

function makePhase(id: string, overrides: Partial<PhaseDef> = {}): PhaseDef {
  return { id, agent: 'default_agent', type: 'standard', ...overrides };
}

describe('Validator', () => {
  test('S1: fase con agente inesistente → errors include S1', () => {
    const ir = makeIR({
      agents: { writer: makeAgent('writer') },
      phases: [makePhase('validate', { agent: 'nonexistent' })],
    });
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'S1')).toBe(true);
  });

  test('S2: fase con output non in must_produce → errors include S2', () => {
    const ir = makeIR({
      agents: {
        writer: makeAgent('writer', {
          must_produce: [{ name: 'code' }],
        }),
      },
      phases: [makePhase('write', { agent: 'writer', output: ['code', 'missing_field'] })],
    });
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'S2')).toBe(true);
    expect(result.errors.find((e) => e.rule === 'S2')!.message).toContain('missing_field');
  });

  test('S3: loop con fase inesistente → errors include S3', () => {
    const ir = makeIR({
      agents: { writer: makeAgent('writer') },
      phases: [makePhase('write', { agent: 'writer' })],
      loop: {
        id: 'quality_gate',
        phases: ['write', 'nonexistent_phase'],
        max_iterations: 5,
      },
    });
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'S3')).toBe(true);
  });

  test('S5: loop senza max_iterations → errors include S5', () => {
    const ir = makeIR({
      agents: { writer: makeAgent('writer') },
      phases: [makePhase('write', { agent: 'writer' })],
      loop: {
        id: 'infinite_loop',
        phases: ['write'],
      } as LoopDef,
    });
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'S5')).toBe(true);
  });

  test('S9: human_action_required senza timeout → errors include S9', () => {
    const ir = makeIR({
      agents: { user: makeAgent('user') },
      phases: [makePhase('await_user', { agent: 'user', type: 'human_action_required' })],
    });
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'S9')).toBe(true);
  });

  test('S10: fase con poll e retry → errors include S10', () => {
    const ir = makeIR({
      agents: { checker: makeAgent('checker') },
      phases: [
        makePhase('check', {
          agent: 'checker',
          poll: { interval: { value: 5, unit: 'min' } },
          retry: { max_attempts: 3 },
        }),
      ],
    });
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'S10')).toBe(true);
  });

  test('workflow valido → ok: true, errors: []', () => {
    const ir = makeIR({
      agents: {
        writer: makeAgent('writer', {
          must_produce: [{ name: 'code' }, { name: 'tests' }],
        }),
      },
      phases: [makePhase('write', { agent: 'writer', output: ['code', 'tests'] })],
    });
    const result = validate(ir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('S4: agente senza must_produce → warning', () => {
    const ir = makeIR({
      agents: { writer: makeAgent('writer') },
      phases: [makePhase('write', { agent: 'writer' })],
    });
    const result = validate(ir);
    expect(result.warnings.some((w) => w.rule === 'S4')).toBe(true);
  });

  test('S6: must_produce confidence non float → error S6', () => {
    const ir = makeIR({
      agents: {
        critic: makeAgent('critic', {
          must_produce: [{ name: 'confidence', type: 'string' }],
        }),
      },
      phases: [],
    });
    const result = validate(ir);
    expect(result.errors.some((e) => e.rule === 'S6')).toBe(true);
  });

  test('S6: must_produce confidence float → no error', () => {
    const ir = makeIR({
      agents: {
        critic: makeAgent('critic', {
          must_produce: [{ name: 'confidence', type: 'float' }],
        }),
      },
      phases: [],
    });
    const result = validate(ir);
    expect(result.errors.some((e) => e.rule === 'S6')).toBe(false);
  });

  test('S7: agente adversarial con constraint approve → warning', () => {
    const ir = makeIR({
      agents: {
        critic: makeAgent('critic', {
          mode: 'adversarial',
          constraints: ['must approve all code'],
        }),
      },
      phases: [],
    });
    const result = validate(ir);
    expect(result.warnings.some((w) => w.rule === 'S7')).toBe(true);
  });
});
