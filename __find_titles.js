const fs = require('fs');
const data = fs.readFileSync('embyClient.js', 'utf8');
const regex = /title: child\.Name \|\|[^\r\n]*/g;
const matches = data.match(regex) || [];
matches.forEach(line => console.log(line));
