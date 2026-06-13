import type { AgentDef } from '../types.js';

/**
 * Agent modes whose context must NEVER be routed through a lossy compression
 * proxy. These agents are evidence-critical: the verifier (`adversarial`) lives
 * by "evidence before assertions — stale evidence is not evidence", and the
 * contract writer (`strict`) emits a precise JSON schema. Compressing their
 * inputs risks a false verdict or a broken contract, so they always talk to
 * Anthropic directly. Exploration/implementation agents (focused, reliable,
 * objective, patient) tolerate lossy tool-output compression.
 *
 * This single denylist is shared by every executor that can route through
 * Headroom, so the safety boundary cannot drift between providers.
 */
export const HEADROOM_EXCLUDED_MODES = new Set(['adversarial', 'strict', 'precise']);

/**
 * Decide whether this agent's traffic may be routed through the Headroom
 * compression proxy. Compression is opt-in (a proxy URL must be configured) and
 * is hard-blocked for evidence-critical modes regardless of configuration.
 */
export function shouldRouteThroughHeadroom(
  agent: Pick<AgentDef, 'mode'>,
  proxyUrl?: string,
): boolean {
  if (!proxyUrl) return false;
  return !HEADROOM_EXCLUDED_MODES.has(agent.mode);
}

/** The configured Headroom proxy URL (env-driven), or undefined when off. */
export function headroomProxyUrl(explicit?: string): string | undefined {
  return explicit ?? process.env.HEADROOM_PROXY_URL;
}
