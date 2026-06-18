# Project State — agentflow

## Current focus
Maintenance of the personal fork (`ajhochy/agentflow`, `origin`) of `anhonestboy/agentflow` (`upstream`). The fork carries patches the agent-stack AI coding workflow depends on — four chain segments compile to `.aflow` workflows exposed as the `mcp__agentflow__*` MCP tools the orchestrator dispatches to. Engine is in active use, not greenfield development.

## Active branch / PR
`feat/headroom-proxy-routing`. No open PR. `AGENTS.md` and `docs/ai/` are new/untracked (workflow scaffolding added 2026-06-18).

## In progress
- Headroom compression-proxy routing landed on both executor paths (claude-executor + agent-sdk-executor) on this branch; A/B test showed ~0.69% efficacy on the live subscription path, so the recommendation is to leave it off by default on agent-sdk.

## Risks / known issues
- Don't blindly `git pull` upstream — it can clobber fork-only patches (claude-agent-sdk install, resume `user_inputs`, `max_turns`, Headroom routing).
- The MCP server must run from this fork's `dist/` (settings launch `node .../bin/agentflow-mcp.js` directly; `npx` would pull the published package and bypass fork patches).
- Evidence-critical agent modes (adversarial verifier, strict contract writer, precise) are structurally hard-blocked from Headroom routing via `src/executors/headroom-routing.ts` — that bypass must never regress.

## Test status
- Jest suite (`npm test`). Headroom work reported the suite at 141→145 green. Pin exact counts/coverage in `testing-guide.md`.

## Next step
Decide whether to merge `feat/headroom-proxy-routing` (Headroom routing) given the low real-world efficacy; keep it opt-in (off by default) if merged.

---
**Run history:** one file per run under `docs/ai/runs/` (surfaced in Obsidian as `ai-runs/`). This snapshot is overwritten in place — it does not accumulate a log.
