# Testing MCP-DSL CLI

## Overview
AgentFlow is a CLI tool (`npx agentflow`) for defining and validating agent workflows using `.aflow` DSL files. Testing involves verifying CLI output, error handling, and interactive prompts.

## Prerequisites
- Run `npm install` and `npm run build` before testing
- The CLI is available via `npx agentflow` after build

## How to Run the CLI
```bash
# From the repo root
npx agentflow --help          # Show all commands
npx agentflow check <file>     # Validate a .aflow file
npx agentflow init             # Interactive setup wizard
npx agentflow compile <file>   # Compile to IR JSON
```

## Testing Validation Errors
Create an invalid `.aflow` file to trigger specific validation rules (S1-S10):
```bash
# Example: S1 - undefined agent reference
cat > /tmp/invalid-test.aflow << 'EOF'
workflow test_invalid
  description: "Test invalid workflow"

  agents:
    agent writer
      model: "gpt-4"
      mode: focused
      must_produce:
        - code

  phases:
    phase do_work
      agent: nonexistent_agent
      input: [request]
      output: [missing_output]
      prompt: "Do the work"
EOF

npx agentflow check /tmp/invalid-test.aflow
# Expected: English error message about undefined agent
```

## Testing Error Handling
```bash
# File not found - should show friendly error, no stack trace
npx agentflow check nonexistent.aflow
# Expected: "Error: File not found: nonexistent.aflow"

# Ctrl+C in init wizard - should exit gracefully
npx agentflow init
# Press Ctrl+C at any prompt
# Expected: "Setup cancelled." in yellow, clean exit
```

## Testing Valid Workflows
```bash
# Use example files in examples/ directory
npx agentflow check examples/code-quality.aflow
# Expected: Workflow summary + "Workflow valid" in green
```

## CI Checks
The repo runs these checks in CI:
- `npm run format:check` (Prettier)
- `npm run lint` (ESLint) 
- `npm run build` (TypeScript compilation)
- `npm test` (Jest, 92 tests across 6 suites)

Run `npx prettier --write 'src/**/*.ts' 'tests/**/*.ts'` before committing to pass format checks.

## Key Files
- `src/cli.ts` — CLI entry point and command definitions
- `src/validate.ts` — Validation rules (S1-S10)
- `src/commands/init.ts` — Interactive setup wizard
- `src/executors/` — AI executor system prompts (Claude, Ollama, OpenRouter)
- `examples/` — Sample .aflow files for testing

## Notes
- The CLI is a terminal application; test it in konsole for visual recording
- All user-facing strings should be in English
- The init wizard uses `@inquirer/prompts` — Ctrl+C throws `ExitPromptError`
