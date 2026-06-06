**Title:** Show HN: AgentFlow — a DSL for multi-agent workflows that compiles to MCP tools

I'm a wedding photographer, not a professional developer. Over the past months I built AgentFlow and I honestly don't know if it's useful or if I built a toy.

The idea: write a `.aflow` file describing agents and phases, compile it, and it auto-registers as an MCP tool. The MCP server scans a directory and exposes each workflow with zero integration code.

The feature I'm least insecure about is output schema validation. You define a JSON Schema inline — if the LLM produces bad output (wrong type, missing fields, constraint violations), the system retries automatically with the error as feedback:

```
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

I haven't found this in LangChain, CrewAI, or AutoGen — structured retry with schema-aware feedback. Maybe I'm wrong.

Current state: 92 tests, 7 workflows, MCP server working (tested with Hermes), CLI, MIT license. Built on Node/TypeScript, zero heavy dependencies.

I'm asking because I genuinely don't know if this solves a real problem or if I'm just reinventing Python with extra syntax. Tear it apart.

Repo: https://github.com/anhonestboy/agentflow
