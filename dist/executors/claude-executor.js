import Anthropic from '@anthropic-ai/sdk';
export class ClaudeExecutor {
    client;
    constructor() {
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY non impostata');
        }
        this.client = new Anthropic();
    }
    async execute(agent, input) {
        const system = this.buildSystemPrompt(agent);
        const response = await this.client.messages.create({
            model: agent.model ?? 'claude-opus-4-5',
            max_tokens: 8096,
            system,
            messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
            tools: [this.buildOutputTool(agent)],
            tool_choice: { type: 'any' },
        });
        const toolUse = response.content.find(b => b.type === 'tool_use');
        if (!toolUse || toolUse.type !== 'tool_use') {
            throw new Error(`[${agent.id}] Non ha chiamato produce_output`);
        }
        return toolUse.input;
    }
    buildSystemPrompt(agent) {
        const modeMap = {
            adversarial: 'Sei un revisore critico. Il tuo obiettivo è trovare bug, problemi e debolezze. Non puoi approvare senza prove concrete che tutto funzioni.',
            focused: 'Concentrati esclusivamente sul task. Nessuna divagazione.',
            reliable: 'Priorità assoluta: correttezza e idempotenza. Nessuna scorciatoia.',
            precise: 'Output esatto. Nessuna ambiguità. Nessun testo superfluo.',
            strict: 'Applica tutte le regole senza eccezioni.',
            patient: 'Analizza con attenzione prima di rispondere.',
            objective: 'Valuta i fatti senza bias.',
        };
        const lines = [];
        if (modeMap[agent.mode])
            lines.push(modeMap[agent.mode]);
        if (agent.constraints?.length)
            lines.push(`\nConstraints:\n${agent.constraints.map(c => `- ${c}`).join('\n')}`);
        if (agent.rules?.length)
            lines.push(`\nRegole:\n${agent.rules.map(r => `- ${r}`).join('\n')}`);
        lines.push('\nDevi chiamare il tool produce_output con tutti i campi richiesti.');
        return lines.join('\n');
    }
    buildOutputTool(agent) {
        const properties = {};
        const required = [];
        // must_produce è un array di { name, type } nel runtime generato da Claude
        for (const item of agent.must_produce ?? []) {
            const jsonType = this.toJsonType(item.type);
            properties[item.name] = { type: jsonType, description: `Campo richiesto: ${item.name}` };
            required.push(item.name);
        }
        return {
            name: 'produce_output',
            description: `Produci l'output richiesto per l'agente ${agent.id}`,
            input_schema: {
                type: 'object',
                properties,
                required,
            }
        };
    }
    toJsonType(type) {
        switch (type) {
            case 'bool': return 'boolean';
            case 'float':
            case 'int': return 'number';
            case 'array': return 'array';
            case 'object': return 'object';
            default: return 'string';
        }
    }
}
