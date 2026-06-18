# Architecture — agentflow

## Overview
A workflow-orchestration engine for multi-agent AI pipelines. Workflows are authored declaratively in `.aflow` files, parsed and compiled into a multi-phase IR, then executed phase-by-phase against pluggable LLM providers. Each compiled workflow is also exposed as a single **MCP tool**, so a `.aflow` becomes a callable tool in Claude Code with zero glue code. First-class language constructs: per-agent model aliases, iterative loops (`repeat_while` / `max_iterations`), typed `must_produce` outputs, per-agent `max_turns` budgets, and `irreversible: true` human-approval gates.

## Stack
- TypeScript, compiled to `dist/` (Jest, ESLint, Prettier).
- DSL: `.aflow` declarative files → parser → compiler → IR → runtime.
- MCP: each workflow compiles to one MCP tool; `agentflow mcp-config` prints the Claude Code server config.
- Providers: Claude (native `@anthropic-ai/sdk`, pay-as-you-go key), **Claude Agent SDK** (`provider: agent-sdk` — subscription credit via `claude login`, no API key), OpenRouter (315+ models), Ollama (local), plus a Hermes executor. Model aliases route cheap models for drafting, frontier models for review.

## Components
| Component | Path | Responsibility |
|---|---|---|
| Parser | `src/parser.ts` | Parse `.aflow` source into the workflow AST |
| Compiler | `src/compiler.ts` | Compile AST → IR (`AgentDef`, phases, loops, gates) |
| Runtime | `src/runtime.ts` | Execute phases; manage state, loops, and human gates (~35 KB, the core) |
| MCP server | `src/mcp-server.ts` | Expose each compiled workflow as an MCP tool |
| CLI | `src/cli.ts` | `init / check / run / compile / validate / mcp-config / models / resume` |
| Model resolver | `src/model-resolver.ts` | Resolve per-agent model aliases to a concrete provider + model |
| Executors | `src/executors/` | One per provider: `claude-`, `agent-sdk-`, `openrouter-`, `ollama-`, `hermes-`; plus `headroom-routing.ts` (shared eligibility gate) |
| Tools | `src/tools/` | Tool catalog (`index.ts`) + `test-runner` exposed to agents |
| Validation | `src/schema-validator.ts`, `src/validate.ts` | Validate workflows and typed `must_produce` outputs |
| Tokenizer | `src/tokenizer.ts` | Token counting / budgeting |

## Key flow
```
.aflow ──parser──▶ AST ──compiler──▶ IR ──runtime──▶ executor(provider) ──▶ LLM
                                              │
                                              └─ MCP server exposes each workflow as one MCP tool
```

## Fork-specific patches (vs upstream `anhonestboy/agentflow`)
- `agent-sdk` provider's `@anthropic-ai/claude-agent-sdk` peer is actually installed (upstream leaves it optional/uninstalled → runtime crash).
- `resume` (MCP + CLI) accepts human-gate answers via `user_inputs` / `--user-inputs` directly.
- Per-agent `max_turns` with tool-aware defaults (tool-using agents default to 50).
- Optional Headroom compression-proxy routing on both Anthropic executor paths (opt-in, off by default).

## Cross-links
- Visual: [[AgentFlow Architecture]] (Obsidian canvas)
- Consumer: [[agent-stack]] (compiles its chain segments into this engine's `.aflow` workflows)
