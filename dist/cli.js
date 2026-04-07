import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { parse } from './parser.js';
import { compile } from './compiler.js';
import { validate } from './validate.js';
import { WorkflowRunner, MockAgentExecutor } from './runtime.js';
import { ClaudeExecutor } from './executors/claude-executor.js';
import { OllamaExecutor } from './executors/ollama-executor.js';
function loadAndCompile(filePath) {
    const source = readFileSync(filePath, 'utf-8');
    const ast = parse(source);
    return compile(ast);
}
const program = new Command();
program
    .name('agentflow')
    .version('0.1.0')
    .description('AgentFlow DSL — declarative language for multi-agent orchestration');
// compile command
program
    .command('compile <file>')
    .description('Compile .aflow file and output IR JSON to stdout')
    .action((file) => {
    try {
        const ir = loadAndCompile(file);
        console.log(JSON.stringify(ir, null, 2));
    }
    catch (err) {
        console.error(chalk.red(`Compilation error: ${err.message}`));
        process.exit(1);
    }
});
// validate command
program
    .command('validate <file>')
    .description('Validate .aflow file and show errors/warnings')
    .action((file) => {
    try {
        const ir = loadAndCompile(file);
        const result = validate(ir);
        for (const err of result.errors) {
            console.log(chalk.red(`❌ [${err.rule}]${err.phase ? ` [fase: ${err.phase}]` : ''}${err.agent ? ` [agente: ${err.agent}]` : ''} ${err.message}`));
        }
        for (const warn of result.warnings) {
            console.log(chalk.yellow(`⚠️  [${warn.rule}]${warn.phase ? ` [fase: ${warn.phase}]` : ''}${warn.agent ? ` [agente: ${warn.agent}]` : ''} ${warn.message}`));
        }
        if (result.ok) {
            const warnText = result.warnings.length > 0 ? ` — ${result.warnings.length} warning` : '';
            console.log(chalk.green(`\n✅ Workflow valido${warnText}`));
        }
        else {
            console.log(chalk.red(`\n❌ Validazione fallita — ${result.errors.length} errori, ${result.warnings.length} warning`));
            process.exit(1);
        }
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    }
});
// check command
program
    .command('check <file>')
    .description('Check .aflow file: summary + errors + warnings')
    .action((file) => {
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
        if (w.description)
            console.log(`   ${w.description}`);
        console.log(`   Agenti: ${agentCount}  |  Fasi: ${phaseCount}  |  ${loopInfo}\n`);
        for (const err of result.errors) {
            console.log(chalk.red(`❌ [${err.rule}]${err.phase ? ` [fase: ${err.phase}]` : ''}${err.agent ? ` [agente: ${err.agent}]` : ''} ${err.message}`));
        }
        for (const warn of result.warnings) {
            console.log(chalk.yellow(`⚠️  [${warn.rule}]${warn.phase ? ` [fase: ${warn.phase}]` : ''}${warn.agent ? ` [agente: ${warn.agent}]` : ''} ${warn.message}`));
        }
        if (result.ok) {
            const warnText = result.warnings.length > 0 ? ` — ${result.warnings.length} warning` : '';
            console.log(chalk.green(`\n✅ Workflow valido${warnText}`));
        }
        else {
            console.log(chalk.red(`\n❌ Validazione fallita — ${result.errors.length} errori, ${result.warnings.length} warning`));
            process.exit(1);
        }
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    }
});
// build command
program
    .command('build <file>')
    .description('Compile and save IR JSON to disk')
    .action((file) => {
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
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    }
});
// run command
program
    .command('run <file>')
    .description('Execute workflow with ClaudeExecutor (real) or MockExecutor (fallback)')
    .option('--input <json>', 'Trigger input as key=value pairs')
    .option('--mock', 'Force MockAgentExecutor even if ANTHROPIC_API_KEY is set')
    .action(async (file, options) => {
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
        const triggerInput = {};
        if (options.input) {
            const pairs = options.input.match(/(\w+)=("[^"]*"|[^\s]+)/g) ?? [];
            for (const pair of pairs) {
                const eqIdx = pair.indexOf('=');
                const key = pair.substring(0, eqIdx);
                let value = pair.substring(eqIdx + 1);
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                }
                triggerInput[key] = value;
            }
        }
        // Executor selection
        const useClaude = !options.mock && !!process.env.ANTHROPIC_API_KEY;
        const useOllama = !options.mock && !useClaude;
        const executor = useClaude
            ? new ClaudeExecutor()
            : useOllama
                ? new OllamaExecutor()
                : new MockAgentExecutor();
        if (useClaude)
            console.log(chalk.cyan('🤖 Executor: Claude API\n'));
        else if (useOllama)
            console.log(chalk.cyan(`🦙 Executor: Ollama (${process.env.OLLAMA_MODEL ?? 'gemma4:e4b'})\n`));
        else
            console.log(chalk.yellow('⚠️  Executor: Mock\n'));
        const runner = new WorkflowRunner(ir, executor);
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
        console.log(chalk.dim(`   State saved to: ${instance.instance_id}.state.json\n`));
    }
    catch (err) {
        console.error(chalk.red(`Runtime error: ${err.message}`));
        process.exit(1);
    }
});
program.parse();
