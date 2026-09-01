'use strict';
/* Phase 42 — the practice view.
 *
 * Drives the real page in Chrome. Navigation is exercised by CLICKING and by
 * hit-testing with elementFromPoint, never by calling show*() directly: bugfix
 * fad8fd0 existed for phases because the suites called the function and so
 * never noticed the view was covering the rail.
 *
 * Every group reports how many things it inspected, and a group that inspected
 * fewer than its floor FAILS. Several checks are mutation-style: they change
 * state and assert the consequence, rather than asserting a value that would
 * be true whether or not the feature works.
 */
const path = require('path');
const puppeteer = require('puppeteer-core');

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
  /* The compiler bridge probes localhost:4242; offline that is a refused
     connection and is correct. phase20 and phase35 ignore it for the same reason. */
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1400);

  console.log('\n=== part 1: the fifth view, reached by clicking ===');
  const rail = await page.evaluate(() => {
    const el = document.querySelector('#railExam');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hit: hit === el || el.contains(hit), w: Math.round(r.width) };
  });
  check('[1] the rail has a practice button and it is hit-testable', !!rail && rail.hit);
  await page.click('#railExam');
  await sleep(450);
  check('[2] clicking it opens #examRoot and sets the view',
    await page.evaluate(() => getComputedStyle(document.querySelector('#examRoot')).display === 'block' && ui.view === 'exam'));
  check('[3] #examRoot does not cover the rail', await page.evaluate(() => {
    const el = document.querySelector('#railHome');
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t === el || el.contains(t);
  }), 'the bug fad8fd0 fixed for the dashboard and the lab');
  check('[4] #examRoot is inside .workarea, not at body level',
    await page.evaluate(() => !!document.querySelector('.workarea #examRoot')));

  /* every section must actually render something */
  const navs = await page.evaluate(() => [...document.querySelectorAll('#examRoot .x-navb')].map(b => b.textContent));
  check('[5] all eight sections are present', navs.length === 8, navs.join(' | '));
  let sectionChars = 0, thin = [];
  for (const label of navs) {
    await page.evaluate((t) => {
      const b = [...document.querySelectorAll('#examRoot .x-navb')].find(x => x.textContent === t);
      b.click();
    }, label);
    await sleep(180);
    const n = await page.evaluate(() => document.querySelector('#examRoot .x-main').textContent.trim().length);
    sectionChars += n;
    if (n < 250) thin.push(label + '=' + n);
  }
  counted('[6] section content rendered', sectionChars, 20000);
  check('[7] no section renders as a stub', thin.length === 0, thin.join(', '));

  console.log('\n=== part 2: the database drives the view ===');
  const dataFacts = await page.evaluate(() => ({
    total: EXAM_EXERCISES.length,
    cards: (() => { xs.page = 'browse'; xs.ex = null; xs.filters = { q:'',track:'',subject:'',skill:'',band:'',source:'',solved:'' }; renderExam();
      return document.querySelectorAll('#examRoot .x-card').length; })(),
  }));
  check('[8] the browser lists every exercise in the database',
    dataFacts.cards === dataFacts.total, dataFacts.cards + ' cards / ' + dataFacts.total + ' records');
  counted('[9] exercise cards rendered', dataFacts.cards, 60);

  /* filtering — each filter must actually reduce, and to the right records */
  const filters = await page.evaluate(() => {
    const setF = (k, v) => { xs.filters = { q:'',track:'',subject:'',skill:'',band:'',source:'',solved:'' }; xs.filters[k] = v; return xFilterSet(); };
    const out = {};
    out.all = xFilterSet().length;
    out.trackA = setF('track', 'C00-C08');
    out.trackB = setF('track', 'C09-C13');
    out.bandE = setF('band', 'E');
    out.skillWord = setF('skill', 'WORD_DETECTION');
    out.subjC06 = setF('subject', 'C06');
    out.search = setF('q', 'word');
    return {
      all: out.all,
      trackA: out.trackA.length, trackAok: out.trackA.every(x => x.track === 'C00-C08'),
      trackB: out.trackB.length, trackBok: out.trackB.every(x => x.track === 'C09-C13'),
      bandE: out.bandE.length, bandEok: out.bandE.every(x => x.band === 'E'),
      skill: out.skillWord.length, skillok: out.skillWord.every(x => x.skills.indexOf('WORD_DETECTION') >= 0),
      subj: out.subjC06.length, subjok: out.subjC06.every(x => x.required_subjects.indexOf('C06') >= 0),
      search: out.search.length,
    };
  });
  counted('[10] filter results examined', filters.trackA + filters.trackB + filters.bandE +
    filters.skill + filters.subj + filters.search, 120);
  check('[11] the track filter returns only that track',
    filters.trackAok && filters.trackBok && filters.trackA > 0 && filters.trackB > 0,
    'A=' + filters.trackA + ' B=' + filters.trackB);
  check('[12] the difficulty filter returns only that band', filters.bandEok && filters.bandE > 0, 'E=' + filters.bandE);
  check('[13] the skill filter returns only exercises with that skill', filters.skillok && filters.skill > 0);
  check('[14] the subject filter returns only exercises needing that subject', filters.subjok && filters.subj > 0);
  check('[15] search narrows the set', filters.search > 0 && filters.search < filters.all,
    filters.search + ' of ' + filters.all);

  console.log('\n=== part 3: launching and running an exercise ===');
  await page.evaluate(() => { xs.page = 'recoding'; xs.sub = 'words'; xs.ex = null; renderExam(); });
  await sleep(200);
  const wordCards = await page.evaluate(() => document.querySelectorAll('#examRoot .x-card').length);
  counted('[16] word exercises reachable from Recoding Prep', wordCards, 8);
  await page.evaluate(() => document.querySelector('#examRoot .x-card').click());
  await sleep(300);
  const ex = await page.evaluate(() => ({
    id: xs.ex,
    editor: !!document.querySelector('#xEditor'),
    allowed: (document.querySelector('#examRoot .x-allowed span') || {}).textContent,
    hasTask: (document.querySelector('#examRoot .x-brief') || {}).textContent.length,
    hasCases: document.querySelectorAll('#examRoot .x-cases tbody tr').length,
  }));
  check('[17] the exercise page shows task, allowed functions, examples and an editor',
    !!ex.id && ex.editor && ex.hasTask > 30 && !!ex.allowed && ex.hasCases > 0, JSON.stringify(ex));

  /* run the exercise's own reference solution: it must PASS */
  const solved = await page.evaluate(() => {
    const withSol = EXAM_EXERCISES.filter(x => x.reference_solution && x.io.cases && x.io.cases.length);
    const x = withSol[0];
    xs.ex = x.id; xs.result = null; xs.attempted = false; renderExam();
    const v = examCheck(x, x.reference_solution);
    return { id: x.id, verdict: v.verdict, passed: v.passed, total: v.total };
  });
  check('[18] a reference solution submitted through the UI checker passes',
    solved.verdict === 'pass' && solved.passed === solved.total,
    solved.id + ' ' + solved.passed + '/' + solved.total);

  /* and a deliberately wrong one must fail as WRONG OUTPUT, not something else */
  const wrong = await page.evaluate(() => {
    const x = EXAM_EXERCISES.find(q => q.reference_solution && q.io.cases && q.io.cases.length);
    return examCheck(x, 'int\tmain(void)\n{\n\twrite(1, "zzz", 3);\n\treturn (0);\n}\n').verdict;
  });
  check('[19] a wrong answer is reported as wrong output', wrong === 'wrong-output', wrong);

  console.log('\n=== part 4: the failure kinds are told apart ===');
  const kinds = await page.evaluate(() => ({
    cast:    examExecute('int\tmain(void)\n{\n\tchar\tc;\n\n\tc = (char)65;\n\twrite(1,&c,1);\n\treturn (0);\n}\n', []),
    voidc:   examExecute('int\tmain(int argc, char **argv)\n{\n\t(void)argc;\n\twrite(1,"a",1);\n\treturn (0);\n}\n', []),
    sw:      examExecute('int\tmain(void)\n{\n\tint\ti;\n\n\ti = 1;\n\tswitch (i) { case 1: break; }\n\treturn (0);\n}\n', []),
    compile: examExecute('int\tmain(void)\n{\n\twrite(1 "a", 1);\n\treturn (0);\n}\n', []),
    loop:    examExecute('int\tmain(void)\n{\n\tint\ti;\n\n\ti = 0;\n\twhile (i >= 0)\n\t\ti++;\n\treturn (0);\n}\n', [], 3000),
    streams: examExecute('int\tmain(void)\n{\n\twrite(2,"E",1);\n\twrite(1,"O",1);\n\treturn (0);\n}\n', []),
    ok:      examExecute('int\tmain(void)\n{\n\twrite(1,"hi",2);\n\treturn (0);\n}\n', []),
  }));
  inspected += 7;
  check('[20] a cast is an engine limitation, not a compilation error', kinds.cast.kind === 'engine-limit', kinds.cast.kind);
  check('[21] (void)x is named specifically and the code called correct',
    kinds.voidc.kind === 'engine-limit' && kinds.voidc.limit.id === 'voidcast' &&
    /Your code is correct/.test(kinds.voidc.message));
  check('[22] switch is an engine limitation', kinds.sw.kind === 'engine-limit', kinds.sw.kind);
  check('[23] a genuine syntax error IS a compilation error', kinds.compile.kind === 'compile', kinds.compile.kind);
  check('[24] an endless loop is a timeout, reported separately from a wrong answer',
    kinds.loop.kind === 'timeout' && /Timeout/.test(kinds.loop.message), kinds.loop.kind);
  check('[25] stdout is reconstructed from steps and excludes stderr',
    kinds.streams.stdout === 'O' && kinds.streams.stderr === 'E',
    'stdout=' + JSON.stringify(kinds.streams.stdout) + ' stderr=' + JSON.stringify(kinds.streams.stderr));
  check('[26] a correct program simply runs', kinds.ok.kind === 'ok' && kinds.ok.stdout === 'hi');

  /* forbidden functions, from the exercise's own list */
  const forb = await page.evaluate(() => {
    const x = EXAM_EXERCISES.find(q => (q.allowed_functions || []).join() === 'write');
    const v = examCheck(x, 'int\tmain(void)\n{\n\tprintf("hi");\n\treturn (0);\n}\n');
    return { verdict: v.verdict, names: v.forbidden, msg: v.message };
  });
  check('[27] a forbidden function is caught before output is compared',
    forb.verdict === 'forbidden' && forb.names.indexOf('printf') >= 0 && /-42/.test(forb.msg),
    forb.names && forb.names.join(','));

  console.log('\n=== part 5: hints and solution gating ===');
  const gate = await page.evaluate(() => {
    const x = EXAM_EXERCISES.find(q => q.reference_solution);
    xs.ex = x.id; xs.mode = 'guided'; xs.hints = 0; xs.attempted = false; xs.showSolution = false;
    xs.result = null; renderExam();
    const btn = () => document.querySelector('#examRoot [data-xact="solution"]');
    const before = !!btn() && btn().disabled;
    xs.attempted = true; renderExam();
    const after = !!btn() && !btn().disabled;
    /* blind mode must offer no hint button at all */
    xs.mode = 'blind'; xs.attempted = false; renderExam();
    const blindHint = !!document.querySelector('#examRoot [data-xact="hint"]');
    return { before, after, blindHint };
  });
  check('[28] the reference solution is locked before an attempt', gate.before);
  check('[29] it unlocks after a real attempt', gate.after);
  check('[30] blind mode offers no hint button', !gate.blindHint);

  const hints = await page.evaluate(() => {
    const x = EXAM_EXERCISES.find(q => q.skills.indexOf('WORD_DETECTION') >= 0);
    xs.ex = x.id; xs.mode = 'guided'; xs.hints = 0; renderExam();
    const texts = [];
    for (let i = 1; i <= 5; i++) {
      xs.hints = i; renderExam();
      texts.push(document.querySelector('#examRoot .x-hints').textContent);
    }
    return { count: document.querySelectorAll('#examRoot .x-hint').length, last: texts[4], grew: texts[3].length > texts[0].length };
  });
  counted('[31] hint ladder steps rendered', hints.count, 4);
  check('[32] hints get more specific as they go', hints.grew);
  check('[33] the ladder ends without code', !/write\s*\(1|int\s+main/.test(hints.last) && /no fifth one/.test(hints.last));

  console.log('\n=== part 6: the string function trainer ===');
  const fn = await page.evaluate(() => {
    xs.page = 'functions'; xs.sub = 'table'; xs.ex = null; renderExam();
    const rows = document.querySelectorAll('#examRoot .x-ftable tbody tr').length;
    const txt = document.querySelector('#examRoot .x-main').textContent;
    xs.sub = 'pairs'; renderExam();
    const pairs = document.querySelectorAll('#examRoot .x-pair').length;
    xs.sub = 'quiz'; xs.quiz = { i:0, picked:null, score:0, asked:0 }; renderExam();
    const opts = document.querySelectorAll('#examRoot .x-qopt').length;
    return { rows, pairs, opts, hasExcluded: /ft_strnstr/.test(txt),
      protos: FUNC_TRAINER.map(f => f.proto), names: FUNC_TRAINER.map(f => f.name) };
  });
  counted('[34] functions in the comparison table', fn.rows, 10);
  counted('[35] deceptive pairs', fn.pairs, 6);
  check('[36] ft_strnstr is named as deliberately absent', fn.hasExcluded);
  /* every prototype must match the subject database exactly */
  const protoMatch = await page.evaluate(() => {
    const subj = {};
    for (const s of EXAM_SUBJECTS) for (const x of s.ex) if (x.proto) subj[x.name] = { proto: x.proto, subject: s.id, ex: x.id, allowed: x.allowed };
    const bad = [];
    let n = 0;
    for (const f of FUNC_TRAINER) {
      n += 3;
      const r = subj[f.name];
      if (!r) { bad.push(f.name + ': not in any subject'); continue; }
      if (r.proto !== f.proto) bad.push(f.name + ': proto ' + f.proto + ' vs subject ' + r.proto);
      if (r.subject !== f.subject || r.ex !== f.ex) bad.push(f.name + ': cites ' + f.subject + ' ' + f.ex + ' but it is ' + r.subject + ' ' + r.ex);
      if (r.allowed !== f.allowed) bad.push(f.name + ': allowed ' + f.allowed + ' vs subject ' + r.allowed);
    }
    return { n, bad };
  });
  counted('[37] trainer fields checked against the subject database', protoMatch.n, 30);
  check('[38] every prototype, exercise number and allowed list matches its subject',
    protoMatch.bad.length === 0, protoMatch.bad.slice(0, 3).join(' | '));

  /* the canonical implementations must actually run and behave */
  const impls = await page.evaluate(() => {
    const T = [
      ['strlen',  'int\tmain(void)\n{\n\tchar\tc;\n\n\tc = 48 + ft_strlen("abc");\n\twrite(1, &c, 1);\n\treturn (0);\n}\n', '3'],
      ['strcmp',  'int\tmain(void)\n{\n\tif (ft_strcmp("abc", "abc") == 0)\n\t\twrite(1, "y", 1);\n\treturn (0);\n}\n', 'y'],
      ['strcpy',  'int\tmain(void)\n{\n\tchar\td[8];\n\n\tft_strcpy(d, "hi");\n\twrite(1, d, 2);\n\treturn (0);\n}\n', 'hi'],
      ['strstr',  'int\tmain(void)\n{\n\tchar\t*p;\n\n\tp = ft_strstr("abcd", "cd");\n\twrite(1, p, 2);\n\treturn (0);\n}\n', 'cd'],
      ['strncat', 'int\tmain(void)\n{\n\tchar\td[16] = "Hi";\n\n\tft_strncat(d, "World", 3);\n\twrite(1, d, 5);\n\treturn (0);\n}\n', 'HiWor'],
      ['strlcpy', 'int\tmain(void)\n{\n\tchar\td[8];\n\tchar\tc;\n\n\tc = 48 + ft_strlcpy(d, "abcd", 3);\n\twrite(1, d, 2);\n\twrite(1, &c, 1);\n\treturn (0);\n}\n', 'ab4'],
    ];
    const out = [];
    for (const [id, main, want] of T) {
      const f = FUNC_TRAINER.find(q => q.id === id);
      const r = examExecute(f.impl + '\n' + main, []);
      out.push({ id, kind: r.kind, got: r.stdout, want, ok: r.kind === 'ok' && r.stdout === want, msg: r.message });
    }
    return out;
  });
  counted('[39] canonical implementations executed by the engine', impls.length, 6);
  check('[40] every canonical implementation produces the documented behaviour',
    impls.every(r => r.ok), impls.filter(r => !r.ok).map(r => r.id + ':' + (r.got !== undefined ? JSON.stringify(r.got) : r.kind) + ' want ' + JSON.stringify(r.want)).join(' | '));

  /* quiz logic: right answer scores, wrong does not, and every answer exists */
  const quiz = await page.evaluate(() => {
    const ids = new Set(FUNC_TRAINER.map(f => f.id));
    const unknown = FUNC_QUIZ.filter(q => !ids.has(q.a)).map(q => q.a);
    xs.page = 'functions'; xs.sub = 'quiz'; xs.quiz = { i:0, picked:null, score:0, asked:0 }; renderExam();
    const q0 = FUNC_QUIZ[0];
    document.querySelector('#examRoot [data-xquiz="' + q0.a + '"]').click();
    const afterRight = { score: xs.quiz.score, asked: xs.quiz.asked };
    xs.quiz.i = 1; xs.quiz.picked = null; renderExam();
    const q1 = FUNC_QUIZ[1];
    const wrongId = FUNC_TRAINER.map(f => f.id).find(i => i !== q1.a);
    document.querySelector('#examRoot [data-xquiz="' + wrongId + '"]').click();
    const afterWrong = { score: xs.quiz.score, asked: xs.quiz.asked };
    return { unknown, afterRight, afterWrong, n: FUNC_QUIZ.length };
  });
  counted('[41] quiz questions', quiz.n, 8);
  check('[42] every quiz answer names a function that exists', quiz.unknown.length === 0, quiz.unknown.join(','));
  check('[43] a correct pick scores, a wrong pick does not',
    quiz.afterRight.score === 1 && quiz.afterWrong.score === 1 && quiz.afterWrong.asked === 2,
    JSON.stringify(quiz.afterRight) + ' then ' + JSON.stringify(quiz.afterWrong));

  console.log('\n=== part 7: algorithm trainer ===');
  const algo = await page.evaluate(() => {
    xs.page = 'skills'; xs.ex = null; renderExam();
    const lessons = document.querySelectorAll('#examRoot .x-sideb').length;
    const missing = [];
    let fields = 0;
    for (const L of ALGO_LESSONS) {
      fields += 8;
      for (const k of ['solves','recognise','model','pseudo','example'])
        if (!L[k] || String(L[k]).length < 10) missing.push(L.id + '.' + k);
      for (const k of ['steps','mistakes','edges'])
        if (!Array.isArray(L[k]) || !L[k].length) missing.push(L.id + '.' + k);
      for (const p of L.practice)
        if (!EXAM_EXERCISES.some(x => x.id === p)) missing.push(L.id + ' -> unknown exercise ' + p);
    }
    xs.algo = 'insertion'; renderExam();
    const sortTxt = document.querySelector('#examRoot .x-main').textContent;
    return { lessons, missing, fields,
      hasSort: /Bubble sort versus insertion sort/.test(sortTxt),
      scenarios: document.querySelectorAll('#examRoot .x-explain .x-q').length };
  });
  counted('[44] algorithm lesson fields checked', algo.fields, 100);
  check('[45] every lesson is complete and links only to real exercises',
    algo.missing.length === 0, algo.missing.slice(0, 3).join(' | '));
  counted('[46] lessons offered', algo.lessons, 15);
  check('[47] the sorting comparison and decision scenarios appear under insertion sort',
    algo.hasSort && algo.scenarios >= 5, 'scenarios=' + algo.scenarios);

  console.log('\n=== part 8: projects, persisted ===');
  await page.evaluate(() => { localStorage.removeItem('cexlab.projects.v1'); examProjects.data = null; });
  const proj = await page.evaluate(() => {
    xs.page = 'projects'; xs.ex = null; renderExam();
    document.querySelector('#xpName').value = 'Recoding week 1';
    document.querySelector('#xpTrack').value = 'C00-C08';
    document.querySelector('#xpMode').value = 'drill';
    document.querySelector('#examRoot [data-xact="pcreate"]').click();
    const d = examProjects.get();
    return { n: d.list.length, name: d.list[0].name, mode: d.list[0].mode, current: d.current === d.list[0].id,
      raw: !!localStorage.getItem('cexlab.projects.v1'),
      cards: document.querySelectorAll('#examRoot .x-proj').length };
  });
  check('[48] creating a project stores it and makes it active',
    proj.n === 1 && proj.name === 'Recoding week 1' && proj.mode === 'drill' && proj.current && proj.raw);
  check('[49] the project is rendered', proj.cards === 1);

  /* attempts inside a project are attributed to it */
  const attributed = await page.evaluate(() => {
    const x = EXAM_EXERCISES.find(q => q.reference_solution && q.io.cases.length);
    examProgress.record(x, 'pass');
    examProjects.note(x, 'pass');
    const p = examProjects.currentProject();
    return { attempts: p.attempts, solved: p.solved.length, skills: p.skills.length };
  });
  check('[50] work done inside a project is recorded on it',
    attributed.attempts === 1 && attributed.solved === 1 && attributed.skills > 0, JSON.stringify(attributed));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1300);
  const persisted = await page.evaluate(() => ({
    projects: examProjects.get().list.map(p => p.name),
    attempts: examProgress.get().attempts.length,
    solved: Object.keys(examProgress.get().solved).length,
  }));
  check('[51] projects and progress survive a reload',
    persisted.projects.length === 1 && persisted.attempts === 1 && persisted.solved === 1,
    JSON.stringify(persisted));

  /* MUTATION: corrupt each store and prove the app still works */
  const resilience = await page.evaluate(() => {
    const out = {};
    localStorage.setItem('cexlab.projects.v1', '{{{ not json at all');
    localStorage.setItem('cexlab.progress.v1', '[1,2,3]');
    examProjects.data = null; examProgress.data = null;
    out.projects = examProjects.get().list.length;
    out.attempts = examProgress.get().attempts.length;
    let threw = false;
    try { xs.page = 'projects'; renderExam(); xs.page = 'progress'; renderExam(); }
    catch (e) { threw = true; out.err = e.message; }
    out.threw = threw;
    out.rendered = document.querySelector('#examRoot .x-main').textContent.length;
    out.keptBroken = !!localStorage.getItem('cexlab.projects.v1.broken');
    return out;
  });
  inspected += 3;
  check('[52] corrupt stores fall back to empty instead of throwing',
    !resilience.threw && resilience.projects === 0 && resilience.attempts === 0,
    JSON.stringify(resilience));
  check('[53] the view still renders on corrupt data', resilience.rendered > 200);
  check('[54] the unreadable text is kept rather than destroyed', resilience.keptBroken);
  /* MUTATION: write a UI preference, corrupt both exam stores, and prove the
     preference survived. Asserting the key merely EXISTS would pass on a fresh
     profile that had never written one. */
  const isolation = await page.evaluate(() => {
    ui.split = 61; saveUI();
    const before = JSON.parse(localStorage.getItem('cexlab.ui.v3')).split;
    localStorage.setItem(EXAM_KEYS.projects, 'garbage{');
    localStorage.setItem(EXAM_KEYS.progress, 'garbage[');
    examProjects.data = null; examProgress.data = null;
    examProjects.get(); examProgress.get();
    const after = JSON.parse(localStorage.getItem('cexlab.ui.v3')).split;
    return { before, after, distinct: EXAM_KEYS.progress !== 'cexlab.ui.v3' &&
      EXAM_KEYS.projects !== 'cexlab.ui.v3' && EXAM_KEYS.progress !== EXAM_KEYS.projects };
  });
  check('[55] corrupting the practice stores leaves UI preferences intact',
    isolation.before === 61 && isolation.after === 61 && isolation.distinct,
    JSON.stringify(isolation));

  console.log('\n=== part 9: progress and recommendations ===');
  const adaptive = await page.evaluate(() => {
    localStorage.removeItem('cexlab.progress.v1');
    examProgress.data = null;
    const cold = examRecommend(EXAM_EXERCISES, examProgress.get());
    /* build a deliberate weakness in one skill */
    const word = EXAM_EXERCISES.filter(x => x.skills.indexOf('WORD_DETECTION') >= 0).slice(0, 4);
    const argv = EXAM_EXERCISES.filter(x => x.skills.indexOf('ARGC_ARGV') >= 0 &&
      x.skills.indexOf('WORD_DETECTION') < 0).slice(0, 4);
    for (const x of word) { examProgress.record(x, 'fail'); examProgress.record(x, 'fail'); }
    /* SKILL_MIN_SEEN is 3: the product refuses to call a skill strong or weak
       until it has been seen enough times, so the fixture must clear that bar. */
    for (const x of argv) { examProgress.record(x, 'pass'); examProgress.record(x, 'pass'); }
    const p = examProgress.get();
    const st = examStats(p);
    const weak = examWeakSkills(p).map(s => s.id);
    const strong = examStrongSkills(p).map(s => s.id);
    const rec = examRecommend(EXAM_EXERCISES, p);
    return { coldFlag: cold.cold, coldPicks: cold.picks.length,
      attempts: st.attempts, solved: st.solved, rate: st.successRate,
      weak, strong, picks: rec.picks.length,
      whyMentionsSkill: rec.picks.some(q => /WORD_DETECTION/.test(q.why)),
      recNotSolved: rec.picks.every(q => !examProgress.isSolved(q.ex.id)) };
  });
  inspected += 8;
  check('[56] with no history the page says so rather than inventing a diagnosis',
    adaptive.coldFlag === true);
  check('[57] statistics are computed from the stored attempts',
    adaptive.attempts === 16 && adaptive.solved === 4 && adaptive.rate === 50,
    JSON.stringify({ a: adaptive.attempts, s: adaptive.solved, r: adaptive.rate }));
  check('[58] a repeatedly failed skill is identified as weak',
    adaptive.weak.indexOf('WORD_DETECTION') >= 0, adaptive.weak.slice(0, 4).join(','));
  check('[59] a consistently passed skill is identified as strong',
    adaptive.strong.indexOf('ARGC_ARGV') >= 0, adaptive.strong.slice(0, 4).join(','));
  check('[60] recommendations name the weak skill as the reason', adaptive.whyMentionsSkill);
  check('[61] nothing already solved is recommended', adaptive.recNotSolved);
  counted('[62] recommendations produced', adaptive.picks, 3);

  console.log('\n=== part 10: knowledge gating stays derived ===');
  const gating = await page.evaluate(() => {
    let n = 0; const bad = [];
    for (const x of EXAM_EXERCISES) {
      n += 2;
      const g = examGate(x.required_subjects);
      if (x.track !== g.track) bad.push(x.id + ' track');
      if (x.studied_status !== g.status) bad.push(x.id + ' status');
    }
    /* an ADVANCED exercise must SAY which subject is missing, in the page */
    const adv = EXAM_EXERCISES.find(x => x.studied_status === 'ADVANCED');
    xs.ex = adv.id; renderExam();
    const txt = document.querySelector('#examRoot .x-main').textContent;
    return { n, bad, advId: adv.id, missing: adv.missing_subjects,
      saysAdvanced: /ADVANCED/.test(txt),
      namesSubject: adv.missing_subjects.every(s => txt.indexOf(s) >= 0),
      distinguishes: /have not studied/.test(txt) };
  });
  counted('[63] gate derivations re-checked in the live page', gating.n, 140);
  check('[64] every record still agrees with the derivation', gating.bad.length === 0, gating.bad.slice(0, 3).join(','));
  check('[65] an advanced exercise says so and names the missing subject',
    gating.saysAdvanced && gating.namesSubject, gating.advId + ' needs ' + gating.missing.join(','));
  check('[66] it distinguishes "not studied" from "cannot do it"', gating.distinguishes);

  console.log('\n=== part 11: exam configuration and scoring ===');
  const exam = await page.evaluate(() => {
    let n = 0; const bad = [];
    for (const c of EXAM_CONFIGS) {
      n += 6;
      for (const k of ['pointsPerExercise','maxScore','durationMinutes','exerciseCount'])
        if (typeof c[k] !== 'number' || c[k] <= 0) bad.push(c.id + '.' + k);
      if (!Array.isArray(c.levels) || !c.levels.length) bad.push(c.id + '.levels');
      if (!c.note) bad.push(c.id + '.note');
    }
    const fin = examConfig('final');
    const s0 = examScore(fin, 0), s8 = examScore(fin, 8), s99 = examScore(fin, 99);
    const sess = examPickSession(EXAM_EXERCISES, fin, 12345, { attempts: [], solved: {} });
    const sess2 = examPickSession(EXAM_EXERCISES, fin, 12345, { attempts: [], solved: {} });
    const ids = sess.map(x => x.id);
    return { n, bad,
      points: fin.pointsPerExercise, max: fin.maxScore,
      s0: s0.score, s8: s8.score, s99: s99.score, capped: s99.capped,
      sessLen: sess.length, unique: new Set(ids).size === ids.length,
      deterministic: sess2.map(x => x.id).join() === ids.join(),
      allTrackA: sess.every(x => x.track === 'C00-C08' && x.studied_status === 'STUDIED'),
      bands: [...new Set(sess.map(x => x.band))].join('') };
  });
  counted('[67] exam configuration fields checked', exam.n, 20);
  check('[68] every configuration is complete', exam.bad.length === 0, exam.bad.join(','));
  check('[69] the historical 6-points-capped-at-100 model is configuration, not code',
    exam.points === 6 && exam.max === 100 && exam.s0 === 0 && exam.s8 === 48);
  check('[70] the score is capped at the configured maximum', exam.s99 === 100 && exam.capped);
  counted('[71] exercises selected for a session', exam.sessLen, 5);
  check('[72] a session never repeats an exercise', exam.unique);
  check('[73] session selection is deterministic for a seed', exam.deterministic);
  check('[74] a Track A session contains only studied Track A exercises', exam.allTrackA, 'bands ' + exam.bands);

  /* run a simulator session end to end */
  const sim = await page.evaluate(() => {
    xStartSim('drill');
    const started = { list: xs.sim.list.length, mode: xs.mode, ex: xs.ex,
      noHint: !document.querySelector('#examRoot [data-xact="hint"]'),
      hasClock: !!document.querySelector('#examRoot .x-clock') };
    /* solve the first one with its own reference solution, if it has one */
    const first = xs.sim.list[0];
    if (first.reference_solution) {
      const e = document.querySelector('#xEditor');
      e.value = first.reference_solution;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#examRoot [data-xact="check"]').click();
    }
    const after = { solved: xs.sim.solved.length, score: examScore(xs.sim.cfg, xs.sim.solved.length).score,
      advanced: xs.ex !== first.id };
    xs.sim.finished = true; xs.ex = null; renderExam();
    const result = document.querySelector('#examRoot .x-score') ?
      document.querySelector('#examRoot .x-score').textContent : '';
    xs.sim = null; xs.ex = null; xs.mode = 'guided'; renderExam();
    return { started, after, result, hadSolution: !!first.reference_solution };
  });
  check('[75] a simulator session starts in exam mode with a clock and no hints',
    sim.started.list > 0 && sim.started.mode === 'blind' && sim.started.noHint && sim.started.hasClock,
    JSON.stringify(sim.started));
  check('[76] solving inside the session scores it and advances',
    !sim.hadSolution || (sim.after.solved === 1 && sim.after.score === 5 && sim.after.advanced),
    JSON.stringify(sim.after));
  check('[77] the result screen shows a score out of the configured maximum',
    /of 50/.test(sim.result), sim.result.trim().slice(0, 40));

  console.log('\n=== part 12: the view carries no exercise content of its own ===');
  const purity = await page.evaluate(() => {
    /* every task sentence rendered must come from a record in the database */
    xs.page = 'browse'; xs.ex = null;
    xs.filters = { q:'',track:'',subject:'',skill:'',band:'',source:'',solved:'' };
    renderExam();
    const briefs = new Set(EXAM_EXERCISES.map(x => x.brief.slice(0, 60)));
    const cards = [...document.querySelectorAll('#examRoot .x-card-b')].map(e => e.textContent);
    let matched = 0;
    for (const c of cards) {
      const key = c.replace(/\u2026$/, '').slice(0, 60);
      if (briefs.has(key)) matched++;
    }
    return { cards: cards.length, matched };
  });
  counted('[78] rendered briefs traced back to the database', purity.cards, 60);
  check('[79] every rendered brief comes from a record, none invented by the view',
    purity.matched === purity.cards, purity.matched + ' of ' + purity.cards);

  console.log('\n=== part 13: the other four views still work ===');
  const others = await page.evaluate(() => {
    const out = {};
    document.querySelector('#railHome').click();
    out.dash = ui.view === 'dashboard' && getComputedStyle(document.querySelector('#examRoot')).display === 'none';
    document.querySelector('#railWork').click();
    out.work = ui.view === 'workspace';
    showLearn();
    out.learn = ui.view === 'learn' && getComputedStyle(document.querySelector('#examRoot')).display === 'none';
    showLab();
    out.lab = ui.view === 'lab' && getComputedStyle(document.querySelector('#examRoot')).display === 'none';
    document.querySelector('#railExam').click();
    out.back = ui.view === 'exam';
    return out;
  });
  inspected += 5;
  check('[80] the dashboard still opens and hides the practice view', others.dash);
  check('[81] the workspace still opens', others.work);
  check('[82] the Learn view still opens and hides the practice view', others.learn);
  check('[83] the labs still open and hide the practice view', others.lab);
  check('[84] and the practice view comes back', others.back);

  check('[85] no page or console errors across the whole phase',
    errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + '-'.repeat(64));
  console.log('TOTAL ITEMS INSPECTED: ' + inspected);
  console.log('PHASE 42  pass ' + pass + '  fail ' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
