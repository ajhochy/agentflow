# Contributing to AgentFlow

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/anhonestboy/MCP-DSL.git
cd MCP-DSL
npm install
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run checks before committing:

```bash
npm run lint        # Check for lint errors
npm run format      # Format code with Prettier
npm run build       # Ensure TypeScript compiles
npm test            # Run all tests
```

4. Open a pull request against `main`

## Code Style

- TypeScript strict mode is enforced
- Formatting is handled by Prettier (run `npm run format`)
- Linting is handled by ESLint (run `npm run lint`)
- Use meaningful variable and function names
- Keep functions focused and small

## Tests

- Tests live in `tests/` and use Jest
- Name test files `*.test.ts`
- Run tests with `npm test`
- Run with coverage: `npm run test:coverage`

## Project Structure

```
src/
  cli.ts              # CLI entry point
  tokenizer.ts        # Indentation-aware tokenizer
  parser.ts           # Recursive descent parser
  compiler.ts         # AST to WorkflowIR compiler
  validate.ts         # Semantic validation (S1-S10)
  runtime.ts          # Workflow execution engine
  mcp-server.ts       # MCP server (stdio JSON-RPC)
  logger.ts           # Structured logging
  retry.ts            # Retry with exponential backoff
  model-resolver.ts   # Multi-provider model selection
  types.ts            # Type definitions
  executors/          # LLM provider executors
  tools/              # Tool registry and built-in tools
  commands/           # CLI subcommands
tests/                # Test files
examples/             # Example .aflow workflows
```

## Reporting Issues

Open an issue on GitHub with:
- A clear description of the problem or suggestion
- Steps to reproduce (for bugs)
- Expected vs actual behavior
