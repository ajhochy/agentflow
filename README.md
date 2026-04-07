# AgentFlow DSL

A declarative, indentation-based Domain-Specific Language for orchestrating multi-agent AI systems.

## Overview

AgentFlow lets you define complex multi-agent workflows in a clean, readable `.aflow` syntax. The DSL compiles to an intermediate representation (IR) in JSON, which can be validated, executed, and exposed as MCP tools.

**Pipeline:** `.aflow` → Tokenizer → Parser → AST → Compiler → WorkflowIR (JSON) → Validator → Runtime/MCP Server

## Installation

```bash
# From npm
npm install -g agentflow

# Or from source
git clone https://github.com/anhonestboy/MCP-DSL.git
cd MCP-DSL
npm install
npm run build
```

## Quick Start

### 1. Initialize a project

```bash
agentflow init
```

This interactive wizard helps you configure your model provider (Claude, Ollama, or OpenRouter) and creates an `agentflow.config.json` file.

### 2. Write a workflow

Create a `hello.aflow` file:

```
workflow hello
  description: "Simple code generation"
  version: "1.0.0"

  agents:
    agent writer
      mode: focused
      must_produce:
        - code

  phases:
    phase write
      agent: writer
      input: [trigger.task]
      output: [code]

  done when: write.code != ""
```

### 3. Validate and run

```bash
# Validate the workflow
agentflow check hello.aflow

# Run it
agentflow run hello.aflow --input 'task="Build a hello world function"'
```

## CLI Commands

```bash
# Check a workflow (summary + validation)
agentflow check examples/code-quality.aflow

# Compile to IR JSON
agentflow compile examples/code-quality.aflow

# Validate only
agentflow validate examples/custom-domain.aflow

# Build (save IR to disk)
agentflow build examples/code-quality.aflow

# Run a workflow
agentflow run examples/code-quality.aflow --input 'task="Build a REST API"'

# Initialize project configuration
agentflow init
```

> **Tip:** If not installed globally, use `npx agentflow` or `npx tsx src/cli.ts` instead.

### MCP Server

```bash
# Start MCP server (reads .aflow files from AGENTFLOW_WORKFLOWS_DIR)
AGENTFLOW_WORKFLOWS_DIR=./examples npx tsx src/mcp-server.ts
```

See `claude_mcp_config.example.json` for Claude Code integration.

## Configuration

### Model providers

AgentFlow supports multiple LLM providers. Configure them via `agentflow init` or manually in `agentflow.config.json`:

```json
{
  "models": {
    "auto": { "provider": "auto" },
    "claude-sonnet": { "provider": "claude", "model": "claude-sonnet-4-5" },
    "local-fast": { "provider": "ollama", "model": "qwen3.5:9b", "options": { "num_ctx": 2048 } }
  },
  "defaults": {
    "provider": "auto"
  }
}
```

The `auto` provider selects the best available: Claude (if `ANTHROPIC_API_KEY` is set) → OpenRouter (if `OPENROUTER_API_KEY` is set) → Ollama (local).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | API key for Claude |
| `OPENROUTER_API_KEY` | — | API key for OpenRouter |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server endpoint |
| `OLLAMA_MODEL` | `gemma4:e4b` | Default Ollama model |
| `AGENTFLOW_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `AGENTFLOW_MAX_TOOL_ROUNDS` | `10` | Max tool call rounds per agent |
| `AGENTFLOW_WORKFLOWS_DIR` | `.` | Directory for MCP server to discover `.aflow` files |

## Language Syntax

AgentFlow uses **indentation-based** syntax (like Python). No braces needed.

```
workflow code_quality
  description: "Iterative code review"
  version: "1.0.0"

  agents:
    agent writer
      mode: focused
      must_produce:
        - code
        - tests

    agent reviewer
      mode: adversarial
      must_produce:
        - verdict
        - confidence: float

  phases:
    phase write
      agent: writer
      input: [trigger.task]
      output: [code, tests]

    phase review
      agent: reviewer
      input: [write.code]
      output: [verdict, confidence]

  loop quality_gate
    phases: [write, review]
    repeat_while: review.verdict == "needs_work"
    max_iterations: 5

  done when: review.confidence >= 0.85 and review.verdict == "approved"
```

### Key Concepts

- **Agents**: AI actors with specific modes (focused, adversarial, reliable, etc.) and declared outputs (`must_produce`)
- **Phases**: Sequential execution steps, each assigned to an agent
- **Loops**: Iterative refinement cycles with conditions and max iterations
- **References**: Dot-notation to pass data between phases (`write.code`, `trigger.task`)
- **Conditions**: Comparison expressions for flow control (`review.verdict == "approved"`)

### Agent Modes

| Mode | Behavior |
|------|----------|
| `focused` | Stays strictly on task |
| `adversarial` | Critical reviewer, finds bugs and weaknesses |
| `reliable` | Prioritizes correctness and idempotency |
| `precise` | Exact output, no ambiguity |
| `strict` | Enforces all rules without exceptions |
| `patient` | Analyzes carefully before responding |
| `objective` | Evaluates facts without bias |

### Phase Types

- `standard` — Default sequential execution
- `human_action_required` — Waits for human confirmation (requires `timeout`)
- `streaming_batch` — Batch processing mode

### Duration Format

`<number><unit>` where unit is `s`, `min`, `h`, or `d`. Examples: `30s`, `5min`, `48h`, `7d`

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- check examples/code-quality.aflow

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint

# Format
npm run format
```

## Examples

- `examples/code-quality.aflow` — Iterative code quality with writer, tester, critic
- `examples/code-quality-with-plan.aflow` — Extended with planning phase
- `examples/custom-domain.aflow` — Domain provisioning (DNS, SSL, proxy, DB)
- `examples/blog-post.aflow` — Blog post generation with researcher, writer, editor loop

## Validation Rules

| Rule | Type | Description |
|------|------|-------------|
| S1 | Error | Phase agent must exist |
| S2 | Error | Phase output must be in agent's must_produce |
| S3 | Error | Loop phases must exist |
| S4 | Warning | Agent without must_produce |
| S5 | Error | Loop without max_iterations |
| S6 | Error | `confidence` must be type `float` |
| S7 | Warning | Adversarial agent with contradicting constraint |
| S8 | Warning | Same as S7, applied per phase |
| S9 | Error | human_action_required without timeout |
| S10 | Error | Phase with both poll and retry |

## License

[MIT](LICENSE)
