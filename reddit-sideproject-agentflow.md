I built a DSL for defining multi-agent workflows that compile to MCP tools — no glue code

**What it is:** AgentFlow — you write `.aflow` files describing agents, phases, loops, and validation rules. The CLI compiles them into MCP tools that Claude Code (or any MCP host) can call natively. No Python glue. No LangChain boilerplate.

**Why I built it:** I was wiring up the same patterns over and over — researcher → writer → editor loops with structured output validation. Every framework wanted 40 lines of Python before I could express anything interesting. I wanted something that felt like writing a config file, because the workflow structure *is* configuration. The agent behavior is the interesting part; the plumbing shouldn't be.

**What surprised me:** The `output_schema` + retry-with-feedback pattern. Each phase declares a JSON Schema for its output. If the agent produces invalid output, the validation error gets fed back as context on retry. I expected this to only work with frontier models. It works fine with Gemini Flash. The model just needs to be told *what* it got wrong, not "try again pls."

**What I'm not sure about:** Is a DSL actually better than just writing Python? I think yes for the 80% case (standard agent pipelines), but I might be wrong. I also haven't built an irreversibility gate yet — if a phase touches money or deploys, there should be a hard declarative gate, not just a convention.

**Stack:** TypeScript, compiled to a single binary. Supports Claude, OpenRouter, and Ollama. 92 tests passing. MIT license.

**Repo:** [github.com/anhonestboy/agentflow](https://github.com/anhonestboy/agentflow)
**npm:** `npm install -g @anhonestboy/agentflow`

Honest question for anyone who's built agent orchestration: did you go DSL or code? And if code, do you regret it?
