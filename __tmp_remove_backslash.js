const fs = require('fs');
const path = 'embyClient.js';
let data = fs.readFileSync(path, 'utf8');
data = data.replace(/\\/g, ''); // remove double backslashes
data = data.replace(/\\/g, ''); // redundant but keep
fs.writeFileSync(path, data, 'utf8');
