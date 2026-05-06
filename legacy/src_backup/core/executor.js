'use strict';

const { exec, execSync } = require('child_process');
const { promisify }       = require('util');
const fs                  = require('fs-extra');
const path                = require('path');
const chalk               = require('chalk');

const execAsync = promisify(exec);

// ─── EXECUTOR ─────────────────────────────────────────────────────────────────
class Executor {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.cwd     = options.cwd     || process.cwd();
    this.timeout = options.timeout || 30000;
  }

  // ── RUN STEPS ─────────────────────────────────────────────────────────────
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

  // ── RUN SINGLE STEP ───────────────────────────────────────────────────────
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
          // Try to execute as shell curl if url provided
          if (step.url) {
            try {
              result.output = await this._runShell('curl -s --max-time 10 "' + step.url + '"');
            } catch {
              result.output = '[API call failed — try using shell action with curl instead]';
            }
          } else {
            result.output = '[No URL provided for api_call — use shell action with curl]';
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

  // ── SHELL COMMAND ─────────────────────────────────────────────────────────
  async _runShell(command) {
    if (!command) throw new Error('No command provided');

    // ⚠ SAFETY CHECK — block known destructive commands
    if (!this.isSafeCommand(command)) {
      throw new Error(`Blocked dangerous command: "${command}". Tejas will not run this.`);
    }

    if (this.verbose) {
      console.log(chalk.gray(`    $ ${command}`));
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd:     this.cwd,
      timeout: this.timeout,
      env:     { ...process.env }
    });

    if (stderr && !stdout) {
      // Some tools write to stderr normally (e.g., git)
      return stderr.trim();
    }

    return stdout.trim();
  }

  // ── FILE READ ─────────────────────────────────────────────────────────────
  async _readFile(filePath) {
    if (!filePath) throw new Error('No file path provided');
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.cwd, filePath);
    if (!await fs.pathExists(fullPath)) throw new Error(`File not found: ${fullPath}`);
    return fs.readFile(fullPath, 'utf8');
  }

  // ── FILE WRITE ────────────────────────────────────────────────────────────
  async _writeFile(filePath, content) {
    if (!filePath) throw new Error('No file path provided');
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.cwd, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content || '', 'utf8');
    return `Written: ${fullPath}`;
  }

  // ── SAFE SHELL (READ-ONLY CHECK) ──────────────────────────────────────────
  isSafeCommand(command) {
    const dangerous = [
      'rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:',
      'chmod -R 777 /', 'chown -R', '> /dev/sda',
      'mv /* ', 'wget -O- | sh', 'curl | sh', 'curl | bash'
    ];
    return !dangerous.some(d => command.includes(d));
  }

  // ── DETECT SYSTEM INFO ────────────────────────────────────────────────────
  async detectEnvironment() {
    const info = {
      os:      process.platform,
      arch:    process.arch,
      node:    process.version,
      cwd:     this.cwd,
      tools:   []
    };

    const toolChecks = [
      { tool: 'git',     cmd: 'git --version' },
      { tool: 'node',    cmd: 'node --version' },
      { tool: 'npm',     cmd: 'npm --version' },
      { tool: 'python3', cmd: 'python3 --version' },
      { tool: 'docker',  cmd: 'docker --version' },
      { tool: 'curl',    cmd: 'curl --version' },
      { tool: 'wget',    cmd: 'wget --version' },
      { tool: 'jq',      cmd: 'jq --version' }
    ];

    for (const { tool, cmd } of toolChecks) {
      try {
        execSync(cmd, { stdio: 'pipe' });
        info.tools.push(tool);
      } catch {}
    }

    return info;
  }
}

module.exports = Executor;
