# Repo Map — agentflow

## Key directories
```
agentflow/
├── src/
│   ├── cli.ts                 ← CLI entry (init/check/run/compile/validate/mcp-config/models/resume, ~19 KB)
│   ├── mcp-server.ts          ← MCP server; exposes each workflow as one MCP tool (~21 KB)
│   ├── parser.ts              ← .aflow → AST (~14 KB)
│   ├── compiler.ts            ← AST → IR (~17 KB)
│   ├── runtime.ts             ← phase/loop/gate execution engine (~35 KB, the core)
│   ├── model-resolver.ts      ← model-alias → provider+model resolution
│   ├── schema-validator.ts / validate.ts ← workflow + must_produce validation
│   ├── tokenizer.ts           ← token counting / budgeting
│   ├── types.ts               ← shared types (AgentDef, etc.)
│   ├── retry.ts / logger.ts / index.ts
│   ├── commands/              ← init.ts
│   ├── executors/             ← claude-, agent-sdk-, openrouter-, ollama-, hermes-executor.ts; headroom-routing.ts
│   └── tools/                 ← index.ts (tool catalog), test-runner.ts
├── bin/
│   ├── agentflow.js           ← CLI launcher (bin: agentflow)
│   └── agentflow-mcp.js       ← MCP server launcher (bin: agentflow-mcp)
├── examples/                  ← sample .aflow workflows (code-quality, deploy-gate, blog-post, …)
├── tests/                     ← Jest suites (parser, compiler, runtime, executors, gates, budget, …)
├── dist/                      ← compiled output; MCP server runs from here (not npx)
├── docs/                      ← project docs + docs/ai/ (AI workflow records)
├── AGENTS.md                  ← agent guidance (no CLAUDE.md in this repo)
├── README.md / ROADMAP.md / CHANGELOG.md / CONTRIBUTING.md / coding-standards.md
└── package.json               ← name @anhonestboy/agentflow, version 1.0.20
```

## Entry points
- CLI: `bin/agentflow.js` → `src/cli.ts`
- MCP server: `bin/agentflow-mcp.js` → `src/mcp-server.ts` (run from `dist/`)
- Workflow execution core: `src/runtime.ts`

## Dependencies
`@anthropic-ai/sdk`, `@inquirer/input`, `@inquirer/prompts`, `@inquirer/select`, `chalk`, `commander`, `dotenv`, `zod`. Optional peer: `@anthropic-ai/claude-agent-sdk` (fork installs it).

## Remotes
- `origin`: https://github.com/ajhochy/agentflow (personal fork)
- `upstream`: https://github.com/anhonestboy/agentflow (published `@anhonestboy/agentflow`)
- Don't blindly pull upstream — it can clobber fork-only patches.
