'use strict';
/* C 06 — argc/argv in use: read one, read all, read them backwards, order them.

   Two claims under test.

   FIDELITY: everything shown as official is what the C 06 subject (version 8)
   says. The expected strings below are transcribed here, independently of the
   application, so a mistake in the data cannot agree with itself.

   REALITY: every traversal, comparison, swap and sort the module shows is a
   real execution. This suite recomputes each expected result in JavaScript —
   the forward and reverse orders, the ASCII comparison, the sorted list — and
   requires the page to match. Reading a value out of the panel and comparing
   it to itself would prove nothing.

   And one claim particular to this module: the lessons must NOT hand over the
   four solutions. That is checked too.

   Writes nothing: no screenshots, no artifacts. */
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}

/* ---- the subject, transcribed by hand from en.subject 06.pdf, version 8 ---- */
const SUBJECT = {
  ex00: { name: 'ft_print_program_name', chapter: 'IV', dir: 'ex00/',
          files: 'ft_print_program_name.c', allowed: 'write',
          bullets: ['Since this is a program, your .c file must contain a main function.',
                    'Write a program that displays its own name, followed by a new line.'] },
  ex01: { name: 'ft_print_params', chapter: 'V', dir: 'ex01/',
          files: 'ft_print_params.c', allowed: 'write',
          bullets: ['Since this is a program, your .c file must contain a main function.',
                    'Write a program that displays its given arguments.',
                    'Each argument should be printed on a new line, in the same order as in the command line.',
                    'The program should display all arguments except argv[0].'] },
  ex02: { name: 'ft_rev_params', chapter: 'VI', dir: 'ex02/',
          files: 'ft_rev_params.c', allowed: 'write',
          bullets: ['Since this is a program, your .c file must contain a main function.',
                    'Write a program that displays its given arguments.',
                    'Each argument should be printed on a new line, in the reverse order from the command line.',
                    'The program should display all arguments except argv[0].'] },
  ex03: { name: 'ft_sort_params', chapter: 'VII', dir: 'ex03/',
          files: 'ft_sort_params.c', allowed: 'write',
          bullets: ['Since this is a program, your .c file must contain a main function.',
                    'Write a program that displays its given arguments sorted in ASCII order.',
                    'The program should display all arguments except argv[0].',
                    'Each argument should be printed on a new line.'] },
};
const EX00_EXAMPLE = ['$>./a.out | cat -e', './a.out$', '$>'];
const EX01_EXAMPLE = ['$>./a.out test1 test2 test3 | cat -e', 'test1$', 'test2$', 'test3$', '$>'];

/* ---- expected behaviour, computed here ---- */
const fwd = (args) => args.map(a => a + '\n').join('');
const rev = (args) => args.slice().reverse().map(a => a + '\n').join('');
const asciiSort = (args) => args.slice().sort();          // JS string < is code-unit order
const cmpStop = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const cmpDiff = (a, b) => { const i = cmpStop(a, b);
  return (i < a.length ? a.charCodeAt(i) : 0) - (i < b.length ? b.charCodeAt(i) : 0); };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;
    errs.push('console: ' + m.text());
  });
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1000);

  const go = (pg, state, tab) => page.evaluate((p, st, t) => {
    c4.mod = 'C06'; c4.page = p; c4.step = null; if (t) c4.tab = t;
    Object.assign(c4, st || {});
    showLearn();
  }, pg, state || {}, tab);
  const txt = (sel) => page.evaluate(s => {
    const e = document.querySelector('#learnRoot ' + s);
    return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  }, sel);
  const all = (sel) => page.evaluate(s => [...document.querySelectorAll('#learnRoot ' + s)]
    .map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);

  /* ================= registration ==================================== */
  console.log('\n== the module joins the curriculum in the right place ==');
  const mods = await page.evaluate(() => learnModules().map(m => ({ id: m.id, ex: m.ex.length, f: m.founds.length })));
  check('four modules are registered', mods.length === 4, JSON.stringify(mods));
  check('and C 06 comes after Memory, which it builds on',
        mods.map(m => m.id).join(',') === 'C04,C05,MEM,C06', mods.map(m => m.id).join(','));
  const c06 = mods.find(m => m.id === 'C06');
  check('C 06 has exactly the subject\'s four exercises', c06 && c06.ex === 4, c06 ? c06.ex + '' : '-');
  const pages = await page.evaluate(() => { c4.mod = 'C06'; c4.page = 'overview'; showLearn();
    return c4Pages().map(x => x.key); });
  check('and ten lessons alongside them',
        pages.filter(k => k.indexOf('f:') === 0).length === 10, pages.length + ' pages');

  /* ================= subject fidelity, 4/4 =========================== */
  console.log('\n== subject fidelity ==');
  const data = await page.evaluate(() => C06_EX.map(e => ({
    id: e.id, name: e.name, chapter: e.chapter,
    dir: e.official.dir, files: e.official.files, allowed: e.official.allowed,
    bullets: e.official.bullets, proto: e.official.proto,
    protoNote: e.official.protoNote, examples: e.official.examples || null,
  })));
  for (const id of ['ex00', 'ex01', 'ex02', 'ex03']) {
    const got = data.find(d => d.id === id), want = SUBJECT[id];
    check(id + ' — name, chapter, directory, file and allowed function',
          got.name === want.name && got.chapter === want.chapter && got.dir === want.dir &&
          got.files === want.files && got.allowed === want.allowed,
          [got.name, got.chapter, got.dir, got.files, got.allowed].join(' | '));
    check(id + ' — every requirement bullet, word for word',
          got.bullets.length === want.bullets.length &&
          got.bullets.every((x, i) => x === want.bullets[i]),
          got.bullets.length + ' bullets');
    check(id + ' — no prototype is invented for a program',
          got.proto === null && /no prototype/.test(got.protoNote || ''),
          JSON.stringify(got.proto) + ' / ' + (got.protoNote || '').slice(0, 40));
  }
  check('ex00 reproduces the subject\'s example exactly',
        JSON.stringify(data.find(d => d.id === 'ex00').examples) === JSON.stringify(EX00_EXAMPLE),
        JSON.stringify(data.find(d => d.id === 'ex00').examples));
  check('ex01 reproduces the subject\'s example exactly',
        JSON.stringify(data.find(d => d.id === 'ex01').examples) === JSON.stringify(EX01_EXAMPLE));
  check('ex02 and ex03 carry no example, because the subject gives none',
        data.find(d => d.id === 'ex02').examples === null &&
        data.find(d => d.id === 'ex03').examples === null);
  const meta = await page.evaluate(() => ({ v: C06_META.version, m: C06_META.module }));
  check('the module records subject version 8', meta.v === '8' && meta.m === 'C 06', JSON.stringify(meta));

  /* ================= the module refuses to hand over solutions ======= */
  console.log('\n== it teaches without giving the four answers away ==');
  const hasTrace = await page.evaluate(() => C06_EX.some(e => (e.tabs || []).some(t => t[0] === 'trace')));
  check('no exercise offers a Trace tab stepping through a finished solution', !hasTrace);
  const hasProgram = await page.evaluate(() => C06_EX.some(e => e.program || e.cases));
  check('and none carries a program or test cases to reveal one', !hasProgram);
  const skeletons = await page.evaluate(() => C06_EX.map(e => e.algo.skeleton));
  check('every skeleton has holes in it rather than code',
        skeletons.every(s => (s.match(/\?/g) || []).length >= 4),
        skeletons.map(s => (s.match(/\?/g) || []).length + ' holes').join(', '));
  check('and none of them contains a finished loop body',
        skeletons.every(s => !/while \(i < argc\)\s*\n\s*\{[^?]*write/.test(s)));
  const examBody = await page.evaluate(() => {
    c4.mod = 'C06'; c4.page = 'f:exam'; c4.c6Hint = 4; showLearn();
    return (document.querySelector('#learnRoot .c4-main') || {}).textContent;
  });
  check('exam mode, with every hint open, still contains no C solution',
        !/write\s*\(\s*1\s*,\s*argv/.test(examBody) && !/while\s*\(\s*argv/.test(examBody));
  check('and says outright that no further hint contains the code',
        /no tenth hint containing the code/.test(examBody));

  /* ================= argc and the ruler ============================== */
  console.log('\n== argc is the engine\'s, and the ruler follows it ==');
  for (const args of [[], ['hello'], ['a', 'b', 'c'], ['']]) {
    await go('f:indexes', { c6Prog: './a.out', c6Args: args });
    await sleep(150);
    const want = args.length + 1;
    const facts = await all('.c6-fact b');
    const engine = await page.evaluate(() => {
      const r = memRun(C06_ARGV_SRC, c4.c6Args, c4.c6Prog);
      if (!r.ok) return null;
      return +memVar(memLive(r), 'argc').valueText;
    });
    check('argc for ' + JSON.stringify(args) + ' is ' + want,
          engine === want && facts[0] === String(want), 'engine ' + engine + ', shown ' + facts[0]);
    check('  and the last valid index is shown as ' + (want - 1),
          facts[2] === String(want - 1), facts[2]);
    const rules = await all('.c6-rule .c6-rule-i');
    check('  the ruler runs 0..' + want + ', ending in the NULL slot',
          rules.join(',') === Array.from({ length: want + 1 }, (_, i) => i).join(','), rules.join(','));
  }

  /* ================= forward traversal =============================== */
  console.log('\n== ex01 order, executed ==');
  for (const args of [['test1', 'test2', 'test3'], ['one'], [], ['a b', '', '42']]) {
    await go('f:forward', { c6Prog: './a.out', c6Args: args, c6Step: null });
    await sleep(170);
    const out = await page.evaluate(() => {
      const r = memRun(C06_FWD_SRC, c4.c6Args, c4.c6Prog);
      return r.ok ? r.output : null;
    });
    check('forward ' + JSON.stringify(args) + ' prints them in order, one per line',
          out === fwd(args), JSON.stringify(out) + ' vs ' + JSON.stringify(fwd(args)));
  }
  const fwdBounds = await all('.c6-bound b');
  check('the forward bounds are stated as start / condition / step',
        fwdBounds.join(' | ') === 'i = 1 | i < argc | i++', fwdBounds.join(' | '));

  /* ================= reverse traversal =============================== */
  console.log('\n== ex02 order, executed ==');
  for (const args of [['a', 'b', 'c'], ['one'], [], ['x', 'y']]) {
    await go('f:reverse', { c6Prog: './a.out', c6Args: args, c6Step: null });
    await sleep(170);
    const out = await page.evaluate(() => {
      const r = memRun(C06_REV_SRC, c4.c6Args, c4.c6Prog);
      return r.ok ? r.output : null;
    });
    check('reverse ' + JSON.stringify(args) + ' prints them backwards',
          out === rev(args), JSON.stringify(out) + ' vs ' + JSON.stringify(rev(args)));
  }
  const revBounds = await all('.c6-bound b');
  check('the reverse bounds differ in exactly three places',
        revBounds.join(' | ') === 'i = argc − 1 | i > 0 | i--', revBounds.join(' | '));
  check('one user argument makes ex01 and ex02 identical — and the lesson says so',
        fwd(['only']) === rev(['only']));

  /* ================= ASCII ============================================ */
  console.log('\n== ASCII order, not dictionary order ==');
  await go('f:ascii');
  await sleep(180);
  const codes = await page.evaluate(() => [...document.querySelectorAll('#learnRoot table.c4-t tbody tr')]
    .map(r => [...r.querySelectorAll('td')].map(d => d.textContent.trim())));
  const wantCodes = { '0': '48', '9': '57', 'A': '65', 'M': '77', 'Z': '90', '_': '95', 'a': '97', 'm': '109', 'z': '122' };
  const codeBad = codes.filter(r => wantCodes[r[0]] && r[1] !== wantCodes[r[0]]);
  check('every character code shown is right', codeBad.length === 0,
        codeBad.map(r => r[0] + '=' + r[1]).join(', ') || codes.length + ' rows');
  const asciiBody = await txt('.c4-main');
  check('the page states that "Zebra" sorts before "apple"',
        /"Zebra" sorts before "apple"/.test(asciiBody || ''));
  check('and warns this is not how a person alphabetises',
        /NOT DICTIONARY ORDER/.test(asciiBody || ''));
  check('the independent check agrees: "Zebra" < "apple"', 'Zebra' < 'apple');

  /* ================= string comparison =============================== */
  console.log('\n== comparing two strings, executed ==');
  for (const [a, bb] of [['cat', 'car'], ['abc', 'abd'], ['abc', 'abcd'], ['A', 'a'],
                         ['hello', 'hello'], ['apple', 'avocado']]) {
    await go('f:compare', { c6A: a, c6B: bb });
    await sleep(170);
    const got = await page.evaluate(() => {
      const src = 'int\tmain(int argc, char **argv)\n{\n\tint\ti;\n\tint\td;\n\n\ti = 0;\n' +
        '\twhile (argv[1][i] == argv[2][i] && argv[1][i])\n\t\ti++;\n' +
        '\td = argv[1][i] - argv[2][i];\n\tif (argc > 99)\n\t\td = 0;\n\treturn (0);\n}\n';
      const r = memRun(src, [c4.c6A, c4.c6B], './cmp');
      if (!r.ok) return null;
      const st = memLive(r);
      return { i: +memVar(st, 'i').valueText, d: +memVar(st, 'd').valueText };
    });
    check('"' + a + '" vs "' + bb + '" stops at index ' + cmpStop(a, bb),
          got && got.i === cmpStop(a, bb), got ? 'engine ' + got.i : 'no run');
    check('  and the difference is ' + cmpDiff(a, bb) + ' (' +
          (cmpDiff(a, bb) === 0 ? 'equal' : cmpDiff(a, bb) < 0 ? 'first one first' : 'second one first') + ')',
          got && got.d === cmpDiff(a, bb), got ? 'engine ' + got.d : '');
  }

  /* ================= pointer swap ==================================== */
  console.log('\n== swapping pointers, not characters ==');
  await go('f:swap');
  await sleep(200);
  const swap = await page.evaluate(() => {
    const src = 'int\tmain(int argc, char **argv)\n{\n\tchar\t*tmp;\n\tint\tn;\n\n\tn = argc;\n' +
      '\ttmp = argv[1];\n\targv[1] = argv[2];\n\targv[2] = tmp;\n\treturn (0);\n}\n';
    const r = memRun(src, ['zebra', 'apple'], './a.out');
    const before = c6Slots(r.steps[1].state), after = c6Slots(memLive(r));
    return {
      beforeText: before.filter(x => !x.isNull).map(x => x.text),
      afterText: after.filter(x => !x.isNull).map(x => x.text),
      beforeAddr: before.filter(x => !x.isNull).map(x => String(x.value)),
      afterAddr: after.filter(x => !x.isNull).map(x => String(x.value)),
      strBlocks: (memLive(r).blocks || []).filter(x => /^argv\[\d+\] /.test(x.label)).map(x => x.base),
    };
  });
  check('before the swap the slots read ./a.out, zebra, apple',
        swap.beforeText.join(',') === './a.out,zebra,apple', swap.beforeText.join(','));
  check('after the swap they read ./a.out, apple, zebra',
        swap.afterText.join(',') === './a.out,apple,zebra', swap.afterText.join(','));
  check('the two addresses were exchanged, not the text',
        swap.beforeAddr[1] === swap.afterAddr[2] && swap.beforeAddr[2] === swap.afterAddr[1],
        swap.beforeAddr.join(',') + ' -> ' + swap.afterAddr.join(','));
  check('and the strings themselves never moved',
        swap.strBlocks.length === 3 && new Set(swap.strBlocks).size === 3);

  /* ================= the sort ======================================== */
  console.log('\n== the sort, executed, against an independent ordering ==');
  for (const list of [['zebra', 'apple', 'cat'], ['ant', 'bee', 'cow'], ['dog', 'cat', 'ant'],
                      ['bee', 'ant', 'bee'], ['apple', 'Zebra', 'Apple'], ['abc', 'ab', 'abcd'],
                      ['only'], ['b', 'a']]) {
    await go('f:sorting', { c6Sort: list, c6SortStep: null });
    await sleep(200);
    const got = await page.evaluate(() => {
      const r = memRun(C06_SORT_SRC, c4.c6Sort.slice(0, 5), './a.out');
      if (!r.ok) return null;
      return c6Slots(memLive(r)).filter(x => !x.isNull && x.slot > 0).map(x => x.text);
    });
    check('sorting ' + JSON.stringify(list) + ' gives ' + JSON.stringify(asciiSort(list)),
          got && got.join('|') === asciiSort(list).join('|'), JSON.stringify(got));
  }
  await go('f:sorting', { c6Sort: ['apple', 'Zebra', 'Apple'], c6SortStep: null });
  await sleep(200);
  const agree = await all('.mem-eq-r');
  check('the page reports agreement with ASCII order for the mixed-case list',
        agree.some(t => /agree\?\s*yes/.test(t)), agree.filter(t => /agree/.test(t)).join(' | '));

  /* ================= exercise pages ================================== */
  console.log('\n== the four exercise pages ==');
  for (const id of ['ex00', 'ex01', 'ex02', 'ex03']) {
    await go('ex:' + id, {}, 'subject');
    await sleep(180);
    const tabs = await all('.c4-tab');
    check(id + ' offers Subject, Understand, Visualize and Practice — and no Trace',
          tabs.join(',') === 'Subject,Understand,Visualize,Practice', tabs.join(','));
    const subj = await txt('.c4-subject');
    check(id + ' shows the official panel with the subject\'s allowed function',
          /OFFICIAL SUBJECT/.test(subj || '') && /write/.test(subj || ''));
    await go('ex:' + id, {}, 'understand');
    await sleep(180);
    const g = await all('.c4-g .c4-g-l');
    check(id + ' has all nine GIOPVC-LAC steps',
          g.join('') === 'GIOPVCLAC', g.join(''));
    await go('ex:' + id, {}, 'visualize');
    await sleep(200);
    const vizLen = await page.evaluate(() =>
      (document.querySelector('#learnRoot .c4-main') || {}).textContent.length);
    check(id + ' renders its visualizer', vizLen > 800, vizLen + ' chars');
  }

  /* ================= bug cards and checks ============================ */
  console.log('\n== bug cards and interactive checks ==');
  const bugs = await page.evaluate(() => C06_BUGS.map(b => b.length));
  check('every bug card carries all six fields, including a minimal example',
        bugs.length >= 16 && bugs.every(l => l === 6), bugs.length + ' cards, lengths ' + [...new Set(bugs)].join('/'));
  await go('bugs');
  await sleep(200);
  const egs = await all('.c4-bug-eg');
  check('and the examples are rendered', egs.length === bugs.length, egs.length + ' rendered');
  const total = await page.evaluate(() => {
    let n = 0;
    c4.mod = 'C06';
    for (const k of c4Pages().map(x => x.key)) {
      c4.page = k; c4.step = null; showLearn();
      n += document.querySelectorAll('#learnRoot .mem-chk').length;
    }
    return n;
  });
  check('the module carries at least 20 interactive checks', total >= 20, total + ' checks');
  await go('f:indexes', { c6Quiz: {} });
  await sleep(160);
  const before = (await all('.mem-chk-a')).length;
  await page.evaluate(() => document.querySelector('#learnRoot [data-c6q]').click());
  await sleep(160);
  const after = await all('.mem-chk-a');
  check('a check reveals its answer on click', before === 0 && after.length === 1,
        before + ' -> ' + after.length);

  /* ================= it references rather than repeats ================ */
  console.log('\n== it points back to the Memory module instead of repeating it ==');
  const links = await page.evaluate(() => {
    let n = 0;
    c4.mod = 'C06';
    for (const k of c4Pages().map(x => x.key)) {
      c4.page = k; c4.step = null; showLearn();
      n += document.querySelectorAll('#learnRoot .c6-see').length;
    }
    return n;
  });
  check('C 06 links out to the deeper memory lessons', links >= 3, links + ' cross-links');
  await go('f:swap');
  await sleep(200);
  const jumped = await page.evaluate(() => {
    const el = document.querySelector('#learnRoot .c6-see');
    if (!el) return null;
    el.click();
    return { mod: c4.mod, page: c4.page };
  });
  await sleep(250);
  check('and following one really lands in the Memory module',
        jumped && jumped.mod === 'MEM' && jumped.page === 'f:pointee', JSON.stringify(jumped));

  /* ================= interactivity =================================== */
  console.log('\n== the command-line editor drives the engine ==');
  await go('f:pipeline', { c6Prog: './a.out', c6Args: ['x'] });
  await sleep(200);
  const argcBefore = (await all('.c6-recv-c b'))[0];
  await page.evaluate(() => document.querySelector('#learnRoot [data-c6add]').click());
  await sleep(250);
  const argcAfter = (await all('.c6-recv-c b'))[0];
  check('adding an argument raises argc', argcBefore === '2' && argcAfter === '3',
        argcBefore + ' -> ' + argcAfter);
  await page.evaluate(() => document.querySelector('#learnRoot [data-c6del]').click());
  await sleep(250);
  check('and removing one lowers it', (await all('.c6-recv-c b'))[0] === '2');

  /* ================= regression ====================================== */
  console.log('\n== the other three modules are unaffected ==');
  const other = await page.evaluate(() => {
    const out = {};
    for (const m of ['C04', 'C05', 'MEM']) {
      c4.mod = m; c4.page = 'overview'; showLearn();
      const keys = c4Pages().map(x => x.key);
      let bad = null;
      for (const k of keys) {
        c4.mod = m; c4.page = k; c4.tab = 'subject'; c4.step = null;
        try { showLearn(); } catch (e) { bad = k + ': ' + e.message; break; }
        const t = (document.querySelector('#learnRoot .c4-main') || {}).textContent || '';
        if (t.length < 200) { bad = k + ' rendered almost nothing'; break; }
      }
      out[m] = { pages: keys.length, bad };
    }
    return out;
  });
  check('C 04 still has 19 pages, all rendering', other.C04.pages === 19 && !other.C04.bad, other.C04.bad || 'ok');
  check('C 05 still has 22 pages, all rendering', other.C05.pages === 22 && !other.C05.bad, other.C05.bad || 'ok');
  /* Not a page count: the Memory module is free to grow. What this suite
     depends on is that all of its pages still render and that the lessons
     C 06 links into are still there. */
  check('Memory still renders every page', !other.MEM.bad, other.MEM.bad || other.MEM.pages + ' pages');
  const memLinked = await page.evaluate(() => {
    c4.mod = 'MEM'; c4.page = 'overview'; showLearn();
    const keys = c4Pages().map(x => x.key);
    return ['f:pointee', 'f:argv-array', 'f:argv-bytes'].filter(k => keys.indexOf(k) < 0);
  });
  check('and still provides the lessons C 06 links into', memLinked.length === 0, memLinked.join(', '));
  const c05trace = await page.evaluate(() => {
    c4.mod = 'C05'; c4.page = 'ex:ex00'; c4.tab = 'trace'; showLearn();
    return [...document.querySelectorAll('#learnRoot .c4-tab')].map(x => x.textContent.trim()).join(',');
  });
  check('and C 05 keeps its Trace tab, which C 06 only omits for itself',
        c05trace === 'Subject,Understand,Visualize,Trace,Practice', c05trace);

  /* ================= hygiene ========================================= */
  console.log('\n== hygiene ==');
  const leaks = await page.evaluate(() => {
    const hits = [];
    c4.mod = 'C06';
    for (const k of c4Pages().map(x => x.key)) {
      for (const t of ['subject', 'understand', 'visualize', 'practice']) {
        c4.page = k; c4.tab = t; c4.step = null; showLearn();
        const main = document.querySelector('#learnRoot .c4-main');
        const s = main ? main.textContent : '';
        if (/\[object Object\]|\bNaN\b|>undefined|undefined</.test(s)) hits.push(k + '/' + t);
        if (main && /MISSING VISUALIZER/.test(main.innerHTML)) hits.push(k + '/' + t + ' (missing viz)');
      }
    }
    return hits;
  });
  check('no leaked values and no missing visualizer anywhere', leaks.length === 0, leaks.join(', '));

  for (const w of [420, 768, 1024, 1280, 1500]) {
    await page.setViewport({ width: w, height: 900 });
    await sleep(160);
    const bad = await page.evaluate(() => {
      const out = [];
      c4.mod = 'C06';
      for (const k of c4Pages().map(x => x.key)) {
        c4.page = k; c4.step = null; showLearn();
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(k);
      }
      return out;
    });
    check('no horizontal overflow at ' + w + 'px', bad.length === 0, bad.join(', '));
  }
  await page.setViewport({ width: 1500, height: 950 });

  const a11y = await page.evaluate(() => {
    c4.mod = 'C06'; c4.page = 'f:pipeline'; showLearn();
    const inputs = [...document.querySelectorAll('#learnRoot input')];
    const unlabelled = inputs.filter(i => !i.getAttribute('aria-label') && !i.id).length;
    const btns = [...document.querySelectorAll('#learnRoot button')];
    const empty = btns.filter(x => !x.textContent.trim() && !x.getAttribute('aria-label')).length;
    return { inputs: inputs.length, unlabelled, buttons: btns.length, empty };
  });
  check('every input on the busiest page is labelled',
        a11y.unlabelled === 0, a11y.inputs + ' inputs, ' + a11y.unlabelled + ' unlabelled');
  check('and no button is nameless', a11y.empty === 0, a11y.buttons + ' buttons');

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log('\n----------------------------------------------------------------');
  console.log('C 06 module  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
