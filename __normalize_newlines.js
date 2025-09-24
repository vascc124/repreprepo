const fs = require('fs');
const path = 'embyClient.js';
let data = fs.readFileSync(path, 'utf8');
data = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
fs.writeFileSync(path, data.replace(/\n/g, '\r\n'), 'utf8');
