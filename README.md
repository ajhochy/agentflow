# AgentFlow DSL

A declarative language for multi-agent AI workflows — exposes them as MCP tools in Claude Code.

## What it does

- Write complex AI workflows in a clean, readable `.aflow` syntax
- Each workflow becomes a **tool in Claude Code** via MCP — no code required
- Assign different AI models to different agents (Claude, OpenRouter, Ollama)
- Workflows run iteratively: writer → tester → critic, loop until done

## Quick start (5 minutes)

### 1. Install

```bash
npm install -g @anhonestboy/agentflow
```

### 2. Configure

```bash
agentflow init
```

Interactive wizard: choose your AI provider (Claude, OpenRouter, Ollama), configure model aliases, save API keys.

### 3. Write a workflow

```
workflow code_quality
  description: "Iterative code review"
  version: "1.0.0"

  agents:
    agent writer
      model: "local-fast"      # ollama, fast local model
      mode: focused
      must_produce:
        - code

    agent critic
      model: "openrouter-smart"  # gemini-2.5-pro via OpenRouter
      mode: adversarial
      must_produce:
        - verdict
        - confidence: float

  phases:
    phase write
      agent: writer
      input: [trigger.task]
      output: [code]

    phase review
      agent: critic
      input: [write.code]
      output: [verdict, confidence]

  loop quality_gate
    phases: [write, review]
    repeat_while: review.verdict == "needs_work"
    max_iterations: 5

  done when: review.confidence >= 0.85 and review.verdict == "approved"
```

### 4. Validate and run

```bash
agentflow check my-workflow.aflow
agentflow run my-workflow.aflow --input 'task="Build a REST API"'
```

### 5. Add to Claude Code

```bash
agentflow mcp-config
```

Copy the printed JSON into your Claude Code MCP settings. Your workflow is now available as a tool inside Claude Code.

## Per-agent model selection

Each agent can use a different AI model. Configure aliases in `agentflow.config.json`:

```json
{
  "models": {
    "local-fast":       { "provider": "ollama",      "model": "qwen3:8b" },
    "local-smart":      { "provider": "ollama",      "model": "qwen3:14b" },
    "openrouter-smart": { "provider": "openrouter",  "model": "google/gemini-2.5-pro" },
    "openrouter-free":  { "provider": "openrouter",  "model": "qwen/qwen3-8b:free" },
    "claude-sonnet":    { "provider": "claude",      "model": "claude-sonnet-4-6" },
    "auto":             { "provider": "auto" }
  }
}
```

Then reference them in your `.aflow` file:

```
agent writer
  model: "local-fast"       # cheap & fast for drafting

agent critic
  model: "openrouter-smart" # frontier model for review
```

The `auto` alias selects the best available: Claude → OpenRouter → Ollama.

Check connectivity:

```bash
agentflow models
```

## CLI commands

```bash
agentflow init                    # interactive setup
agentflow check <file>            # validate + summary
agentflow run <file> --input '…'  # execute workflow
agentflow mcp-config              # print MCP config for Claude Code
agentflow models                  # list configured models + connectivity
agentflow compile <file>          # compile to IR JSON (stdout)
agentflow build <file>            # save compiled IR to disk
agentflow validate <file>         # validate only
agentflow resume <file> --instance <uuid>  # resume interrupted workflow
```

## MCP setup for Claude Code

Run `agentflow mcp-config` and copy the output:

```json
{
  "mcpServers": {
    "agentflow": {
      "command": "npx",
      "args": ["-y", "--package=@anhonestboy/agentflow", "agentflow-mcp"],
      "env": {
        "AGENTFLOW_WORKFLOWS_DIR": "/path/to/your/workflows",
        "ANTHROPIC_API_KEY": "sk-...",
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```

Add this to `~/.claude/settings.json` under `mcpServers`. Or use the CLI shortcut:

```bash
claude mcp add agentflow \
  -e AGENTFLOW_WORKFLOWS_DIR="$PWD" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -- npx -y --package=@anhonestboy/agentflow agentflow-mcp
```

> **Note:** `$PWD` makes this configuration project-scoped (saved in `.claude/settings.json` of the current directory). Run this command from the directory that contains your `.aflow` files.

**Using workflows from multiple projects**

If you keep your `.aflow` files in a shared directory and want to use them across different projects, configure the MCP server globally with an absolute path:

```bash
claude mcp add agentflow -s user \
  -e AGENTFLOW_WORKFLOWS_DIR="/path/to/your/workflows" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -- npx -y --package=@anhonestboy/agentflow agentflow-mcp
```

The `-s user` flag writes to `~/.claude/settings.json`, making the server available in every project.

Every `.aflow` file in `AGENTFLOW_WORKFLOWS_DIR` becomes a tool Claude Code can call.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | API key for Claude |
| `OPENROUTER_API_KEY` | — | API key for OpenRouter |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server |
| `AGENTFLOW_WORKFLOWS_DIR` | `.` | Directory MCP server scans for `.aflow` files |
| `AGENTFLOW_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Language reference

### Agents

```
agent <id>
  model: "<alias>"        # optional, defaults to "auto"
  mode: <mode>            # focused | adversarial | reliable | precise | strict | patient | objective
  must_produce:
    - <output_name>
    - <output_name>: float  # typed output
```

### Phases

```
phase <id>
  agent: <agent_id>
  input: [<ref>, ...]          # trigger.field or phase_id.output
  output: [<name>, ...]
  inject_context: "<path>"     # optional: inject file content into agent context
  type: standard               # standard | human_action_required | streaming_batch
  timeout: 30min               # required for human_action_required
```

`inject_context` accepts a direct file path (e.g. `"../CLAUDE.md"`) or a key from the workflow `context:` block. The file content is prepended to the agent's system prompt — useful for injecting project conventions, architecture docs, or coding standards.

### Loops

```
loop <id>
  phases: [<phase_id>, ...]
  repeat_while: <condition>
  max_iterations: <n>
```

### Done condition

```
done when: <condition>
```

Conditions use dot-notation (`review.verdict == "approved"`, `review.confidence >= 0.85`) and logical operators (`and`, `or`, `not`).

## Built-in agent tools

Agents can use these tools during execution:

| Tool | Description |
|------|-------------|
| `file_write` | Write content to a file |
| `file_read` | Read file content |
| `shell_exec` | Execute shell commands (30s timeout) |
| `test_runner` | Run TypeScript code in a temp file |

## Examples

| File | Description |
|------|-------------|
| `examples/code-quality.aflow` | Writer → tester → critic with quality loop |
| `examples/code-quality-with-plan.aflow` | Extended with planning phase |
| `examples/custom-domain.aflow` | 7-phase domain provisioning workflow |
| `examples/blog-post.aflow` | Researcher → writer → editor loop |
| `examples/mosaiico-component-dev.aflow` | UI component: design → implement → review → document (uses `inject_context`) |
| `examples/mosaiico-component-review.aflow` | UI component audit: accessibility, CSS tokens, API consistency |

## Development

```bash
git clone https://github.com/anhonestboy/MCP-DSL.git
cd MCP-DSL
npm install
npm run build
npm test
npm run dev -- check examples/code-quality.aflow
```

## License

[MIT](LICENSE)
