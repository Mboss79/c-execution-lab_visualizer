'use strict';
// Runs every suite in order and reports one verdict.
// Engine suite is fast and has no browser dependency; UI and QA drive real Chrome.
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['Engine + Foundation Gate', 'regression.test.js'],
  ['UI (real browser)',        'ui.test.js'],
  ['QA (shipped file)',        'qa.test.js'],
  ['Phase 3 exit gate',        'phase3.test.js'],
  ['Phase 4 Norminette Lab',   'phase4.test.js'],
  ['Phase 5 Compiler Lab',     'phase5.test.js'],
  ['Phase 6 Test Lab',         'phase6.test.js'],
  ['Phase 7 Trace Analyzer',   'phase7.test.js'],
  ['Phase 8 3D Visualization', 'phase8.test.js'],
  ['Final UX + emphasis',      'phase9.test.js'],
  ['Phase 9 flow/errors/scale','phase10.test.js'],
];

let failed = 0;
const summary = [];

for (const [name, file] of SUITES) {
  console.log('\n' + '#'.repeat(70));
  console.log('# ' + name + '  (' + file + ')');
  console.log('#'.repeat(70));
  const r = spawnSync(process.execPath, [path.join(__dirname, file)],
    { stdio: 'inherit', cwd: __dirname });
  const code = r.status === null ? 1 : r.status;
  if (code !== 0) failed++;
  summary.push([name, code === 0 ? 'PASS' : 'FAIL']);
}

console.log('\n' + '='.repeat(70));
for (const [name, verdict] of summary) console.log('  ' + verdict.padEnd(6) + name);
console.log('='.repeat(70));
console.log(failed ? failed + ' suite(s) FAILED' : 'ALL SUITES PASSED');
process.exit(failed ? 1 : 0);
