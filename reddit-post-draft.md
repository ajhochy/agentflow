**Title:** I'm a wedding photographer. I built a DSL for AI agent workflows. Does this actually solve a problem?

I'm a wedding photographer from Italy, not a professional developer. Over the past months I built [AgentFlow](https://github.com/anhonestboy/agentflow) and I honestly don't know if it's useful or if I just reinvented the wheel in a worse way. I'd really appreciate honest feedback.

**The problem I thought I was solving:**

Every time I tried using LLM agents for anything real, I ended up writing glue code — retry logic, checking that outputs were valid, orchestrating phases. And the worst part: when an agent produced bad output, the workflow kept going silently. No validation, no guardrails.

**What I built:**

AgentFlow DSL — write a `.aflow` file, compile it, and it auto-exposes as an MCP tool. The MCP server scans a directory of `.aflow` files and registers each workflow as a tool. Zero integration code.

But the thing I'm least insecure about is the **output schema validation**. You write a JSON Schema inline in the workflow:

```aflow
agent writer
  output_schema:
    type: object
    properties:
      summary:
        type: string
        minLength: 20
      word_count:
        type: integer
        minimum: 10
    required: [summary, word_count]
  validation:
    retry: 2
    on_fail: abort
```

If the LLM produces `word_count: "banana"` instead of an integer, the system retries automatically, feeding the validation error back to the agent. After 2 retries, if it still fails, it aborts.

I couldn't find anything like this in LangChain, CrewAI, or AutoGen — but maybe I'm just not looking hard enough.

**What's there now:**

92 passing tests, 7 example workflows, MCP server working (tested with Nous Research's Hermes agent), CLI. I also wrote a Hermes executor so you can have agents in the workflow that don't just *think* — they actually *do* things (write files, git, deploy). Tested end-to-end: a full Instagram reel pipeline (photo → poetic narration → TTS → subtitles → video assembly) where AgentFlow handles the creative orchestration and a separate tool does the technical assembly.

**My honest questions:**

1. Is structured output validation actually useful for people putting agents in production? Or does everyone just use prompt engineering and hope for the best?
2. Does a declarative DSL for multi-agent workflows make sense as an abstraction above MCP? Or is this solving a problem nobody has?
3. Do the existing tools (LangGraph, CrewAI, etc.) already cover this? What am I missing?
4. If you could only have one more feature, what would it be?

**Why I'm asking instead of launching with hype:**

I built most of this with Claude Code — which is ironic, I know. I'm not a language engineer, I don't know how to do lexical analysis properly, I wrote the parser while learning the theory in parallel. Maybe I built a toy. If so, please tell me.

Brutal honesty appreciated.

Repo: [github.com/anhonestboy/agentflow](https://github.com/anhonestboy/agentflow)
