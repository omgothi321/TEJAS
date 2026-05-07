'use strict';

const path = require('path');

/**
 * Tejas Security Sanitizer
 * Prevents command injection and path traversal.
 */
class Sanitizer {
  /**
   * Hardens shell commands by blocking dangerous characters and sequences.
   */
  static sanitizeShell(command) {
    if (!command) return '';

    // Block non-pipe dangerous operators first (these are never safe)
    const nonPipeOps = [';', '&&', '||', '>', '<', '`'];
    for (const op of nonPipeOps) {
      if (command.includes(op)) {
        throw new Error(`Forbidden shell operator detected in: "${command}"`);
      }
    }

    // Block command substitution $() but allow arithmetic $((
    if (command.includes('$(') && !command.includes('$((')) {
      throw new Error(`Forbidden shell operator detected in: "${command}"`);
    }

    // If pipe present, validate EACH segment individually
    if (command.includes('|')) {
      const segments = command.split('|');
      const allowedPipeCmds = ['grep', 'sort', 'head', 'tail', 'uniq', 'awk', 'wc', 'cut', 'sed'];
      for (const seg of segments.slice(1)) {
        const cmd = seg.trim().split(' ')[0];
        if (!allowedPipeCmds.includes(cmd)) {
          throw new Error(`Potentially dangerous shell operator detected in: "${command}"`);
        }
      }
    }

    return command.trim();
  }

  /**
   * Prevents path traversal by ensuring the path stays within the CWD 
   * (or a specific allowed root).
   */
  static sanitizePath(filePath, rootDir = process.cwd()) {
    if (!filePath) throw new Error('No path provided');
    
    const absolutePath = path.isAbsolute(filePath) 
      ? path.normalize(filePath) 
      : path.normalize(path.join(rootDir, filePath));

    if (!absolutePath.startsWith(path.normalize(rootDir))) {
      throw new Error(`Security Alert: Path traversal attempt blocked: "${filePath}"`);
    }

    return absolutePath;
  }
}

module.exports = Sanitizer;
