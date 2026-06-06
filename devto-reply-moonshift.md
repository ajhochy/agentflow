This is great — "deterministic pipeline with stochastic agents inside" is exactly the framing I was fumbling toward but couldn't articulate that cleanly. Stealing it.

The validation layer you're describing is almost identical to what I landed on. In AgentFlow it's `output_schema` (JSON Schema inline) + `validation.retry` (auto-retry with the validation error fed back to the agent) + `validation.on_fail` (abort vs. default fill). What surprised me: even with a cheap model like Gemini Flash, the retry-with-feedback works most of the time. The agent gets the schema violation message and fixes it on the next pass. It's not magic — it just gives the model a second chance with a specific error instead of "try again pls."

The irreversibility gate is the thing I haven't built yet and you're right that it's the other half of the puzzle. Validation prevents silent corruption; gating prevents silent disaster. Right now AgentFlow trusts the workflow author to set `on_fail: abort` on critical phases, but that's convention, not enforcement. A declarative `irreversible: true` on phases that touch money/deploy would be the right move.

What format are you using for the typed contracts between phases? I went with JSON Schema because it was the obvious choice, but I wonder if there's a better fit for agent-to-agent contract validation that I'm not seeing.
