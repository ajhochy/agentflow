import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parse } from './parser.js';
import { compile } from './compiler.js';
import { validate } from './validate.js';
import { WorkflowRunner } from './runtime.js';
import { ClaudeExecutor } from './executors/claude-executor.js';
import { OllamaExecutor } from './executors/ollama-executor.js';
import { OpenRouterExecutor } from './executors/openrouter-executor.js';
import { HermesExecutor } from './executors/hermes-executor.js';
import { AgentSdkExecutor } from './executors/agent-sdk-executor.js';
import { resolveModel } from './model-resolver.js';
import { createBuiltinRegistry } from './tools/index.js';
import type { AgentDef } from './types.js';
import type { WorkflowIR } from './types.js';

// ─── Load workflows ─────────────────────────────────────────────────

function loadWorkflows(dir: string): Map<string, WorkflowIR> {
  const workflows = new Map<string, WorkflowIR>();

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.aflow'));
  } catch (err) {
    console.error(`[agentflow] Cannot read workflows dir: ${dir} — ${(err as Error).message}`);
    return workflows;
  }

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const source = readFileSync(filePath, 'utf-8');
      const ast = parse(source);
      const ir = compile(ast);
      const result = validate(ir);

      if (!result.ok) {
        console.error(`[agentflow] Skipping ${file}: validation errors`);
        for (const err of result.errors) {
          console.error(`  [${err.rule}] ${err.message}`);
        }
        continue;
      }

      workflows.set(ir.workflow.id, ir);
      console.error(`[agentflow] Loaded workflow: ${ir.workflow.id} (${file})`);
    } catch (err) {
      console.error(`[agentflow] Skipping ${file}: ${(err as Error).message}`);
    }
  }

  return workflows;
}

// ─── JSON-RPC helpers ───────────────────────────────────────────────

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function sendResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

function makeResult(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ─── MCP Server ─────────────────────────────────────────────────────

async function main() {
  const workflowsDir = process.env.AGENTFLOW_WORKFLOWS_DIR || './examples';

  // Load .env from the workflows directory as fallback
  // (Claude Code may not pass all env vars to the child process)
  const dotenvPath = join(workflowsDir, '.env');
  if (existsSync(dotenvPath)) {
    const lines = readFileSync(dotenvPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim();
      }
    }
    console.error(`[agentflow] Loaded .env from: ${dotenvPath}`);
  }

  // Write diagnostic log to file (readable even when stderr is not visible)
  const debugLog = [
    `[${new Date().toISOString()}] agentflow-mcp startup`,
    `AGENTFLOW_WORKFLOWS_DIR: ${workflowsDir}`,
    `AGENTFLOW_DEFAULT_PROVIDER: ${process.env.AGENTFLOW_DEFAULT_PROVIDER ?? '(not set)'}`,
    `OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.slice(0, 16) + '...' : '(missing)'}`,
    `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? (process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-') ? 'real key' : 'session token') : '(missing)'}`,
    `dotenv path: ${join(workflowsDir, '.env')} exists=${existsSync(join(workflowsDir, '.env'))}`,
  ].join('\n');
  writeFileSync('/tmp/agentflow-mcp-debug.log', debugLog + '\n');

  console.error(`[agentflow] Loading workflows from: ${workflowsDir}`);

  const workflows = loadWorkflows(workflowsDir);
  console.error(`[agentflow] ${workflows.size} workflow(s) loaded`);

  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      sendResponse(makeError(null, -32700, 'Parse error'));
      continue;
    }

    try {
      switch (request.method) {
        case 'initialize': {
          sendResponse(
            makeResult(request.id, {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'agentflow',
                version: '0.1.0',
              },
            }),
          );
          break;
        }

        case 'notifications/initialized': {
          // Client ack — no response needed
          break;
        }

        case 'tools/list': {
          const tools = [];
          for (const [id, ir] of workflows) {
            const w = ir.workflow;
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            if (w.trigger?.input) {
              for (const inp of w.trigger.input) {
                properties[inp.name] = {
                  type: mapType(inp.type),
                  description: `Input: ${inp.name}`,
                };
                required.push(inp.name);
              }
            } else {
              // Default schema
              properties['task'] = {
                type: 'string',
                description: 'Task description',
              };
              required.push('task');
            }

            // Build declaration summary
            const declaration = buildDeclaration(ir);

            tools.push({
              name: id,
              description: declaration,
              inputSchema: {
                type: 'object',
                properties,
                required,
              },
            });
          }
          sendResponse(makeResult(request.id, { tools }));
          break;
        }

        case 'tools/call': {
          const params = request.params as
            | { name: string; arguments?: Record<string, unknown> }
            | undefined;
          if (!params?.name) {
            sendResponse(makeError(request.id, -32602, 'Missing tool name'));
            break;
          }

          const ir = workflows.get(params.name);
          if (!ir) {
            sendResponse(makeError(request.id, -32602, `Unknown workflow: ${params.name}`));
            break;
          }

          const outputDir = resolve(`./output/${ir.workflow.id}`);
          const toolRegistry = createBuiltinRegistry(outputDir);

          const executor = (agent: AgentDef) => {
            const cfg = resolveModel(agent.model);
            console.error(`[agentflow] [${agent.id}] ${cfg.provider}/${cfg.model}`);
            switch (cfg.provider) {
              case 'claude':
                return new ClaudeExecutor({ toolRegistry });
              case 'openrouter':
                return new OpenRouterExecutor(cfg.model);
              case 'hermes':
                return new HermesExecutor();
              case 'agent-sdk':
                return new AgentSdkExecutor(cfg.model);
              default:
                return new OllamaExecutor(cfg);
            }
          };

          const runner = new WorkflowRunner(ir, executor, { outputDir });
          const instance = await runner.run(params.arguments ?? {});

          sendResponse(
            makeResult(request.id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      workflow_id: instance.workflow_id,
                      instance_id: instance.instance_id,
                      state: instance.state,
                      phase_outputs: instance.phase_outputs,
                      loop_iterations: instance.loop_iterations,
                      receipt: instance.execution_receipt ?? null,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }),
          );
          break;
        }

        default: {
          sendResponse(makeError(request.id, -32601, `Method not found: ${request.method}`));
        }
      }
    } catch (err) {
      sendResponse(makeError(request.id, -32603, (err as Error).message));
    }
  }
}

function buildDeclaration(ir: WorkflowIR): string {
  const w = ir.workflow;
  const parts: string[] = [];

  // Base description
  if (w.description) {
    parts.push(w.description);
  }

  // Agents
  const agentIds = Object.keys(w.agents);
  const models = agentIds
    .map((id) => w.agents[id].model ?? 'default')
    .filter((v, i, a) => a.indexOf(v) === i);
  parts.push(`${agentIds.length} agent(s): ${agentIds.join(', ')}`);

  // Models
  if (models.length > 0) {
    parts.push(`Models: ${models.join(', ')}`);
  }

  // Phases
  parts.push(`${w.phases.length} phase(s): ${w.phases.map((p) => p.id).join(' → ')}`);

  // Loop
  if (w.loop) {
    const loopInfo = w.loop.max_iterations
      ? `Loop on [${w.loop.phases.join(', ')}] (max ${w.loop.max_iterations} iterations)`
      : `Loop on [${w.loop.phases.join(', ')}]`;
    parts.push(loopInfo);
  }

  // Tools
  for (const [agentId, agent] of Object.entries(w.agents)) {
    if (agent.tools?.length) {
      parts.push(`Agent "${agentId}" has tools: ${agent.tools.join(', ')}`);
    }
  }

  // Schema validation
  const schemas = agentIds.filter((id) => w.agents[id].output_schema);
  if (schemas.length > 0) {
    parts.push(`Schema validation on: ${schemas.join(', ')}`);
  }

  // Output dir (side effects)
  parts.push('May write output files to disk');

  return parts.join('. ');
}

function mapType(aflowType: string): string {
  switch (aflowType) {
    case 'int':
    case 'float':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

main().catch((err) => {
  console.error(`[agentflow] Fatal: ${err.message}`);
  process.exit(1);
});
