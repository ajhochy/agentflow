const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:e4b';
export class OllamaExecutor {
    async execute(agent, input) {
        process.stderr.write(`\n🔧 Esecuzione agente: ${agent.id} (mode: ${agent.mode})\n`);
        const system = this.buildSystemPrompt(agent);
        // Separa i campi "codice" dagli altri
        const codeFields = (agent.must_produce ?? []).filter(i => i.name === 'code');
        const textFields = (agent.must_produce ?? []).filter(i => i.name !== 'code');
        // Chiama il modello per i campi testuali
        const textOutput = await this.fetchJson(agent, system, input, textFields);
        // Se c'è un campo code, chiama separatamente in plain text
        if (codeFields.length > 0) {
            const code = await this.fetchCode(agent, system, input);
            textOutput['code'] = code;
        }
        return this.normalizeOutput(textOutput);
    }
    async fetchJson(agent, system, input, fields) {
        process.stderr.write(`  ⏳ [${agent.id}] fetchJson: ${fields.map(f => f.name).join(', ')}...\n`);
        const fieldList = fields.map(i => `"${i.name}": "<${i.type ?? 'string'}>"`).join(',\n  ');
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                stream: false,
                format: 'json',
                options: { temperature: 0 },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: `Input:\n${JSON.stringify(input, null, 2)}\n\nRispondi con JSON con questi campi:\n{\n  ${fieldList}\n}\n\nNOTA: verdict deve essere ESATTAMENTE "approved" oppure "needs_work"` },
                ],
            }),
        });
        process.stderr.write(`  ✅ [${agent.id}] fetchJson risposta ricevuta\n`);
        if (!response.ok)
            throw new Error(`Ollama error: ${response.status}`);
        const data = await response.json();
        try {
            return JSON.parse(data.message.content);
        }
        catch {
            throw new Error(`[${agent.id}] JSON non parsabile:\n${data.message.content.slice(0, 200)}`);
        }
    }
    async fetchCode(agent, system, input) {
        process.stderr.write(`  ⏳ [${agent.id}] fetchCode...\n`);
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                stream: false,
                format: 'json',
                options: { temperature: 0 },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: `Input:\n${JSON.stringify(input, null, 2)}\n\nRispondi con JSON: { "code": "<codice TypeScript completo>" }\nIl campo code deve contenere SOLO il codice, niente altro.` },
                ],
            }),
        });
        process.stderr.write(`  ✅ [${agent.id}] fetchCode risposta ricevuta\n`);
        if (!response.ok)
            throw new Error(`Ollama error: ${response.status}`);
        const data = await response.json();
        try {
            const parsed = JSON.parse(data.message.content);
            if (typeof parsed === 'object' && parsed !== null) {
                const code = parsed.code ?? parsed.implementation ?? parsed.typescript
                    ?? Object.values(parsed).find(v => typeof v === 'string' && (v.includes('=>') || v.includes('function')));
                if (code)
                    return String(code);
            }
            return data.message.content;
        }
        catch {
            return data.message.content
                .replace(/^```[\w]*\n?/, '')
                .replace(/\n?```$/, '')
                .trim();
        }
    }
    buildSystemPrompt(agent) {
        const modeMap = {
            adversarial: 'Sei un revisore critico. Trova bug e problemi. Non approvare senza prove.',
            focused: 'Concentrati solo sul task. Nessuna divagazione.',
            reliable: 'Priorità: correttezza. Nessuna scorciatoia.',
            precise: 'Output esatto. Nessuna ambiguità.',
            strict: 'Applica tutte le regole senza eccezioni.',
            patient: 'Analizza con cura prima di rispondere.',
        };
        const lines = [];
        if (modeMap[agent.mode])
            lines.push(modeMap[agent.mode]);
        if (agent.constraints?.length)
            lines.push(`Constraints:\n${agent.constraints.map(c => `- ${c}`).join('\n')}`);
        if (agent.rules?.length)
            lines.push(`Regole:\n${agent.rules.map(r => `- ${r}`).join('\n')}`);
        lines.push('Rispondi SEMPRE e SOLO con JSON valido. Nessun testo aggiuntivo.');
        return lines.join('\n');
    }
    normalizeOutput(output) {
        // Normalizza verdict a lowercase con underscore
        if (typeof output['verdict'] === 'string') {
            const v = output['verdict'].toLowerCase().replace(/\s+/g, '_');
            output['verdict'] = v.includes('approv') ? 'approved' : 'needs_work';
        }
        return output;
    }
}
