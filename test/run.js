'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
for (const f of ['engine.test.js', 'server.test.js']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
