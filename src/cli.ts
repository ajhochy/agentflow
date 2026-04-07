import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { parse } from './parser.js';
import { compile } from './compiler.js';
import { validate } from './validate.js';
import { WorkflowRunner, MockAgentExecutor } from './runtime.js';
import type { ExecutorResolver } from './runtime.js';
import { ClaudeExecutor } from './executors/claude-executor.js';
import { OllamaExecutor } from './executors/ollama-executor.js';
import { resolveModel } from './model-resolver.js';
import { createBuiltinRegistry } from './tools/index.js';
import { runInit } from './commands/init.js';
import { OpenRouterExecutor } from './executors/openrouter-executor.js';
import type { WorkflowIR, AgentDef } from './types.js';

function loadAndCompile(filePath: string): WorkflowIR {
  const source = readFileSync(filePath, 'utf-8');
  const ast = parse(source);
  return compile(ast);
}

/** Crea un ExecutorResolver che risolve il modello per ogni agente */
function createExecutorResolver(
  toolRegistry: ReturnType<typeof createBuiltinRegistry>,
): ExecutorResolver {
  return (agent: AgentDef) => {
    const modelConfig = resolveModel(agent.model);
    process.stderr.write(
      chalk.dim(`  📦 [${agent.id}] model: ${modelConfig.model} (${modelConfig.provider})\n`),
    );

    switch (modelConfig.provider) {
      case 'claude':
        return new ClaudeExecutor({ toolRegistry });
      case 'openrouter':
        return new OpenRouterExecutor(modelConfig.model);
      case 'ollama':
      default:
        return new OllamaExecutor(modelConfig);
    }
  };
}

const program = new Command();

program
  .name('agentflow')
  .version('0.1.0')
  .description('AgentFlow DSL — declarative language for multi-agent orchestration');

// init command
program
  .command('init')
  .description('Wizard di configurazione interattivo')
  .action(async () => {
    await runInit();
  });

// compile command
program
  .command('compile <file>')
  .description('Compile .aflow file and output IR JSON to stdout')
  .action((file: string) => {
    try {
      const ir = loadAndCompile(file);
      console.log(JSON.stringify(ir, null, 2));
    } catch (err) {
      console.error(chalk.red(`Compilation error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// validate command
program
  .command('validate <file>')
  .description('Validate .aflow file and show errors/warnings')
  .action((file: string) => {
    try {
      const ir = loadAndCompile(file);
      const result = validate(ir);

      for (const err of result.errors) {
        console.log(
          chalk.red(
            `❌ [${err.rule}]${err.phase ? ` [fase: ${err.phase}]` : ''}${err.agent ? ` [agente: ${err.agent}]` : ''} ${err.message}`,
          ),
        );
      }
      for (const warn of result.warnings) {
        console.log(
          chalk.yellow(
            `⚠️  [${warn.rule}]${warn.phase ? ` [fase: ${warn.phase}]` : ''}${warn.agent ? ` [agente: ${warn.agent}]` : ''} ${warn.message}`,
          ),
        );
      }

      if (result.ok) {
        const warnText = result.warnings.length > 0 ? ` — ${result.warnings.length} warning` : '';
        console.log(chalk.green(`\n✅ Workflow valido${warnText}`));
      } else {
        console.log(
          chalk.red(
            `\n❌ Validazione fallita — ${result.errors.length} errori, ${result.warnings.length} warning`,
          ),
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// check command
program
  .command('check <file>')
  .description('Check .aflow file: summary + errors + warnings')
  .action((file: string) => {
    try {
      const ir = loadAndCompile(file);
      const result = validate(ir);
      const w = ir.workflow;

      const agentCount = Object.keys(w.agents).length;
      const phaseCount = w.phases.length;
      const loopInfo = w.loop
        ? `Loop: ${w.loop.id} (max ${w.loop.max_iterations ?? '?'} iter.)`
        : 'nessun loop';

      console.log(chalk.bold(`\n📋 ${w.id}${w.version ? ` — v${w.version}` : ''}`));
      if (w.description) console.log(`   ${w.description}`);
      console.log(`   Agenti: ${agentCount}  |  Fasi: ${phaseCount}  |  ${loopInfo}\n`);

      for (const err of result.errors) {
        console.log(
          chalk.red(
            `❌ [${err.rule}]${err.phase ? ` [fase: ${err.phase}]` : ''}${err.agent ? ` [agente: ${err.agent}]` : ''} ${err.message}`,
          ),
        );
      }
      for (const warn of result.warnings) {
        console.log(
          chalk.yellow(
            `⚠️  [${warn.rule}]${warn.phase ? ` [fase: ${warn.phase}]` : ''}${warn.agent ? ` [agente: ${warn.agent}]` : ''} ${warn.message}`,
          ),
        );
      }

      if (result.ok) {
        const warnText = result.warnings.length > 0 ? ` — ${result.warnings.length} warning` : '';
        console.log(chalk.green(`\n✅ Workflow valido${warnText}`));
      } else {
        console.log(
          chalk.red(
            `\n❌ Validazione fallita — ${result.errors.length} errori, ${result.warnings.length} warning`,
          ),
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// build command
program
  .command('build <file>')
  .description('Compile and save IR JSON to disk')
  .action((file: string) => {
    try {
      const ir = loadAndCompile(file);
      const result = validate(ir);

      if (!result.ok) {
        for (const err of result.errors) {
          console.error(chalk.red(`❌ [${err.rule}] ${err.message}`));
        }
        console.error(chalk.red('\nBuild failed due to validation errors.'));
        process.exit(1);
      }

      const outFile = file.replace(/\.aflow$/, '.ir.json');
      writeFileSync(outFile, JSON.stringify(ir, null, 2));
      console.log(chalk.green(`✅ Built: ${outFile}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// run command
program
  .command('run <file>')
  .description('Execute workflow with per-agent model resolution')
  .option('--input <json>', 'Trigger input as key=value pairs')
  .option('--mock', 'Force MockAgentExecutor even if ANTHROPIC_API_KEY is set')
  .option(
    '--output-dir <dir>',
    'Directory for phase output files (default: ./output/<workflow-id>)',
  )
  .action(async (file: string, options: { input?: string; mock?: boolean; outputDir?: string }) => {
    // Guard: config mancante
    if (!existsSync('agentflow.config.json')) {
      console.log(chalk.yellow('⚠️  agentflow.config.json non trovato. Esegui prima:'));
      console.log(chalk.cyan('   npx tsx src/cli.ts init\n'));
      process.exit(1);
    }

    try {
      const ir = loadAndCompile(file);
      const result = validate(ir);

      if (!result.ok) {
        for (const err of result.errors) {
          console.error(chalk.red(`❌ [${err.rule}] ${err.message}`));
        }
        process.exit(1);
      }

      // Parse trigger input
      const triggerInput: Record<string, unknown> = {};
      if (options.input) {
        const pairs = options.input.match(/(\w+)=("[^"]*"|[^\s]+)/g) ?? [];
        for (const pair of pairs) {
          const eqIdx = pair.indexOf('=');
          const key = pair.substring(0, eqIdx);
          let value: string = pair.substring(eqIdx + 1);
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
          }
          triggerInput[key] = value;
        }
      }

      // Executor selection: per-agent model resolution
      const outputDir = options.outputDir ?? `./output/${ir.workflow.id}`;
      const toolRegistry = createBuiltinRegistry(resolve(outputDir));

      const executor = options.mock
        ? new MockAgentExecutor()
        : createExecutorResolver(toolRegistry);

      if (options.mock) console.log(chalk.yellow('⚠️  Executor: Mock\n'));
      else console.log(chalk.cyan('🔀 Executor: per-agent model resolution\n'));

      const runner = new WorkflowRunner(ir, executor, { outputDir });

      console.log(chalk.bold(`🚀 Running: ${ir.workflow.id}\n`));

      const instance = await runner.run(triggerInput);

      // Phase results
      console.log(chalk.bold('\n📊 Phase Results:'));
      for (const [phaseId, state] of Object.entries(instance.phase_states)) {
        const icon = state === 'completed' ? '✅' : state === 'failed' ? '❌' : '⏳';
        console.log(`   ${icon} ${phaseId}: ${state}`);
      }

      // Loop info
      for (const [loopId, iterations] of Object.entries(instance.loop_iterations)) {
        console.log(chalk.cyan(`\n🔄 Loop "${loopId}": ${iterations} iteration(s)`));
      }

      // Final state
      const stateIcon = instance.state === 'completed' ? '✅' : '❌';
      console.log(chalk.bold(`\n${stateIcon} Workflow state: ${instance.state}`));
      console.log(chalk.dim(`   Instance: ${instance.instance_id}`));
      console.log(chalk.dim(`   State saved to: ${instance.instance_id}.state.json`));
      console.log(chalk.dim(`   Outputs saved to: ${outputDir}/\n`));
    } catch (err) {
      console.error(chalk.red(`Runtime error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// resume command
program
  .command('resume <file>')
  .description('Resume a previously interrupted workflow instance from saved state')
  .option('--instance <uuid>', 'Instance ID to resume (required)')
  .option('--mock', 'Force MockAgentExecutor')
  .option(
    '--output-dir <dir>',
    'Directory for phase output files (default: ./output/<workflow-id>)',
  )
  .action(
    async (file: string, options: { instance?: string; mock?: boolean; outputDir?: string }) => {
      if (!options.instance) {
        console.error(chalk.red('Error: --instance <uuid> is required for resume'));
        process.exit(1);
      }

      try {
        const ir = loadAndCompile(file);
        const result = validate(ir);

        if (!result.ok) {
          for (const err of result.errors) {
            console.error(chalk.red(`❌ [${err.rule}] ${err.message}`));
          }
          process.exit(1);
        }

        // Executor selection: per-agent model resolution
        const outputDir = options.outputDir ?? `./output/${ir.workflow.id}`;
        const toolRegistry = createBuiltinRegistry(resolve(outputDir));

        const executor = options.mock
          ? new MockAgentExecutor()
          : createExecutorResolver(toolRegistry);

        if (options.mock) console.log(chalk.yellow('⚠️  Executor: Mock\n'));
        else console.log(chalk.cyan('🔀 Executor: per-agent model resolution\n'));

        const runner = new WorkflowRunner(ir, executor, { outputDir });

        console.log(chalk.bold(`▶ Resuming: ${ir.workflow.id} — instance ${options.instance}\n`));

        const instance = await runner.resume(options.instance);

        // Phase results
        console.log(chalk.bold('\n📊 Phase Results:'));
        for (const [phaseId, state] of Object.entries(instance.phase_states)) {
          const icon = state === 'completed' ? '✅' : state === 'failed' ? '❌' : '⏳';
          console.log(`   ${icon} ${phaseId}: ${state}`);
        }

        // Loop info
        for (const [loopId, iterations] of Object.entries(instance.loop_iterations)) {
          console.log(chalk.cyan(`\n🔄 Loop "${loopId}": ${iterations} iteration(s)`));
        }

        // Final state
        const stateIcon = instance.state === 'completed' ? '✅' : '❌';
        console.log(chalk.bold(`\n${stateIcon} Workflow state: ${instance.state}`));
        console.log(chalk.dim(`   Instance: ${instance.instance_id}`));
        console.log(chalk.dim(`   State saved to: ${instance.instance_id}.state.json`));
        console.log(chalk.dim(`   Outputs saved to: ${outputDir}/\n`));
      } catch (err) {
        console.error(chalk.red(`Resume error: ${(err as Error).message}`));
        process.exit(1);
      }
    },
  );

program.parse();
