const MemoryManager = require('./src/core/memory');
const AgentRouter = require('./src/agents/router');
const AIEngine = require('./src/core/ai');

async function testRouting() {
  const memory = new MemoryManager(process.cwd());
  const config = await memory.readConfig();
  const ai = new AIEngine(config);
  const router = new AgentRouter(ai, memory);

  const tasks = [
    "search for latest AI news",
    "what is the weather in Mumbai",
    "search for nodejs best practices"
  ];

  for (const task of tasks) {
    const explanation = await router.explainRouting(task);
    console.log(`Task: ${task}`);
    console.log(JSON.stringify(explanation, null, 2));
    console.log('---');
  }
}

testRouting();
