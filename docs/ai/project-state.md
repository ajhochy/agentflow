---
type: project
---

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

## Consolidation 2026-09-29
- Branch: `mega/2026-09-29-consolidation` (from `origin/main` 609a2e3). PR: PR_URL_PLACEHOLDER. Issues are disabled on this fork, so the tracking content lives in the PR body.
- Folded: `origin/devin/update-skills-1775674828` (tip db4ada6, adds `.agents/skills/testing-cli/SKILL.md`); local `feat/headroom-proxy-routing` (tip 07f6861 = WIP snapshot commit over a6d3f3a; a6d3f3a and the Headroom routing work were already in `origin/main`, the snapshot only adds Obsidian frontmatter to `docs/ai/*`).
- Dropped (already in `origin/main`, or patch-equivalent commit present there): `feat/agent-max-turns` local + origin (4e575aa), `origin/feat/headroom-proxy-routing` (a6d3f3a), `origin/chore/cleanup-drafts` (fa057c7), `origin/chore/v1.0.17-changelog` (33af794), `origin/devin/1775672446-production-ready-fixes` (468d154), `origin/feat/execution-receipt` (1409441), `origin/feat/hermes-executor` (a610c19), `origin/feat/schema-validation` (7160a42), `origin/fix/ci-format` (5baec56), `origin/fix/prettier` (5b62ec4), `origin/fix/prettier-schema-validation` (d11ea2c), `origin/fix/readme-no-glue-code` (928604c), `origin/feat/s11-s12-validation` (06b2fec, `git cherry` patch already in main), `origin/fix/prettier-receipt` (f50e4c5, `git cherry` patch already in main). Bundle: `~/Documents/.consolidation-backups/agentflow-2026-09-29.bundle`.
- In-flight worktrees: none (single worktree).
- Cleanup script (not yet run): `~/Documents/.consolidation-backups/cleanup/agentflow-2026-09-29-cleanup.sh`.
