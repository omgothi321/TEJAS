'use strict';

const path = require('path');
const fs   = require('fs-extra');
const chalk = require('chalk');
const MemoryManager = require('../src/core/memory');
const AIEngine = require('../src/core/ai');

async function generateReport() {
    console.log(chalk.bold.blue('\n--- TEJAS DAILY SYSTEM REPORT ---'));
    
    const rootDir = path.join(__dirname, '..');
    const memory = new MemoryManager(rootDir);
    await memory.initialize();
    
    const config = await memory.readConfig();
    const ai = new AIEngine(config);
    
    const mem = await memory.read();
    const stats = mem.stats;
    const history = mem.agents.history;

    const reportPrompt = `
You are Tejas System Analyst. Summarize the following system data into a professional daily report.

System Stats:
- Tasks Run: ${stats.tasks_run}
- Patterns Learned: ${stats.patterns_learned}
- Total Interactions: ${stats.total_interactions}

Recent History (last 10 tasks):
${JSON.stringify(history.slice(0, 10), null, 2)}

Provide:
1. Executive Summary (1 paragraph)
2. Performance Trends (Agent success rates)
3. Anomalies or Errors detected
4. Security Posture Recommendation
`;

    console.log(chalk.gray('Analyzing system state...'));
    try {
        const report = await ai.call(reportPrompt, "System: Analytical Mode Active.");
        console.log('\n' + report + '\n');
        
        const reportPath = path.join(rootDir, 'logs', `report-${new Date().toISOString().split('T')[0]}.md`);
        await fs.writeFile(reportPath, report, 'utf8');
        console.log(chalk.green(`✓ Report saved to: ${reportPath}`));
    } catch (err) {
        console.error(chalk.red('Failed to generate report:'), err.message);
    }
}

if (require.main === module) {
    generateReport();
}
