import {
  ClaudeExecutor,
  shouldRouteThroughHeadroom,
  HEADROOM_EXCLUDED_MODES,
  type AnthropicLike,
} from '../src/executors/claude-executor.js';
import type { AgentDef } from '../src/types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function agent(mode: string): AgentDef {
  return {
    id: `agent-${mode}`,
    mode,
    tools: [], // no real tools → only produce_output, terminates in one round
    must_produce: [{ name: 'result' }],
  } as AgentDef;
}

type CallLog = { baseURL?: string; calls: number };

/** A fake Anthropic client that records calls and returns a produce_output block. */
function fakeClient(log: CallLog, behavior?: () => void): AnthropicLike {
  return {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: (async (_params: any) => {
        log.calls += 1;
        if (behavior) behavior();
        return {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: '1', name: 'produce_output', input: { result: 'ok' } }],
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

/**
 * Build an executor whose factory hands out a distinct fake per baseURL, so a
 * test can tell whether the proxy client or the direct client was used.
 */
function executorWithSpies(
  proxyUrl: string | undefined,
  proxyBehavior?: () => void,
): { exec: ClaudeExecutor; direct: CallLog; proxy: CallLog } {
  const direct: CallLog = { baseURL: undefined, calls: 0 };
  const proxy: CallLog = { baseURL: proxyUrl, calls: 0 };
  const exec = new ClaudeExecutor({
    headroomProxyUrl: proxyUrl,
    clientFactory: ({ baseURL }) =>
      baseURL ? fakeClient(proxy, proxyBehavior) : fakeClient(direct),
  });
  return { exec, direct, proxy };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('shouldRouteThroughHeadroom', () => {
  it('is false when no proxy URL is configured (opt-in)', () => {
    expect(shouldRouteThroughHeadroom(agent('focused'), undefined)).toBe(false);
  });

  it('blocks evidence-critical modes even when a proxy is configured', () => {
    for (const mode of HEADROOM_EXCLUDED_MODES) {
      expect(shouldRouteThroughHeadroom(agent(mode), 'http://localhost:8787')).toBe(false);
    }
  });

  it('allows exploration/implementation modes when a proxy is configured', () => {
    for (const mode of ['focused', 'reliable', 'objective', 'patient']) {
      expect(shouldRouteThroughHeadroom(agent(mode), 'http://localhost:8787')).toBe(true);
    }
  });
});

describe('ClaudeExecutor proxy routing', () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it('routes an eligible (focused) agent through the proxy client', async () => {
    const { exec, direct, proxy } = executorWithSpies('http://localhost:8787');
    const { output } = await exec.execute(agent('focused'), { task: 'x' });
    expect(output.result).toBe('ok');
    expect(proxy.calls).toBe(1);
    expect(direct.calls).toBe(0);
  });

  it('routes the verifier (adversarial) directly, never through the proxy', async () => {
    const { exec, direct, proxy } = executorWithSpies('http://localhost:8787');
    await exec.execute(agent('adversarial'), { task: 'x' });
    expect(direct.calls).toBe(1);
    expect(proxy.calls).toBe(0);
  });

  it('uses the direct client when no proxy is configured', async () => {
    const { exec, direct, proxy } = executorWithSpies(undefined);
    await exec.execute(agent('focused'), { task: 'x' });
    expect(direct.calls).toBe(1);
    expect(proxy.calls).toBe(0);
  });

  it('fails safe: on proxy connection error, falls back to the direct client', async () => {
    const { exec, direct, proxy } = executorWithSpies('http://localhost:8787', () => {
      throw new Error('fetch failed: ECONNREFUSED');
    });
    const { output } = await exec.execute(agent('focused'), { task: 'x' });
    expect(output.result).toBe('ok');
    expect(proxy.calls).toBeGreaterThanOrEqual(1); // attempted (possibly retried)
    expect(direct.calls).toBe(1); // fell back to direct
  });
});
