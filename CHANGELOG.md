# Changelog

All notable changes to AgentFlow DSL will be documented in this file.

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
