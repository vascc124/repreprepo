const fs = require('fs');
const path = 'embyClient.js';
let data = fs.readFileSync(path, 'utf8');

function replaceFunction(source, signature, replacement) {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`Signature not found: ${signature}`);
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) throw new Error(`Opening brace not found for ${signature}`);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Closing brace not found for ${signature}`);
  return source.slice(0, start) + replacement + source.slice(end + 1);
}

const parseReplacement = `function parseLibraryCatalogId(rawId) {\n    if (!rawId || typeof rawId !== 'string') {\n        return { libraryId: rawId, mode: 'all' };\n    }\n    const [libraryId, modeToken] = rawId.split('::');\n    const mode = modeToken === 'favorites' ? 'all' : (modeToken || 'all');\n    return { libraryId, mode };\n}\n\n`;

data = replaceFunction(data, 'function parseLibraryCatalogId', parseReplacement);

data = data.replace(/}\\n/g, '}\n');
fs.writeFileSync(path, data, 'utf8');
