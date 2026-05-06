'use strict';

const fs   = require('fs-extra');
const path = require('path');

// ─── FILE AGENT ───────────────────────────────────────────────────────────────
// Gives Tejas intelligence over your file system.
// Can: read files, analyze code, summarize docs, find files, organize
// Used when task contains: read, open, analyze, summarize, find file, organize

class FileAgent {
  constructor(aiEngine, memory) {
    this.ai     = aiEngine;
    this.memory = memory;
    this.name   = 'file';
    this.cwd    = process.cwd();
    // File size limit — don't read huge files into AI context
    this.maxFileSize = 50000; // 50KB
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
        case 'read':
          result.output = await this._readAndAnalyze(intent.target, task);
          break;
        case 'find':
          result.output = await this._findFiles(intent.target);
          break;
        case 'summarize':
          result.output = await this._summarizeFile(intent.target);
          break;
        case 'analyze':
          result.output = await this._analyzeCode(intent.target);
          break;
        case 'list':
          result.output = await this._listDirectory(intent.target || '.');
          break;
        case 'organize':
          result.output = await this._suggestOrganization(intent.target || '.');
          break;
        case 'write':
        case 'create':
          result.output = await this._writeFileAction(intent.target, intent.content, task);
          break;
        default:
          result.output = await this._smartFileOperation(task, intent);
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
Analyze this file task. Respond ONLY with JSON.

Task: "${task}"

Return:
{
  "action": "read|find|summarize|analyze|list|organize|write|create",
  "target": "filename or directory (use . for current dir)",
  "content": "exact content to write if action is write/create, else null",
  "operation": "what specifically to do"
}

Rules:
- "current directory" or "here" = target is "."
- If task says create/write a file with content, action = "write"
- Extract EXACT content from task if specified
- Never use the full task as content`;

    try {
      const raw = await this.ai.call(prompt);
      const parsed = this.ai._parseJSON(raw);
      
      // Post-process to ensure extension-only targets work for search
      if (parsed.action === 'find' && task.toLowerCase().includes('.txt')) {
        parsed.target = '.txt';
      }
      
      return parsed;
    } catch {
      // Fallback: try to extract filename from task
      const fileMatch = task.match(/[\w.-]+\.(js|py|ts|json|md|txt|sh|yaml|yml|css|html)/i);
      return {
        action: 'read',
        target: fileMatch ? fileMatch[0] : '.',
        operation: task
      };
    }
  }

  // ── READ AND ANALYZE ──────────────────────────────────────────────────────
  async _readAndAnalyze(target, originalTask) {
    const filePath = this._resolvePath(target);

    if (!await fs.pathExists(filePath)) {
      return `File not found: ${filePath}\n\nFiles in current directory:\n${await this._listDirectory('.')}`;
    }

    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      return this._listDirectory(target);
    }

    const content = await this._readFileSafe(filePath);
    const ext     = path.extname(filePath).toLowerCase();

    // For code files — do AI analysis
    if (['.js', '.py', '.ts', '.go', '.rs', '.java', '.cpp', '.c', '.sh'].includes(ext)) {
      return this._analyzeCodeContent(content, filePath, originalTask);
    }

    // For data files — summarize
    if (['.json', '.yaml', '.yml', '.xml'].includes(ext)) {
      return `File: ${filePath}\nSize: ${stat.size} bytes\n\nContent:\n${content.slice(0, 2000)}`;
    }

    // For text/markdown
    return `File: ${filePath}\nSize: ${stat.size} bytes\n\nContent:\n${content.slice(0, 3000)}`;
  }

  // ── FIND FILES ────────────────────────────────────────────────────────────
  async _findFiles(pattern) {
    if (!pattern) return 'No search pattern provided.';

    // Improve pattern matching for extensions (e.g. "find all .txt files" -> pattern might be ".txt")
    let searchPattern = pattern.toLowerCase();
    const extMatch = pattern.match(/\.([a-z0-9]+)$/i);
    if (extMatch) {
      searchPattern = extMatch[0].toLowerCase();
    }

    const results = [];
    await this._walkDir(this.cwd, searchPattern, results, 0);

    if (results.length === 0) {
      return `No files found matching "${searchPattern}" in ${this.cwd}`;
    }

    return `Found ${results.length} file(s) matching "${searchPattern}":\n\n${results.map(f => `  • ${f}`).join('\n')}`;
  }

  // ── WALK DIRECTORY ────────────────────────────────────────────────────────
  async _walkDir(dir, pattern, results, depth) {
    if (depth > 4) return; // max depth 4
    if (results.length > 50) return; // max 50 results

    const skip = ['node_modules', '.git', '.tejas', 'dist', 'build', '__pycache__'];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (skip.includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(this.cwd, fullPath);

        if (entry.isDirectory()) {
          await this._walkDir(fullPath, pattern, results, depth + 1);
        } else {
          const nameLower = entry.name.toLowerCase();
          const isExtMatch = pattern.startsWith('.') && nameLower.endsWith(pattern);
          const isNameMatch = nameLower.includes(pattern);
          
          if (isExtMatch || isNameMatch || relative.toLowerCase().includes(pattern)) {
            results.push(relative);
          }
        }
      }
    } catch {}
  }

  // ── SUMMARIZE FILE ────────────────────────────────────────────────────────
  async _summarizeFile(target) {
    const filePath = this._resolvePath(target);
    if (!await fs.pathExists(filePath)) {
      return `File not found: ${filePath}`;
    }

    const content = await this._readFileSafe(filePath);
    const prompt  = `
Summarize this file concisely. What does it do? What are the key parts?
File: ${path.basename(filePath)}

Content:
${content.slice(0, 4000)}

Give a 3-5 sentence summary.`;

    return this.ai.call(prompt);
  }

  // ── ANALYZE CODE ──────────────────────────────────────────────────────────
  async _analyzeCode(target) {
    const filePath = this._resolvePath(target);
    if (!await fs.pathExists(filePath)) {
      return `File not found: ${filePath}`;
    }

    const content = await this._readFileSafe(filePath);
    return this._analyzeCodeContent(content, filePath, 'analyze this code');
  }

  // ── ANALYZE CODE CONTENT ──────────────────────────────────────────────────
  async _analyzeCodeContent(content, filePath, task) {
    const prompt = `
You are Tejas Code Analyst. Analyze this code file.

File: ${path.basename(filePath)}
Task: "${task}"

Code:
${content.slice(0, 4000)}

Provide:
1. What this code does (1-2 sentences)
2. Key functions/classes (list)
3. Any obvious bugs or issues
4. Suggestions for improvement (max 3)

Be direct and specific.`;

    return this.ai.call(prompt);
  }

  // ── LIST DIRECTORY ────────────────────────────────────────────────────────
  async _listDirectory(target) {
    const dirPath = this._resolvePath(target);

    if (!await fs.pathExists(dirPath)) {
      return `Directory not found: ${dirPath}`;
    }

    const entries  = await fs.readdir(dirPath, { withFileTypes: true });
    const skip     = ['node_modules', '.git'];
    const dirs     = [];
    const files    = [];

    for (const entry of entries) {
      if (skip.includes(entry.name)) continue;
      if (entry.isDirectory()) {
        dirs.push(`  📁 ${entry.name}/`);
      } else {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        const size = this._formatSize(stat.size);
        files.push(`  📄 ${entry.name} (${size})`);
      }
    }

    return `Contents of ${dirPath}:\n\n${[...dirs, ...files].join('\n')}`;
  }

  // ── SUGGEST ORGANIZATION ──────────────────────────────────────────────────
  async _suggestOrganization(target) {
    const listing = await this._listDirectory(target);

    const prompt = `
You are Tejas File Agent. Suggest how to better organize this directory.

${listing}

Give 3-5 specific, actionable organization suggestions.
Focus on: folder structure, naming conventions, cleanup opportunities.`;

    return this.ai.call(prompt);
  }

  // ── SMART FILE OPERATION ──────────────────────────────────────────────────
  // ── WRITE FILE (actually creates files with real content) ──────────────────
  async _writeFileAction(target, content, originalTask) {
    if (!target || target === '.') {
      return 'Error: No filename specified. Please say the filename you want to create.';
    }

    // If no content specified, generate appropriate content
    if (!content || content.trim().length < 2 || content === originalTask) {
      const ext = target.split('.').pop() || 'txt';
      const prompt = 'Generate content for a ' + ext + ' file named "' + target + '" for this task: "' + originalTask + '". Return ONLY the file content. No explanation. No markdown fences. Just raw file content.';
      try {
        content = await this.ai.call(prompt);
        // Strip markdown fences if AI added them
        if (content.startsWith('```')) {
          content = content.replace(/^```[a-zA-Z]*/, '').replace(/```$/, '').trim();
        }
      } catch (e) {
        content = '// ' + originalTask;
      }
    }

    const filePath = this._resolvePath(target);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf8');

    const preview = content.slice(0, 500) + (content.length > 500 ? '...' : '');
    return 'Successfully wrote to ' + filePath + '\n\nContent:\n' + preview;
  }

  async _smartFileOperation(task, intent) {
    const prompt = `
You are Tejas File Agent. Complete this file task.
Current directory: ${this.cwd}

Task: "${task}"
Detected intent: ${JSON.stringify(intent)}

Provide the result or explain what you would do.`;

    return this.ai.call(prompt);
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  _resolvePath(target) {
    if (!target || target === '.') return this.cwd;
    if (path.isAbsolute(target)) return target;
    return path.join(this.cwd, target);
  }

  async _readFileSafe(filePath) {
    const stat = await fs.stat(filePath);
    if (stat.size > this.maxFileSize) {
      const content = await fs.readFile(filePath, 'utf8');
      return content.slice(0, this.maxFileSize) + '\n\n[... file truncated — too large ...]';
    }
    return fs.readFile(filePath, 'utf8');
  }

  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  }

  // ── CAPABILITY CHECK ──────────────────────────────────────────────────────
  static canHandle(task) {
    const triggers = [
      'read file', 'open file', 'analyze file', 'summarize file',
      'find file', 'list files', 'organize folder', 'list directory',
      'what is in this folder', 'check files',
      'create file', 'write to file', 'append to file'
    ];
    const lower = task.toLowerCase();
    return triggers.some(t => lower.includes(t));
  }
}

module.exports = FileAgent;
