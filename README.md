# AgentFlow DSL

**A declarative language for multi-agent AI workflows — compile to MCP tools, no glue code required.**

[![npm version](https://img.shields.io/npm/v/@anhonestboy/agentflow)](https://www.npmjs.com/package/@anhonestboy/agentflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-92%20passed-brightgreen)](.)

---

Write complex multi-agent workflows in clean, readable `.aflow` files. Each workflow becomes a **tool in Claude Code** via MCP — zero integration code. Assign different AI models to different agents, run iterative loops, and let agents collaborate with structured output.

```aflow
workflow code_quality
  description: "Iterative code review with writer, tester, and critic"
  version: "1.0.0"

  agents:
    agent writer     → model: "local-fast"
    agent tester     → model: "openrouter-smart"
    agent critic     → model: "claude-sonnet"

  loop quality_gate
    phases: [write, test, review]
    repeat_while: review.verdict == "needs_work"
    max_iterations: 5

  done when: review.confidence >= 0.85
```

## Why AgentFlow?

| | Traditional (LangGraph, CrewAI) | AgentFlow DSL |
|---|---|---|
| **Define workflows** | Python code (~40 lines boilerplate) | `.aflow` file (~20 lines) |
| **Multi-model** | Manual provider switching | Per-agent model aliases |
| **MCP integration** | Write MCP server code | Automatic — each workflow = MCP tool |
| **Git-friendly** | Code + config scattered | Single `.aflow` file |
| **Reviewable** | Need Python knowledge | Readable by anyone |

## Quick Start

### 1. Install

```bash
npm install -g @anhonestboy/agentflow
```

### 2. Configure

```bash
agentflow init
```

Interactive wizard: choose providers (Claude, OpenRouter, Ollama), configure model aliases, save API keys.

### 3. Write a workflow

Create `my-workflow.aflow`:

```aflow
workflow blog_post
  description: "Generate and refine a blog post"
  version: "1.0.0"

  agents:
    agent researcher
      mode: patient
      must_produce:
        - outline
        - key_points

    agent writer
      mode: focused
      must_produce:
        - draft
        - word_count: int

    agent editor
      mode: adversarial
      must_produce:
        - verdict
        - suggestions
        - confidence: float

  phases:
    phase research
      agent: researcher
      input: [trigger.topic]
      output: [outline, key_points]

    phase write
      agent: writer
      input: [research.outline, research.key_points]
      output: [draft, word_count]

    phase edit
      agent: editor
      input: [write.draft]
      output: [verdict, suggestions, confidence]

  loop revision_cycle
    phases: [write, edit]
    repeat_while: edit.verdict == "needs_work"
    max_iterations: 3
    on_each_iteration:
      send_to: writer
      payload: edit.suggestions

  done when: edit.confidence >= 0.8 and edit.verdict == "approved"
```

### 4. Run

```bash
agentflow check my-workflow.aflow     # Validate
agentflow run my-workflow.aflow --input 'topic="AI in photography"'
```

### 5. Add to Claude Code

```bash
agentflow mcp-config
```

Copy the JSON output to your Claude Code MCP settings. Your workflow is now a tool — call it directly from Claude Code.

## Supported Providers

| Provider | Status | Notes |
|---|---|---|
| **Claude** (Anthropic) | ✅ | Native SDK, multi-round tool use |
| **OpenRouter** | ✅ | 315+ models, automatic provider routing |
| **Ollama** | ✅ | Local execution, no API key needed |

Configure model aliases for cost optimization — use cheap models for drafting, frontier models for review:

```json
{
  "models": {
    "local-fast":       { "provider": "ollama",      "model": "qwen3:8b" },
    "openrouter-smart": { "provider": "openrouter",  "model": "google/gemini-2.5-flash" },
    "claude-sonnet":    { "provider": "claude",      "model": "claude-sonnet-4-5" }
  }
}
```

## CLI Reference

```bash
agentflow init                     # Interactive setup wizard
agentflow check <file>             # Validate workflow + summary
agentflow run <file> --input '…'   # Execute with real LLMs
agentflow run <file> --mock        # Execute with mock agents (no API key needed)
agentflow compile <file>           # Compile to IR JSON
agentflow validate <file>          # Validate only (no summary)
agentflow mcp-config               # Print MCP server config for Claude Code
agentflow models                   # List configured models + connectivity
agentflow resume <file> --instance <uuid>  # Resume interrupted workflow
```

## Language Reference

### Agents

```
agent <id>
  model: "<alias>"         # Model alias from config (default: "auto")
  mode: <mode>             # focused | adversarial | reliable | precise | strict | patient | objective
  tools: [<name>, ...]     # Built-in tools: file_write, file_read, shell_exec, test_runner
  must_produce:
    - <name>               # Required output field (string)
    - <name>: float        # Typed output field
  constraint: "<rule>"     # Natural language constraint
```

### Phases

```
phase <id>
  agent: <agent_id>
  input: [<ref>, ...]          # trigger.field or phase_id.output
  output: [<name>, ...]
  inject_context: "<path>"     # Optional: inject file content into agent context
  timeout: 30min               # For human_action_required phases
```

### Loops

```
loop <id>
  phases: [<phase_id>, ...]
  repeat_while: <condition>    # review.verdict == "needs_work"
  max_iterations: <n>
  on_each_iteration:
    send_to: <agent_id>
    payload: <ref>             # Feedback to inject
  on_max_exceeded:
    escalate_to: <agent_id>
    message: "<...>"
```

### Conditions

```aflow
# Comparison
review.confidence >= 0.85

# Logical
review.verdict == "approved" and review.confidence >= 0.85
not (review.verdict == "needs_work")
```

## Architecture

```
.aflow file
    │
    ▼
 Tokenizer ──► Parser ──► Compiler (AST → IR)
                              │
                    ┌─────────▼──────────┐
                    │   Validator (S1-S10) │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  WorkflowRunner     │
                    │  ┌───────────────┐  │
                    │  │ ExecutorResolver│  │
                    │  │ ┌─────────────┐│  │
                    │  │ │ Claude      ││  │
                    │  │ │ OpenRouter  ││  │
                    │  │ │ Ollama      ││  │
                    │  │ └─────────────┘│  │
                    │  └───────────────┘  │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  MCP Server         │
                    │  (stdio JSON-RPC)   │
                    └─────────┬──────────┘
                              │
                     Claude Code / Cursor
```

## Examples

| File | Description |
|---|---|
| `examples/blog-post.aflow` | Researcher → writer → editor with revision loop |
| `examples/code-quality.aflow` | Writer → tester → critic with quality gate loop |
| `examples/code-quality-with-plan.aflow` | Extended with planning phase |
| `examples/custom-domain.aflow` | 7-phase domain provisioning workflow |

## Development

```bash
git clone https://github.com/anhonestboy/agentflow.git
cd agentflow
npm install
npm run build
npm test          # 92 tests, 6 suites
npm run dev -- check examples/code-quality.aflow
```

## Roadmap

- **v1.1** — VS Code extension (syntax highlighting, LSP)
- **v1.2** — Parallel phase execution
- **v1.3** — Workflow registry & sharing
- **v2.0** — Web visualizer, CI/CD integration

## License

MIT — see [LICENSE](LICENSE) for details.
