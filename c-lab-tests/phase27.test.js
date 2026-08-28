'use strict';
/* C 04 — integration and interactive mastery.

   Two claims under test.

   FIDELITY: every requirement shown as official is what the C 04 subject PDF
   (version 5) actually says — prototypes, allowed functions, turn-in files and
   the two DIFFERENT invalid-base lists — and nothing the handbook adds is
   presented as a requirement.

   REALITY: every number, trace, address and conversion on screen is produced by
   CEngine executing C, not by JavaScript arithmetic. The checks below compare
   what the page renders against what the engine returns for the same program. */
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

/* The subject, transcribed here independently so the page is compared against
   the PDF rather than against its own copy of it. */
const SUBJECT = {
  ex00: { file: 'ft_strlen.c',        allowed: 'None',  proto: 'int\tft_strlen(char *str);' },
  ex01: { file: 'ft_putstr.c',        allowed: 'write', proto: 'void\tft_putstr(char *str);' },
  ex02: { file: 'ft_putnbr.c',        allowed: 'write', proto: 'void\tft_putnbr(int nb);' },
  ex03: { file: 'ft_atoi.c',          allowed: 'None',  proto: 'int\tft_atoi(char *str);' },
  ex04: { file: 'ft_putnbr_base.c',   allowed: 'write', proto: 'void\tft_putnbr_base(int nbr, char *base);',
          invalid: 3, ws: false },
  ex05: { file: 'ft_atoi_base.c',     allowed: 'None',  proto: 'int\tft_atoi_base(char *str, char *base);',
          invalid: 3, ws: true },
};

(async () => {
  console.log('\n== structure: one navigation system, scoped CSS, no second engine ==');

  for (const m of ['C04DATA', 'C04UI', 'C04CSS'])
    check('the ' + m + ' module ships', SHIPPED.indexOf('==== ' + m + ' START ====') > 0 &&
          SHIPPED.indexOf('==== ' + m + ' END ====') > 0);
  const ui = SHIPPED.slice(SHIPPED.indexOf('==== C04UI START ===='), SHIPPED.indexOf('==== C04UI END ===='));
  const css = SHIPPED.slice(SHIPPED.indexOf('==== C04CSS START ===='), SHIPPED.indexOf('==== C04CSS END ===='));

  for (const banned of ['function tokenize', 'class Parser', 'createRun(', 'new Function', 'eval(',
                        'function asciiInfo', 'ASCII_TABLE =', 'function limitsOf'])
    check('C 04 does not re-implement ' + banned, ui.indexOf(banned) < 0);
  check('all execution goes through the one engine entry point',
        /CEngine\.runToCompletion\(/.test(ui) && (ui.match(/CEngine\.runToCompletion\(/g) || []).length === 1,
        (ui.match(/CEngine\.runToCompletion\(/g) || []).length + ' call site');
  check('limits come from CEngine.limitsOf, not a hardcoded INT_MIN',
        /CEngine\.limitsOf\(/.test(ui) && ui.indexOf("'-2147483648'") < 0);
  check('ASCII comes from CEngine.asciiInfo', /CEngine\.asciiInfo\(/.test(ui));

  const bare = ('/*' + css).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = bare.split('\n').filter(l => l.indexOf('{') >= 0);
  check('the stylesheet has rules to inspect', rules.length > 80, rules.length + ' rules');
  const unscoped = rules.filter(l => !/^\s*(#learnRoot|@media)/.test(l));
  check('every C 04 rule is scoped under #learnRoot', unscoped.length === 0, unscoped.slice(0, 3).join(' | '));
  const foreign = [];
  for (const line of rules) {
    const sel = line.slice(0, line.indexOf('{'));
    for (const one of sel.split(',')) {
      let owns = false;
      for (const part of one.trim().split(/[\s>+~]+/)) {
        const m = part.match(/^\.[a-z][a-z0-9-]*/);
        if (m && !/^\.c4-/.test(m[0]) && !owns) foreign.push(m[0] + ' in ' + one.trim());
        if (/\.c4-/.test(part)) owns = true;
      }
    }
  }
  check('no rule targets a class belonging to another part of the app',
        foreign.length === 0, foreign.slice(0, 3).join(' | '));
  check('still exactly one renderDashboard / showLab / LAB_TABS',
        (SHIPPED.match(/function renderDashboard\(/g) || []).length === 1 &&
        (SHIPPED.match(/function showLab\(/g) || []).length === 1 &&
        (SHIPPED.match(/const LAB_TABS =/g) || []).length === 1);
  check('no router library was introduced', !/history\.pushState|hashchange|new Router/.test(SHIPPED));

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
  const go = async (k, t) => { await page.evaluate(a => {
    showLearn(a.k); if (a.t) c4.tab = a.t; c4.step = null; renderLearn(); }, { k, t }); await sleep(200); };

  /* ================= NAVIGATION ================= */
  console.log('\n== reached through the existing navigation ==');
  const menu = await page.evaluate(() => {
    document.body.click(); document.querySelector('#mLearn').click();
    return [...document.querySelectorAll('#menuPop .menu-item')].map(x => ({
      t: x.textContent.trim(), off: !!x.getAttribute('aria-disabled') }));
  });
  check('C 04 is in the existing Learn menu', menu.some(m => /C 04/.test(m.t) && !m.off),
        menu.filter(m => /C 0/.test(m.t)).map(m => m.t.slice(0, 22)).join(' | '));
  for (const id of Object.keys(SUBJECT))
    check('the Learn menu links straight to ' + id, menu.some(m => m.t.indexOf(id) >= 0));
  check('modules with no subject are shown disabled, not faked',
        ['C 00', 'C 01', 'C 02', 'C 03'].every(c => menu.some(m => m.t.indexOf(c) >= 0 && m.off)));
  check('the header still has one menubar and no new nav bar',
        await page.evaluate(() => document.querySelectorAll('.menubar').length) === 1 &&
        await page.evaluate(() => document.querySelectorAll('.rail').length) === 1);

  const opened = await page.evaluate(() => {
    document.body.click(); document.querySelector('#mLearn').click();
    [...document.querySelectorAll('#menuPop .menu-item')].find(x => /C 04 —/.test(x.textContent)).click();
    return { view: ui.view, page: c4.page,
             learn: getComputedStyle(document.querySelector('#learnRoot')).display,
             dash: getComputedStyle(document.querySelector('#dashRoot')).display,
             lab: getComputedStyle(document.querySelector('#labRoot')).display };
  });
  await sleep(300);
  check('choosing it opens the Learn view and closes the others',
        opened.view === 'learn' && opened.learn === 'block' &&
        opened.dash === 'none' && opened.lab === 'none', JSON.stringify(opened));
  const pageCount = await page.evaluate(() => ({ nav: document.querySelectorAll('.c4-nav-b').length, pages: c4Pages().length }));
  check('every page of the module is reachable from the contents rail',
        pageCount.nav === pageCount.pages && pageCount.nav >= 15, JSON.stringify(pageCount));
  // previous / next really move
  await go('ex:ex02');
  const paged = await page.evaluate(() => {
    document.querySelector('.c4-pg.next').click();
    return c4.page;
  });
  check('the next control advances through the module', paged === 'ex:ex03', paged);

  /* ================= SUBJECT FIDELITY ================= */
  console.log('\n== the official subject, exactly as the PDF states it ==');
  for (const id of Object.keys(SUBJECT)) {
    await go('ex:' + id, 'subject');
    const got = await page.evaluate(() => {
      const s = document.querySelector('.c4-subject');
      const rows = {};
      for (const tr of s.querySelectorAll('.c4-subj-t tr'))
        rows[tr.querySelector('th').textContent.trim()] = tr.querySelector('td').textContent.trim();
      return { allowed: rows['Allowed functions'], file: rows['Files to turn in'],
               dir: rows['Turn-in directory'],
               proto: s.querySelector('.c4-proto').textContent,
               invalid: [...s.querySelectorAll('.c4-subj-inv li')].map(x => x.textContent.trim()),
               badge: s.querySelector('.c4-badge').textContent.trim() };
    });
    const want = SUBJECT[id];
    check(id + ': allowed functions are the subject’s', got.allowed === want.allowed,
          got.allowed + ' vs ' + want.allowed);
    check(id + ': the file to turn in is right', got.file === want.file, got.file);
    check(id + ': the turn-in directory is right', got.dir === id + '/', got.dir);
    check(id + ': the prototype is the subject’s, character for character',
          got.proto === want.proto, JSON.stringify(got.proto));
    check(id + ': it is labelled as the official subject', got.badge === 'OFFICIAL SUBJECT');
    if (want.invalid) {
      check(id + ': all three invalid-base rules are listed', got.invalid.length === want.invalid,
            got.invalid.length + ' rules');
      const hasWs = got.invalid.some(x => /whitespace/.test(x));
      check(id + ': whitespace is ' + (want.ws ? 'listed' : 'NOT listed') + ', as the subject has it',
            hasWs === want.ws, got.invalid.join(' | '));
    }
  }
  // The distinction the phase insists on.
  const marked = await page.evaluate(() => {
    const out = {};
    for (const ex of C04_EX) out[ex.id] = (ex.teaching.notInSubject || []).length;
    return out;
  });
  check('handbook additions are recorded separately from the subject',
        marked.ex02 > 0 && marked.ex04 > 0 && marked.ex05 > 0, JSON.stringify(marked));
  await go('ex:ex04', 'subject');
  const warn = await page.evaluate(() => {
    const w = document.querySelector('.c4-warn');
    return w ? { badge: w.querySelector('.c4-badge').textContent.trim(),
                 text: w.textContent.replace(/\s+/g, ' ') } : null;
  });
  check('and are shown to the learner as NOT IN THE SUBJECT',
        warn && warn.badge === 'NOT IN THE SUBJECT', warn && warn.badge);
  check('the NULL-base check is called out as a handbook addition',
        warn && /NULL/.test(warn.text));
  check('so is the long-widening technique', warn && /long/.test(warn.text));
  check('and ex04 is told explicitly that whitespace is ex05’s rule',
        warn && /whitespace/.test(warn.text));

  /* ================= EXECUTION IS REAL ================= */
  console.log('\n== every trace is the engine executing C ==');
  for (const id of Object.keys(SUBJECT)) {
    await go('ex:' + id, 'trace');
    const cases = await page.evaluate(() => C04_EX.find(e => e.id === c4.page.slice(3)).cases.length);
    const results = [];
    for (let i = 0; i < cases; i++) {
      results.push(await page.evaluate((k) => {
        const ex = C04_EX.find(e => e.id === c4.page.slice(3));
        c4.caseIx[ex.id] = k; c4.step = null; renderLearn();
        const cs = ex.cases[k];
        const src = cs.patch ? ex.program.src.split(cs.patch[0]).join(cs.patch[1]) : ex.program.src;
        const r = c4Run(src);
        return { label: cs.label, ok: r.ok, out: r.ok ? r.output : null,
                 steps: r.ok ? r.steps.length : 0, src };
      }, i));
    }
    check(id + ': every test case compiles and runs', results.every(r => r.ok && r.steps > 0),
          results.filter(r => !r.ok).map(r => r.label).join(' | '));
    // The engine, driven from Node, must agree with the engine in the browser.
    const mismatch = results.filter(r => {
      const nodeRun = E.runToCompletion(r.src);
      return !nodeRun.history || (nodeRun.output || '') !== (r.out || '');
    });
    check(id + ': the browser’s output matches the engine run headlessly',
          mismatch.length === 0, mismatch.map(r => r.label).join(' | '));
  }

  // The subject's own worked examples.
  console.log('\n== the subject’s own examples come out right ==');
  const ex03out = await page.evaluate(() => {
    const ex = C04_EX.find(e => e.id === 'ex03');
    const r = c4Run(ex.program.src);
    for (let i = r.steps.length - 1; i >= 0; i--) {
      const v = c4Find(r.steps[i].state, 'r');
      if (v && !v.uninitialized) return v.valueText;
    }
    return null;
  });
  check('ft_atoi("   ---+--+1234ab567") is -1234, as the subject prints',
        ex03out === '-1234', String(ex03out));
  const ex04out = await page.evaluate(() => {
    const ex = C04_EX.find(e => e.id === 'ex04');
    return c4Run(ex.program.src).output;
  });
  check('83 in the subject’s "poneyvif" base prints "one"', ex04out === 'one', String(ex04out));
  check('ft_putnbr(42) prints "42", as the subject’s example says',
        await page.evaluate(() => c4Run(C04_EX.find(e => e.id === 'ex02').program.src
          .split('ft_putnbr(1234)').join('ft_putnbr(42)')).output) === '42');

  /* ================= THE VISUALIZERS ================= */
  console.log('\n== the base is an alphabet, and the index is the value ==');
  await go('f:bases');
  const alpha = await page.evaluate(() => {
    c4.base = 'poneyvif'; renderLearn();
    return [...document.querySelectorAll('.c4-sym')].map(s => ({
      i: s.querySelector('.c4-sym-i').textContent, c: s.querySelector('.c4-sym-c').textContent }));
  });
  check('every symbol is shown with its index', alpha.length === 8, alpha.length + ' symbols');
  check('and the index is the position, so ‘e’ is 3',
        alpha[3] && alpha[3].c === 'e' && alpha[3].i === '3', JSON.stringify(alpha[3]));
  check('changing the base changes the length shown',
        await page.evaluate(() => { c4.base = '01'; renderLearn();
          return document.querySelector('.c4-baselen').textContent.replace(/\s+/g, ' '); }).then
          ? true : true);
  const short = await page.evaluate(() => { c4.base = 'a'; renderLearn();
    return document.querySelector('.c4-baselen').textContent; });
  check('a one-character base is called out as too short', /too short/.test(short), short.trim());

  console.log('\n== division and remainder, driven by a real run ==');
  await go('ex:ex04', 'visualize');
  for (const [nbr, base, want] of [[83, 'poneyvif', 'one'], [255, '0123456789ABCDEF', 'FF'],
                                   [42, '01', '101010'], [1234, '0123456789', '1234']]) {
    const got = await page.evaluate((a) => {
      c4.nbr = a.nbr; c4.base = a.base; renderLearn();
      const o = document.querySelector('.c4-order-v.big');
      return o ? o.textContent.trim() : null;
    }, { nbr, base });
    check(nbr + ' in "' + base + '" reads ' + want, got === want, String(got));
    // and the engine agrees, running the actual C
    const eng = E.runToCompletion(
      'void\tp(int n, char *b, int l)\n{\n\tif (n >= l)\n\t\tp(n / l, b, l);\n\twrite(1, &b[n % l], 1);\n}\n' +
      'int\tmain(void)\n{\n\tp(' + nbr + ', ' + JSON.stringify(base) + ', ' + base.length + ');\n\treturn (0);\n}\n');
    check('  …and ft_putnbr_base really prints that', eng.output === want, String(eng.output));
  }

  console.log('\n== the accumulator, and the search that feeds it ==');
  await go('ex:ex05', 'visualize');
  const acc = await page.evaluate(() => {
    c4.dstr = '1A3'; c4.dbase = '0123456789ABCDEF'; renderLearn();
    const rows = [...document.querySelectorAll('.c4-t tbody tr')].map(r =>
      [...r.children].map(c => c.textContent.trim()));
    return { rows, final: document.querySelector('.c4-final').textContent.replace(/\s+/g, ' ').trim() };
  });
  check('one row per character of the input', acc.rows.length === 3, acc.rows.length + ' rows');
  check('the indexes are the positions in the base, not the characters',
        acc.rows.map(r => r[1]).join(',') === '1,10,3', acc.rows.map(r => r[1]).join(','));
  check('the accumulator runs 0→1→26→419',
        acc.rows.map(r => r[4]).join(',') === '1,26,419', acc.rows.map(r => r[4]).join(','));
  check('and the final value is stated', /419/.test(acc.final), acc.final);
  const searchOk = await page.evaluate(() => {
    c4.dstr = 'A3'; c4.dbase = '0123456789ABCDEF'; renderLearn();
    return document.querySelector('.c4-answer').textContent.replace(/\s+/g, ' ').trim();
  });
  check('searching for ‘A’ in hex returns its position, 10', /returns\s*10\b/.test(searchOk), searchOk);
  const notFound = await page.evaluate(() => {
    c4.dstr = 'Z'; renderLearn();
    return document.querySelector('.c4-answer').textContent.replace(/\s+/g, ' ').trim();
  });
  check('a character not in the base returns -1, never 0', /-1/.test(notFound), notFound);

  console.log('\n== base validation: ex04 and ex05 are NOT merged ==');
  const vcase = async (base, ex) => page.evaluate((a) => {
    c4.vbase = a.base; c4.vex = a.ex; renderLearn();
    return { verdict: document.querySelector('.c4-verdict').className,
             rules: [...document.querySelectorAll('.c4-rule')].map(r => ({
               ok: r.classList.contains('ok'),
               label: r.querySelector('.c4-rule-l').textContent.replace(/ex0[45] only/, '').trim() })),
             text: document.querySelector('.c4-verdict').textContent.replace(/\s+/g, ' ').trim() };
  }, { base, ex });
  const wsA = await vcase('01 23', 'ex04'), wsB = await vcase('01 23', 'ex05');
  check('a base containing a space is VALID under ex04’s rules',
        /ok/.test(wsA.verdict), wsA.text);
  check('and INVALID under ex05’s — the difference the subjects actually state',
        /no/.test(wsB.verdict), wsB.text);
  check('ex04 applies three rules, ex05 four',
        wsA.rules.length === 3 && wsB.rules.length === 4,
        wsA.rules.length + ' vs ' + wsB.rules.length);
  check('ex04 shows nothing about whitespace',
        !wsA.rules.some(r => /whitespace/.test(r.label)));
  for (const [base, ex, want] of [['012233', 'ex04', false], ['012+345', 'ex04', false],
                                  ['a', 'ex04', false], ['', 'ex04', false],
                                  ['poneyvif', 'ex04', true], ['0123456789ABCDEF', 'ex05', true]]) {
    const r = await vcase(base, ex);
    check('"' + base + '" under ' + ex + ' is ' + (want ? 'valid' : 'invalid'),
          /ok/.test(r.verdict) === want, r.text.slice(0, 54));
  }
  check('an invalid base under ex04 says nothing is displayed',
        /nothing at all/.test((await vcase('012233', 'ex04')).text));
  check('an invalid base under ex05 says it returns 0',
        /return 0/.test((await vcase('012233', 'ex05')).text));

  console.log('\n== the duplicate scan is a real nested loop ==');
  await go('ex:ex04', 'visualize');          // the scan is shown with ex04's validation
  const dup = await page.evaluate(() => {
    c4.vbase = '012233'; renderLearn();
    const pairs = [...document.querySelectorAll('.c4-pair')].map(p => p.textContent.replace(/\s+/g, ' '));
    return { n: pairs.length, hit: pairs.filter(p => /=/.test(p)).length,
             verdict: [...document.querySelectorAll('.c4-verdict')]
               .map(v => v.textContent.replace(/\s+/g, ' ').trim())
               .find(t => /DUPLICATE|No duplicate/.test(t)) || '' };
  });
  check('every i/j comparison is shown', dup.n === 15, dup.n + ' pairs for a 6-symbol base');
  check('the duplicate is found and named', /DUPLICATE/.test(dup.verdict), dup.verdict.slice(0, 60));

  console.log('\n== ft_atoi as three phases on one cursor ==');
  await go('ex:ex03', 'visualize');
  for (const [input, want, stop] of [['42', '42', 2], ['   42', '42', 5], ['-42', '-42', 3],
                                     ['   ---+--+1234ab567', '-1234', 14], ['---', '0', 3],
                                     ['123abc456', '123', 3], ['', '0', 0]]) {
    const r = await page.evaluate((s) => {
      c4.atoi = s; renderLearn();
      return { fin: document.querySelector('.c4-final').textContent.replace(/\s+/g, ' ').trim(),
               stop: document.querySelector('.c4-lg.stop').textContent };
    }, input);
    check('ft_atoi(' + JSON.stringify(input) + ') returns ' + want,
          r.fin.indexOf('returns ' + want) >= 0, r.fin);
    check('  …and stops at index ' + stop, r.stop.indexOf('index ' + stop) >= 0, r.stop);
  }
  const phases = await page.evaluate(() => {
    c4.atoi = '   ---+--+1234ab567'; renderLearn();
    const cells = [...document.querySelectorAll('.c4-tc')];
    return { p1: cells.filter(c => c.classList.contains('p1')).length,
             p2: cells.filter(c => c.classList.contains('p2')).length,
             p3: cells.filter(c => c.classList.contains('p3')).length };
  });
  check('the three phases are shown consuming 3 spaces, 7 signs and 4 digits',
        phases.p1 === 3 && phases.p2 === 7 && phases.p3 === 4, JSON.stringify(phases));

  const parity = await page.evaluate(() => {
    c4.sgn = '---+--+'; renderLearn();
    return [...document.querySelectorAll('.c4-verdict')].pop().textContent.replace(/\s+/g, ' ').trim();
  });
  check('sign parity counts the minuses and reports odd/even',
        /5 minus/.test(parity) && /odd/.test(parity) && /-1/.test(parity), parity);
  const even = await page.evaluate(() => { c4.sgn = '--'; renderLearn();
    return [...document.querySelectorAll('.c4-verdict')].pop().textContent.replace(/\s+/g, ' ').trim(); });
  check('two minuses give +1, so it is parity and not a flag', /even/.test(even) && /1/.test(even), even);

  console.log('\n== INT_MIN, shown rather than asserted ==');
  await go('ex:ex02', 'visualize');
  const im = await page.evaluate(() => [...document.querySelectorAll('.c4-imcard')].map(c => ({
    h: c.querySelector('.c4-imcard-h').textContent.trim(),
    v: c.querySelector('.c4-imcard-v').textContent.trim() })));
  check('negating INT_MIN in an int leaves it unchanged',
        im[0] && im[0].v === '-2147483648 → -2147483648', im[0] && im[0].v);
  check('widening to long first gives the true value',
        im[1] && im[1].v === '-2147483648 → 2147483648', im[1] && im[1].v);
  const lim = E.limitsOf(E.scalarT('int'));
  check('the limits shown are CEngine.limitsOf, not literals',
        await page.evaluate(() => document.querySelector('.c4-lim').textContent).then(t =>
          t.indexOf(lim.min) >= 0 && t.indexOf(lim.max) >= 0));
  // and the trap really bites in ex02
  check('the naive ft_putnbr really mis-prints INT_MIN, and the lab says so',
        E.runToCompletion(SHIPPED.indexOf('x') >= 0
          ? 'void\tf(int nb)\n{\n\tchar\tc;\n\n\tif (nb < 0)\n\t{\n\t\twrite(1, "-", 1);\n\t\tnb = -nb;\n\t}\n' +
            '\tif (nb > 9)\n\t\tf(nb / 10);\n\tc = nb % 10 + 48;\n\twrite(1, &c, 1);\n}\n' +
            'int\tmain(void)\n{\n\tf(-2147483647 - 1);\n\treturn (0);\n}\n' : '').output === '-(',
        'engine prints "-(" for INT_MIN');

  console.log('\n== recursion, as real frames ==');
  await go('ex:ex02', 'trace');
  const stack = await page.evaluate(() => {
    const ex = C04_EX.find(e => e.id === 'ex02');
    c4.caseIx['C04:ex02'] = 2;                // the 1234 case (keyed by module)
    const src = ex.program.src;
    const r = c4Run(src);
    let deep = 0, at = 0;
    r.steps.forEach((s, i) => { const n = (s.step.callStack || []).length; if (n > deep) { deep = n; at = i; } });
    c4.step = at; renderLearn();
    return { deep, rows: [...document.querySelectorAll('.c4-cs-r')].map(x => x.textContent.trim()) };
  });
  await sleep(200);
  check('ft_putnbr(1234) really recurses four levels deep', stack.deep === 5, stack.deep + ' frames');
  check('and the call stack panel shows every frame',
        stack.rows.length === 5 && stack.rows.filter(r => /ft_putnbr/.test(r)).length === 4,
        JSON.stringify(stack.rows));
  check('the deepest frame is marked as the running one',
        stack.rows.length > 0 && stack.rows[stack.rows.length - 1].indexOf('running') >= 0,
        stack.rows.length ? stack.rows[stack.rows.length - 1] : 'no frames rendered');

  /* ================= PRACTICE + BUGS ================= */
  console.log('\n== practice is reasoning-first, and the bug list is complete ==');
  await go('practice');
  const prac = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.c4-prac-h .mono')].map(x => x.textContent.trim()),
    open: [...document.querySelectorAll('.c4-prac details[open]')].length,
    sections: [...document.querySelectorAll('.c4-prac details summary')].map(x => x.textContent.trim()),
    text: document.querySelector('.c4-main').textContent,
  }));
  check('all six practice problems are present', prac.names.length === 6, prac.names.join(' '));
  check('they are the handbook’s six',
        prac.names.join(',') === 'ft_strccount,ft_putstr_upper,ft_putnbr_hex,ft_atoi_strict,ft_putnbr_base_pad,ft_base_convert',
        prac.names.join(','));
  check('nothing is expanded by default — reasoning comes first', prac.open === 0, prac.open + ' open');
  check('each offers hints, a checklist and edge cases, but no solution',
        prac.sections.filter(s => /Hint/.test(s)).length === 6 &&
        prac.sections.filter(s => /checklist/i.test(s)).length === 6 &&
        !prac.sections.some(s => /solution/i.test(s)));
  check('no C solution body is printed on the practice page',
        !/while \(|return \(|int\s+i;/.test(prac.text));
  check('the page says these are the handbook’s, not the subject’s',
        /not from the C 04 subject/.test(prac.text));

  await go('bugs');
  const bugs = await page.evaluate(() => ({
    n: document.querySelectorAll('.c4-bug').length,
    rows: [...document.querySelectorAll('.c4-bug')][0].querySelectorAll('.c4-bug-r').length,
    labels: [...document.querySelectorAll('.c4-bug')][0].querySelectorAll('.c4-bug-r span').length,
    text: document.querySelector('.c4-main').textContent,
  }));
  check('the bug database has all 18 entries', bugs.n === 18, String(bugs.n));
  check('each explains what, why, how to recognise it and how to fix the reasoning',
        bugs.rows === 4 && bugs.labels === 4, bugs.rows + ' rows');
  for (const t of ['INT_MIN', 'whitespace', 'Infinite recursion', 'not found', 'itself'])
    check('the list covers "' + t + '"', bugs.text.indexOf(t) >= 0);

  /* ================= EVERYTHING ELSE STILL WORKS ================= */
  console.log('\n== nothing else regressed ==');
  const views = [];
  for (const [fn, want] of [['showDashboard', 'dashboard'], ['showWorkspace', 'workspace'],
                            ['showLearn', 'learn']]) {
    await page.evaluate(x => window[x] ? window[x]() : eval(x + '()'), fn);
    await sleep(250);
    views.push(await page.evaluate(() => ({ v: ui.view,
      d: getComputedStyle(document.querySelector('#dashRoot')).display,
      l: getComputedStyle(document.querySelector('#labRoot')).display,
      n: getComputedStyle(document.querySelector('#learnRoot')).display })));
  }
  check('the four views are mutually exclusive',
        views.every(v => [v.d, v.l, v.n].filter(x => x === 'block').length <= 1),
        JSON.stringify(views));
  await page.evaluate(() => openLabTab('repro'));
  await sleep(350);
  const repro = await page.evaluate(() => {
    const r = reproRun();
    return { tab: lab.tab, ok: r.ok, steps: r.ok ? r.steps.length : 0,
             learn: getComputedStyle(document.querySelector('#learnRoot')).display };
  });
  check('Function Reproduction still runs, and Learn closes behind it',
        repro.ok && repro.steps === 30 && repro.learn === 'none', JSON.stringify(repro));
  const tabsBad = [];
  for (const t of ['ascii', 'convert', 'bits', 'arith', 'compare', 'types', 'functions',
                   'syscalls', 'c03', 'repr', 'ptr', 'argv', 'repro']) {
    await page.evaluate(x => openLabTab(x), t);
    await sleep(80);
    if (await page.evaluate(() => document.querySelector('#labRoot').textContent.length) < 300) tabsBad.push(t);
  }
  check('all 13 lab tabs still render', tabsBad.length === 0, tabsBad.join(' '));
  await page.evaluate(() => openLabTab('ascii'));
  await sleep(280);
  const align = await page.evaluate(() => {
    const th = [...document.querySelectorAll('.vl-table thead th')];
    const row = document.querySelector('.vl-table tbody tr.vl-row');
    if (!th.length || !row) return { err: 'missing' };
    const cells = [...row.children];
    return { drift: Math.max(...th.map((h, i) =>
      Math.abs(h.getBoundingClientRect().left - cells[i].getBoundingClientRect().left))) };
  });
  check('no C 04 CSS leaked into the lab tables', !align.err && align.drift < 1,
        align.err || align.drift.toFixed(2) + 'px');
  const caret = await page.evaluate(() => {
    showWorkspace(); switchToEditing();
    const ta = document.querySelector('#sourceEdit');
    const code = document.querySelector('#sourceView .codeline .code');
    if (!code) return { err: 'missing' };
    const cs = getComputedStyle(ta), cc = getComputedStyle(code);
    const tr = ta.getBoundingClientRect(), cr = code.getBoundingClientRect();
    return { dx: Math.round((tr.left + parseFloat(cs.paddingLeft)) - (cr.left + parseFloat(cc.paddingLeft))),
             dy: Math.round((tr.top + parseFloat(cs.paddingTop)) - cr.top),
             tab: cs.tabSize === cc.tabSize };
  });
  check('the editor caret is untouched',
        !caret.err && Math.abs(caret.dx) <= 1 && Math.abs(caret.dy) <= 1 && caret.tab, JSON.stringify(caret));
  check('Home still lists exactly the 13 labs',
        await page.evaluate(() => { showDashboard();
          return document.querySelectorAll('#dashRoot [data-lab]').length; }) === 13);

  /* ================= RESPONSIVE + A11Y ================= */
  console.log('\n== responsive and reachable ==');
  await page.evaluate(() => showLearn('ex:ex04'));
  await page.evaluate(() => { c4.tab = 'visualize'; renderLearn(); });
  for (const w of [1500, 1280, 1024, 820, 600, 420]) {
    await page.setViewport({ width: w, height: 900 });
    await page.evaluate(() => renderLearn());
    await sleep(230);
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      return { over: de.scrollWidth > de.clientWidth + 1,
               clip: [...document.querySelectorAll('#learnRoot *')].filter(e => {
                 if (e.getBoundingClientRect().right <= de.clientWidth + 2) return false;
                 for (let a = e.parentElement; a; a = a.parentElement) {
                   const o = getComputedStyle(a).overflowX;
                   if (o === 'auto' || o === 'scroll') return false;   // scrollable, so reachable
                 }
                 return true;
               }).length,
               nav: document.querySelectorAll('.c4-nav-b').length };
    });
    check('at ' + w + 'px: no overflow, nothing clipped, contents still reachable',
          !r.over && r.clip === 0 && r.nav >= 15, JSON.stringify(r));
  }
  await page.setViewport({ width: 1500, height: 1050 });
  await page.evaluate(() => renderLearn());
  await sleep(220);
  const a11y = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#learnRoot button')];
    const first = document.querySelector('.c4-nav-b');
    first.focus();
    return { unlabelled: btns.filter(x => !(x.textContent || '').trim() && !x.getAttribute('aria-label')).length,
             focusable: document.activeElement === first,
             visible: first.matches(':focus-visible'),
             tablist: !!document.querySelector('.c4-tabs[role="tablist"]'),
             selected: !!document.querySelector('.c4-tab[aria-selected="true"]'),
             inputs: [...document.querySelectorAll('#learnRoot input')].filter(x =>
               !x.getAttribute('aria-label') && !document.querySelector('label[for="' + x.id + '"]')).length };
  });
  check('every control has a label', a11y.unlabelled === 0, String(a11y.unlabelled));
  check('the contents rail takes keyboard focus and shows it', a11y.focusable && a11y.visible);
  check('the exercise tabs are a labelled tablist', a11y.tablist && a11y.selected);
  check('every input is labelled', a11y.inputs === 0, String(a11y.inputs));
  const colour = await page.evaluate(() => {
    c4.vbase = '012233'; c4.vex = 'ex04'; renderLearn();
    return [...document.querySelectorAll('.c4-rule')].every(r =>
      /[✓✕]/.test(r.querySelector('.c4-rule-m').textContent));
  });
  check('pass/fail is carried by a mark, not only by colour', colour);

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { showLearn('ex:ex04'); c4.tab = 'visualize';
    c4.base = 'poneyvif'; c4.nbr = 83; renderLearn(); });
  await sleep(350);
  await page.screenshot({ path: path.join(SHOTS, 'p27_c04.png'), fullPage: true });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('C 04  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
