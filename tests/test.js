'use strict';

const Sanitizer = require('../src/utils/sanitizer');
const path = require('path');
const chalk = require('chalk');

/**
 * Simple Test Runner for Tejas
 */
async function runTests() {
  console.log(chalk.blue.bold('\n🚀 Running Tejas Security & Utility Tests...\n'));
  
  let passed = 0;
  let failed = 0;

  const test = (name, fn) => {
    try {
      fn();
      console.log(`${chalk.green('✓')} ${name}`);
      passed++;
    } catch (err) {
      console.log(`${chalk.red('✗')} ${name}`);
      console.error(chalk.red(`  Error: ${err.message}`));
      failed++;
    }
  };

  // --- Sanitizer Tests ---

  test('Sanitizer: allow safe commands', () => {
    const cmd = 'ls -la';
    if (Sanitizer.sanitizeShell(cmd) !== cmd) throw new Error('Failed to allow safe command');
  });

  test('Sanitizer: allow safe pipes (grep)', () => {
    const cmd = 'ls | grep tests';
    if (Sanitizer.sanitizeShell(cmd) !== cmd) throw new Error('Failed to allow safe pipe');
  });

  test('Sanitizer: block dangerous chaining (&&)', () => {
    try {
      Sanitizer.sanitizeShell('ls && rm -rf /');
      throw new Error('Should have blocked &&');
    } catch (e) {
      if (!e.message.includes('Forbidden shell operator')) throw e;
    }
  });

  test('Sanitizer: block dangerous pipes (xargs rm)', () => {
    try {
      Sanitizer.sanitizeShell('ls | xargs rm');
      throw new Error('Should have blocked xargs rm');
    } catch (e) {
      if (!e.message.includes('Potentially dangerous shell operator')) throw e;
    }
  });

  test('Sanitizer: allow math expansions $(( ))', () => {
    const cmd = 'echo $((1+1))';
    if (Sanitizer.sanitizeShell(cmd) !== cmd) throw new Error('Failed to allow math expansion');
  });

  test('Sanitizer: block command substitution $( )', () => {
    try {
      Sanitizer.sanitizeShell('echo $(whoami)');
      throw new Error('Should have blocked $( )');
    } catch (e) {
      if (!e.message.includes('Forbidden shell operator')) throw e;
    }
  });

  // --- Path Traversal Tests ---

  test('Path Sanitizer: allow safe paths', () => {
    const safePath = 'src/index.js';
    const root = process.cwd();
    const result = Sanitizer.sanitizePath(safePath, root);
    if (!result.includes(safePath)) throw new Error('Failed to allow safe path');
  });

  test('Path Sanitizer: block traversal (../)', () => {
    try {
      Sanitizer.sanitizePath('../../../etc/passwd', process.cwd());
      throw new Error('Should have blocked traversal');
    } catch (e) {
      if (!e.message.includes('Path traversal attempt blocked')) throw e;
    }
  });

  // --- Summary ---
  
  console.log(chalk.blue('\n-------------------------------------------'));
  console.log(`Tests Complete: ${chalk.green(passed + ' passed')}, ${chalk.red(failed + ' failed')}`);
  console.log(chalk.blue('-------------------------------------------\n'));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite failed to run:', err);
  process.exit(1);
});
