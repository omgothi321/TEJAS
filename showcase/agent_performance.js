const MemoryManager = require('./src/core/memory');
const AIEngine = require('./src/core/ai');
const AgentRouter = require('./src/agents/router');
const CriticAgent = require('./src/agents/critic.agent');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

async function testAll() {
    console.log(chalk.bold.blue('--- TEJAS SYSTEM DIAGNOSTIC ---'));

    const cwd = process.cwd();
    const memory = new MemoryManager(cwd);
    const config = await memory.readConfig();
    const ai = new AIEngine(config);
    const router = new AgentRouter(ai, memory);
    const critic = new CriticAgent(ai);

    const tests = [
        { name: 'FILE AGENT', task: 'list all files in current directory', agent: 'file' },
        { name: 'CODE AGENT', task: 'write a python function for fibonacci', agent: 'code' },
        { name: 'WEB AGENT', task: 'what is the capital of France?', agent: 'web' },
        { name: 'CRITIC AGENT', task: 'Check this output: "Hello world"', output: 'Hello world', agent: 'critic' }
    ];

    for (const t of tests) {
        console.log(chalk.yellow(`
Testing ${t.name}...`));
        try {
            if (t.agent === 'critic') {
                const judgment = await critic.judge('test task', t.output, 'test_agent');
                console.log(chalk.green('✓ Critic Agent Response:'), JSON.stringify(judgment, null, 2));
                critic.display(judgment);
            } else {
                const routeInfo = await router.route(t.task);
                console.log(chalk.cyan(`  Selected Agent: ${routeInfo.agent}`));
                
                if (routeInfo.result) {
                    console.log(chalk.green(`  Success: ${routeInfo.result.success}`));
                    console.log(chalk.gray(`  Output preview: ${String(routeInfo.result.output).slice(0, 100)}...`));
                    
                    const judgment = await critic.judge(t.task, routeInfo.result.output, routeInfo.agent);
                    critic.display(judgment);
                } else if (routeInfo.useNativeExecutor) {
                    console.log(chalk.magenta('  (Uses native executor - skip deep test)'));
                }
            }
        } catch (err) {
            console.log(chalk.red(`  FAILED: ${err.message}`));
        }
    }
}

testAll().catch(console.error);
