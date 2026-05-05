'use strict';

const chalk = require('chalk');
const AIEngine = require('./src/core/ai');
const IntentParser = require('./src/core/intent');
const AgentRouter = require('./src/agents/router');
const MemoryManager = require('./src/core/memory');
const WebAgent = require('./src/agents/web.agent');
const FileAgent = require('./src/agents/file.agent');

async function brutalDiagnostic() {
  console.log(chalk.bold.red('\n🔥 TEJAS BRUTAL A-TO-Z DIAGNOSTIC 🔥'));
  console.log(chalk.gray('Testing for zero-error tolerance...\n'));

  const memory = new MemoryManager(process.cwd());
  const config = await memory.readConfig();
  const ai = new AIEngine(config);
  const parser = new IntentParser(ai);
  const router = new AgentRouter(ai, memory);

  let passed = 0;
  let failed = 0;

  const runTest = async (name, fn) => {
    process.stdout.write(chalk.white(`Testing ${name.padEnd(30)}... `));
    try {
      await fn();
      console.log(chalk.green('PASSED ✅'));
      passed++;
    } catch (err) {
      console.log(chalk.red('FAILED ❌'));
      console.log(chalk.red(`   ↳ Error: ${err.message}`));
      failed++;
    }
  };

  // --- 1. ENGINE TEST ---
  await runTest('AI Engine Connectivity', async () => {
    const res = await ai.call('respond with ONLY the word "OK"');
    if (!res.toUpperCase().includes('OK')) throw new Error('AI Response Mismatch: ' + res);
  });

  // --- 2. INTENT PARSER TEST ---
  await runTest('Smart Intent Extraction', async () => {
    const res = await parser.parse('search for the price of 5 gold bars and save it to gold.txt');
    if (!['web.search', 'file.operation', 'code.task'].includes(res.intent)) {
       throw new Error(`Weak Intent Parsing: ${res.intent}`);
    }
  });

  // --- 3. ROUTER SCORING TEST ---
  await runTest('Router Accuracy', async () => {
    const scores = router._calculateScores('write a python script to sort a list');
    if (scores.code < 70) throw new Error(`Router failed to prioritize Code Agent: ${scores.code}`);
  });

  // --- 4. WEB AGENT (TAVILY) TEST ---
  await runTest('Tavily Data Integrity', async () => {
    const web = new WebAgent(ai, memory);
    const result = await web._searchTavily('Bitcoin price today');
    if (!result || !result.toLowerCase().includes('bitcoin')) {
        throw new Error('Tavily returned empty or irrelevant data');
    }
  });

  // --- 5. FILE AGENT TEST ---
  await runTest('File Agent Stability', async () => {
    const file = new FileAgent(ai, memory);
    const result = await file.run('list all files in the current directory'); 
    if (!result.success) throw new Error('File Agent failed simple list: ' + result.error);
  });

  // --- 6. MEMORY GRAPH TEST ---
  await runTest('Knowledge Graph Persistence', async () => {
    await memory.initialize();
    const stats = await memory.getGraphStats();
    if (typeof stats.total_nodes !== 'number') {
        throw new Error(`Graph stats corrupted - total_nodes is ${typeof stats.total_nodes}: ${JSON.stringify(stats)}`);
    }
  });

  console.log('\n' + '─'.repeat(40));
  console.log(chalk.bold(`TOTAL: ${passed + failed} | `) + chalk.green(`PASSED: ${passed}`) + chalk.red(` | FAILED: ${failed}`));
  
  if (failed === 0) {
    console.log(chalk.bold.green('\nVERDICT: TEJAS IS STABLE (9/10) 🚀'));
  } else {
    console.log(chalk.bold.red('\nVERDICT: TEJAS HAS CRITICAL WEAKNESSES 💀'));
  }
}

brutalDiagnostic().catch(err => {
    console.log(chalk.red('\nFATAL ERROR DURING TEST SUITE:'), err);
});
