'use strict';
/* Phase 41 — the exercise database.

   No browser: this is a data + engine suite, and it runs against the SHIPPED
   index.html so the records checked are the records that would ship.

   Its one design rule: every section reports how many things it actually
   inspected, and a section that inspected fewer than its floor FAILS. This
   project has already shipped a sweep whose regex matched nothing and printed a
   clean verdict; a check that asserts over an empty set is not a passing check.

   The strongest section is [17]: every reference solution is compiled and run
   by the real engine against that exercise's own declared cases. If a stated
   expected output is wrong, or a solution stops working because the engine
   changed, this fails — the data cannot drift away from what actually runs. */
const fs = require('fs');
const path = require('path');
const HTML = path.resolve(__dirname, '..', 'index.html');
const vm = require('vm');
const { load } = require('./load-engine.js');

let pass = 0, fail = 0, inspected = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}
/* A section that inspected too little is a failure, not a pass. */
function counted(name, n, floor, detail) {
  inspected += n;
  check(name + ' (' + n + ' inspected)', n >= floor,
        detail || (n < floor ? 'VACUOUS: expected at least ' + floor : ''));
  return n >= floor;
}

const html = fs.readFileSync(HTML, 'utf8');
function section(name) {
  const a = html.indexOf('==== ' + name + ' START ====');
  const b = html.indexOf('==== ' + name + ' END ====');
  if (a < 0 || b < 0) throw new Error('missing marker ' + name);
  return html.slice(html.indexOf('*/', a) + 2, html.lastIndexOf('/*', b)) + '\n';
}
const box = { module: { exports: {} }, console, window: undefined };
vm.createContext(box);
vm.runInContext(section('EXAMDATA') + section('EXAMEX') + section('EXLIST') +
  '\n;module.exports={EXAM_SUBJECTS,EXAM_SKILLS,EXAM_PATTERNS,EXAM_CORPUS,EXAM_EXERCISES,' +
  'examGate,examBand};', box, { filename: 'examdata' });
const D = box.module.exports;
const E = load();

const AXES = ['concept', 'algorithm', 'implementation', 'edges', 'combination'];
const REQUIRED = ['id','title','brief','track','source','source_type','required_subjects',
  'studied_status','skills','algorithm_patterns','allowed_functions','forbidden_functions',
  'difficulty','io','engine_support','band'];

console.log('\n=== PHASE 41: the exercise database ===\n');

/* -------------------------------------------------------------- presence */
counted('[1] the historical corpus is analysed', D.EXAM_CORPUS.length, 70,
  'DKMR/42exams, six levels');
counted('[2] patterns extracted from it', D.EXAM_PATTERNS.length, 15);
counted('[3] generated practice exists', D.EXAM_EXERCISES.length, 60);

/* --------------------------------------------------- required metadata */
let missing = 0, fieldChecks = 0;
for (const x of D.EXAM_EXERCISES) {
  for (const f of REQUIRED) { fieldChecks++; if (x[f] === undefined || x[f] === null) missing++; }
  for (const a of AXES) {
    fieldChecks++;
    const v = x.difficulty[a];
    if (typeof v !== 'number' || v < 1 || v > 5) missing++;
  }
}
counted('[4] every required field present on every exercise', fieldChecks, 1200);
check('[5] no field is missing or out of range', missing === 0, missing + ' problems');

/* ------------------------------------------------- references resolve */
const subjIds = new Set(D.EXAM_SUBJECTS.map(s => s.id));
const skillIds = new Set(D.EXAM_SKILLS.map(s => s.id));
const patIds = new Set(D.EXAM_PATTERNS.map(p => p.id));
let refs = 0, badRefs = [];
for (const x of D.EXAM_EXERCISES) {
  for (const s of x.required_subjects) { refs++; if (!subjIds.has(s)) badRefs.push(x.id + '->' + s); }
  for (const k of x.skills) { refs++; if (!skillIds.has(k)) badRefs.push(x.id + '->' + k); }
  for (const p of x.algorithm_patterns) { refs++; if (!patIds.has(p)) badRefs.push(x.id + '->' + p); }
}
for (const c of D.EXAM_CORPUS) {
  refs++; if (!patIds.has(c.pattern)) badRefs.push(c.id + '->' + c.pattern);
  for (const s of c.required_subjects) { refs++; if (!subjIds.has(s)) badRefs.push(c.id + '->' + s); }
}
counted('[6] cross-references between the four tables', refs, 400);
check('[7] every reference resolves', badRefs.length === 0, badRefs.slice(0, 4).join(', '));

/* ------------------------------------------------------- the derivation */
let derivChecks = 0, derivBad = 0;
for (const x of D.EXAM_EXERCISES.concat(D.EXAM_CORPUS)) {
  const g = D.examGate(x.required_subjects);
  derivChecks += 2;
  if (x.track !== g.track) derivBad++;
  if (x.studied_status !== g.status) derivBad++;
}
counted('[8] track and status re-derived and compared', derivChecks, 250);
check('[9] every one matches the derivation', derivBad === 0, derivBad + ' mismatches');
const exlist = section('EXLIST');
check('[10] no record literal assigns track / studied_status / band',
  exlist.indexOf('track:') < 0 && exlist.indexOf('studied_status:') < 0 && exlist.indexOf('band:') < 0);
let bandBad = 0;
for (const x of D.EXAM_EXERCISES) if (x.band !== D.examBand(x.difficulty).id) bandBad++;
check('[11] the band follows the combination axis', bandBad === 0, bandBad + ' disagree');

/* -------------------------------------- generated is not the historical */
const corpusNames = new Set(D.EXAM_CORPUS.map(c => c.name));
let dupes = [];
for (const x of D.EXAM_EXERCISES) {
  const tail = x.id.split('.').pop();
  if (corpusNames.has(tail)) dupes.push(x.id);
  const t = x.title.toLowerCase().replace(/[^a-z]/g, '');
  for (const n of corpusNames) if (n.replace(/_/g, '') === t) dupes.push(x.id);
}
counted('[12] generated ids and titles checked against the corpus',
  D.EXAM_EXERCISES.length * (corpusNames.size + 1), 4000);
check('[13] no generated exercise reproduces a corpus exercise', dupes.length === 0, dupes.join(', '));
let corpusLeak = 0;
for (const c of D.EXAM_CORPUS) if (c.brief || c.reference_solution || c.io) corpusLeak++;
check('[14] the corpus carries analysis only, no tasks and no solutions', corpusLeak === 0);

/* ------------------------------------------------------------- variety */
const uniq = a => new Set(a).size;
const briefs = D.EXAM_EXERCISES.map(x => x.brief);
const skillSets = D.EXAM_EXERCISES.map(x => x.skills.slice().sort().join('|'));
const profiles = D.EXAM_EXERCISES.map(x => AXES.map(a => x.difficulty[a]).join(''));
check('[15] every brief is distinct', uniq(briefs) === briefs.length,
  uniq(briefs) + '/' + briefs.length);
check('[16] skill combinations vary', uniq(skillSets) >= skillSets.length * 0.55,
  uniq(skillSets) + ' distinct of ' + skillSets.length);
check('[17] difficulty profiles vary', uniq(profiles) >= 20, uniq(profiles) + ' distinct profiles');
const bandsSeen = new Set(D.EXAM_EXERCISES.map(x => x.band));
check('[18] all five bands A..E are populated', ['A','B','C','D','E'].every(b => bandsSeen.has(b)),
  [...bandsSeen].sort().join(''));
const patUse = new Set();
for (const x of D.EXAM_EXERCISES) for (const p of x.algorithm_patterns) patUse.add(p);
check('[19] every extracted pattern has practice',
  patUse.size === D.EXAM_PATTERNS.length,
  patUse.size + ' of ' + D.EXAM_PATTERNS.length);

/* ------------------------------------------------------ track separation */
const A = D.EXAM_EXERCISES.filter(x => x.track === 'C00-C08');
const B = D.EXAM_EXERCISES.filter(x => x.track === 'C09-C13');
let leak = 0;
for (const x of A) for (const s of x.required_subjects) if (parseInt(s.slice(1), 10) > 8) leak++;
for (const x of B) for (const s of x.required_subjects) if (parseInt(s.slice(1), 10) <= 8) leak++;
counted('[20] track membership checked per required subject',
  A.concat(B).reduce((n, x) => n + x.required_subjects.length, 0), 150);
check('[21] Track A and Track B do not leak into each other', leak === 0,
  'A=' + A.length + ' B=' + B.length);
check('[22] no Track A exercise is marked ADVANCED',
  A.every(x => x.studied_status !== 'ADVANCED'));
check('[23] a NOT_STUDIED exercise always names the subject it needs',
  D.EXAM_EXERCISES.every(x => x.studied_status !== 'NOT_STUDIED' || x.missing_subjects.length > 0));

/* ------------------------------------------------------ band E stays dark */
const bandE = D.EXAM_EXERCISES.filter(x => x.band === 'E');
counted('[24] band E records', bandE.length, 5);
check('[25] every band E record hides its inspiration',
  bandE.every(x => x.hideInspiration === true));
check('[26] no band E brief hints at an ancestor',
  bandE.every(x => !/inspired|based on|similar to|like the/i.test(x.brief)));

/* ============ [27] THE ONE THAT CANNOT PASS VACUOUSLY ==================== */
let withSol = 0, casesRun = 0, solFail = [];
for (const x of D.EXAM_EXERCISES) {
  if (!x.reference_solution) continue;
  withSol++;
  for (const [args, expect] of ((x.io && x.io.cases) || [])) {
    casesRun++;
    let r;
    try { r = E.runToCompletion(x.reference_solution, { args, argv0: './a.out' }); }
    catch (e) { solFail.push(x.id + ' threw: ' + e.message); continue; }
    if (!r.ok) { solFail.push(x.id + ' ' + r.phase + ': ' + r.message); continue; }
    /* r.output merges stdout and stderr. Assert nothing reached stderr so that
       comparing it to the expected stdout is sound rather than lucky. */
    if (r.history.steps.some(s => s.detail && s.detail.stream === 'stderr'))
      { solFail.push(x.id + ' wrote to stderr'); continue; }
    if (r.output !== expect)
      solFail.push(x.id + ' ' + JSON.stringify(args) + ' gave ' + JSON.stringify(r.output) +
                   ' want ' + JSON.stringify(expect));
  }
}
counted('[27] reference solutions EXECUTED by the engine against their own cases',
  casesRun, 60, withSol + ' solutions');
check('[28] every executed case produced exactly the declared output',
  solFail.length === 0, solFail.slice(0, 3).join(' | '));
check('[29] enough exercises carry a verified solution to matter', withSol >= 20, withSol + ' solutions');
check('[30] cases_verified is never claimed without a solution',
  D.EXAM_EXERCISES.every(x => !x.cases_verified || !!x.reference_solution));

/* ------------------------------------------------- provenance discipline */
const SRC_TYPES = new Set(['official', 'historical', 'pattern', 'generated']);
check('[31] every exercise declares a known source type',
  D.EXAM_EXERCISES.every(x => SRC_TYPES.has(x.source_type)));
check('[32] the corpus is attributed to the repository it came from',
  D.EXAM_CORPUS.every(c => c.source.repository === 'DKMR/42exams' && !!c.source.url));
check('[33] the corpus states it is not a current exam specification',
  D.EXAM_CORPUS.every(c => /not a specification of any current exam/i.test(c.source.note)));

console.log('\n' + '-'.repeat(64));
console.log('TOTAL ITEMS INSPECTED: ' + inspected);
console.log('PHASE 41  pass ' + pass + '  fail ' + fail);
process.exit(fail ? 1 : 0);
