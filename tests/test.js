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

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`${chalk.green('✓')} ${name}`);
      passed++;
    } catch (err) {
      console.log(`${chalk.red('✗')} ${name}`);
      console.error(chalk.red(`  Error: ${err.message}`));
      failed++;
    }
  };

  // --- Sanitizer Tests ---

  await test('Sanitizer: allow safe commands', () => {
    const cmd = 'ls -la';
    if (Sanitizer.sanitizeShell(cmd) !== cmd) throw new Error('Failed to allow safe command');
  });

  await test('Sanitizer: allow safe pipes (grep)', () => {
    const cmd = 'ls | grep tests';
    if (Sanitizer.sanitizeShell(cmd) !== cmd) throw new Error('Failed to allow safe pipe');
  });

  await test('Sanitizer: block dangerous chaining (&&)', () => {
    try {
      Sanitizer.sanitizeShell('ls && rm -rf /');
      throw new Error('Should have blocked &&');
    } catch (e) {
      if (!e.message.includes('Forbidden shell operator')) throw e;
    }
  });

  await test('Sanitizer: block dangerous pipes (xargs rm)', () => {
    try {
      Sanitizer.sanitizeShell('ls | xargs rm');
      throw new Error('Should have blocked xargs rm');
    } catch (e) {
      if (!e.message.includes('Potentially dangerous shell operator')) throw e;
    }
  });

  await test('Sanitizer: allow math expansions $(( ))', () => {
    const cmd = 'echo $((1+1))';
    if (Sanitizer.sanitizeShell(cmd) !== cmd) throw new Error('Failed to allow math expansion');
  });

  await test('Sanitizer: block command substitution $( )', () => {
    try {
      Sanitizer.sanitizeShell('echo $(whoami)');
      throw new Error('Should have blocked $( )');
    } catch (e) {
      if (!e.message.includes('Forbidden shell operator')) throw e;
    }
  });

  // --- Path Traversal Tests ---

  await test('Path Sanitizer: allow safe paths', () => {
    const safePath = 'src/index.js';
    const root = process.cwd();
    const result = Sanitizer.sanitizePath(safePath, root);
    if (!result.includes(safePath)) throw new Error('Failed to allow safe path');
  });

  await test('Path Sanitizer: block traversal (../)', () => {
    try {
      Sanitizer.sanitizePath('../../../etc/passwd', process.cwd());
      throw new Error('Should have blocked traversal');
    } catch (e) {
      if (!e.message.includes('Path traversal attempt blocked')) throw e;
    }
  });

  // --- Phase 1 Foundation Tests ---

  await test('Database: initializes with WAL mode', async () => {
    const TejasDatabase = require('../src/core/database');
    const os = require('os'), path = require('path'), fs = require('fs-extra');
    const tmpDir = path.join(os.tmpdir(), 'tejas_test_' + Date.now());
    await fs.ensureDir(tmpDir);
    const db = new TejasDatabase(tmpDir);
    await db.initialize();
    const row = db.db.prepare("PRAGMA journal_mode").get();
    if (row.journal_mode !== 'wal') throw new Error('WAL mode not set');
    await fs.remove(tmpDir);
  });

  await test('Embeddings: cosine similarity correct', () => {
    const EmbeddingService = require('../src/core/embeddings');
    const v1 = new Float32Array([1, 0, 0]);
    const v2 = new Float32Array([1, 0, 0]);
    const v3 = new Float32Array([0, 1, 0]);
    const same = EmbeddingService.cosineSimilarity(v1, v2);
    const ortho = EmbeddingService.cosineSimilarity(v1, v3);
    if (Math.abs(same - 1.0) > 0.0001) throw new Error(`Expected 1.0, got ${same}`);
    if (Math.abs(ortho - 0.0) > 0.0001) throw new Error(`Expected 0.0, got ${ortho}`);
  });

  await test('Memory: migration logic', async () => {
    const MemoryManager = require('../src/core/memory');
    const os = require('os'), path = require('path'), fs = require('fs-extra');
    const tmpDir = path.join(os.tmpdir(), 'tejas_mig_' + Date.now());
    const tejasDir = path.join(tmpDir, '.tejas');
    await fs.ensureDir(tejasDir);

    // 1. Create legacy JSON
    await fs.writeJson(path.join(tejasDir, 'memory.json'), { version: '0.1.0', stats: { tasks_run: 42 } });
    
    // 2. Initialize MemoryManager
    const mem = new MemoryManager(tmpDir);
    await mem.initialize();

    // 3. Verify data in SQL
    const data = await mem.read();
    if (data.stats.tasks_run !== 42) throw new Error('Migration failed to preserve stats');
    
    // 4. Verify backup exists
    if (!await fs.pathExists(path.join(tejasDir, 'memory.json.bak'))) throw new Error('Backup not created');
    
    await fs.remove(tmpDir);
  });

  await test('FTS5: search returns results', async () => {
    const MemoryManager = require('../src/core/memory');
    const os = require('os'), path = require('path'), fs = require('fs-extra');
    const tmpDir = path.join(os.tmpdir(), 'tejas_fts_' + Date.now());
    const mem = new MemoryManager(tmpDir);
    await mem.initialize();

    // 1. Log a task
    await mem.logTask({ task: 'deploy production server', agent: 'web', success: true });
    
    // 2. Search for it
    const results = await mem.search('production');
    if (results.length === 0) throw new Error('FTS5 search failed to find task');
    if (!results.some(r => r.task === 'deploy production server')) throw new Error('Task not found in results');

    await fs.remove(tmpDir);
  });

  await test('Memory: clear() resets SQLite', async () => {
    const MemoryManager = require('../src/core/memory');
    const os = require('os'), path = require('path'), fs = require('fs-extra');
    const tmpDir = path.join(os.tmpdir(), 'tejas_clear_' + Date.now());
    const mem = new MemoryManager(tmpDir);
    await mem.initialize();

    await mem.logTask({ task: 'test clear', agent: 'test', success: true });
    await mem.clear();

    const data = await mem.read();
    if (data.stats.tasks_run !== 0) throw new Error('Stats not reset after clear');
    
    const tasks = mem.db.db.prepare('SELECT count(*) as count FROM tasks').get();
    if (tasks.count !== 0) throw new Error('Tasks table not cleared');

    await fs.remove(tmpDir);
  });

  await test('Graph: stats and patterns', async () => {
    const MemoryManager = require('../src/core/memory');
    const os = require('os'), path = require('path'), fs = require('fs-extra');
    const tmpDir = path.join(os.tmpdir(), 'tejas_graph_' + Date.now());
    const mem = new MemoryManager(tmpDir);
    await mem.initialize();

    await mem.logTask({ task: 'git commit', agent: 'code', success: true, duration_ms: 100 });
    
    const stats = await mem.getGraphStats();
    if (stats.nodes === 0) throw new Error('Graph nodes not created');
    
    const patterns = await mem.findPatterns();
    if (patterns.length === 0) throw new Error('Patterns not detected');
    if (patterns[0].label !== 'code') throw new Error('Incorrect pattern detection');

    await fs.remove(tmpDir);
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
