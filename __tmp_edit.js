const fs = require('fs');
const path = 'embyClient.js';
const contents = fs.readFileSync(path, 'utf8');
const lines = contents.split(/\r?\n/);
const result = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('${view.Id}::favorites')) {
    i += 3; // skip type, name, closing lines
    continue;
  }
  result.push(line);
}
fs.writeFileSync(path, result.join('\n'), 'utf8');
