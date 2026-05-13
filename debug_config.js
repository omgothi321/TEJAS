const fs = require('fs');
const path = require('path');
const tejasDir = path.join(process.cwd(), '.tejas');
const confFile = path.join(tejasDir, 'config.json');
console.log('Looking for config at:', confFile);
console.log('Exists:', fs.existsSync(confFile));
if (fs.existsSync(confFile)) {
  console.log('Content:', fs.readFileSync(confFile, 'utf8'));
}
