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
  ['Phase 10 UX + Error Lab',  'phase11.test.js'],
  ['Phase 11 header/editor/2.5D','phase12.test.js'],
  ['Phase 12b memory architecture','phase13.test.js'],
  ['Phase 12c pointers/objects','phase14.test.js'],
  ['Phase 12d value/representation lab','phase15.test.js'],
  ['Phase 12e types/limits/overflow','phase16.test.js'],
  ['Bugfix nav + table alignment','phase17.test.js'],
  ['Phase 7 functions/libraries/syscalls','phase18.test.js'],
  ['Phase 7.5 C03 string functions','phase19.test.js'],
  ['Phase 8 simulated terminal','phase20.test.js'],
  ['Phase 9 types/representation','phase21.test.js'],
  ['Phase 10 pointers/dereferencing','phase22.test.js'],
  ['Phase 11 argc/argv','phase23.test.js'],
  ['Phase 12 function reproduction','phase24.test.js'],
  ['Home / dashboard','phase25.test.js'],
  ['Home cleanup + branding','phase26.test.js'],
  ['C 04 module','phase27.test.js'],
  ['C 04 deepened lessons','phase28.test.js'],
  ['C 05 module','phase29.test.js'],
  ['Stepper scroll stability','phase30.test.js'],
  ['C 05 audit fixes','phase31.test.js'],
  ['Memory module','phase32.test.js'],
  ['C 06 module','phase33.test.js'],
  ['Memory deep dive','phase34.test.js'],
  ['Terminal execution bridge','phase35.test.js'],
  ['P41 exercise database',   'phase36.test.js'],
  ['P42 practice view',       'phase37.test.js'],
  ['P43 modes + code editor', 'phase38.test.js'],
  ['P44 ExamShell Training',  'phase39.test.js'],
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
