'use strict';

const chalk = require('chalk');
const display = require('../utils/display');

/**
 * TEJAS HYPER-SUPERVISOR (v3.5)
 * The Meta-Brain that orchestrates multi-agent workflows and self-correction.
 */
class Supervisor {
...
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
          display.warn(`Self-Correction Needed (Attempt ${attempt}/2): ${judgment.summary}`);
          step.subtask += `

Fix this: ${judgment.fix}`;
        }
      }

      finalResults.push(result);
    }

    return finalResults;
  }
}

module.exports = Supervisor;
