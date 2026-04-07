import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parse } from './parser.js';
import { compile } from './compiler.js';
import { validate } from './validate.js';
import { WorkflowRunner, MockAgentExecutor } from './runtime.js';
import type { WorkflowIR } from './types.js';

// ─── Load workflows ─────────────────────────────────────────────────

function loadWorkflows(dir: string): Map<string, WorkflowIR> {
  const workflows = new Map<string, WorkflowIR>();

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.aflow'));
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
          sendResponse(makeResult(request.id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'agentflow',
              version: '0.1.0',
            },
          }));
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
                properties[inp.name] = { type: mapType(inp.type), description: `Input: ${inp.name}` };
                required.push(inp.name);
              }
            } else {
              // Default schema
              properties['task'] = { type: 'string', description: 'Task description' };
              required.push('task');
            }

            tools.push({
              name: id,
              description: w.description ?? `Esegui workflow: ${id}`,
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
          const params = request.params as { name: string; arguments?: Record<string, unknown> } | undefined;
          if (!params?.name) {
            sendResponse(makeError(request.id, -32602, 'Missing tool name'));
            break;
          }

          const ir = workflows.get(params.name);
          if (!ir) {
            sendResponse(makeError(request.id, -32602, `Unknown workflow: ${params.name}`));
            break;
          }

          const executor = new MockAgentExecutor();
          const runner = new WorkflowRunner(ir, executor);
          const instance = await runner.run(params.arguments ?? {});

          sendResponse(makeResult(request.id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  workflow_id: instance.workflow_id,
                  instance_id: instance.instance_id,
                  state: instance.state,
                  phase_outputs: instance.phase_outputs,
                  loop_iterations: instance.loop_iterations,
                }, null, 2),
              },
            ],
          }));
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

function mapType(aflowType: string): string {
  switch (aflowType) {
    case 'int':
    case 'float': return 'number';
    case 'bool': return 'boolean';
    case 'array': return 'array';
    case 'object': return 'object';
    default: return 'string';
  }
}

main().catch(err => {
  console.error(`[agentflow] Fatal: ${err.message}`);
  process.exit(1);
});
