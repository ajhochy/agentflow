import { AgentSdkExecutor } from '../src/executors/agent-sdk-executor.js';
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
