# Changelog

All notable changes to AgentFlow DSL will be documented in this file.

## [1.0.19] — 2026-06-07

### Added
- **AgentSdkExecutor** (`provider: "agent-sdk"`): run agents through the Claude Agent SDK with subscription authentication. Usage draws from the plan's monthly Agent SDK credit (Pro $20, Max 5x $100, Max 20x $200 — from June 15, 2026) instead of pay-as-you-go API credits. Requires Claude Code logged in (`claude login`) and the optional dependency `@anthropic-ai/claude-agent-sdk`. New `claude-plan` model alias. The executor unsets `ANTHROPIC_API_KEY` for the process so the SDK uses subscription auth instead of silently billing the API account
- **Async MCP execution**: `tools/call` no longer blocks until the workflow finishes. Fast workflows (< `AGENTFLOW_SYNC_TIMEOUT_MS`, default 45s) still return their full result synchronously; longer ones return `{state: "running", instance_id}` immediately — no more MCP client timeouts
- **`agentflow_status` MCP tool**: poll a running instance for live per-phase progress, loop iterations, execution receipt, and (once finished) phase outputs
- **Irreversibility gate**: phases marked `irreversible: true` (money, deploys, deletions) never execute without explicit approval. Without it the workflow pauses at the gate (`state: paused`, `gated` event in the receipt) and can be resumed after review: CLI `--approve-irreversible` on `run`/`resume`, MCP `approve_irreversible: true` argument
- **`agentflow_resume` MCP tool**: resume paused instances (gate or graceful shutdown) directly from the MCP host, with optional `approve_irreversible`
- **Mock mode for the MCP server**: `AGENTFLOW_MOCK=1` runs workflows with mock executors (no API keys needed); `AGENTFLOW_MOCK_DELAY_MS` simulates slow agents
- **S11 validation (dangling references)**: references to undefined phases/agents in `input:`, `done when`, `repeat_while`, and ref-shaped loop payloads now fail validation instead of failing silently at runtime; undefined `send_to` agents are errors, undefined `escalate_to` targets are warnings (escalation is log-only today)
- **S12 validation (honest runtime)**: workflows using parsed-but-not-executed features (`human_action_required`, `streaming_batch`, `poll`, `retry`, `timeout`, `rollback_on_fail`, `completes_when`, `instruction_to_user`, `on_timeout`, workflow `rollback`) now get an explicit warning
- **S13 validation**: warning when an irreversible phase is inside a loop (one approval covers every iteration)
- **Literal loop payloads**: `on_each_iteration.payload` accepts a literal message (e.g. `"Expand to 50 words."`) in addition to `phase.field` references — previously literals silently resolved to `undefined`
- `WorkflowRunner.start()` / `resumeStart()`: non-blocking APIs returning the live instance plus a completion promise (`run()` / `resume()` unchanged)
- New example `deploy-gate.aflow`: build → review → deploy with the gate on the deploy phase

### Fixed
- `custom-domain.aflow` example: `done when` referenced the agent `health_checker` instead of the phase `verify` (caught by S11)

## [1.0.18] — 2026-06-06

### Added
- **ExecutionReceipt**: every workflow run now produces a receipt with execution log (per-phase, per-iteration), tool call counts per agent, side effects (files written), checkpoints, failed steps, and resumability info (`resume_from_phase`)
- **Tool declaration**: `tools/list` now enriches each MCP tool description with a summary of agents, models, phases, loops, built-in tools, and potential side effects — hosts can see what a workflow does *before* calling it
- Receipt exposed in `tools/call` response for full MCP transparency

### Changed
- Executor interface: all executors now return `{ output, metrics }` instead of raw output
- Removed stray draft files from repo root

## [1.0.17] — 2026-05-31

### Added
- **Schema validation**: `output_schema` with JSON Schema support (type, required, properties, minLength/maxLength, minimum/maximum, nested objects)
- **Validation retry**: `validation.retry` with automatic feedback loop when agent output fails schema check
- **Validation gate**: `validation.on_fail` — `abort` (stop workflow) or `default` (backward-compatible, fills with defaults)
- **HermesExecutor**: call Hermes API as a "model" in AgentFlow workflows, enabling tools and creative writing
- **rick_summary.aflow**: example workflow with analyzer → rick_writer → reviewer loop
- **instagram_reel_narration.aflow**: poetry narration pipeline with confidence gate (≥ 0.85)
- Built-in JSON Schema validator (zero-dependency, inline to avoid ESM/CJS conflicts)

### Changed
- Workflow examples now use explicit `trigger.input` instead of `trigger.topic` for MCP compatibility
- OpenRouter executor: increased `max_tokens` default to 4096

## [1.0.16] — 2026-05-28

### Fixed
- CLI `run` command no longer requires `agentflow.config.json` — uses built-in defaults
- OpenRouter executor: repaired truncated JSON responses from token-limited models
- Runtime: missing `must_produce` fields now fill with defaults instead of crashing
- OpenRouter executor: increased `max_tokens` from 1024 to 2048

### Changed
- Updated README with comprehensive documentation and architecture diagram
- Added MIT LICENSE file
- Package metadata: homepage, bugs URL, keywords

## [1.0.15] — 2026-04-08

### Added
- Initial public release
- Tokenizer and recursive descent parser for `.aflow` syntax
- AST → WorkflowIR compiler
- Semantic validation (S1–S10 rules)
- MockRuntime for local testing
- Claude executor (Anthropic SDK, multi-round tool use)
- OpenRouter executor (315+ models via unified API)
- Ollama executor (local execution)
- MCP server (stdio JSON-RPC)
- CLI: `init`, `check`, `run`, `compile`, `validate`, `mcp-config`, `models`, `resume`
- Example workflows: blog-post, code-quality, code-quality-with-plan, custom-domain
- 92 unit tests, 6 test suites
