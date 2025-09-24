const fs = require('fs');
const path = 'embyClient.js';
let data = fs.readFileSync(path, 'utf8');
const regex = /\s*definitions\.push\(\{\s*[\r\n]+\s*libraryId: `\$\{view\.Id\}::favorites`,[\r\n]+\s*type,[\r\n]+\s*name: `\$\{baseName\} \(Favorites\)`[\r\n]+\s*\}\);[\r\n]*/;
if (!regex.test(data)) {
  console.warn('favorites block not found');
} else {
  data = data.replace(regex, '\n');
  fs.writeFileSync(path, data, 'utf8');
}
