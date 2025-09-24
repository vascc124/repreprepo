const fs = require('fs');
const path = 'embyClient.js';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
const result = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const next = lines[i + 1] || '';
  if (line.trim() === 'definitions.push({' && next.trim() === '}') {
    i += 0; // skip this line only, let loop continue to add next closing line normally (so not appended)
    continue;
  }
  result.push(line);
}
fs.writeFileSync(path, result.join('\n'), 'utf8');
