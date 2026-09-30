# Testing Guide — agentflow

## How to run checks
- Unit tests: `npm test` (Jest under `--experimental-vm-modules`). Coverage: `npm run test:coverage`.
- Lint: `npm run lint` (`eslint src/`); format check: `npm run format:check` (Prettier on `src/` + `tests/`).
- Type/build: `npm run build` (`tsc`).
- Workflow self-check: `npm run check:all` runs `agentflow check` against `examples/code-quality.aflow` and `examples/custom-domain.aflow`.
- End-to-end dry run: `agentflow run <workflow.aflow> --mock` exercises phases/gates without calling real providers.

## What's covered
- Test suites in `tests/` cover the parser, compiler, runtime, executors (including `agent-sdk-executor` and `claude-executor-headroom`), budget, irreversible gates, HITL rollback, retry, receipt dedup, and async execution. The Headroom work reported the suite at 141 → 145 green. (Pin the exact current count + coverage % here once re-run.)

## What's NOT covered (needs manual verification)
- Live provider calls (Claude API, Agent SDK subscription, OpenRouter, Ollama) — tests mock providers; real-credential runs are manual.
- The Headroom compression proxy path — requires a reachable `HEADROOM_PROXY_URL`; unit tests use an injectable `clientFactory` and don't hit a real proxy.
- MCP integration with Claude Code — verify by launching the MCP server from `dist/` and confirming the `mcp__agentflow__*` tools appear and dispatch.

## Manual smoke
1. `npm run build`, then confirm the MCP server starts: `node bin/agentflow-mcp.js`.
2. In Claude Code, confirm the four workflow tools (`plan_and_issues`, `implement_issue`, `post_merge_smoke`, `improve_prompts`) are listed.
3. Run `agentflow run examples/code-quality.aflow --mock` and confirm all phases complete and human gates pause/resume.
