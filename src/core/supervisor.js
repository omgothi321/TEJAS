'use strict';

const chalk = require('chalk');
const display = require('../utils/display');

/**
 * TEJAS HYPER-SUPERVISOR (v3.5)
 * The Meta-Brain that orchestrates multi-agent workflows and self-correction.
 */
class Supervisor {
  constructor(ai, router, memory, critic) {
    this.ai = ai;
    this.router = router;
    this.memory = memory;
    this.critic = critic;
  }

  async execute(task) {
    display.section('HYPER-ORCHESTRATION ACTIVE');
    const spin = display.spinner('Thinking deeply...').start();

    // 1. CONTEXTUAL RECALL
    const context = await this.memory.getContextSummary(task);
    
    // 2. META-PLANNING (Chain-of-Thought)
    const planPrompt = `
You are the Tejas Hyper-Supervisor. 
Task: "${task}"
Context: ${JSON.stringify(context.graph_context || 'None')}

Break this task into a multi-agent workflow. 
If it requires searching AND coding, plan both.
If it requires verification, plan a check step.

Respond ONLY with JSON:
{
  "reasoning": "your deep thought process",
  "workflow": [
    { "subtask": "description", "agent": "web|code|file|workflow", "critical": true }
  ]
}`;

    const rawPlan = await this.ai.call(planPrompt, "System: Zero-Error Mode Enabled.");
    const plan = this.ai._parseJSON(rawPlan);
    spin.stop();

    display.info(chalk.bold('Reasoning: ') + chalk.gray(plan.reasoning));
    
    const finalResults = [];

    // 3. MULTI-AGENT EXECUTION LOOP
    for (const step of plan.workflow) {
      display.info(`Executing Sub-task: ${chalk.cyan(step.subtask)} [Agent: ${step.agent}]`);
      
      let attempt = 0;
      let success = false;
      let result = null;

      while (attempt < 3 && !success) {
        attempt++;
        const routing = await this.router.route(step.subtask, { agent: step.agent }, context);
        
        if (routing.useNativeExecutor) {
            throw new Error("Native executor integration not implemented.");
        } else {
            result = routing.result;
        }

        // 4. THE CRITIC LOOP (Self-Correction)
        const judgment = await this.critic.judge(step.subtask, result.output, step.agent);
        
        if (judgment.passed) {
          success = true;
          this.critic.display(judgment);
        } else {
          display.warn(`Judge Rejected Result (Attempt ${attempt}/3): ${judgment.summary}`);
          
          if (attempt < 3) {
            display.info(chalk.yellow('  ↻ Autonomous Self-Correction Active...'));
            step.subtask = `FIX: ${step.subtask} (Retry reason: ${judgment.fix})`;
          }
        }
      }

      finalResults.push(result);
      if (!success) {
          display.error(`Critical Failure in workflow step: ${step.subtask}`);
          break;
      }
    }

    return finalResults;
  }
}

module.exports = Supervisor;
