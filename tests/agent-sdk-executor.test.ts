import {
  AgentSdkExecutor,
  DEFAULT_MAX_TURNS_WITH_TOOLS,
} from '../src/executors/agent-sdk-executor.js';
import type { AgentSdkQueryFn } from '../src/executors/agent-sdk-executor.js';
import type { AgentDef } from '../src/types.js';

// ─── Helpers ───────────────────────────────────────────────────────

const AGENT: AgentDef = {
  id: 'editor',
  mode: 'adversarial',
  must_produce: [
    { name: 'verdict' },
    { name: 'confidence', type: 'float' },
    { name: 'suggestions' },
  ],
} as AgentDef;

function mockQuery(resultText: string, extras: Record<string, unknown> = {}): AgentSdkQueryFn {
  return async function* () {
    yield { type: 'system', subtype: 'init' };
    yield {
      type: 'result',
      subtype: 'success',
      result: resultText,
      total_cost_usd: 0.0042,
      num_turns: 1,
      usage: { input_tokens: 100, output_tokens: 50 },
      ...extras,
    };
  };
}

function capturingQuery(captured: { options?: Record<string, unknown> }): AgentSdkQueryFn {
  return async function* (params) {
    captured.options = params.options;
    yield {
      type: 'result',
      subtype: 'success',
      result: '{"verdict": "approved", "confidence": 1, "suggestions": "none"}',
    };
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('AgentSdkExecutor', () => {
  it('parses plain JSON output and returns metrics', async () => {
    const exec = new AgentSdkExecutor(
      'claude-sonnet-4-5',
      mockQuery('{"verdict": "approved", "confidence": 0.9, "suggestions": "none"}'),
    );
    const { output, metrics } = await exec.execute(AGENT, { draft: 'hello' });
    expect(output.verdict).toBe('approved');
    expect(output.confidence).toBe(0.9);
    expect(metrics?.tool_calls).toBe(0);
  });

  it('extracts JSON from fenced code blocks', async () => {
    const exec = new AgentSdkExecutor(
      'claude-sonnet-4-5',
      mockQuery('Here you go:\n```json\n{"verdict": "Approved!", "confidence": "85"}\n```'),
    );
    const { output } = await exec.execute(AGENT, {});
    expect(output.verdict).toBe('approved');
    expect(output.confidence).toBe(0.85); // normalized from "85"
  });

  it('normalizes verdict variants to approved/needs_work', async () => {
    const exec = new AgentSdkExecutor(
      'claude-sonnet-4-5',
      mockQuery('{"verdict": "Needs Work", "confidence": 0.4}'),
    );
    const { output } = await exec.execute(AGENT, {});
    expect(output.verdict).toBe('needs_work');
  });

  it('throws a clear error on non-success result', async () => {
    const failing: AgentSdkQueryFn = async function* () {
      yield { type: 'result', subtype: 'error_max_turns' };
    };
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', failing);
    await expect(exec.execute(AGENT, {})).rejects.toThrow(/error_max_turns/);
  });

  it('throws a clear error on unparseable output', async () => {
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', mockQuery('not json at all'));
    await expect(exec.execute(AGENT, {})).rejects.toThrow(/unparseable JSON/);
  });

  it('runs tool-less agents with maxTurns 1 and no tools', async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', capturingQuery(captured));
    await exec.execute(AGENT, {});
    expect(captured.options?.maxTurns).toBe(1);
    expect(captured.options?.allowedTools).toEqual([]);
  });

  it('defaults tool-using agents to DEFAULT_MAX_TURNS_WITH_TOOLS and maps tool names', async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', capturingQuery(captured));
    const agent: AgentDef = { ...AGENT, tools: ['file_read', 'shell_exec', 'Glob'] };
    await exec.execute(agent, {});
    expect(captured.options?.maxTurns).toBe(DEFAULT_MAX_TURNS_WITH_TOOLS);
    expect(DEFAULT_MAX_TURNS_WITH_TOOLS).toBeGreaterThanOrEqual(50);
    expect(captured.options?.allowedTools).toEqual(['Read', 'Bash', 'Glob']);
  });

  it('honors an explicit max_turns over the defaults', async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', capturingQuery(captured));
    const agent: AgentDef = { ...AGENT, tools: ['file_edit'], max_turns: 60 };
    await exec.execute(agent, {});
    expect(captured.options?.maxTurns).toBe(60);

    const toolLess: AgentDef = { ...AGENT, max_turns: 3 };
    await exec.execute(toolLess, {});
    expect(captured.options?.maxTurns).toBe(3);
  });

  it('unsets ANTHROPIC_API_KEY so subscription auth is used', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const exec = new AgentSdkExecutor(
      'claude-sonnet-4-5',
      mockQuery('{"verdict": "approved", "confidence": 1}'),
    );
    await exec.execute(AGENT, {});
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('AgentSdkExecutor Headroom routing (subscription path)', () => {
  const PROXY = 'http://localhost:8787';
  const FOCUSED: AgentDef = { ...AGENT, mode: 'focused' };

  it('redirects an eligible agent to the proxy via options.env', async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', capturingQuery(captured), PROXY);
    await exec.execute(FOCUSED, {});
    const env = captured.options?.env as Record<string, string> | undefined;
    expect(env?.ANTHROPIC_BASE_URL).toBe(PROXY);
  });

  it('preserves process.env (spread) so subscription login survives', async () => {
    process.env.HEADROOM_TEST_SENTINEL = 'keepme';
    const captured: { options?: Record<string, unknown> } = {};
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', capturingQuery(captured), PROXY);
    await exec.execute(FOCUSED, {});
    const env = captured.options?.env as Record<string, string> | undefined;
    expect(env?.HEADROOM_TEST_SENTINEL).toBe('keepme');
    expect(env?.ANTHROPIC_API_KEY).toBeUndefined(); // never reintroduced
    delete process.env.HEADROOM_TEST_SENTINEL;
  });

  it('never routes the verifier (adversarial) — no env override', async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', capturingQuery(captured), PROXY);
    await exec.execute(AGENT, {}); // AGENT.mode === 'adversarial'
    expect(captured.options?.env).toBeUndefined();
  });

  it('does not set env when no proxy is configured', async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const exec = new AgentSdkExecutor('claude-sonnet-4-5', capturingQuery(captured), undefined);
    await exec.execute(FOCUSED, {});
    expect(captured.options?.env).toBeUndefined();
  });
});
