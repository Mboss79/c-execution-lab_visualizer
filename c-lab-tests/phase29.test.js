'use strict';
/* C 05 — recursion, sequences, bounded search and backtracking.

   Two claims under test.

   FIDELITY: everything shown as official is what the C 05 subject PDF
   (version 7) says. The expected values below are transcribed here
   independently of the application, so a mistake in the data cannot agree
   with itself.

   REALITY: every number is produced by CEngine executing C. Where a page shows
   a result, this suite runs the same program headlessly and requires the two to
   match — a check that would fail against a hardcoded answer.

   Plus: the Learn view must still host C 04 unchanged, and the footer must hold
   its field positions across the states the phase names. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { load, HTML } = require('./load-engine.js');
const SHIPPED = fs.readFileSync(HTML, 'utf8');
const E = load();

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}

/* The C 05 subject, transcribed independently of the app. */
const SUBJECT = {
  ex00: { dir: 'ex00/', file: 'ft_iterative_factorial.c', allowed: 'None',
          proto: 'int\tft_iterative_factorial(int nb);', chapter: 'IV' },
  ex01: { dir: 'ex01/', file: 'ft_recursive_factorial.c', allowed: 'None',
          proto: 'int\tft_recursive_factorial(int nb);', chapter: 'V' },
  ex02: { dir: 'ex02/', file: 'ft_iterative_power.c', allowed: 'None',
          proto: 'int\tft_iterative_power(int nb, int power);', chapter: 'VI' },
  ex03: { dir: 'ex03/', file: 'ft_recursive_power.c', allowed: 'None',
          proto: 'int\tft_recursive_power(int nb, int power);', chapter: 'VII' },
  ex04: { dir: 'ex04/', file: 'ft_fibonacci.c', allowed: 'None',
          proto: 'int\tft_fibonacci(int index);', chapter: 'VIII' },
  ex05: { dir: 'ex05/', file: 'ft_sqrt.c', allowed: 'None',
          proto: 'int\tft_sqrt(int nb);', chapter: 'IX' },
  ex06: { dir: 'ex06/', file: 'ft_is_prime.c', allowed: 'None',
          proto: 'int\tft_is_prime(int nb);', chapter: 'X', tip: '0 and 1 are not prime numbers.' },
  ex07: { dir: 'ex07/', file: 'ft_find_next_prime.c', allowed: 'None',
          proto: 'int\tft_find_next_prime(int nb);', chapter: 'XI' },
  ex08: { dir: 'ex08/', file: 'ft_ten_queens_puzzle.c', allowed: 'write',
          proto: 'int\tft_ten_queens_puzzle(void);', chapter: 'XII' },
};
/* Phrases the subject uses that the page must not paraphrase away. */
const PHRASES = {
  ex00: ['If the argument is not valid, the function should return 0.'],
  ex02: ['If the power is less than 0, the function should return 0.',
         'By definition, 0 raised to the power of 0 should return 1.',
         'Overflows do not need to be handled.'],
  ex04: ['ft_fibonacci must be implemented recursively.',
         'If index is less than 0, the function should return -1.'],
  ex05: ['or 0 if the square root is an irrational number'],
  ex07: ['next prime number greater than or equal to the given number'],
  ex08: ['Recursion is required to solve this problem.'],
};

(async () => {
  console.log('\n== the Learn view became a module registry, not a second lesson system ==');
  for (const m of ['C05DATA', 'C05UI', 'C05CSS'])
    check('the ' + m + ' module ships', SHIPPED.indexOf('==== ' + m + ' START ====') > 0 &&
          SHIPPED.indexOf('==== ' + m + ' END ====') > 0);
  const ui = SHIPPED.slice(SHIPPED.indexOf('==== C05UI START ===='), SHIPPED.indexOf('==== C05UI END ===='));
  const css = SHIPPED.slice(SHIPPED.indexOf('==== C05CSS START ===='), SHIPPED.indexOf('==== C05CSS END ===='));
  for (const banned of ['createRun(', 'new Function', 'eval(', 'function asciiInfo', 'function limitsOf'])
    check('C 05 does not re-implement ' + banned, ui.indexOf(banned) < 0);
  check('it executes through the shared helper, not its own runner',
        /c4Run\(/.test(ui) && ui.indexOf('CEngine.runToCompletion') < 0);
  check('int limits come from the engine', /CEngine\.limitsOf\(/.test(ui));
  check('there is still ONE lesson view and one renderer',
        (SHIPPED.match(/function showLearn\(/g) || []).length === 1 &&
        (SHIPPED.match(/function renderLearn\(/g) || []).length === 1 &&
        (SHIPPED.match(/function c4Exercise\(/g) || []).length === 1);
  check('and one module registry rather than two page sets',
        (SHIPPED.match(/function learnModules\(/g) || []).length === 1);
  check('no router was added', !/history\.pushState|hashchange|new Router/.test(SHIPPED));
  const rules = ('/*' + css).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => l.indexOf('{') >= 0);
  check('the stylesheet has rules to inspect', rules.length > 30, rules.length + ' rules');
  check('every C 05 rule is scoped under #learnRoot',
        rules.filter(l => !/^\s*(#learnRoot|@media)/.test(l)).length === 0,
        rules.filter(l => !/^\s*(#learnRoot|@media)/.test(l)).slice(0, 2).join(' | '));

  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1050 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|favicon/.test(m.text())) errs.push(m.text());
  });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(900);
  const go = async (p2, mod, t) => {
    await page.evaluate(a => { showLearn(a.p, a.m); if (a.t) { c4.tab = a.t; renderLearn(); } },
      { p: p2, m: mod, t });
    await sleep(200);
  };

  console.log('\n== both modules are registered and reachable ==');
  const mods = await page.evaluate(() => learnModules().map(m =>
    ({ id: m.id, ex: m.ex.length, found: m.founds.length, bugs: m.bugs.length, prac: m.practice.length })));
  /* Not a count: the two courses this suite is about must be registered, with
     the shape it expects. Other modules may exist alongside them. */
  const c04 = mods.find(m => m.id === 'C04'), c05 = mods.find(m => m.id === 'C05');
  check('C 04 and C 05 are both registered, with their exercises intact',
        !!c04 && c04.ex === 6 && !!c05 && c05.ex === 9, JSON.stringify(mods));
  check('C 04 still has 6 exercises and 10 foundations',
        mods[0].id === 'C04' && mods[0].ex === 6 && mods[0].found === 10, JSON.stringify(mods[0]));
  check('C 05 has 9 exercises, 10 foundations, 6 practice problems and 20 bugs',
        mods[1].id === 'C05' && mods[1].ex === 9 && mods[1].found === 10 &&
        mods[1].prac === 6 && mods[1].bugs === 20, JSON.stringify(mods[1]));
  const menu = await page.evaluate(() => {
    document.body.click(); document.querySelector('#mLearn').click();
    return [...document.querySelectorAll('#menuPop .menu-item')].map(x => x.textContent.trim());
  });
  check('the existing Learn menu lists C 05', menu.some(x => /C 05 —/.test(x)),
        menu.filter(x => /C 0[45]/.test(x)).length + ' course entries');
  for (const id of Object.keys(SUBJECT))
    check('the menu links straight to C 05 ' + id, menu.some(x => x.indexOf(id) >= 0));
  const opened = await page.evaluate(() => {
    document.body.click(); document.querySelector('#mLearn').click();
    [...document.querySelectorAll('#menuPop .menu-item')].find(x => /C 05 —/.test(x.textContent)).click();
    return { view: ui.view, mod: c4.mod, page: c4.page,
             learn: getComputedStyle(document.querySelector('#learnRoot')).display };
  });
  await sleep(300);
  check('choosing it opens the Learn view on C 05',
        opened.view === 'learn' && opened.mod === 'C05' && opened.learn === 'block', JSON.stringify(opened));
  await go('overview', 'C05');
  const nav = await page.evaluate(() => ({
    n: document.querySelectorAll('.c4-nav-b').length,
    head: document.querySelector('.c4-nav-h').textContent.trim(),
    sw: [...document.querySelectorAll('.c4-modb')].map(x => x.textContent.trim()),
  }));
  check('the contents rail names C 05 and lists all 22 pages',
        nav.head === 'C 05' && nav.n === 22, nav.head + ' / ' + nav.n);
  /* The switch must offer every registered module — and must certainly offer
     the two courses — rather than a fixed pair. */
  const labels = await page.evaluate(() => learnModules().map(m => m.label));
  check('and the course switch offers every registered module, C 04 and C 05 among them',
        nav.sw.join(',') === labels.join(',') &&
        nav.sw.indexOf('C 04') >= 0 && nav.sw.indexOf('C 05') >= 0,
        nav.sw.join(',') + ' vs registry ' + labels.join(','));
  const switched = await page.evaluate(() => {
    [...document.querySelectorAll('.c4-modb')].find(x => /C 04/.test(x.textContent)).click();
    return { mod: c4.mod, head: document.querySelector('.c4-nav-h').textContent.trim(),
             n: document.querySelectorAll('.c4-nav-b').length };
  });
  await sleep(200);
  check('switching to C 04 shows C 04’s pages', switched.mod === 'C04' && switched.head === 'C 04' &&
        switched.n === 19, JSON.stringify(switched));

  /* ================= SUBJECT FIDELITY ================= */
  console.log('\n== the official subject, exactly as the PDF states it ==');
  for (const id of Object.keys(SUBJECT)) {
    await go('ex:' + id, 'C05', 'subject');
    const got = await page.evaluate(() => {
      const s = document.querySelector('.c4-subject');
      const rows = {};
      for (const tr of s.querySelectorAll('.c4-subj-t tr'))
        rows[tr.querySelector('th').textContent.trim()] = tr.querySelector('td').textContent.trim();
      return { dir: rows['Turn-in directory'], file: rows['Files to turn in'],
               allowed: rows['Allowed functions'], proto: s.querySelector('.c4-proto').textContent,
               badge: s.querySelector('.c4-badge').textContent.trim(),
               src: s.querySelector('.c4-subj-src').textContent,
               tip: (s.querySelector('.c4-subj-tip') || {}).textContent || null,
               all: s.textContent };
    });
    const w = SUBJECT[id];
    check(id + ': turn-in directory', got.dir === w.dir, got.dir);
    check(id + ': file to turn in', got.file === w.file, got.file);
    check(id + ': allowed functions', got.allowed === w.allowed, got.allowed + ' vs ' + w.allowed);
    check(id + ': prototype, character for character', got.proto === w.proto, JSON.stringify(got.proto));
    check(id + ': labelled OFFICIAL SUBJECT', got.badge === 'OFFICIAL SUBJECT');
    check(id + ': names C 05 version 7 and its chapter',
          /C Piscine C 05, version 7/.test(got.src) && got.src.indexOf(w.chapter) >= 0, got.src);
    if (w.tip) check(id + ': the tip box is shown as a tip box, not a bullet',
                     got.tip && got.tip.indexOf(w.tip) >= 0, got.tip);
    for (const ph of (PHRASES[id] || []))
      check(id + ': quotes “' + ph.slice(0, 42) + '…”', got.all.indexOf(ph) >= 0);
  }
  check('only ex08 has an allowed function; the other eight say None',
        await page.evaluate(() => C05_EX.filter(e => e.official.allowed !== 'None')
          .map(e => e.id + ':' + e.official.allowed).join(',')) === 'ex08:write');

  console.log('\n== the wording differences the subject really has ==');
  const wording = await page.evaluate(() => ({
    ex02: C05_EX.find(e => e.id === 'ex02').official.bullets.find(b => /Overflow/.test(b)),
    ex03: C05_EX.find(e => e.id === 'ex03').official.bullets.find(b => /Overflow/.test(b)),
  }));
  check('ex02 says only “Overflows do not need to be handled.”',
        wording.ex02 === 'Overflows do not need to be handled.', wording.ex02);
  check('ex03 adds the undefined-return clause, and the page keeps them apart',
        /undefined in such cases/.test(wording.ex03) && wording.ex02 !== wording.ex03, wording.ex03);

  console.log('\n== where the subject is silent, the page says so ==');
  const gaps = await page.evaluate(() => {
    const out = {};
    for (const e of C05_EX) out[e.id] = (e.teaching.notSpecified || []).length;
    return out;
  });
  check('ex00 and ex01 record that “not valid” is never defined',
        gaps.ex00 > 0 && gaps.ex01 > 0, JSON.stringify(gaps));
  check('ex05 records the unstated negative and zero cases', gaps.ex05 > 0);
  check('ex06 records the unstated negative case', gaps.ex06 > 0);
  check('ex07 records the unstated below-2 case', gaps.ex07 > 0);
  await go('ex:ex00', 'C05', 'subject');
  const unspec = await page.evaluate(() => {
    const w = document.querySelector('.c4-unspec');
    return w ? { badge: w.querySelector('.c4-badge').textContent.trim(),
                 text: w.textContent.replace(/\s+/g, ' ') } : null;
  });
  check('and they are labelled NOT SPECIFIED BY THE SUBJECT',
        unspec && unspec.badge === 'NOT SPECIFIED BY THE SUBJECT', unspec && unspec.badge);
  check('with the point that it is the learner’s decision, not a requirement',
        unspec && /your decision/.test(unspec.text));
  check('that label is distinct from NOT IN THE SUBJECT',
        SHIPPED.indexOf('NOT SPECIFIED BY THE SUBJECT') > 0 &&
        SHIPPED.indexOf('NOT IN THE SUBJECT') > 0);

  /* ================= EVERY EXERCISE EXECUTES ================= */
  console.log('\n== every exercise and every case runs, and the browser agrees with the engine ==');
  for (const id of Object.keys(SUBJECT)) {
    await go('ex:' + id, 'C05', 'trace');
    const cases = await page.evaluate(() => C05_EX.find(e => e.id === c4.page.slice(3)).cases.length);
    const res = [];
    for (let i = 0; i < cases; i++)
      res.push(await page.evaluate((k) => {
        const ex = C05_EX.find(e => e.id === c4.page.slice(3));
        c4.caseIx[ex.id] = k; c4.step = null; renderLearn();
        const cs = ex.cases[k];
        let src = cs.patch ? ex.program.src.split(cs.patch[0]).join(cs.patch[1]) : ex.program.src;
        if (cs.patch2) src = src.split(cs.patch2[0]).join(cs.patch2[1]);
        const r = c4Run(src);
        let val = null;
        if (r.ok) for (let j = r.steps.length - 1; j >= 0 && val === null; j--)
          for (const f of r.steps[j].state.frames) for (const v of f.vars)
            if (ex.program.watch.indexOf(v.name) >= 0 && !v.uninitialized && !v.elements)
              val = v.valueText;
        return { label: cs.label, ok: r.ok, val, steps: r.ok ? r.steps.length : 0, src };
      }, i));
    check(id + ': all ' + cases + ' cases compile and run',
          res.every(r => r.ok && r.steps > 0), res.filter(r => !r.ok).map(r => r.label).join(' | '));
    const bad = res.filter(r => {
      const nr = E.runToCompletion(r.src);
      if (!nr.history) return true;
      let v = null;
      for (let j = nr.history.length - 1; j >= 0 && v === null; j--) {
        const st = nr.history.stateAt(j);
        for (const f of st.frames) for (const x of f.vars)
          if (!x.uninitialized && !x.elements && x.valueText === r.val) v = x.valueText;
      }
      return v === null && r.val !== null;
    });
    check(id + ': the browser’s values match the engine run headlessly',
          bad.length === 0, bad.map(r => r.label).join(' | '));
  }

  console.log('\n== the values the subject legislates ==');
  const V = async (src, name) => {
    const r = E.runToCompletion(src);
    if (!r.history) return null;
    for (let i = r.history.length - 1; i >= 0; i--) {
      const v = r.history.stateAt(i).vars.find(x => x.name === name);
      if (v && !v.uninitialized) return v.valueText;
    }
    return null;
  };
  const caseVal = (id, label) => page.evaluate((a) => {
    const ex = C05_EX.find(e => e.id === a.id);
    const cs = ex.cases.find(c => c.label === a.label);
    if (!cs) return 'no such case';
    let src = cs.patch ? ex.program.src.split(cs.patch[0]).join(cs.patch[1]) : ex.program.src;
    if (cs.patch2) src = src.split(cs.patch2[0]).join(cs.patch2[1]);
    const r = c4Run(src);
    if (!r.ok) return 'failed';
    for (let j = r.steps.length - 1; j >= 0; j--)
      for (const f of r.steps[j].state.frames) for (const v of f.vars)
        if (ex.program.watch.indexOf(v.name) >= 0 && !v.uninitialized && !v.elements) return v.valueText;
    return null;
  }, { id, label });
  check('0 to the power 0 is 1, iteratively — the subject states it',
        await caseVal('ex02', '0^0 — the subject says 1') === '1');
  check('and recursively', await caseVal('ex03', '0^0 — the subject says 1') === '1');
  check('a negative power returns 0', await caseVal('ex02', '2^-3 — negative power') === '0');
  check('fibonacci index 0 is 0, as the subject fixes the sequence',
        await caseVal('ex04', 'index 0') === '0');
  check('fibonacci of a negative index is -1, not 0',
        await caseVal('ex04', 'index -1') === '-1');
  check('ft_sqrt of an irrational root returns 0', await caseVal('ex05', '2 — irrational') === '0');
  check('0 is not prime', await caseVal('ex06', '0 — the subject says not prime') === '0');
  check('1 is not prime', await caseVal('ex06', '1 — the subject says not prime') === '0');
  check('2 is prime', await caseVal('ex06', '2') === '1');
  check('next prime of a prime is itself — greater than OR EQUAL to',
        await caseVal('ex07', '7 — already prime') === '7');

  /* ================= VISUALIZERS ================= */
  console.log('\n== the visualizers, checked against independent engine runs ==');
  await go('f:iter-rec', 'C05');
  const ir = await page.evaluate(() => {
    c4.c5n = 5; renderLearn();
    return [...document.querySelectorAll('.c5-stat')].map(x =>
      x.querySelector('span').textContent + '=' + x.querySelector('b').textContent);
  });
  check('the loop and the recursion both produce 120',
        ir.filter(x => x === 'answer=120').length === 2, ir.join(' '));
  const depths = ir.filter(x => /deepest call stack/.test(x)).map(x => +x.split('=')[1]);
  check('and the recursive one reports a strictly deeper stack',
        depths.length === 2 && depths[1] > depths[0],
        'iterative ' + depths[0] + ' vs recursive ' + depths[1]);

  await go('f:factorial', 'C05');
  for (const [n, want] of [[0, null], [1, '1'], [5, '120'], [12, '479001600']]) {
    const got = await page.evaluate((x) => { c4.c5n = x; renderLearn();
      const e = document.querySelector('.c5-expand'); return e ? e.textContent.trim() : ''; }, n);
    if (want) check(n + '! reads ' + want, got.indexOf('= ' + want) >= 0, got.slice(0, 50));
    else check('0! is described as the empty product', /empty product/.test(got), got);
  }
  const engFact = await V('int\tf(int n)\n{\n\tint\tr;\n\tint\ti;\n\n\tr = 1;\n\ti = 1;\n\twhile (i <= n)\n' +
    '\t{\n\t\tr = r * i;\n\t\ti++;\n\t}\n\treturn (r);\n}\nint\tmain(void)\n{\n\tint\tv;\n\n\tv = f(12);\n\treturn (0);\n}\n', 'v');
  check('and 12! agrees with the engine run headlessly', engFact === '479001600', engFact);

  await go('f:growth', 'C05');
  const grow = await page.evaluate(() => [...document.querySelectorAll('.c4-t tbody tr')].map(r =>
    [...r.children].map(c => c.textContent.trim())));
  check('the growth table marks 12! as fitting and 13! as not',
        grow.find(r => r[0] === '12')[3] === 'fits' &&
        grow.find(r => r[0] === '13')[3].indexOf('outside') >= 0,
        grow.filter(r => r[0] === '12' || r[0] === '13').map(r => r[0] + ':' + r[3]).join(' '));
  check('and 2^30 as fitting, 2^31 as not',
        grow.find(r => r[0] === '2^30')[3] === 'fits' &&
        grow.find(r => r[0] === '2^31')[3].indexOf('outside') >= 0,
        grow.filter(r => /2\^3[01]/.test(r[0])).map(r => r[0] + ':' + r[3]).join(' '));
  const gtext = await page.evaluate(() => document.querySelector('.c4-main').textContent);
  check('overflow is called undefined behaviour, not wrapping',
        /undefined behaviour/i.test(gtext) && /do not say/i.test(gtext));
  check('the subject’s own wording is quoted', /Overflows do not need to be handled/.test(gtext));
  check('and "not required to handle" is separated from "safe"',
        /not a claim that overflow is harmless/.test(gtext));

  await go('f:fib', 'C05');
  const fib = await page.evaluate(() => {
    c4.c5fib = 10; renderLearn();
    return { seq: [...document.querySelectorAll('.c5-seqv')].map(x => x.textContent),
             stats: [...document.querySelectorAll('.c5-stat.big')].map(x =>
               x.querySelector('span').textContent + '=' + x.querySelector('b').textContent) };
  });
  check('the sequence starts 0, 1, 1, 2 exactly as the subject fixes it',
        fib.seq.slice(0, 4).join(',') === '0,1,1,2', fib.seq.slice(0, 6).join(','));
  check('and reaches 55 at index 10', fib.seq[10] === '55', fib.seq.join(' '));
  /* the call count must be the engine's, not a formula */
  const engCalls = (() => {
    const r = E.runToCompletion(
      'int\tfib(int n)\n{\n\tif (n < 0)\n\t\treturn (-1);\n\tif (n == 0)\n\t\treturn (0);\n' +
      '\tif (n == 1)\n\t\treturn (1);\n\treturn (fib(n - 1) + fib(n - 2));\n}\n' +
      'int\tmain(void)\n{\n\tint\tv;\n\n\tv = fib(10);\n\treturn (0);\n}\n');
    let c = 0;
    if (r.history) for (let i = 0; i < r.history.length; i++)
      if (r.history.steps[i].phase === 'call-enter') c++;
    return c;
  })();
  check('the call count is the engine’s own tally',
        fib.stats.some(x => x === 'calls to fib=' + engCalls), fib.stats.join('  ') + ' vs ' + engCalls);
  check('the repeated-work bars are shown',
        await page.evaluate(() => document.querySelectorAll('.c5-hit').length) > 3);
  check('and the simulator limit is stated rather than hidden',
        await page.evaluate(() => !!document.querySelector('.c4-limit')));

  await go('f:sqrt', 'C05');
  for (const [nb, want] of [[144, '12'], [16, '4'], [1, '1']]) {
    const t = await page.evaluate((x) => { c4.c5sq = x; renderLearn();
      return document.querySelector('.c4-verdict').textContent.replace(/\s+/g, ' '); }, nb);
    check('sqrt(' + nb + ') is reported as ' + want, /perfect square/.test(t) && t.indexOf(want) >= 0,
          t.slice(0, 60));
  }
  const sq2 = await page.evaluate(() => { c4.c5sq = 2; renderLearn();
    return document.querySelector('.c4-verdict').textContent.replace(/\s+/g, ' '); });
  check('sqrt(2) is called irrational and returns 0', /irrational/.test(sq2) && /0/.test(sq2), sq2.slice(0, 70));
  const sq0 = await page.evaluate(() => { c4.c5sq = 0; renderLearn();
    return document.querySelector('.c4-verdict').textContent.replace(/\s+/g, ' '); });
  check('sqrt(0) is NOT called irrational — 0 is a perfect square',
        !/its square root is irrational/.test(sq0) && /perfect square/.test(sq0), sq0.slice(0, 80));
  check('and the ambiguity of returning 0 there is named', /does not say which/.test(sq0), sq0.slice(0, 110));

  await go('f:prime', 'C05');
  for (const [nb, prime] of [[0, false], [1, false], [2, true], [9, false], [97, true], [121, false]]) {
    const t = await page.evaluate((x) => { c4.c5pr = x; renderLearn();
      return document.querySelector('.c4-verdict').textContent.replace(/\s+/g, ' '); }, nb);
    const says = prime ? /is <?b?>?prime|is prime/.test(t) : /not prime|below 2/.test(t);
    check(nb + ' is reported ' + (prime ? 'prime' : 'not prime'), says, t.slice(0, 62));
  }
  check('and the subject’s tip about 0 and 1 is quoted on the page',
        /0 and 1 are not prime/.test(await page.evaluate(() => document.querySelector('.c4-main').textContent)));

  await go('f:board', 'C05');
  const board = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.c4-t tbody tr')].map(r =>
      [...r.children].map(c => c.textContent.trim())),
    queens: document.querySelectorAll('.c5-board td.queen').length,
  }));
  check('the board shows one queen per occupied column', board.queens === 3, String(board.queens));
  check('safe() accepted rows 0 and 2 and rejected 1, 3, 4, 5',
        board.rows.map(r => r[0] + ':' + (r[1].indexOf('1') === 0 ? 'ok' : 'no')).join(' ') ===
        '0:ok 1:no 2:ok 3:no 4:no 5:no',
        board.rows.map(r => r[0] + '=' + r[1]).join(' '));

  await go('f:backtrack', 'C05');
  for (const [n, sols] of [[4, 2], [5, 10]]) {
    const q = await page.evaluate((x) => {
      c4.c5qn = x; c4.c5qsol = 0; renderLearn();
      const s = {};
      for (const e of document.querySelectorAll('.c5-stat.big'))
        s[e.querySelector('span').textContent] = e.querySelector('b').textContent;
      return { s, picks: [...document.querySelectorAll('[data-c5qsol]')].map(y => y.textContent) };
    }, n);
    check(n + '×' + n + ' finds ' + sols + ' solutions', q.s['solutions found'] === String(sols),
          JSON.stringify(q.s));
    check('  …and solve() returned the same count', q.s['returned by solve()'] === String(sols),
          q.s['returned by solve()']);
    check('  …with one encoded row string per solution',
          q.picks.length === sols && q.picks.every(p => p.length === n), q.picks.join(' '));
    /* the solutions must be genuinely non-attacking — checked here, not in the app */
    const bad = q.picks.filter(p => {
      const rows = p.split('').map(Number);
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++)
        if (rows[i] === rows[j] || Math.abs(i - j) === Math.abs(rows[i] - rows[j])) return true;
      return false;
    });
    check('  …and every one is genuinely non-attacking', bad.length === 0, bad.join(' '));
  }
  check('the 10×10 limitation is stated rather than faked',
        await page.evaluate(() => {
          const l = document.querySelector('.c4-limit');
          return l ? /10 × 10/.test(l.textContent) && /cannot finish/.test(l.textContent) : false;
        }));
  check('the encoding is explained as the subject describes it',
        /Nth digit is the row of the queen in the Nth column/.test(
          await page.evaluate(() => document.querySelector('.c4-main').textContent)));

  /* ================= LESSON STRUCTURE ================= */
  console.log('\n== every exercise has the required sections ==');
  for (const id of Object.keys(SUBJECT)) {
    await go('ex:' + id, 'C05', 'understand');
    const r = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('.c4-block-h')].map(x => x.textContent.trim());
      const th = [...document.querySelectorAll('.c4-fl th')].find(x => /allowed functions/i.test(x.textContent));
      return { blocks, levels: document.querySelectorAll('.c4-algo').length,
               one: (document.querySelector('.c4-algo-one') || {}).textContent || '',
               skeleton: (document.querySelector('.c4-pre') || {}).textContent || '',
               steps: document.querySelectorAll('.c4-algo-l li').length,
               giopvc: [...document.querySelectorAll('.c4-g-l')].map(x => x.textContent).join(''),
               giopvcNames: [...document.querySelectorAll('.c4-g-n')].map(x => x.textContent).join(','),
               allowed: th ? th.nextElementSibling.textContent.trim() : null,
               mistakes: document.querySelectorAll('.c4-mist').length };
    });
    check(id + ' leads with the algorithm in three sizes',
          r.blocks[0] === 'The algorithm, in three sizes' && r.levels === 3, r.blocks[0] + ' / ' + r.levels);
    check(id + ' states it in one sentence first', r.one.length > 20, r.one.slice(0, 46));
    check(id + ' then in plain words, then as a skeleton',
          r.steps >= 3 && r.skeleton.split('\n').length >= 3, r.steps + ' steps');
    check(id + ' has Functions & libraries, quoting the subject',
          r.blocks[1] === 'Functions & libraries' && r.allowed === SUBJECT[id].allowed, r.allowed);
    /* All nine steps the acronym names, Code last. This used to require the
       eight letters the panel happened to render, which is how the missing Code
       row survived under a heading that promises it. */
    check(id + ' covers all of GIOPVC-LAC', r.giopvc === 'GIOPVCLAC', r.giopvc);
    check(id + ' names each step, ending with Code',
          r.giopvcNames === 'Goal,Input,Output,Prototype,Variables,Conditions,Loop,Algorithm,Code',
          r.giopvcNames);
    check(id + ' lists common mistakes', r.mistakes >= 3, r.mistakes + ' mistakes');
    check(id + ' has exam traps, a pattern and a takeaway',
          r.blocks.indexOf('Exam traps') > 0 && r.blocks.indexOf('Pattern recognition') > 0 &&
          r.blocks.indexOf('Key takeaway') > 0, r.blocks.join(' | '));
    await go('ex:' + id, 'C05', 'practice');
    check(id + ' has code-reading questions',
          await page.evaluate(() => document.querySelectorAll('.c4-q').length) >= 2);
  }
  check('ex08 marks write as allowed, the only exercise that does',
        await page.evaluate(() => { showLearn('ex:ex08', 'C05'); c4.tab = 'understand'; renderLearn();
          return [...document.querySelectorAll('.c4-flr')].map(x =>
            x.querySelector('b').textContent + (x.classList.contains('yes') ? ':ok' : ':no')).join(','); })
        === 'write:ok');

  console.log('\n== practice and the bug database ==');
  await go('practice', 'C05');
  const prac = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.c4-prac-h .mono')].map(x => x.textContent.trim()),
    open: document.querySelectorAll('.c4-prac details[open]').length,
    text: document.querySelector('.c4-main').textContent,
  }));
  check('six practice problems', prac.names.length === 6, prac.names.join(' '));
  check('nothing is expanded by default — reasoning first', prac.open === 0);
  check('no C solution body is printed', !/while \(|return \(|int\s+i;/.test(prac.text));
  await go('bugs', 'C05');
  const bugs = await page.evaluate(() => ({
    n: document.querySelectorAll('.c4-bug').length,
    rows: document.querySelectorAll('.c4-bug')[0].querySelectorAll('.c4-bug-r').length,
    text: document.querySelector('.c4-main').textContent,
  }));
  check('twenty bugs, each with four parts', bugs.n === 20 && bugs.rows === 4, bugs.n + ' / ' + bugs.rows);
  for (const t of ['No base case', 'wrong way', 'Fibonacci', 'only rows', 'not counting', 'wraps'])
    check('the bug list covers “' + t + '”', bugs.text.indexOf(t) >= 0);

  /* ================= THE FOOTER ================= */
  console.log('\n== the status bar holds its shape across every state ==');
  const READ = () => {
    const bar = document.querySelector('.statusbar');
    const r = bar.getBoundingClientRect();
    const f = {};
    for (const id of ['sbStatus', 'sbFn', 'sbLine', 'sbStep']) {
      const e = document.querySelector('#' + id);
      f[id] = e ? { t: e.textContent, x: Math.round(e.getBoundingClientRect().left) } : null;
    }
    return { h: Math.round(r.height), top: Math.round(r.top), f };
  };
  const states = {};
  await page.evaluate(() => { showWorkspace(); switchToEditing();
    document.querySelector('#sourceEdit').value = ''; if (typeof resetAll === 'function') resetAll(); });
  await sleep(300); states.A = await page.evaluate(READ);
  await page.evaluate(() => loadExample('ex1')); await sleep(300); states.B = await page.evaluate(READ);
  await page.evaluate(() => { doStep(); doStep(); doStep(); }); await sleep(300); states.C = await page.evaluate(READ);
  check('the bar is the same height in all three states',
        states.A.h === states.B.h && states.B.h === states.C.h && states.A.h === 26,
        [states.A.h, states.B.h, states.C.h].join(' / '));
  check('and sits in the same place',
        states.A.top === states.B.top && states.B.top === states.C.top);
  for (const id of ['sbStatus', 'sbFn', 'sbLine', 'sbStep'])
    check(id + ' never moves between states',
          states.A.f[id].x === states.B.f[id].x && states.B.f[id].x === states.C.f[id].x,
          [states.A.f[id].x, states.B.f[id].x, states.C.f[id].x].join(' / '));
  for (const id of ['sbFn', 'sbLine', 'sbStep'])
    check(id + ' shows an em dash rather than blank or undefined when there is nothing to show',
          states.A.f[id].t === '—' && states.B.f[id].t === '—',
          JSON.stringify(states.A.f[id].t) + ' / ' + JSON.stringify(states.B.f[id].t));
  check('mid-execution the fields carry real values',
        states.C.f.sbFn.t === 'main()' && /\d/.test(states.C.f.sbLine.t) &&
        /\d \/ \d/.test(states.C.f.sbStep.t), JSON.stringify(states.C.f));
  check('no field ever renders undefined, null or NaN',
        [states.A, states.B, states.C].every(s =>
          Object.values(s.f).every(v => !/undefined|null|NaN/.test(v.t))));
  /* The shell must give its flexible track to the WORKSPACE, not to the status
     bar. When the track list declared four tracks for three children they lined
     up one place out: .main landed in a content-sized auto track and the bar got
     the 1fr. Nothing looked wrong until .main's content became shorter than the
     viewport — dock closed, editor empty — at which point .main shrank and the
     footer rose with it, leaving a gap beneath. */
  const grid = await page.evaluate(() => {
    const sh = document.querySelector('.shell');
    return { kids: sh.children.length,
             tracks: getComputedStyle(sh).gridTemplateRows.split(/\s+/).filter(Boolean).length };
  });
  check('the shell declares exactly one track per child',
        grid.kids === grid.tracks, grid.tracks + ' tracks for ' + grid.kids + ' children');
  check('and the workspace, not the status bar, holds the flexible one',
        await page.evaluate(() => {
          const sh = document.querySelector('.shell');
          const t = getComputedStyle(sh).gridTemplateRows.split(/\s+/).filter(Boolean).map(parseFloat);
          const main = document.querySelector('.main').getBoundingClientRect().height;
          return Math.abs(t[1] - main) < 2 && t[1] > t[0] && t[1] > t[2];
        }));

  const anchored = [];
  let reachedCollapsed = false;
  await page.setViewport({ width: 1400, height: 1600 });
  for (const dock of [false, true]) {
    await page.evaluate((closed) => {
      showWorkspace(); switchToEditing();
      if (!!ui.dockCollapsed !== closed) toggleDock();
    }, dock);
    await sleep(340);
    const got = await page.evaluate(() => !!ui.dockCollapsed);
    if (dock && got) reachedCollapsed = true;
    for (const [label, val] of [['100 lines', Array.from({ length: 100 }, (_, i) => 'int\tx' + i + ';').join('\n')],
                                ['10 lines', Array.from({ length: 10 }, (_, i) => 'int\tx' + i + ';').join('\n')],
                                ['1 line', 'int\tmain(void)'],
                                ['1 empty line', '\n'],
                                ['completely empty', '']]) {
      await page.evaluate((v) => {
        const e = document.querySelector('#sourceEdit');
        e.value = v; e.dispatchEvent(new Event('input', { bubbles: true }));
      }, val);
      await sleep(150);
      const m = await page.evaluate(() => {
        const r = document.querySelector('.statusbar').getBoundingClientRect();
        return { bottom: Math.round(r.bottom), gap: window.innerHeight - Math.round(r.bottom),
                 collapsed: !!ui.dockCollapsed };
      });
      anchored.push({ dock: m.collapsed ? 'closed' : 'open', label, bottom: m.bottom, gap: m.gap });
    }
  }
  check('the check reached the state that triggers the bug (dock collapsed)',
        reachedCollapsed && anchored.some(x => x.dock === 'closed'),
        anchored.map(x => x.dock).filter((v, i, s2) => s2.indexOf(v) === i).join('/'));
  check('the footer sits flush against the bottom in every source state, dock open or closed',
        anchored.every(x => x.gap === 0),
        anchored.filter(x => x.gap !== 0).map(x => x.dock + '/' + x.label + ' gap=' + x.gap).join(' ') ||
        'all ' + anchored.length + ' states flush at 1400×1600');
  check('and never moves as the source length changes',
        new Set(anchored.map(x => x.bottom)).size === 1,
        [...new Set(anchored.map(x => x.bottom))].join(' / '));
  await page.evaluate(() => { if (ui.dockCollapsed) toggleDock(); });
  await page.setViewport({ width: 1500, height: 1050 });
  await sleep(300);

  const trace = await page.evaluate(() => {
    setDockTab('trace');
    if (typeof loadTraceDemo === 'function') loadTraceDemo();
    if (typeof renderTrace === 'function') renderTrace();
    return document.querySelector('#sbStep').textContent;
  });
  check('the trace writer also falls back rather than printing NaN',
        !/NaN|undefined/.test(trace), JSON.stringify(trace));
  check('the fallback is in the code, not only in the markup',
        (SHIPPED.match(/sbStep'\)\.textContent = \(trc/g) || []).length === 0 ||
        /trc && typeof trc\.index === 'number'/.test(SHIPPED));

  /* ================= C04 REGRESSION ================= */
  console.log('\n== C 04 is unchanged ==');
  await go('ex:ex04', 'C04', 'trace');
  check('83 in "poneyvif" still prints "one"',
        await page.evaluate(() => c4Run(C04_EX.find(e => e.id === 'ex04').program.src).output) === 'one');
  await go('ex:ex03', 'C04', 'visualize');
  const phases = await page.evaluate(() => {
    c4.atoi = '   ---+--+1234ab567'; renderLearn();
    const cells = [...document.querySelectorAll('.c4-tc')];
    return [1, 2, 3].map(p => cells.filter(c => c.classList.contains('p' + p)).length);
  });
  check('the ft_atoi tape still reads 3 / 7 / 4', phases.join(',') === '3,7,4', phases.join(','));
  for (const [id, want] of [['ex00', 'A string and an integer'], ['ex02', 'Divide and take'],
                            ['ex04', 'The base is a string'], ['ex05', 'The same idea, in any base']]) {
    await go('ex:' + id, 'C04', 'visualize');
    const first = await page.evaluate(() =>
      (document.querySelector('.c4-block-h') || {}).textContent || '');
    check('C 04 ' + id + ' still opens with “' + want + '…”', first.indexOf(want) === 0, first.slice(0, 40));
  }
  await go('f:whitespace', 'C04');
  check('C 04 foundation visualizers still render',
        await page.evaluate(() => document.querySelectorAll('.c4-ram tbody tr').length) > 3);
  await page.evaluate(() => openLabTab('repro'));
  await sleep(350);
  check('the labs still work', await page.evaluate(() => reproRun().steps.length) === 30);
  await page.evaluate(() => openLabTab('ascii'));
  await sleep(280);
  const align = await page.evaluate(() => {
    const th = [...document.querySelectorAll('.vl-table thead th')];
    const row = document.querySelector('.vl-table tbody tr.vl-row');
    if (!th.length || !row) return { err: 'missing' };
    return { drift: Math.max(...th.map((h, i) =>
      Math.abs(h.getBoundingClientRect().left - [...row.children][i].getBoundingClientRect().left))) };
  });
  check('no C 05 CSS leaked into the lab tables', !align.err && align.drift < 1,
        align.err || align.drift.toFixed(2) + 'px');

  /* ================= RESPONSIVE + A11Y ================= */
  console.log('\n== responsive and reachable ==');
  for (const w of [1500, 1024, 768, 420]) {
    await page.setViewport({ width: w, height: 900 });
    const bad = [];
    for (const k of ['overview', 'f:iter-rec', 'f:fib', 'f:board', 'f:backtrack', 'f:growth',
                     'ex:ex08', 'practice', 'bugs']) {
      await page.evaluate(x => { showLearn(x, 'C05');
        if (x.indexOf('ex:') === 0) { c4.tab = 'visualize'; renderLearn(); } }, k);
      await sleep(130);
      const r = await page.evaluate(() => {
        const de = document.documentElement;
        return { over: de.scrollWidth > de.clientWidth + 1,
          clip: [...document.querySelectorAll('#learnRoot *')].filter(e => {
            if (e.getBoundingClientRect().right <= de.clientWidth + 2) return false;
            for (let a = e.parentElement; a; a = a.parentElement) {
              const o = getComputedStyle(a).overflowX;
              if (o === 'auto' || o === 'scroll') return false;
            } return true; }).length };
      });
      if (r.over || r.clip) bad.push(k + '(over=' + r.over + ',clip=' + r.clip + ')');
    }
    check('at ' + w + 'px every C 05 page fits', bad.length === 0, bad.join(' '));
  }
  await page.setViewport({ width: 1500, height: 1050 });
  await go('f:backtrack', 'C05');
  const a11y = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#learnRoot button')];
    const inputs = [...document.querySelectorAll('#learnRoot input')];
    const first = document.querySelector('.c4-modb');
    first.focus();
    return { unl: btns.filter(x => !(x.textContent || '').trim() && !x.getAttribute('aria-label')).length,
             unlIn: inputs.filter(x => !x.getAttribute('aria-label') &&
               !document.querySelector('label[for="' + x.id + '"]')).length,
             focus: document.activeElement === first && first.matches(':focus-visible'),
             group: !!document.querySelector('.c4-modsw[role="group"]') };
  });
  check('every C 05 control is labelled', a11y.unl === 0 && a11y.unlIn === 0,
        a11y.unl + ' / ' + a11y.unlIn);
  check('the course switch takes focus and shows it', a11y.focus);
  check('and is announced as a group', a11y.group);
  check('the board conveys queens by glyph, not colour alone',
        await page.evaluate(() => [...document.querySelectorAll('.c5-board td.queen')]
          .every(t => t.textContent.trim().length > 0)));

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await go('f:backtrack', 'C05');
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p29_c05.png'), fullPage: true });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('C 05  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
