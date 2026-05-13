const fs = require('fs');
const path = require('path');

function getKeys() {
  const keysPath = '/home/kali/.tejas/keys.env';
  if (!fs.existsSync(keysPath)) {
    console.log('No keys.env found');
    return;
  }
  const content = fs.readFileSync(keysPath, 'utf8');
  const lines = content.split('\n');
  const keys = {};
  lines.forEach(line => {
    const parts = line.trim().split(' ');
    if (parts.length >= 2) {
      keys[parts[0]] = parts[1];
    }
  });
  console.log('Loaded keys:', keys);
}

getKeys();
