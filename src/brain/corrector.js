'use strict';

// ─── SELF-CORRECTOR ───────────────────────────────────────────────────────────
// When a step fails, Tejas doesn't give up.
// It feeds the error back to the AI and asks for a fix.
// This is how Tejas gets smarter from every failure.
//
// Loop:
//   Execute step → fails → describe error to AI → get fix → execute fix → log result

class SelfCorrector {
  constructor(aiEngine) {
    this.ai         = aiEngine;
    this.maxRetries = 2;
  }

  // ── CORRECT STEP ──────────────────────────────────────────────────────────
  // Takes a failed step and returns a corrected version
  async correctStep(step, error, originalTask, context = {}) {
    const prompt = `
You are Tejas Self-Corrector. A step just failed. Fix it.

Original task: "${originalTask}"

Failed step:
${JSON.stringify(step, null, 2)}

Error received:
${String(error).slice(0, 200).replace(/[`$]/g, '')}

Provide a corrected step. Respond ONLY with valid JSON:
{
  "step": ${step.step || 1},
  "action": "shell|file_write|file_read|explain",
  "description": "corrected description",
  "command": "corrected shell command or null",
  "path": "file path or null",
  "content": "file content or null",
  "expected_output": "what success looks like",
  "correction_note": "what was wrong and how you fixed it"
}

Rules:
- If command had wrong path → fix the path
- If command had wrong syntax → fix the syntax  
- If file not found → create it first or use correct path
- If permission denied → suggest manual fix to user, do not retry with elevated privileges
- Never suggest rm -rf or destructive alternatives
`;

    try {
      const raw       = await this.ai.call(prompt);
      const corrected = this.ai._parseJSON(raw);
      return { success: true, step: corrected };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── CORRECT PLAN ─────────────────────────────────────────────────────────
  // When whole plan fails — regenerate with error context
  async correctPlan(originalTask, failedPlan, errors, context = {}) {
    const errorSummary = errors
      .filter(e => e)
      .slice(0, 3)
      .join('\n');

    const prompt = `
You are Tejas. Your previous plan for this task failed. Create a better plan.

Task: "${originalTask}"

Previous plan that failed:
${JSON.stringify(failedPlan?.steps?.slice(0, 5), null, 2)}

Errors encountered:
${errorSummary}

Create a new, corrected execution plan. Learn from the errors above.
Respond ONLY with valid JSON in the same format as before.
`;

    try {
      const raw  = await this.ai.call(prompt);
      const plan = this.ai._parseJSON(raw);
      return { success: true, plan };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── EXPLAIN FAILURE ───────────────────────────────────────────────────────
  // Generate a human-readable explanation of what went wrong
  async explainFailure(task, error, context = {}) {
    const prompt = `
Explain this error in simple terms and suggest what the user should do.

Task attempted: "${task}"
Error: "${error}"

Response format:
- What happened (1 sentence)
- Why it happened (1 sentence)  
- What to do (1-2 specific actions)

Be direct. Be brief.`;

    try {
      return await this.ai.call(prompt);
    } catch {
      return `Task failed: ${error}. Check the command and try again.`;
    }
  }
}

module.exports = SelfCorrector;
