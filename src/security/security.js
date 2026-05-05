'use strict';

const crypto = require('crypto');
const fs     = require('fs-extra');
const path   = require('path');

// ─── TEJAS SECURITY LAYER ─────────────────────────────────────────────────────
// Every command, every API call, every dashboard request goes through here.
// This is the guard between AI decisions and your actual machine.

// ─── DANGEROUS COMMAND PATTERNS ──────────────────────────────────────────────
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\w)/,          // rm -rf / (root deletion)
  /rm\s+-rf\s+~\/?$/,             // rm -rf ~
  /mkfs/,                          // format disk
  /dd\s+if=.*of=\/dev/,           // write to disk device
  /:(){:|:&};:/,                   // fork bomb
  /chmod\s+-R\s+777\s+\//,        // chmod 777 root
  /sudo\s+rm\s+-rf/,              // sudo delete
  />\s*\/dev\/sda/,               // write to disk
  /shutdown\s+-h\s+now/,          // shutdown (unless intended)
  /curl.*\|\s*sh/,                // curl pipe to shell
  /wget.*\|\s*sh/,                // wget pipe to shell
  /python.*-c.*os\.system/,       // python shell injection
  /eval\s*\(/,                    // eval injection
];

// ─── ALLOWED COMMAND PREFIXES (whitelist approach) ────────────────────────────
const SAFE_PREFIXES = [
  'git ', 'npm ', 'node ', 'python3 ', 'python ',
  'cat ', 'ls ', 'pwd ', 'echo ', 'mkdir ',
  'touch ', 'cp ', 'mv ', 'grep ', 'find ',
  'curl ', 'wget ', 'ping ', 'which ', 'whoami',
  'cd ', 'rm ', 'chmod ', 'chown ',
  'docker ', 'yarn ', 'npx ', 'pip ',
  'make ', 'gcc ', 'go ', 'cargo ',
  'systemctl status', 'ps aux', 'top', 'df ', 'du ',
];

// ─── SECURITY MANAGER ────────────────────────────────────────────────────────
class SecurityManager {
  constructor(tejasDir) {
    this.tejasDir  = tejasDir;
    this.auditFile = path.join(tejasDir, 'audit.log');
    this.authFile  = path.join(tejasDir, 'auth.json');
    this._rateMap  = new Map(); // ip → { count, resetAt }
    this.RATE_LIMIT = 30;       // max 30 tasks per minute
  }

  // ── VALIDATE COMMAND ──────────────────────────────────────────────────────
  validateCommand(command) {
    if (!command || typeof command !== 'string') {
      return { safe: false, reason: 'Empty or invalid command' };
    }

    const cmd = command.trim();

    // Check blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          safe:    false,
          reason:  `Blocked pattern detected: ${pattern.source}`,
          blocked: true
        };
      }
    }

    // Check for suspicious chained commands trying to escalate
    if (cmd.includes('sudo') && (cmd.includes('rm') || cmd.includes('dd') || cmd.includes('mkfs'))) {
      return { safe: false, reason: 'Suspicious sudo usage blocked' };
    }

    // Check command length (very long commands are suspicious)
    if (cmd.length > 500) {
      return { safe: false, reason: 'Command too long (>500 chars) — possible injection' };
    }

    return { safe: true };
  }

  // ── VALIDATE TASK ─────────────────────────────────────────────────────────
  validateTask(task) {
    if (!task || typeof task !== 'string') {
      return { valid: false, reason: 'Empty task' };
    }

    if (task.length > 1000) {
      return { valid: false, reason: 'Task too long' };
    }

    // Check for prompt injection attempts
    const injectionPatterns = [
      /ignore previous instructions/i,
      /you are now/i,
      /system prompt/i,
      /\[INST\]/i,
      /<\|system\|>/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(task)) {
        return { valid: false, reason: 'Potential prompt injection detected' };
      }
    }

    return { valid: true };
  }

  // ── RATE LIMITING ─────────────────────────────────────────────────────────
  checkRateLimit(identifier = 'local') {
    const now    = Date.now();
    const record = this._rateMap.get(identifier);

    if (!record || now > record.resetAt) {
      this._rateMap.set(identifier, { count: 1, resetAt: now + 60000 });
      return { allowed: true, remaining: this.RATE_LIMIT - 1 };
    }

    if (record.count >= this.RATE_LIMIT) {
      const waitSec = Math.ceil((record.resetAt - now) / 1000);
      return { allowed: false, reason: `Rate limit hit. Wait ${waitSec}s`, waitSec };
    }

    record.count++;
    return { allowed: true, remaining: this.RATE_LIMIT - record.count };
  }

  // ── AUDIT LOG ─────────────────────────────────────────────────────────────
  async audit(event) {
    await fs.ensureDir(this.tejasDir);
    const entry = {
      ts:      new Date().toISOString(),
      ...event
    };
    await fs.appendFile(this.auditFile, JSON.stringify(entry) + '\n');
  }

  async getAuditLog(limit = 50) {
    if (!await fs.pathExists(this.auditFile)) return [];
    const lines = (await fs.readFile(this.auditFile, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return lines.slice(-limit).reverse();
  }

  // ── DASHBOARD AUTH ────────────────────────────────────────────────────────
  async generateToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const hash  = crypto.createHash('sha256').update(token).digest('hex');
    await fs.ensureDir(this.tejasDir);
    await fs.writeJson(this.authFile, {
      hash,
      created_at: new Date().toISOString()
    });
    return token;
  }

  async validateToken(token) {
    if (!token) return false;
    if (!await fs.pathExists(this.authFile)) return false;
    const { hash } = await fs.readJson(this.authFile);
    const provided = crypto.createHash('sha256').update(token).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(provided));
  }

  async getOrCreateToken() {
    if (await fs.pathExists(this.authFile)) {
      // Token exists — return indicator (not the actual token, that's lost by design)
      return { exists: true, message: 'Token already set. Run: tejas dashboard --reset-token to regenerate' };
    }
    const token = await this.generateToken();
    return { exists: false, token };
  }

  // ── SANITIZE OUTPUT ───────────────────────────────────────────────────────
  sanitizeForDashboard(data) {
    if (typeof data !== 'string') data = JSON.stringify(data);
    // Remove any API keys that might leak into output
    return data
      .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***REDACTED***')
      .replace(/AIzaSy[a-zA-Z0-9_-]{30,}/g, 'AIza***REDACTED***')
      .replace(/gsk_[a-zA-Z0-9]{40,}/g, 'gsk_***REDACTED***')
      .replace(/xai-[a-zA-Z0-9]{40,}/g, 'xai-***REDACTED***');
  }
}

module.exports = SecurityManager;
