const fs = require('fs');
const path = 'embyClient.js';
let data = fs.readFileSync(path, 'utf8');
const snippet = "    if (mode === 'favorites') {\r\n        params.Filters = params.Filters ? ${params.Filters},IsFavorite : 'IsFavorite';\r\n    }\r\n";
if (!data.includes(snippet)) {
  console.warn('favorites snippet not found');
} else {
  data = data.replace(snippet, '\r\n');
  fs.writeFileSync(path, data, 'utf8');
}
