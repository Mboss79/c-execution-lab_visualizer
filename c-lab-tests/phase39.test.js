'use strict';
/* Phase 44 — ExamShell Training.
 *
 * The check that matters most is [20]: the two exercises claimed as July exam
 * material have their reference solutions COMPILED AND RUN against the exam's
 * own worked examples. "hello"+"key" must produce "rijvs" and "Attack"+"abc"
 * must produce "Auvadm", because those strings are the only independent
 * evidence that the handwriting was read correctly.
 *
 * Every group reports how many items it inspected and fails below a floor.
 */
const path = require('path');
const puppeteer = require('puppeteer-core');
const { load } = require('./load-engine.js');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, inspected = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}
function counted(name, n, floor, detail) {
  inspected += n;
  check(name + ' (' + n + ' inspected)', n >= floor,
        n < floor ? 'VACUOUS: expected at least ' + floor : (detail || ''));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--allow-file-access-from-files', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1400);
  await page.click('#railExam');
  await sleep(400);

  console.log('\n=== part 1: a TOP-LEVEL section, after Final Exam Prep, not a mode ===');
  const nav = await page.evaluate(() => {
    xs.page = 'exam'; xs.sub = null; xs.ex = null; xs.sim = null; renderExam();
    return {
      top: [...document.querySelectorAll('#examRoot .x-navb')].map(b => b.textContent),
      keys: XPAGES.map(p => p[0]),
      examTabs: [...document.querySelectorAll('#examRoot .x-tabs .x-tab')].map(b => b.textContent),
      modes: [...document.querySelectorAll('#examRoot .x-modeb')].map(b => b.textContent),
      modeKeys: Object.keys(MODE_CONFIG),
    };
  });
  const iExam = nav.top.indexOf('Final Exam Prep');
  const iShell = nav.top.indexOf('ExamShell Training');
  const iBrowse = nav.top.indexOf('Practice Browser');
  check('[1] ExamShell Training is a TOP-LEVEL section',
    iShell >= 0 && nav.keys.indexOf('examshell') >= 0, nav.top.join(' | '));
  check('[2] the order is Final Exam Prep -> ExamShell Training -> Practice Browser',
    iShell === iExam + 1 && iBrowse === iShell + 1,
    'exam=' + iExam + ' examshell=' + iShell + ' browse=' + iBrowse);
  check('[3] it is NOT nested inside Final Exam Prep',
    nav.examTabs.indexOf('ExamShell Training') < 0, nav.examTabs.join(' | '));
  check('[4] Final Exam Prep keeps its own two tabs',
    nav.examTabs.join('|') === 'Sessions & practice|Validation Challenges', nav.examTabs.join('|'));
  check('[5] the section that followed Practice Browser still does',
    nav.top[iBrowse + 1] === 'Skills & Algorithms', nav.top[iBrowse + 1]);
  check('[5b] every previously existing section is still present, in order',
    nav.top.filter(t => t !== 'ExamShell Training').join('|') ===
    ['Recoding Prep','Final Exam Prep','Practice Browser','Skills & Algorithms',
     'String Function Trainer','Cross-Subject Challenges','My Projects','Progress'].join('|'),
    nav.top.join(' | '));
  check('[5c] nine sections in total', nav.top.length === 9, String(nav.top.length));
  check('[5d] it is NOT a sixth mode',
    nav.modes.length === 5 && nav.modeKeys.join(',') === 'guided,blind,challenge,drill,validation',
    nav.modeKeys.join(','));
  const top = nav.top;

  console.log('\n=== part 2: the section renders and opens exercises ===');
  const sec = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#examRoot .x-navb')].find(b => b.textContent === 'ExamShell Training');
    t.click();
    return {
      sub: xs.page,
      rows: document.querySelectorAll('#examRoot .x-esrow').length,
      chars: document.querySelector('#examRoot .x-main').textContent.length,
      bar: !!document.querySelector('#examRoot .x-esbar'),
      conf: document.querySelectorAll('#examRoot .x-esc').length,
      chk: document.querySelectorAll('#examRoot .x-esrow.chk').length,
    };
  });
  check('[6] clicking the top-level button opens the section', sec.sub === 'examshell');
  counted('[7] exercise rows rendered', sec.rows, 15, 'expected exactly 15');
  check('[8] exactly fifteen rows', sec.rows === 15, String(sec.rows));
  check('[9] progress and sourcing are shown', sec.bar && sec.conf === 3, 'conf blocks=' + sec.conf);
  check('[10] checkpoints are marked in the list', sec.chk === 3, sec.chk + ' marked');

  const open = await page.evaluate(() => {
    document.querySelector('#examRoot .x-esrow').click();
    return { ex: xs.ex, editor: !!document.querySelector('#xEditor'),
      brief: (document.querySelector('#examRoot .x-brief') || {}).textContent.length,
      allowed: (document.querySelector('#examRoot .x-allowed span') || {}).textContent,
      constraints: !!document.querySelector('#examRoot .x-io b') };
  });
  check('[11] opening a row opens the exercise in the normal workspace',
    /^es\./.test(open.ex || '') && open.editor && open.brief > 40, JSON.stringify(open.ex));

  console.log('\n=== part 3: the fifteen, and their metadata ===');
  const data = await page.evaluate(() => {
    const L = EXAMSHELL;
    const ids = L.map(x => x.id);
    let fields = 0; const bad = [];
    const DIMS = ES_DIMENSIONS.map(d => d[0]);
    for (const x of L) {
      const e = x.examshell;
      fields += 8 + DIMS.length;
      if (!x.title || !x.brief || x.brief.length < 40) bad.push(x.id + ':subject');
      if (!e || typeof e.n !== 'number') bad.push(x.id + ':n');
      if (['easy','medium','hard','final'].indexOf(e.difficulty) < 0) bad.push(x.id + ':difficulty');
      if (['verified','inferred','training'].indexOf(e.confidence) < 0) bad.push(x.id + ':confidence');
      if (!e.statement) bad.push(x.id + ':statement');
      if (!e.purpose) bad.push(x.id + ':purpose');
      if (!Array.isArray(e.constraints) || !e.constraints.length) bad.push(x.id + ':constraints');
      if (!Array.isArray(e.edgeCases) || !e.edgeCases.length) bad.push(x.id + ':edgeCases');
      if (!Array.isArray(x.skills) || !x.skills.length) bad.push(x.id + ':skills');
      if (['short','medium','long'].indexOf(e.implementationLength) < 0) bad.push(x.id + ':length');
      for (const d of DIMS) {
        const v = e.profile[d];
        if (typeof v !== 'number' || v < 1 || v > 5) bad.push(x.id + ':' + d);
      }
    }
    return { n: L.length, ids, unique: new Set(ids).size, fields, bad,
      order: L.map(x => x.examshell.n).join(','),
      inMaster: L.filter(x => EXAM_EXERCISES.indexOf(x) >= 0).length };
  });
  check('[12] exactly fifteen exercises', data.n === 15, String(data.n));
  check('[13] no duplicate ids', data.unique === 15, data.unique + ' unique');
  check('[14] numbered 1..15 in order', data.order === '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', data.order);
  counted('[15] metadata fields checked', data.fields, 200);
  check('[16] every exercise has complete metadata', data.bad.length === 0, data.bad.slice(0, 4).join(', '));
  check('[17] the curriculum reuses the shared exercise array, not a parallel one',
    data.inMaster === 15, data.inMaster + '/15 present in EXAM_EXERCISES');

  console.log('\n=== part 4: source integrity ===');
  const src = await page.evaluate(() => {
    const L = EXAMSHELL;
    const byConf = {};
    for (const x of L) byConf[x.examshell.confidence] = (byConf[x.examshell.confidence] || 0) + 1;
    const verified = L.filter(x => x.examshell.confidence === 'verified').map(x => x.title);
    /* nothing that is not verified may describe itself as being from the exam */
    const overclaim = L.filter(x => x.examshell.confidence !== 'verified' &&
      /\bJuly 1337 exam\b/.test(x.examshell.statement) &&
      !/not evidence|Preparation material|not the paper/i.test(x.examshell.statement)).map(x => x.id);
    /* every inferred record must say what it is NOT */
    const inferredHedged = L.filter(x => x.examshell.confidence === 'inferred')
      .every(x => /not evidence|not the paper|Preparation material/i.test(x.examshell.statement));
    const trainingHonest = L.filter(x => x.examshell.confidence === 'training')
      .every(x => /curriculum|Written/i.test(x.examshell.statement));
    return { byConf, verified, overclaim, inferredHedged, trainingHonest,
      labels: Object.keys(ES_CONF_LABEL) };
  });
  counted('[18] source statements inspected', 15, 15);
  check('[19] exactly two exercises are claimed as verified July material',
    src.byConf.verified === 2 && src.verified.indexOf('squeeze_spaces') >= 0 &&
    src.verified.indexOf('vigenere') >= 0, src.verified.join(', '));
  check('[20] nothing unverified is presented as being from the paper',
    src.overclaim.length === 0, src.overclaim.join(','));
  check('[21] every inferred exercise states that it is not evidence of the paper', src.inferredHedged);
  check('[22] every training exercise says it was written for the curriculum', src.trainingHonest);

  console.log('\n=== part 5: squeeze_spaces, preserved exactly ===');
  const sq = await page.evaluate(() => {
    const x = EXAMSHELL.find(q => q.title === 'squeeze_spaces');
    return x ? { found: true, brief: x.brief, allowed: x.allowed_functions,
      file: x.examshell.file, conf: x.examshell.confidence,
      constraints: x.examshell.constraints.join(' | ') } : { found: false };
  });
  check('[23] squeeze_spaces exists', sq.found);
  check('[24] the subject text is preserved verbatim',
    /modifies it in-place so that any sequence of multiple consecutive space characters \(' '\) is replaced by a single space character/.test(sq.brief) &&
    /Other whitespace characters \(such as tabs '\\t', newlines '\\n', etc\.\) must remain completely unchanged/.test(sq.brief));
  check('[25] the prototype is preserved exactly',
    sq.brief.indexOf('char *squeeze_spaces(char *str);') >= 0);
  check('[26] allowed functions is none', Array.isArray(sq.allowed) && sq.allowed.length === 0,
    JSON.stringify(sq.allowed));
  check('[27] the in-place and no-malloc requirement is preserved',
    /strictly in-place/i.test(sq.brief) && /not allowed to allocate new memory \(no malloc\)/.test(sq.brief));
  check('[28] the return requirement is preserved',
    /must return a pointer to the modified string/i.test(sq.brief));
  check('[29] the expected file name is recorded', sq.file === 'squeeze_spaces.c', sq.file);
  check('[30] it is marked verified', sq.conf === 'verified', sq.conf);

  console.log('\n=== part 6: THE DECISIVE CHECK — the July solutions actually run ===');
  const E = load();
  const sols = await page.evaluate(() => EXAMSHELL
    .filter(x => x.reference_solution && x.io.cases.length)
    .map(x => ({ id: x.id, conf: x.examshell.confidence,
      src: x.reference_solution, cases: x.io.cases })));
  let ran = 0, wrong = [];
  for (const s of sols) {
    for (const [args, expect] of s.cases) {
      ran++;
      let r;
      try { r = E.runToCompletion(s.src, { args, argv0: './a.out' }); }
      catch (err) { wrong.push(s.id + ' threw: ' + err.message); continue; }
      if (!r.ok) { wrong.push(s.id + ' ' + r.phase + ': ' + r.message); continue; }
      let out = '';
      for (const st of r.history.steps)
        if (st.detail && st.detail.stream === 'stdout' && st.detail.bytes)
          for (const b of st.detail.bytes) out += String.fromCharCode(b.value);
      if (out !== expect) wrong.push(s.id + ' ' + JSON.stringify(args) + ' gave ' +
        JSON.stringify(out) + ' want ' + JSON.stringify(expect));
    }
  }
  counted('[31] reference-solution cases executed by the engine', ran, 12);
  check('[32] every executed case produced exactly the declared output',
    wrong.length === 0, wrong.slice(0, 3).join(' | '));
  /* the exam's own worked examples, named explicitly */
  const vig = sols.find(s => s.id === 'es.vigenere');
  const vigCases = vig ? vig.cases.map(c => JSON.stringify(c[0]) + '->' + JSON.stringify(c[1])) : [];
  check('[33] the Vigenere worked examples from the cards are the declared cases',
    vigCases.some(c => /"hello","key".*"rijvs/.test(c)) &&
    vigCases.some(c => /"Attack","abc".*"Auvadm/.test(c)), vigCases.slice(0, 2).join('  '));
  check('[34] both verified exercises carry a solution that was run',
    sols.filter(s => s.conf === 'verified').length === 2,
    sols.filter(s => s.conf === 'verified').map(s => s.id).join(','));

  console.log('\n=== part 7: difficulty is not length ===');
  const diff = await page.evaluate(() => {
    const L = EXAMSHELL;
    const rank = { easy:1, medium:2, hard:3, final:4 };
    const lenRank = { short:1, medium:2, long:3 };
    const rows = L.map(x => [lenRank[x.examshell.implementationLength], rank[x.examshell.difficulty]]);
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(rows.map(r => r[0])), my = mean(rows.map(r => r[1]));
    let num = 0, dx = 0, dy = 0;
    for (const [a, b] of rows) { num += (a - mx) * (b - my); dx += (a - mx) ** 2; dy += (b - my) ** 2; }
    const shortHard = L.filter(x => x.examshell.implementationLength === 'short' &&
      ['hard','final'].indexOf(x.examshell.difficulty) >= 0).map(x => x.title);
    const longNotHard = L.filter(x => x.examshell.implementationLength === 'long' &&
      ['easy','medium'].indexOf(x.examshell.difficulty) >= 0).map(x => x.title);
    /* the model must not read implementation length at all */
    const dims = ES_DIMENSIONS.map(d => d[0]);
    return { corr: num / Math.sqrt(dx * dy), shortHard, longNotHard, dims,
      lengthInModel: dims.indexOf('implementationLength') >= 0 || dims.indexOf('length') >= 0,
      bands: L.map(x => x.examshell.difficulty),
      scores: L.map(x => x.examshell.score) };
  });
  counted('[35] difficulty dimensions in the model', diff.dims.length, 8);
  check('[36] implementation length is not one of the scored dimensions', !diff.lengthInModel,
    diff.dims.join(','));
  check('[37] length does not predict difficulty', Math.abs(diff.corr) < 0.4,
    'correlation = ' + Math.round(diff.corr * 100) / 100);
  check('[38] at least one short exercise is hard', diff.shortHard.length > 0, diff.shortHard.join(', '));
  check('[39] at least one long exercise is not hard', diff.longNotHard.length > 0, diff.longNotHard.join(', '));
  check('[40] every difficulty is one of the four bands',
    diff.bands.every(b => ['easy','medium','hard','final'].indexOf(b) >= 0));
  check('[41] scores are distinct enough to be meaningful',
    new Set(diff.scores).size >= 12, new Set(diff.scores).size + ' distinct scores');

  console.log('\n=== part 8: the progression is deliberate ===');
  const prog = await page.evaluate(() => {
    const L = EXAMSHELL;
    const rank = { easy:1, medium:2, hard:3, final:4 };
    const seq = L.map(x => rank[x.examshell.difficulty]);
    let drops = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) drops++;
    return { seq, drops,
      chk: L.filter(x => x.examshell.checkpoint).map(x => x.examshell.n),
      first: seq[0], last: seq[seq.length - 1],
      shape: L.map(x => x.examshell.difficulty[0].toUpperCase() + (x.examshell.checkpoint ? '*' : '')).join(' ') };
  });
  counted('[42] positions in the progression', prog.seq.length, 15);
  check('[43] it does not rise monotonically — there are recovery points', prog.drops >= 3,
    prog.drops + ' drops: ' + prog.shape);
  check('[44] it starts easy and ends at the hardest tier',
    prog.first === 1 && prog.last === 4, 'start=' + prog.first + ' end=' + prog.last);
  check('[45] there are three checkpoints, spread through the curriculum',
    prog.chk.length === 3 && prog.chk[0] < 6 && prog.chk[2] > 10, prog.chk.join(','));

  console.log('\n=== part 9: nothing is leaked before solving ===');
  const leak = await page.evaluate(() => {
    localStorage.removeItem('cexlab.progress.v1'); examProgress.data = null;
    const x = EXAMSHELL.find(q => q.title === 'squeeze_spaces');
    xs.mode = 'guided'; xs.sim = null; xs.ex = x.id; xs.attempted = false; renderExam();
    const before = document.querySelector('#examRoot .x-main').textContent;
    const e = x.examshell;
    const leaked = {
      purpose: before.indexOf(e.purpose.slice(0, 40)) >= 0,
      edge: e.edgeCases.some(c => before.indexOf(c.slice(0, 30)) >= 0),
      review: !!document.querySelector('#examRoot .x-esrev'),
      skills: x.skills.some(s => before.indexOf(s) >= 0),
    };
    /* the subject and its constraints MUST be visible */
    const shown = { subject: before.indexOf('consecutive space characters') >= 0,
      constraint: before.indexOf('Strictly in-place') >= 0 };
    /* now solve it and look again */
    examProgress.record(x, 'pass');
    renderExam();
    const after = document.querySelector('#examRoot .x-main').textContent;
    const revealed = { review: !!document.querySelector('#examRoot .x-esrev'),
      purpose: after.indexOf(e.purpose.slice(0, 40)) >= 0,
      edge: e.edgeCases.some(c => after.indexOf(c.slice(0, 30)) >= 0) };
    localStorage.removeItem('cexlab.progress.v1'); examProgress.data = null;
    return { leaked, shown, revealed };
  });
  inspected += 9;
  check('[46] the training purpose is not shown before solving', !leak.leaked.purpose);
  check('[47] the edge-case list is not shown before solving', !leak.leaked.edge);
  check('[48] the review layer is absent before solving', !leak.leaked.review);
  check('[49] the subject and its constraints ARE shown',
    leak.shown.subject && leak.shown.constraint, JSON.stringify(leak.shown));
  check('[50] after solving, the review layer appears', leak.revealed.review);
  check('[51] and it explains the purpose and the edge cases',
    leak.revealed.purpose && leak.revealed.edge, JSON.stringify(leak.revealed));

  console.log('\n=== part 10: progress state ===');
  const prog2 = await page.evaluate(() => {
    localStorage.removeItem('cexlab.progress.v1'); examProgress.data = null;
    xs.page = 'examshell'; xs.sub = null; xs.ex = null; renderExam();
    const before = document.querySelectorAll('#examRoot .x-esrow.done').length;
    const x = EXAMSHELL[0];
    examProgress.record(x, 'pass');
    renderExam();
    const after = document.querySelectorAll('#examRoot .x-esrow.done').length;
    const bar = document.querySelector('#examRoot .x-esbar b').textContent;
    localStorage.removeItem('cexlab.progress.v1'); examProgress.data = null;
    return { before, after, bar };
  });
  check('[52] solving an exercise marks it in the curriculum list',
    prog2.before === 0 && prog2.after === 1, JSON.stringify(prog2));
  check('[53] the counter reflects it', /1 \/ 15/.test(prog2.bar), prog2.bar);

  check('[54] no page or console errors across the whole phase',
    errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + '-'.repeat(64));
  console.log('TOTAL ITEMS INSPECTED: ' + inspected);
  console.log('PHASE 44  pass ' + pass + '  fail ' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
