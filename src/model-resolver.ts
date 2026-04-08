import { readFileSync } from 'node:fs';

export type ModelConfig = {
  provider: 'claude' | 'ollama' | 'openrouter';
  model: string;
  options?: Record<string, unknown>;
};

type ConfigFile = {
  models: Record<string, { provider: string; model?: string; options?: Record<string, unknown> }>;
  defaults?: { provider?: string; ollama_base_url?: string; num_ctx?: number };
};

let _config: ConfigFile | null = null;

function loadConfig(): ConfigFile {
  if (_config) return _config;
  try {
    const raw = readFileSync('agentflow.config.json', 'utf-8');
    _config = JSON.parse(raw) as ConfigFile;
    return _config;
  } catch {
    _config = {
      models: {
        auto: { provider: 'auto' },
        'claude-sonnet': { provider: 'claude', model: 'claude-sonnet-4-5' },
        'claude-opus': { provider: 'claude', model: 'claude-opus-4-5' },
        'local-fast': { provider: 'ollama', model: 'qwen3.5:9b', options: { num_ctx: 2048 } },
        'local-smart': { provider: 'ollama', model: 'qwen2.5:14b', options: { num_ctx: 4096 } },
        'openrouter-smart': { provider: 'openrouter', model: 'google/gemini-2.5-pro' },
        'openrouter-free': {
          provider: 'openrouter',
          model: 'meta-llama/llama-3.3-8b-instruct:free',
        },
      },
    };
    return _config;
  }
}

function resolveAuto(): ModelConfig {
  const config = loadConfig();

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { provider: 'claude', model: 'claude-sonnet-4-5' };
  }
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const orSmart = config.models['openrouter-smart'];
    return {
      provider: 'openrouter',
      model: orSmart?.model ?? 'google/gemini-2.5-pro',
    };
  }
  const localSmart = config.models['local-smart'];
  if (localSmart?.provider === 'ollama' && localSmart.model) {
    return { provider: 'ollama', model: localSmart.model, options: localSmart.options };
  }
  return {
    provider: 'ollama',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:14b',
    options: { num_ctx: 4096 },
  };
}

export function resolveModel(agentModel?: string): ModelConfig {
  const config = loadConfig();
  const name = agentModel ?? 'auto';
  const entry = config.models[name];

  if (!entry || entry.provider === 'auto') {
    return resolveAuto();
  }

  return {
    provider: entry.provider as ModelConfig['provider'],
    model: entry.model ?? 'claude-sonnet-4-5',
    options: entry.options,
  };
}
