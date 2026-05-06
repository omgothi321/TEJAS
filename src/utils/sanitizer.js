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
    
    // Block command chaining and redirection that could be used for injection
    const forbidden = [';', '&&', '||', '|', '>', '<', '`'];
    
    // Check for common injection patterns
    if (forbidden.some(char => command.includes(char)) || (command.includes('$(') && !command.includes('$(('))) {
      // If it has a pipe or redirect, it MUST be a known safe tool like grep or sort
      const safePipes = ['| grep', '| sort', '| head', '| tail', '| uniq', '| awk'];
      const hasPipe = command.includes('|');
      
      if (hasPipe) {
        const isSafePipe = safePipes.some(p => command.includes(p));
        if (!isSafePipe) {
          throw new Error(`Potentially dangerous shell operator detected in: "${command}"`);
        }
      } else {
        // Block other operators entirely for now
        throw new Error(`Forbidden shell operator detected in: "${command}"`);
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
