const fs = require('node:fs'),
  path = require('node:path');
module.exports = import(
  (JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
    .suite === 'interaction'
    ? './comparison-probe.mjs'
    : './probe.mjs') +
    '?run=' +
    Date.now()
);
