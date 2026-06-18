# Current Plan — agentflow

## Active plan
No active feature milestone — the engine is in maintenance as a fork that tracks upstream while carrying agent-stack-required patches. Work is reactive: keep the `mcp__agentflow__*` workflow tools working for the agent-stack chain, port useful upstream changes selectively, and land fork-only fixes as agent-stack needs them.

## Next steps
1. Decide whether to merge `feat/headroom-proxy-routing`. The A/B test showed ~0.69% efficacy on the live subscription path (prompt caching defeats compression), so if merged it must stay opt-in / off by default.
2. Pin the exact Jest test count + coverage scope in `testing-guide.md`.

## Out of scope / parked
- Blindly merging upstream `anhonestboy/agentflow` — must be done selectively to avoid clobbering fork patches (claude-agent-sdk install, resume `user_inputs`, `max_turns`, Headroom routing).
