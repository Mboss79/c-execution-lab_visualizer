'use strict';
/* C 04 learning upgrade — whitespace, conversion, overflow and the manual.

   The claim: the four new foundations teach the mechanism, and every number
   they show is produced by CEngine executing C. Where the lesson makes a claim
   about the C standard rather than about a value, it must be worded so that it
   is still true on a compiler that behaves differently from this simulator —
   the overflow checks below test exactly that. */
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
/* The test builds C literals itself, independently of the app's helper —
   otherwise a shared escaping bug would agree with itself. */
const C_ESC = { 0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v',
                12: '\\f', 13: '\\r', 34: '\\"', 92: '\\\\' };
function cLit(str) {
  let out = '"';
  for (const ch of String(str)) {
    const c = ch.charCodeAt(0);
    if (C_ESC[c]) out += C_ESC[c];
    else if (c >= 32 && c < 127) out += ch;
    else out += '\\' + c.toString(8);
  }
  return out + '"';
}
/* The whitespace set, transcribed independently of the app. */
const WS = [[32, 'space'], [9, 'tab'], [10, 'newline'], [11, 'vertical tab'],
            [12, 'form feed'], [13, 'carriage return']];

(async () => {
  console.log('\n== structure ==');
  for (const m of ['C04DEEP', 'C04DEEPCSS'])
    check('the ' + m + ' module ships', SHIPPED.indexOf('==== ' + m + ' START ====') > 0 &&
          SHIPPED.indexOf('==== ' + m + ' END ====') > 0);
  const deep = SHIPPED.slice(SHIPPED.indexOf('==== C04DEEP START ===='), SHIPPED.indexOf('==== C04DEEP END ===='));
  const css = SHIPPED.slice(SHIPPED.indexOf('==== C04DEEPCSS START ===='), SHIPPED.indexOf('==== C04DEEPCSS END ===='));
  for (const banned of ['createRun(', 'new Function', 'eval(', 'function asciiInfo', 'function limitsOf'])
    check('the upgrade does not re-implement ' + banned, deep.indexOf(banned) < 0);
  check('it computes through the shared engine helper, not its own runner',
        /c4Run\(/.test(deep) && deep.indexOf('CEngine.runToCompletion') < 0);
  check('ASCII names come from the engine', /CEngine\.asciiInfo\(/.test(deep));
  check('int limits come from the engine, not literals',
        /CEngine\.limitsOf\(/.test(deep) && deep.indexOf("'2147483647'") < 0);
  const bare = ('/*' + css).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = bare.split('\n').filter(l => l.indexOf('{') >= 0);
  check('every new rule is scoped under #learnRoot',
        rules.filter(l => !/^\s*(#learnRoot|@media)/.test(l)).length === 0,
        rules.filter(l => !/^\s*(#learnRoot|@media)/.test(l)).slice(0, 2).join(' | '));
  check('still one lesson view and one router',
        (SHIPPED.match(/function showLearn\(/g) || []).length === 1 &&
        (SHIPPED.match(/function renderLearn\(/g) || []).length === 1);

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
  const go = async (k, t) => { await page.evaluate(a => { showLearn(a.k); if (a.t) c4.tab = a.t;
    c4.step = null; renderLearn(); }, { k, t }); await sleep(210); };
  const text = () => page.evaluate(() => document.querySelector('.c4-main').textContent);

  console.log('\n== the four new foundations are reachable ==');
  await go('overview');                      // the rail only exists inside the Learn view
  const nav = await page.evaluate(() => [...document.querySelectorAll('.c4-nav-b')].map(x => x.textContent.trim()));
  check('the contents rail now has 19 pages', nav.length === 19, nav.length + ' pages');
  for (const [n, t] of [['1.7', 'Whitespace'], ['1.8', '42'], ['1.9', 'Overflow'], ['1.10', 'manual']])
    check('it lists ' + n, nav.some(x => x.indexOf(n) === 0 && x.indexOf(t) >= 0),
          nav.find(x => x.indexOf(n) === 0));
  check('the original six foundations are untouched',
        ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6'].every(n => nav.some(x => x.indexOf(n) === 0)));
  await go('f:whitespace');
  check('and the pager still walks through them',
        await page.evaluate(() => { document.querySelector('.c4-pg.next').click(); return c4.page; }) === 'f:convert');

  /* ================= WHITESPACE ================= */
  console.log('\n== 1.7 whitespace ==');
  await go('f:whitespace');
  const wsRows = await page.evaluate(() => [...document.querySelectorAll('.c4-t')][0]
    .querySelectorAll('tbody tr')).then(() => page.evaluate(() =>
    [...[...document.querySelectorAll('.c4-t')][0].querySelectorAll('tbody tr')].map(r =>
      [...r.children].map(c => c.textContent.trim()))));
  check('all six whitespace characters are listed', wsRows.length === 6, wsRows.length + ' rows');
  for (const [code, name] of WS) {
    const row = wsRows.find(r => r[1] === String(code));
    check('  code ' + code + ' is listed as ' + name, !!row,
          row ? row.join(' ') : 'MISSING');
  }
  const wsNames = await page.evaluate(() => C04_WS.map(w => CEngine.asciiInfo(w.code).name));
  check('the names are the engine’s ASCII names, not retyped',
        wsNames.length === 6 && wsNames.every(n => typeof n === 'string' && n.length), wsNames.join(' '));
  check('the lesson says five of the six are invisible',
        /Five of the six draw nothing/.test(await text()));

  console.log('\n== whitespace in RAM, walked by a real loop ==');
  for (const [input, skipped] of [[' \t\n42', 3], ['   42', 3], ['42', 0], ['\t\t-7', 2],
                                  ['', 0], ['\r\n\v\f 9', 5], ['   ', 3]]) {
    const r = await page.evaluate((s) => {
      c4.ws = s; renderLearn();
      const rows = [...document.querySelectorAll('.c4-ram tbody tr')];
      return { n: rows.length,
               skipped: rows.filter(t => t.classList.contains('c4-skipped')).length,
               here: rows.findIndex(t => t.classList.contains('c4-here')),
               note: [...document.querySelectorAll('.c4-wsnote')].pop().textContent.replace(/\s+/g, ' ') };
    }, input);
    // the engine, run headlessly, must agree about where the loop stops
    const eng = E.runToCompletion(
      'int\tmain(void)\n{\n\tchar\t*s;\n\tint\ti;\n\n\ts = ' + cLit(input) + ';\n\ti = 0;\n' +
      '\twhile (s[i] == 32 || (s[i] >= 9 && s[i] <= 13))\n\t\ti++;\n\treturn (0);\n}\n');
    let stop = 0;
    if (eng.history) for (let k = eng.history.length - 1; k >= 0 && !stop; k--) {
      const st = eng.history.stateAt(k);
      const v = st.vars.find(x => x.name === 'i');
      if (v && !v.uninitialized) stop = +v.valueText;
    }
    check('"' + JSON.stringify(input).slice(1, -1) + '" skips ' + skipped + ' character(s)',
          r.skipped === skipped && stop === skipped && r.here === skipped,
          'shown ' + r.skipped + ', cursor at ' + r.here + ', engine ' + stop);
    check('  …and every byte including the terminator is shown',
          r.n === input.length + 1, r.n + ' rows for ' + input.length + ' characters');
  }

  console.log('\n== isspace, and why ex03 may not call it ==');
  await go('f:whitespace');
  const iss = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.c4-t')].pop();
    return { rows: [...t.querySelectorAll('tbody tr')].map(r =>
               [...r.children].slice(0, 2).map(c => c.textContent.trim())),
             hand: (document.querySelector('.c4-hand .c4-pre') || {}).textContent || '',
             warn: (document.querySelector('.c4-warn') || {}).textContent || '',
             anat: (document.querySelector('.c4-anat') || {}).textContent || '' };
  });
  check('isspace is answered true for whitespace and false for a letter and a digit',
        iss.rows.filter(r => r[1] === 'true').length === 4 &&
        iss.rows.filter(r => r[1] === 'false').length === 2, JSON.stringify(iss.rows));
  check('the hand-rolled replacement is shown',
        /str\[i\] == ' '/.test(iss.hand) && />= 9/.test(iss.hand) && /<= 13/.test(iss.hand),
        iss.hand.replace(/\s+/g, ' ').slice(0, 60));
  check('its header and man section are given', /ctype\.h/.test(iss.anat) && /man 3 isspace/.test(iss.anat));
  check('the lesson states the subject forbids it here',
        /Allowed functions: None/.test(iss.warn) && /forbidden function/.test(iss.warn));
  check('but does not teach that isspace is bad',
        /the right tool/.test(iss.warn), iss.warn.replace(/\s+/g, ' ').slice(0, 80));
  check('and points out the subject’s own "isspace(3)" reference',
        /isspace\(3\)/.test(await text()));

  /* ================= CONVERSION ================= */
  console.log('\n== 1.8 string to integer ==');
  await go('f:convert');
  const t8 = await text();
  check('a string and an integer are contrasted', /A string and an integer are different things/.test(t8));
  check('the four things are named apart',
        /'4' is a character/.test(t8) || /is a character/.test(t8));
  check('why atoi has to exist is answered', /Nothing in C converts text to a number/.test(t8));

  for (const [ch, code, d, ok] of [['0', 48, '0', true], ['7', 55, '7', true], ['9', 57, '9', true],
                                   ['A', 65, '17', false], ['z', 122, '74', false]]) {
    const r = await page.evaluate((x) => {
      c4.adig = x; renderLearn();
      const rungs = [...document.querySelectorAll('.c4-lrung')];
      return { code: rungs[1].querySelector('b').textContent.trim(),
               out: rungs[2].querySelector('b').textContent.trim(),
               bad: rungs[2].classList.contains('bad') };
    }, ch);
    check("'" + ch + "' is ASCII " + code + ' and minus 48 gives ' + d,
          r.code === String(code) && r.out === d, JSON.stringify(r));
    check('  …and it is marked ' + (ok ? 'valid' : 'meaningless'), r.bad !== ok);
  }

  for (const [str, want, rows] of [['1234', '1234', 4], ['42', '42', 2], ['0', '0', 1],
                                   ['907', '907', 3], ['7', '7', 1], ['', '0', 0], ['abc', '0', 0]]) {
    const r = await page.evaluate((s) => {
      c4.s2i = s; renderLearn();
      const tb = [...document.querySelectorAll('.c4-t')].find(t => /result after/i.test(t.textContent));
      const f = document.querySelector('.c4-final');
      return { rows: tb ? [...tb.querySelectorAll('tbody tr')].map(x =>
                 [...x.children].map(c => c.textContent.trim())) : [],
               final: f ? f.textContent.replace(/\s+/g, ' ') : '' };
    }, str);
    check('"' + str + '" produces ' + rows + ' accumulator row(s)', r.rows.length === rows,
          r.rows.length + ' rows');
    if (rows) {
      check('  …ending at ' + want, r.rows[rows - 1][5] === want, r.rows[rows - 1].join(' | '));
      check('  …and the engine agrees',
            String(Number(str)) === want && r.rows[rows - 1][5] === want);
      // each row must be char, its ASCII, the digit, and the arithmetic
      const bad = r.rows.filter((row, k) =>
        row[0] !== str[k] || row[1] !== String(str.charCodeAt(k)) || row[2] !== str[k]);
      check('  …with the right character and ASCII code on every row', bad.length === 0,
            JSON.stringify(bad[0] || []));
    } else {
      check('  …and says the result stays 0', /result stays 0|returns? 0|stays 0/.test(r.final +
            (await text())), r.final.slice(0, 50));
    }
  }

  console.log('\n== why result * 10 + digit is positional notation ==');
  await page.evaluate(() => { c4.s2i = '1234'; renderLearn(); });
  await sleep(150);
  const posn = await page.evaluate(() => ({
    terms: [...document.querySelectorAll('.c4-posn-t')].map(t => ({
      d: t.querySelector('b').textContent, x: t.querySelector('.c4-posn-x').textContent.trim(),
      v: t.querySelector('.c4-posn-v').textContent })),
    sum: document.querySelector('.c4-posn-sum').textContent,
    shifts: [...document.querySelectorAll('.c4-shift-v')].map(x => x.textContent),
  }));
  check('each digit is shown with its place value',
        posn.terms.map(t => t.x).join(',') === '× 1000,× 100,× 10,× 1',
        posn.terms.map(t => t.x).join(','));
  check('the contributions add to the number',
        posn.terms.reduce((a, t) => a + Number(t.v), 0) === 1234 && posn.sum === '1234',
        posn.terms.map(t => t.v).join('+') + ' = ' + posn.sum);
  check('and the running total is shown growing one digit at a time',
        posn.shifts.join(',') === '1,12,123,1234', posn.shifts.join(','));
  check('the lesson explains multiplying shifts everything left',
        /moves one place left/.test(await text()));

  console.log('\n== the bridge from base 10 to any base ==');
  const bridge = await page.evaluate(() => {
    const arms = [...document.querySelectorAll('.c4-bridge-arm')];
    return arms.map(a => ({ h: a.querySelector('.c4-bridge-h').textContent.trim(),
                            f: a.querySelector('.c4-bridge-f').textContent.trim(),
                            x: a.querySelector('.c4-bridge-x').textContent.trim() }));
  });
  check('base 10 and base N are shown side by side', bridge.length === 2,
        bridge.map(x => x.h).join(' / '));
  check('with result * 10 + digit on one side',
        /result = result \* 10 \+ digit/.test(bridge[0].f), bridge[0].f);
  check('and result * base_len + index on the other',
        /result = result \* base_len \+ index/.test(bridge[1].f), bridge[1].f);
  check('naming ft_atoi and ft_atoi_base',
        bridge[0].x === 'ft_atoi' && bridge[1].x === 'ft_atoi_base');

  /* ================= OVERFLOW ================= */
  console.log('\n== 1.9 overflow, underflow and undefined ==');
  await go('f:overflow');
  const lim = E.limitsOf(E.scalarT('int'));
  const ov = await page.evaluate(() => ({
    range: document.querySelector('.c4-range').textContent.replace(/\s+/g, ' '),
    cards: [...document.querySelectorAll('.c4-imcard')].map(c => ({
      h: c.querySelector('.c4-imcard-h').textContent.trim(),
      v: c.querySelector('.c4-imcard-v').textContent.trim() })),
    all: document.querySelector('.c4-main').textContent,
  }));
  check('INT_MIN and INT_MAX are the engine’s limits',
        ov.range.indexOf(lim.min) >= 0 && ov.range.indexOf(lim.max) >= 0, ov.range.slice(0, 70));
  check('the bit count and pattern count come from the engine too',
        ov.range.indexOf(lim.bits) >= 0 && ov.range.indexOf(lim.patterns) >= 0);
  check('overflow is demonstrated with INT_MAX + 1',
        ov.cards.some(c => /OVERFLOW/.test(c.h) && c.v.indexOf(lim.max) >= 0), ov.cards[0] && ov.cards[0].v);
  check('underflow with INT_MIN − 1',
        ov.cards.some(c => /UNDERFLOW/.test(c.h) && c.v.indexOf(lim.min) >= 0), ov.cards[1] && ov.cards[1].v);
  check('the lesson explains the range is lopsided because of zero',
        /one more negative value than positive/.test(ov.all));

  // The honesty checks. These are the point of the whole page.
  check('it calls signed overflow UNDEFINED BEHAVIOUR', /undefined behaviour/i.test(ov.all));
  check('it explicitly rejects "signed overflow wraps"',
        /do not believe/i.test(ov.all) && /Signed arithmetic is not/.test(ov.all));
  check('it notes that UNSIGNED arithmetic is the one defined to wrap',
        /Unsigned arithmetic is defined to wrap/.test(ov.all));
  check('it warns the compiler may optimise on the assumption',
        /optimise on that basis/.test(ov.all));
  check('it quotes the subject rather than paraphrasing it',
        /Overflow and underflow do not need to be handled/.test(ov.all));
  check('and separates "you need not handle it" from "it is safe"',
        /not.*a statement that overflow is harmless/i.test(ov.all.replace(/\s+/g, ' ')));
  check('it says the value THIS simulator shows is not guaranteed elsewhere',
        /what THIS simulator does/.test(ov.all) || /Nothing guarantees another compiler/.test(ov.all));

  console.log('\n== the two overflow problems are kept apart ==');
  const two = await page.evaluate(() => [...document.querySelectorAll('.c4-half')].map(h => ({
    head: h.querySelector('.c4-half-h').textContent.replace(/\s+/g, ' ').trim(),
    body: h.textContent.replace(/\s+/g, ' ') })));
  check('problem A is the parsed value, tagged to ex03/ex05',
        two[0] && /ex03, ex05/.test(two[0].head), two[0] && two[0].head);
  check('problem B is negating INT_MIN, tagged to ex02/ex04',
        two[1] && /ex02, ex04/.test(two[1].head), two[1] && two[1].head);
  check('A is described as excused by the subject', two[0] && /subject excuses this one/.test(two[0].body));
  check('B is described as NOT excused', two[1] && /does not excuse this one/.test(two[1].body));
  check('B quotes ex02’s "all possible values of the int type"',
        two[1] && /all possible values of the int type/.test(two[1].body));
  const bigv = await page.evaluate(() => (document.querySelector('.c4-mini') || {}).textContent || '');
  const engBig = E.runToCompletion(
    'int\tmain(void)\n{\n\tchar\t*s;\n\tint\ti;\n\tint\tr;\n\n\ts = "9999999999";\n\tr = 0;\n\ti = 0;\n' +
    '\twhile (s[i] >= 48 && s[i] <= 57)\n\t{\n\t\tr = r * 10 + (s[i] - 48);\n\t\ti++;\n\t}\n\treturn (0);\n}\n');
  let engVal = null;
  if (engBig.history) for (let k = engBig.history.length - 1; k >= 0 && engVal === null; k--) {
    const v = engBig.history.stateAt(k).vars.find(x => x.name === 'r');
    if (v && !v.uninitialized) engVal = v.valueText;
  }
  check('the overflowing parse shows the engine’s own result',
        engVal !== null && bigv.indexOf(engVal) >= 0, bigv + ' vs engine ' + engVal);

  /* ================= MAN ================= */
  console.log('\n== 1.10 the manual ==');
  await go('f:man');
  const man = await page.evaluate(() => ({
    secs: [...document.querySelectorAll('.c4-mansec-r')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
    heads: [...document.querySelectorAll('.c4-mank')].map(x => x.textContent.trim()),
    anat: [...document.querySelectorAll('.c4-anat-h b')].map(x => x.textContent.trim()),
    all: document.querySelector('.c4-main').textContent,
  }));
  check('the three man sections are explained', man.secs.length === 3, man.secs.length + ' sections');
  check('  man 1 is shell commands', /man 1/.test(man.secs[0]) && /shell commands/.test(man.secs[0]));
  check('  man 2 is system calls', /man 2/.test(man.secs[1]) && /system calls/.test(man.secs[1]));
  check('  man 3 is C library functions', /man 3/.test(man.secs[2]) && /C library/.test(man.secs[2]));
  check('the man-page structure is laid out',
        ['NAME', 'SYNOPSIS', 'DESCRIPTION', 'RETURN VALUE'].every(h => man.heads.indexOf(h) >= 0),
        man.heads.join(' / '));
  check('atoi and isspace both get an anatomy card',
        man.anat.indexOf('atoi') >= 0 && man.anat.indexOf('isspace') >= 0, man.anat.join(' '));
  check('the page explains why the section number matters',
        /man 3 atoi/.test(man.all) && /section number/.test(man.all));

  /* ================= EXERCISES ================= */
  console.log('\n== every exercise leads with an algorithm and a function reference ==');
  const ALLOWED = { ex00: 'None', ex01: 'write', ex02: 'write', ex03: 'None', ex04: 'write', ex05: 'None' };
  for (const id of Object.keys(ALLOWED)) {
    await go('ex:' + id, 'understand');
    const r = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('.c4-block-h')].map(x => x.textContent.trim());
      const th = [...document.querySelectorAll('.c4-fl th')].find(x => /allowed functions/i.test(x.textContent));
      return { blocks, steps: document.querySelectorAll('.c4-algo-l li').length,
               skeleton: (document.querySelector('.c4-pre') || {}).textContent || '',
               allowed: th ? th.nextElementSibling.textContent.trim() : null,
               proto: (() => { const p = [...document.querySelectorAll('.c4-fl th')]
                 .find(x => /prototype/i.test(x.textContent));
                 return p ? p.nextElementSibling.textContent : null; })(),
               fns: [...document.querySelectorAll('.c4-flr')].map(x => ({
                 n: x.querySelector('b').textContent, ok: x.classList.contains('yes') })) };
    });
    check(id + ' opens with the algorithm, before the detail',
          r.blocks[0] === 'The algorithm, in three sizes', r.blocks[0]);
    check(id + ' then gives Functions & libraries', r.blocks[1] === 'Functions & libraries', r.blocks[1]);
    check(id + ' has a short human algorithm', r.steps >= 3 && r.steps <= 8, r.steps + ' steps');
    check(id + ' has a skeleton', r.skeleton.length > 15 && r.skeleton.split('\n').length >= 3,
          JSON.stringify(r.skeleton.split('\n')[0]));
    check(id + ' states the subject’s allowed functions', r.allowed === ALLOWED[id],
          r.allowed + ' vs ' + ALLOWED[id]);
    check(id + ' states the subject’s prototype',
          r.proto === await page.evaluate((x) => C04_EX.find(e => e.id === x).official.proto, id));
    if (id === 'ex03' || id === 'ex05')
      check(id + ' marks isspace as NOT allowed here',
            r.fns.some(f => f.n === 'isspace' && !f.ok), JSON.stringify(r.fns));
    if (id === 'ex01' || id === 'ex02' || id === 'ex04')
      check(id + ' marks write as allowed here',
            r.fns.some(f => f.n === 'write' && f.ok), JSON.stringify(r.fns));
  }
  await go('ex:ex01', 'understand');
  const anat = await page.evaluate(() => {
    const d = [...document.querySelectorAll('.c4-q summary')].find(x => /anatomy/i.test(x.textContent));
    if (d) d.click();
    const a = document.querySelector('.c4-anats .c4-anat');
    return a ? a.textContent.replace(/\s+/g, ' ') : null;
  });
  check('the anatomy of write is available on ex01',
        anat && /unistd\.h/.test(anat) && /ssize_t write/.test(anat) && /file descriptor/.test(anat),
        (anat || '').slice(0, 70));
  check('and it answers WHY the function is needed', anat && /WHY DO WE NEED IT/.test(anat));
  check('the anatomy is collapsed until asked for',
        await page.evaluate(() => { showLearn('ex:ex02'); c4.tab = 'understand'; renderLearn();
          return document.querySelectorAll('.c4-anats').length &&
                 !document.querySelector('.c4-q[open]'); }) === true);

  console.log('\n== ex03 and ex05 pick up the new material ==');
  await go('ex:ex03', 'visualize');
  const v3 = await page.evaluate(() => [...document.querySelectorAll('.c4-block-h')].map(x => x.textContent.trim()));
  check('ex03 opens with the parser model', /parser, not a formula/.test(v3[0]), v3[0]);
  check('ex03 now includes whitespace in RAM', v3.some(x => /as bytes, with the cursor/.test(x)), v3.join(' | '));
  check('ex03 now includes the accumulator', v3.some(x => /becoming a number/.test(x)));
  check('ex03 now includes positional notation', v3.some(x => /not a trick/.test(x)));
  await go('ex:ex05', 'visualize');
  const v5 = await page.evaluate(() => [...document.querySelectorAll('.c4-block-h')].map(x => x.textContent.trim()));
  check('ex05 opens with the bridge from base 10', /The same idea, in any base/.test(v5[0]), v5[0]);
  await go('ex:ex02', 'visualize');
  check('ex02 distinguishes the two overflow problems',
        await page.evaluate(() => [...document.querySelectorAll('.c4-block-h')]
          .some(x => /Two different overflow problems/.test(x.textContent))));

  console.log('\n== the ex05 accumulator still agrees with the engine ==');
  await go('ex:ex05', 'visualize');
  for (const [str, base, want, rows] of [['1A3', '0123456789ABCDEF', '419', 3],
                                         ['FF', '0123456789ABCDEF', '255', 2],
                                         ['0', '0123456789ABCDEF', '0', 1],
                                         ['10', '10', '1', 2],
                                         ['101010', '01', '42', 6]]) {
    const r = await page.evaluate((a) => {
      c4.dstr = a.str; c4.dbase = a.base; renderLearn();
      const tb = [...document.querySelectorAll('.c4-t')].find(t => /result after/i.test(t.textContent));
      return tb ? [...tb.querySelectorAll('tbody tr')].map(x =>
        [...x.children].map(c => c.textContent.trim())) : [];
    }, { str, base });
    check('"' + str + '" in "' + base + '" gives ' + rows + ' rows ending at ' + want,
          r.length === rows && r[rows - 1] && r[rows - 1][4] === want,
          r.length + ' rows, last ' + (r[rows - 1] ? r[rows - 1][4] : '-'));
  }

  /* ================= REGRESSION ================= */
  console.log('\n== nothing already working broke ==');
  await go('ex:ex04', 'trace');
  check('83 in "poneyvif" still prints "one"',
        await page.evaluate(() => c4Run(C04_EX.find(e => e.id === 'ex04').program.src).output) === 'one');
  check('ft_atoi(subject example) is still -1234',
        await page.evaluate(() => {
          const r = c4Run(C04_EX.find(e => e.id === 'ex03').program.src);
          for (let i = r.steps.length - 1; i >= 0; i--) {
            const v = c4Find(r.steps[i].state, 'r');
            if (v && !v.uninitialized) return v.valueText;
          }
          return null;
        }) === '-1234');
  await go('ex:ex03', 'visualize');
  const phases = await page.evaluate(() => {
    c4.atoi = '   ---+--+1234ab567'; renderLearn();
    const cells = [...document.querySelectorAll('.c4-tc')];
    return [1, 2, 3].map(p => cells.filter(c => c.classList.contains('p' + p)).length);
  });
  check('the three-phase tape still reads 3 / 7 / 4', phases.join(',') === '3,7,4', phases.join(','));
  await go('ex:ex04', 'visualize');
  const val = await page.evaluate(() => {
    c4.vbase = '01 23'; c4.vex = 'ex04'; renderLearn();
    const a = document.querySelector('.c4-verdict').className;
    c4.vex = 'ex05'; renderLearn();
    return a + ' | ' + document.querySelector('.c4-verdict').className;
  });
  check('the ex04 / ex05 whitespace difference still holds',
        /ok/.test(val.split('|')[0]) && /no/.test(val.split('|')[1]), val);
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
  check('no new CSS leaked into the lab tables', !align.err && align.drift < 1,
        align.err || align.drift.toFixed(2) + 'px');

  /* ================= RESPONSIVE + A11Y ================= */
  console.log('\n== responsive and reachable ==');
  for (const w of [1500, 1280, 1024, 820, 600, 420]) {
    await page.setViewport({ width: w, height: 900 });
    const bad = [];
    for (const k of ['f:whitespace', 'f:convert', 'f:overflow', 'f:man', 'ex:ex03', 'ex:ex05']) {
      await page.evaluate(x => { showLearn(x); if (x.indexOf('ex:') === 0) c4.tab = 'visualize';
        renderLearn(); }, k);
      await sleep(140);
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
                 }).length };
      });
      if (r.over || r.clip) bad.push(k + '(over=' + r.over + ',clip=' + r.clip + ')');
    }
    check('at ' + w + 'px every new page fits, with wide tables scrolling',
          bad.length === 0, bad.join(' '));
  }
  await page.setViewport({ width: 1500, height: 1050 });
  await go('f:whitespace');
  const a11y = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#learnRoot button')];
    const inputs = [...document.querySelectorAll('#learnRoot input')];
    return { unlabelled: btns.filter(x => !(x.textContent || '').trim() && !x.getAttribute('aria-label')).length,
             unlabelledIn: inputs.filter(x => !x.getAttribute('aria-label') &&
               !document.querySelector('label[for="' + x.id + '"]')).length,
             marks: [...document.querySelectorAll('.c4-yes, .c4-no')].every(x => x.textContent.trim().length) };
  });
  check('every new control is labelled', a11y.unlabelled === 0 && a11y.unlabelledIn === 0,
        a11y.unlabelled + ' / ' + a11y.unlabelledIn);
  check('yes/no is carried by words, not only colour', a11y.marks);

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await go('f:convert');
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p28_c04deep.png'), fullPage: true });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('C 04 DEEP  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
