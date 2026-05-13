const MemoryManager = require('./src/core/memory');
const mm = new MemoryManager(process.cwd());
console.log('Root:', mm.rootDir);
console.log('TejasDir:', mm.tejasDir);
console.log('Config Path:', mm.confFile);
