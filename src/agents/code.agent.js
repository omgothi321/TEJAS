'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const Sanitizer    = require('../utils/sanitizer');
const execFileAsync = promisify(execFile);

// ─── CODE AGENT ───────────────────────────────────────────────────────────────
// Tejas's pair programmer.
// Can: review code, find bugs, fix code, write tests, refactor, explain
// Used when task contains: review, fix, debug, refactor, write test, explain code

class CodeAgent {
  constructor(aiEngine, memory) {
    this.ai     = aiEngine;
    this.memory = memory;
    this.name   = 'code';
    this.cwd    = process.cwd();
  }

  // ── MAIN ENTRY ────────────────────────────────────────────────────────────
  async run(task, context = {}) {
    const result = {
      agent:   this.name,
      task,
      success: false,
      output:  null,
      steps:   [],
      error:   null
    };

    try {
      const intent = await this._detectIntent(task);

      switch (intent.action) {
        case 'review':
          result.output = await this._reviewCode(intent.target, task);
          break;
        case 'fix':
          result.output = await this._fixCode(intent.target, intent.issue, task);
          break;
        case 'debug':
          result.output = await this._debugCode(intent.target, intent.error);
          break;
        case 'write':
          result.output = await this._writeCode(task, context);
          break;
        case 'test':
          result.output = await this._writeTests(intent.target);
          break;
        case 'refactor':
          result.output = await this._refactorCode(intent.target, task);
          break;
        case 'explain':
          result.output = await this._explainCode(intent.target);
          break;
        case 'run':
          result.output = await this._runCode(intent.target);
          break;
        default:
          result.output = await this._smartCodeOperation(task, context);
      }

      result.success = true;

    } catch (err) {
      result.error = err.message;
    }

    return result;
  }

  // ── DETECT INTENT ─────────────────────────────────────────────────────────
  async _detectIntent(task) {
    const prompt = `
Analyze this coding task. Respond ONLY with JSON.

Task: "${task}"

Return:
{
  "action": "review|fix|debug|write|test|refactor|explain|run",
  "target": "filename if mentioned, else null",
  "language": "programming language if mentioned",
  "issue": "specific issue if mentioned",
  "error": "error message if mentioned"
}`;

    try {
      const raw = await this.ai.call(prompt);
      return this.ai._parseJSON(raw);
    } catch {
      return { action: 'write', target: null, language: 'javascript' };
    }
  }

  // ── REVIEW CODE ───────────────────────────────────────────────────────────
  async _reviewCode(target, task) {
    const code = await this._loadCode(target);

    const prompt = `
You are Tejas Code Review Agent. Do a thorough code review.

File: ${target || 'provided code'}
Task context: "${task}"

Code:
${code}

Review format:
## Summary
(1-2 sentences on what the code does)

## Issues Found
(list each bug, security issue, or problem with line numbers if possible)

## Code Quality
(rating 1-10 and key observations)

## Specific Fixes
(exact code changes needed, with before/after)

## Suggestions
(improvements that aren't bugs but would make it better)

Be specific. Be direct. No fluff.`;

    return this.ai.call(prompt);
  }

  // ── FIX CODE ──────────────────────────────────────────────────────────────
  async _fixCode(target, issue, task) {
    const code = await this._loadCode(target);

    const prompt = `
You are Tejas Code Fix Agent. Fix the issue in this code.

File: ${target || 'provided code'}
Issue: "${issue || task}"

Original code:
${code}

Return the COMPLETE fixed code with a brief explanation of what you changed.
Format:
## What I Fixed
(explanation)

## Fixed Code
\`\`\`
(complete fixed code here)
\`\`\``;

    const response = await this.ai.call(prompt);

    // If target file exists and user wants to save — extract and offer
    if (target && await fs.pathExists(path.join(this.cwd, target))) {
      return response + `\n\n💡 To apply this fix:\n  tejas run "apply the fix to ${target}"`;
    }

    return response;
  }

  // ── DEBUG CODE ────────────────────────────────────────────────────────────
  async _debugCode(target, errorMsg) {
    const code = await this._loadCode(target);

    const prompt = `
You are Tejas Debug Agent. Find and fix this bug.

File: ${target || 'code'}
Error: "${errorMsg || 'unknown error'}"

Code:
${code}

Debug analysis:
1. ROOT CAUSE: What exactly is causing this error
2. LINE: Which line(s) are responsible  
3. FIX: Exact code change needed
4. PREVENTION: How to avoid this in future

Be precise. Show exact line numbers and code.`;

    return this.ai.call(prompt);
  }

  // ── WRITE CODE ────────────────────────────────────────────────────────────
  async _writeCode(task, context) {
    // Pull relevant patterns from memory
    const memContext = context?.user?.preferences
      ? `User preferences: ${JSON.stringify(context.user.preferences)}`
      : '';

    const prompt = `
You are Tejas Engineer — expert programmer.

Task: "${task}"
${memContext}

STRICT RULES:
- Write ONLY the code for exactly what was asked
- Do NOT add unrelated features or examples
- If asked for fibonacci — write fibonacci ONLY
- If asked to print numbers — print numbers ONLY
- Code must actually run without errors
- Include error handling
- Keep it simple and focused

Return the code with a ONE LINE explanation.`;

    return this.ai.call(prompt);
  }

  // ── WRITE TESTS ───────────────────────────────────────────────────────────
  async _writeTests(target) {
    const code = await this._loadCode(target);

    const prompt = `
You are Tejas Test Writer. Write comprehensive tests for this code.

File: ${target || 'code'}

Code:
${code}

Write tests that cover:
1. Happy path (normal usage)
2. Edge cases
3. Error handling

Use the appropriate test framework for the language.
Return complete, runnable test code.`;

    return this.ai.call(prompt);
  }

  // ── REFACTOR CODE ─────────────────────────────────────────────────────────
  async _refactorCode(target, task) {
    const code = await this._loadCode(target);

    const prompt = `
You are Tejas Refactor Agent. Refactor this code to be cleaner and more maintainable.

File: ${target || 'code'}
Goal: "${task}"

Original:
${code}

Refactored version with explanation of changes:
## Changes Made
(list of improvements)

## Refactored Code
\`\`\`
(complete refactored code)
\`\`\``;

    return this.ai.call(prompt);
  }

  // ── EXPLAIN CODE ──────────────────────────────────────────────────────────
  async _explainCode(target) {
    const code = await this._loadCode(target);

    const prompt = `
You are Tejas Code Explainer. Explain this code clearly.

File: ${target || 'code'}

Code:
${code}

Explain:
1. What does this code do overall? (simple English)
2. How does it work step by step?
3. What are the key parts?
4. Any important patterns or techniques used?

Explain as if teaching a junior developer.`;

    return this.ai.call(prompt);
  }

  // ── RUN CODE ──────────────────────────────────────────────────────────────
  async _runCode(target) {
    if (!target) return 'No file specified to run.';

    let filePath;
    try {
      filePath = Sanitizer.sanitizePath(target, this.cwd);
    } catch {
      return `Security: Path not allowed — ${target}`;
    }
    if (!await fs.pathExists(filePath)) {
      return `File not found: ${target}`;
    }

    const ext = path.extname(target).toLowerCase();
    const runners = {
      '.js':  ['node',    filePath],
      '.py':  ['python3', filePath],
      '.sh':  ['bash',    filePath],
      '.ts':  ['npx', 'ts-node', filePath],
      '.rb':  ['ruby',    filePath],
      '.go':  ['go', 'run', filePath]
    };

    const args = runners[ext];
    if (!args) return `Don't know how to run ${ext} files.`;

    try {
      const { stdout, stderr } = await execFileAsync(args[0], args.slice(1), {
        cwd: this.cwd,
        timeout: 15000
      });
      return `Running: ${args.join(' ')}\n\nOutput:\n${stdout || stderr || '(no output)'}`;
    } catch (err) {
      return `Run failed:\n${err.message}`;
    }
  }

  // ── SMART CODE OPERATION ──────────────────────────────────────────────────
  async _smartCodeOperation(task, context) {
    const prompt = `
You are Tejas Code Agent. Complete this coding task.
Current directory: ${this.cwd}

Task: "${task}"

Provide a complete, actionable response with code examples.`;

    return this.ai.call(prompt);
  }

  // ── LOAD CODE ─────────────────────────────────────────────────────────────
  async _loadCode(target) {
    if (!target) return '(no file specified — working from task description)';

    const filePath = Sanitizer.sanitizePath(target, this.cwd);
    if (!filePath || !await fs.pathExists(filePath)) {
      return `(file ${target} not found or access denied)`;
    }

    const content = await fs.readFile(filePath, 'utf8');
    return content.slice(0, 6000); // 6KB max for code review
  }


  // ── SCORING FUNCTION ──────────────────────────────────────────────────────
  getScore(task) {
    const t = task.toLowerCase();
    let s = 0;

    // Highest Priority: Explicit "write code/script/function"
    if (/\b(write|create|make|build|generate)\s+(a\s+)?(script|function|program|code|algorithm|snippet)\b/i.test(t)) s = 85;
    
    // Explicit Language Mentions with Action
    if (/\b(write|create|make|build|generate)\s+(a\s+)?(python|javascript|nodejs|node|js|ts|bash|ruby|go|cpp|java|html|css)\b/i.test(t)) s = 90;

    // Specific Coding Tasks
    if (/\b(fibonacci|sorting|factorial|palindrome|binary\s+search|rest\s+api|scraper|bot|server|calculator)\b/i.test(t)) s = Math.max(s, 80);

    // Maintenance & Quality
    if (/\b(debug|fix\s+bug|fix\s+this\s+code|syntax\s+error|refactor|unit\s+test|write\s+tests?|review\s+code|explain\s+code)\b/i.test(t)) s = Math.max(s, 85);

    // Penalties for non-coding tasks
    if (/\b(weather|news|price\s+of|search\s+for|who\s+is|what\s+is\s+the\s+capital)\b/i.test(t)) s = 0;
    if (/\b(version|time|date|ip\s+address|disk\s+space|running|system\s+status)\b/i.test(t)) s = 0;

    return s;
  }

  // ── CAPABILITY CHECK ──────────────────────────────────────────────────────
  static canHandle(task) {
    const triggers = [
      'write a script', 'write a function', 'write code', 'write a program',
      'write python', 'write javascript', 'write nodejs', 'write a node',
      'write fibonacci', 'write calculator', 'write a calculator',
      'write a rest api', 'write rest api', 'write an api',
      'write a flask', 'write flask', 'write express',
      'write a server', 'write a scraper', 'write and run',
      'create a function', 'javascript function', 'python script',
      'python function', 'nodejs script', 'typescript code',
      'create a python', 'create a javascript', 'create a nodejs',
      'debug this', 'fix bug', 'fix this code', 'fix the error',
      'review code', 'refactor', 'unit test', 'write test',
      'algorithm for', 'write algorithm', 'syntax error', 'compile error',
      'generate passwords',
      'write a python', 'rest api', 'write api'
    ];
    const lower = task.toLowerCase();
    return triggers.some(function(t) { return lower.includes(t); });
  }
}

module.exports = CodeAgent;
