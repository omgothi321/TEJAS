'use strict';

const chalk = require('chalk');

// ─── TEJAS JUDGE ──────────────────────────────────────────────────────────────
// Quality control agent — checks every output before user sees it
// Score 0-100 → below 60 = auto fix

class CriticAgent {
  constructor(ai) {
    this.ai = ai;
  }

  // ── JUDGE ANY OUTPUT ────────────────────────────────────────────────────────
  async judge(task, output, agent) {
    if (!output || String(output).trim().length < 5) {
      return {
        score:   0,
        passed:  false,
        issues:  ['Output is empty or too short'],
        fix:     'Regenerate completely',
        summary: 'Empty output'
      };
    }

    const prompt = `You are Tejas Judge. Quality control only.
Task: "${String(task).slice(0, 200)}"
Agent: ${agent || 'unknown'}
Output: "${String(output).slice(0, 400)}"
Score this output. Return JSON only, no extra text:
{"score":75,"passed":true,"issues":[],"fix":null,"summary":"one line verdict"}`;

    try {
      const raw    = await this.ai.call(prompt);
      const result = this.ai._parseJSON(raw);
      if (!result || typeof result.score === 'undefined') {
        return { score: 0, passed: false, issues: ['AI failed to return valid score'], fix: 'Retry', summary: 'Failed analysis' };
      }
      return result;
    } catch {
      return { score: 0, passed: false, issues: ['Judge failed (AI error)'], fix: 'Retry', summary: 'Judge offline' };
    }
  }

  // ── JUDGE CODE ──────────────────────────────────────────────────────────────
  async judgeCode(task, code) {
    if (!code || String(code).trim().length < 10) {
      return { score: 0, passed: false, will_run: false, issues: ['No code'], fixed_code: null };
    }

    const prompt = `You are Tejas Code Judge.
Task: "${String(task).slice(0, 200)}"
Code: "${String(code).slice(0, 600)}"
Does this code solve the task? Return JSON only:
{"score":75,"passed":true,"will_run":true,"issues":[],"fixed_code":null}`;

    try {
      const raw    = await this.ai.call(prompt);
      const result = this.ai._parseJSON(raw);
      if (!result || typeof result.score === 'undefined') {
        return { score: 0, passed: false, will_run: false, issues: ['AI failed to return valid score'], fixed_code: null };
      }
      return result;
    } catch {
      return { score: 0, passed: false, will_run: false, issues: ['Judge failed (AI error)'], fixed_code: null };
    }
  }

  // ── JUDGE FILE ──────────────────────────────────────────────────────────────
  async judgeFile(task, content, filename) {
    if (!content || String(content).trim().length < 3) {
      return { score: 0, passed: false, issues: ['File content empty'], better_content: null };
    }

    const ext    = String(filename || 'txt').split('.').pop() || 'txt';
    const prompt = `You are Tejas File Judge.
Task: "${String(task).slice(0, 200)}"
File: ${filename || 'unknown'}
Content: "${String(content).slice(0, 400)}"
Is this valid ${ext} content for the task? Return JSON only:
{"score":75,"passed":true,"issues":[],"better_content":null}`;

    try {
      const raw    = await this.ai.call(prompt);
      const result = this.ai._parseJSON(raw);
      if (!result || typeof result.score === 'undefined') {
        return { score: 0, passed: false, issues: ['AI failed to return valid score'], better_content: null };
      }
      return result;
    } catch {
      return { score: 0, passed: false, issues: ['Judge failed (AI error)'], better_content: null };
    }
  }

  // ── DISPLAY RESULT ──────────────────────────────────────────────────────────
  display(judgment) {
    if (!judgment) return;
    const score   = Number(judgment.score) || 0;
    const summary = judgment.summary || 'Review complete';

    if (score >= 90) {
      console.log(chalk.green(`  ✓ Judge: ${summary} [${score}/100]`));
    } else if (score >= 60) {
      console.log(chalk.yellow(`  ⚠ Judge: ${summary} [${score}/100]`));
    } else {
      console.log(chalk.red(`  ✗ Judge: ${summary} [${score}/100]`));
      if (Array.isArray(judgment.issues) && judgment.issues.length > 0) {
        console.log(chalk.gray(`    Issues: ${judgment.issues.join(', ')}`));
      }
      if (judgment.fix) {
        console.log(chalk.cyan(`    Fix: ${judgment.fix}`));
      }
    }
  }
}

module.exports = CriticAgent;
