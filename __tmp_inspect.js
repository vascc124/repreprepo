const fs = require('fs');
const data = fs.readFileSync('embyClient.js', 'utf8');
const idx = data.indexOf('return { libraryId, mode };');
console.log('idx', idx);
const snippet = data.slice(idx, idx + 40);
console.log('snippet', JSON.stringify(snippet));
console.log('codes', Array.from(snippet).map(ch => ch.charCodeAt(0)));
