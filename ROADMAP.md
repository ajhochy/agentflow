# AgentFlow Roadmap

Updated June 2026 to reflect the actual state of the project (v1.0.18 on npm).

## Shipped

### Language & tooling (v1.0.x)
- [x] Indentation-based tokenizer, recursive descent parser, AST → WorkflowIR compiler
- [x] Semantic validation (S1–S10)
- [x] CLI (`init`, `compile`, `validate`, `check`, `build`, `run`, `mcp-config`, `models`, `resume`)
- [x] MockRuntime (`--mock`, no API keys needed)
- [x] Example workflows

### Real agent execution
- [x] LLM-backed executors: Claude (Anthropic SDK), OpenRouter, Ollama, Hermes
- [x] **Agent SDK executor** — run workflows on the Claude plan's monthly Agent SDK credit (subscription auth, no API key)
- [x] Per-agent model aliases (multi-model orchestration)
- [x] Tool execution bridge (built-in tools: file_write, file_read, shell_exec, test_runner)
- [x] Context injection from files (`inject_context`)
- [x] Retry with exponential backoff
- [x] State persistence and `resume`

### Validation & transparency
- [x] `output_schema` (JSON Schema) with retry-on-validation-failure and `on_fail: abort | default`
- [x] **ExecutionReceipt**: per-phase execution log, tool calls, side effects, checkpoints, resumability
- [x] **Tool declaration**: MCP `tools/list` describes agents, models, phases, loops, and side effects upfront

## Next — Production hardening (highest priority)

- [x] **Async MCP execution** — `tools/call` returns `{state: "running", instance_id}` after a short sync-wait (`AGENTFLOW_SYNC_TIMEOUT_MS`); poll with the `agentflow_status` tool. Still open: kill orphaned runs on client disconnect, MCP progress notifications.
- [x] **Honest runtime (validation half)** — S12 warns explicitly on every parsed-but-not-executed feature (`human_action_required`, `streaming_batch`, `poll`, `retry`, `rollback_on_fail`, …). Real implementations tracked under "Runtime features" below.
- [x] **S11 validation** — dangling references in `input:`, `done when`, `repeat_while`, and loop payloads/targets now fail validation.
- [ ] **Irreversibility gate** — declarative `irreversible: true` on phases that touch money/deploys: hard stop instead of convention.
- [x] Mock mode for the MCP server (`AGENTFLOW_MOCK=1`, `AGENTFLOW_MOCK_DELAY_MS` for slow-agent simulation)
- [ ] Deduplicate `side_effects.files_written` across loop iterations in the receipt

## Then — Runtime features

- [ ] Parallel phase execution
- [ ] Human-in-the-loop with notifications and timeouts (real implementation)
- [ ] Rollback execution (real implementation)
- [ ] Streaming output support
- [ ] Budget constraints (the agent-sdk executor already reports cost per run; enforce per-workflow caps)

## Later — Developer experience

- [ ] VS Code extension with syntax highlighting
- [ ] Language server (LSP) for autocomplete and diagnostics
- [ ] Watch mode for development
- [ ] Trace mode building on ExecutionReceipt (live, not just post-run)

## Ecosystem (exploratory)

- [ ] Workflow registry and sharing
- [ ] Pre-built agent templates
- [ ] Plugin system for custom tools
- [ ] Web-based workflow visualizer
- [ ] CI/CD integration (GitHub Actions)

## Future considerations

- Conditional branching (`if/else` phases)
- Sub-workflows and workflow composition
- Event-driven triggers (webhooks, cron)
- Observability (OpenTelemetry integration)
