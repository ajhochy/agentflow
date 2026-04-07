# AgentFlow Roadmap

## v0.1.0 (Current)
- [x] Indentation-based tokenizer
- [x] Recursive descent parser
- [x] AST → WorkflowIR compiler
- [x] Semantic validation (S1–S10)
- [x] MockRuntime execution
- [x] CLI (compile, validate, check, build, run)
- [x] MCP server (stdio JSON-RPC)
- [x] Example workflows

## v0.2.0 — Real Agent Execution
- [ ] LLM-backed AgentExecutor (Anthropic Claude API)
- [ ] Tool execution bridge (MCP tool calls from agents)
- [ ] Streaming output support
- [ ] Context injection from files

## v0.3.0 — Advanced Runtime
- [ ] Parallel phase execution
- [ ] Real polling with backoff strategies
- [ ] Retry with exponential backoff
- [ ] Rollback execution
- [ ] Human-in-the-loop with notifications
- [ ] State persistence and recovery

## v0.4.0 — Developer Experience
- [ ] VS Code extension with syntax highlighting
- [ ] Language server (LSP) for autocomplete and diagnostics
- [ ] `agentflow init` scaffolding command
- [ ] Watch mode for development
- [ ] Debug/trace mode with detailed execution logs

## v0.5.0 — Ecosystem
- [ ] Workflow registry and sharing
- [ ] Pre-built agent templates
- [ ] Plugin system for custom tools
- [ ] Web-based workflow visualizer
- [ ] CI/CD integration (GitHub Actions)

## Future Considerations
- Conditional branching (`if/else` phases)
- Sub-workflows and workflow composition
- Event-driven triggers (webhooks, cron)
- Multi-model orchestration (different LLMs per agent)
- Cost estimation and budget constraints
- Observability (OpenTelemetry integration)
