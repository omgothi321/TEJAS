'use strict';

const { exec, execSync, execFile } = require('child_process');
const { promisify }       = require('util');
const fs                  = require('fs-extra');
const path                = require('path');
const chalk               = require('chalk');
const Sanitizer           = require('../utils/sanitizer');
const { parse }           = require('shell-quote');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── EXECUTOR ─────────────────────────────────────────────────────────────────
class Executor {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.cwd     = options.cwd     || process.cwd();
    this.timeout = options.timeout || 30000;
  }

  async runSteps(steps = [], onStepDone = null) {
    const results = [];
    for (const step of steps) {
      const result = await this.runStep(step);
      results.push(result);
      if (onStepDone) onStepDone(step, result);
      if (result.error && !step.continue_on_error) break;
    }
    return results;
  }

  async runStep(step) {
    const result = {
      step:    step.step,
      action:  step.action,
      success: false,
      output:  null,
      error:   null,
      duration_ms: 0
    };

    const start = Date.now();

    try {
      switch (step.action) {
        case 'shell':
          result.output = await this._runShell(step.command);
          break;
        case 'file_read':
          result.output = await this._readFile(step.path);
          break;
        case 'file_write':
          result.output = await this._writeFile(step.path, step.content);
          break;
        case 'explain':
          result.output = step.description;
          break;
        case 'api_call':
          // Hardened API call using curl with args array
          if (step.url) {
            result.output = await this._runShellArray('curl', ['-s', '--max-time', '10', step.url]);
          } else {
            result.output = '[No URL provided for api_call]';
          }
          break;
        case 'ask_user':
          result.output = '[User input required — handled by caller]';
          result.needs_input = true;
          break;
        default:
          result.output = `[Unknown action type: ${step.action}]`;
      }
      result.success = true;
    } catch (err) {
      result.error = err.message;
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  /**
   * Executes a command using an argument array for maximum security.
   * Prevents shell injection by bypassing the shell entirely.
   */
  async _runShellArray(cmd, args) {
    if (this.verbose) {
      console.log(chalk.gray(`    $ ${cmd} ${args.join(' ')}`));
    }
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd:     this.cwd,
      timeout: this.timeout,
      env:     { ...process.env }
    });
    return (stdout || stderr || '').trim();
  }

  async _runShell(command) {
    if (!command) throw new Error('No command provided');

    // Sanitization remains as a secondary defense layer
    const safeCommand = Sanitizer.sanitizeShell(command);
    
    if (!this.isSafeCommand(safeCommand)) {
      throw new Error(`Blocked dangerous command pattern. Tejas will not run this.`);
    }

    if (this.verbose) {
      console.log(chalk.gray(`    $ ${safeCommand}`));
    }

    // Split command into array and use execFile for maximum security.
    // This bypasses the shell entirely.
    const parts = parse(safeCommand);
    const { stdout, stderr } = await execFileAsync(parts[0], parts.slice(1), {
      cwd:     this.cwd,
      timeout: this.timeout,
      env:     { ...process.env }
    });

    return (stdout || stderr || '').trim();
  }

  async _readFile(filePath) {
    if (!filePath) throw new Error('No file path provided');
    const fullPath = Sanitizer.sanitizePath(filePath, this.cwd);
    if (!await fs.pathExists(fullPath)) throw new Error(`File not found: ${fullPath}`);
    return fs.readFile(fullPath, 'utf8');
  }

  async _writeFile(filePath, content) {
    if (!filePath) throw new Error('No file path provided');
    const fullPath = Sanitizer.sanitizePath(filePath, this.cwd);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content || '', 'utf8');
    return `Written: ${fullPath}`;
  }

  isSafeCommand(command) {
    const dangerous = [
      'rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:',
      'chmod -R 777 /', 'chown -R', '> /dev/sda',
      'mv /* ', 'wget -O- | sh', 'curl | sh', 'curl | bash'
    ];
    return !dangerous.some(d => command.includes(d));
  }

  async detectEnvironment() {
    const info = {
      os:      process.platform,
      arch:    process.arch,
      node:    process.version,
      cwd:     this.cwd,
      tools:   []
    };

    const toolChecks = [
      { tool: 'git',     cmd: 'git' },
      { tool: 'node',    cmd: 'node' },
      { tool: 'npm',     cmd: 'npm' },
      { tool: 'python3', cmd: 'python3' },
      { tool: 'docker',  cmd: 'docker' },
      { tool: 'curl',    cmd: 'curl' },
      { tool: 'wget',    cmd: 'wget' },
      { tool: 'jq',      cmd: 'jq' }
    ];

    for (const { tool, cmd } of toolChecks) {
      try {
        // Safe tool check using execFile
        await execFileAsync(cmd, ['--version'], { stdio: 'pipe' });
        info.tools.push(tool);
      } catch {}
    }

    return info;
  }
}

module.exports = Executor;
