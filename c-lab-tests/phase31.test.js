'use strict';
/* Regression cover for the C 05 quality audit.

   Every expected value in this file is computed here, from the C the lessons
   run, and never read back out of the application — so a defect in a visualizer
   cannot agree with itself. Where a defect was about LAYOUT rather than text
   (the recursion ladder paired each call with the wrong return) the assertion
   is made on measured geometry, because the ladder read correctly line by line
   and was wrong only in how the two columns lined up.

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

/* ---- the mathematics, independent of the app ---------------------------- */
const fact = (n) => { let r = 1n; for (let k = 2n; k <= BigInt(n); k++) r *= k; return r; };
const isPrime = (n) => { if (n < 2) return false; for (let i = 2; i <= n / i; i++) if (n % i === 0) return false; return true; };
const primeChain = (n) => { let x = n; const c = []; while (!isPrime(x)) { c.push(x); x++; } c.push(x); return c; };
const isqrtTries = (n) => { if (n < 1) return 0; let t = 0; for (let i = 1; i <= n / i; i++) { t++; if (i * i === n) break; } return t; };
const primeTries = (n) => { if (n < 2) return 0; let t = 0; for (let i = 2; i <= n / i; i++) { t++; if (n % i === 0) break; } return t; };

/* The atoi program the lesson runs, modelled here: for every index the phase
   that CONSUMED it and the sign once it had been consumed. */
function atoiModel(s) {
  const ws = (c) => c === ' ' || (c.charCodeAt(0) >= 9 && c.charCodeAt(0) <= 13);
  let i = 0, sign = 1, result = 0;
  const rows = [];
  while (i < s.length && ws(s[i])) { rows.push({ i, ph: 1, sign, result }); i++; }
  while (i < s.length && (s[i] === '+' || s[i] === '-')) {
    if (s[i] === '-') sign = -sign;
    rows.push({ i, ph: 2, sign, result }); i++;
  }
  while (i < s.length && s[i] >= '0' && s[i] <= '9') {
    result = result * 10 + (s.charCodeAt(i) - 48);
    rows.push({ i, ph: 3, sign, result }); i++;
  }
  return { rows, stop: i, sign, result, value: result * sign };
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;   // the optional local bridge
    errs.push('console: ' + m.text());
  });
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1000);

  const go = (mod, pg, tab, state) => page.evaluate((m, p, t, st) => {
    c4.mod = m; c4.page = p; if (t) c4.tab = t; c4.step = null;
    Object.assign(c4, st || {});
    showLearn();
  }, mod, pg, tab, state || {});

  /* ================= P0-1  the recursion ladder ========================== */
  console.log('\n== the recursion ladder pairs each call with its own return ==');
  for (const n of [1, 2, 3, 5, 8]) {
    await go('C05', 'f:recursion', 'subject', { c5n: n });
    await sleep(160);
    const rungs = await page.evaluate(() => [...document.querySelectorAll('#learnRoot .c5-rung')].map(e => ({
      dir: e.classList.contains('down') ? 'down' : 'up',
      left: Math.round(e.getBoundingClientRect().left),
      text: e.textContent.replace(/\s+/g, ' ').trim(),
    })));
    const base = Math.min(...rungs.map(r => r.left));
    const downs = rungs.filter(r => r.dir === 'down');
    const ups = rungs.filter(r => r.dir === 'up');
    check('ladder nb=' + n + ': one descending rung per call and one return each',
          downs.length === n && ups.length === n, downs.length + ' down, ' + ups.length + ' up');
    const wrong = [];
    for (const d of downs) {
      const callN = +(/fact_rec\((\d+)\)/.exec(d.text) || [])[1];
      const u = ups.find(x => x.left === d.left);
      const got = u ? (/returns (-?\d+)/.exec(u.text) || [])[1] : null;
      const want = fact(callN).toString();
      if (got !== want) wrong.push('fact_rec(' + callN + ') level with ' + got + ', should be ' + want);
    }
    check('ladder nb=' + n + ': every call is drawn level with the value it returned',
          wrong.length === 0, wrong.join('; ') || 'all ' + n + ' rungs paired correctly');
  }

  /* ================= P0-2  next prime =================================== */
  console.log('\n== the next-prime strip shows one candidate per real call ==');
  await go('C05', 'ex:ex07', 'visualize', {});
  await sleep(250);
  for (const n of [-5, -1, 0, 1, 2, 3, 4, 20, 90, 900]) {
    const r = await page.evaluate((v) => {
      c4.c5np = v; c4.step = null; renderLearn();
      const chips = [...document.querySelectorAll('#learnRoot .c5-try')];
      const verdict = (document.querySelector('#learnRoot .c4-verdict') || {}).textContent || '';
      return {
        n: chips.length,
        vals: chips.map(c => (c.querySelector('.c5-try-i') || {}).textContent.trim()),
        marks: chips.map(c => c.classList.contains('hit')),
        verdict: verdict.replace(/\s+/g, ' ').trim(),
      };
    }, n);
    const want = primeChain(n);
    check('next prime ' + n + ': one candidate per call to ft_is_prime',
          r.n === want.length, 'shown ' + r.n + ', expected ' + want.length);
    check('next prime ' + n + ': the candidates are the numbers actually tried',
          r.vals.join(',') === want.map(String).join(','),
          '[' + r.vals.join(',') + '] vs [' + want.join(',') + ']');
    check('next prime ' + n + ': exactly the last candidate is marked prime, and it is',
          r.marks.filter(Boolean).length === 1 && r.marks[r.marks.length - 1] === true &&
          isPrime(want[want.length - 1]),
          'marked ' + r.marks.filter(Boolean).length + ', last = ' + want[want.length - 1]);
    check('next prime ' + n + ': the verdict states the true count and answer',
          r.verdict.indexOf('Returns ' + want[want.length - 1]) === 0 &&
          new RegExp('testing ' + want.length + ' candidate').test(r.verdict), r.verdict.slice(0, 80));
  }

  /* ================= P0-3 / P1  the atoi parser table =================== */
  console.log('\n== the parser table: one row per consumed character, sign after it ==');
  const PHASE = { 1: 'whitespace', 2: 'signs', 3: 'digits' };
  for (const input of ['+123', '-123', '--123', '---123', '+-123', '-+123',
                       '---+--+1234ab567', '-42', '--42', '-', '---', '42', '   -42', '  --42', '']) {
    const r = await page.evaluate((v) => {
      c4.mod = 'C04'; c4.page = 'ex:ex03'; c4.tab = 'visualize'; c4.atoi = v; c4.step = null; showLearn();
      const t = [...document.querySelectorAll('#learnRoot table.c4-t')]
        .find(x => [...x.querySelectorAll('thead th')].map(h => h.textContent.trim()).join(',') === 'i,phase,char,sign,result');
      const stop = (document.querySelector('#learnRoot .c4-lg.stop') || {}).textContent || '';
      const fin = (document.querySelector('#learnRoot .c4-final') || {}).textContent || '';
      return {
        rows: t ? [...t.querySelectorAll('tbody tr')].map(x => [...x.querySelectorAll('td')].map(d => d.textContent.trim())) : [],
        stop: stop.replace(/\s+/g, ' ').trim(), fin: fin.replace(/\s+/g, ' ').trim(),
      };
    }, input);
    const m = atoiModel(input);
    const label = JSON.stringify(input);

    check('parser ' + label + ': exactly one row per consumed character',
          r.rows.length === m.rows.length, 'rows ' + r.rows.length + ', consumed ' + m.rows.length);
    const idx = r.rows.map(x => x[0]);
    check('parser ' + label + ': no index appears twice',
          new Set(idx).size === idx.length, idx.join(','));
    const bad = [];
    r.rows.forEach((row, k) => {
      const e = m.rows[k];
      if (!e) return;
      if (+row[0] !== e.i) bad.push('row ' + k + ' index ' + row[0] + ' != ' + e.i);
      if (row[1] !== PHASE[e.ph]) bad.push('index ' + e.i + ' phase ' + row[1] + ' != ' + PHASE[e.ph]);
      if (row[3] !== String(e.sign)) bad.push('index ' + e.i + " sign " + row[3] + ' != ' + e.sign);
      if (row[4] !== String(e.result)) bad.push('index ' + e.i + ' result ' + row[4] + ' != ' + e.result);
    });
    check('parser ' + label + ': index, consuming phase, sign-after and result all match',
          bad.length === 0, bad.slice(0, 3).join('; ') || m.rows.length + ' rows verified');
    check('parser ' + label + ': the cursor stopped where the program stops',
          r.stop === 'stopped at index ' + m.stop, r.stop + ' (expected index ' + m.stop + ')');
    check('parser ' + label + ': the returned value is still right',
          r.fin.indexOf('returns ' + m.value) === 0, r.fin.slice(0, 60));
  }

  /* ================= .c5-try strips are populated ======================= */
  console.log('\n== every attempt strip actually has attempts in it ==');
  for (const [pg, key, val, want] of [['f:sqrt', 'c5sq', 144, isqrtTries(144)],
                                      ['f:sqrt', 'c5sq', 10, isqrtTries(10)],
                                      ['f:prime', 'c5pr', 97, primeTries(97)],
                                      ['f:prime', 'c5pr', 121, primeTries(121)]]) {
    await go('C05', pg, 'subject', { [key]: val });
    await sleep(160);
    const n = await page.evaluate(() => document.querySelectorAll('#learnRoot .c5-try').length);
    check(pg + ' ' + val + ': the strip shows every candidate the loop tested',
          n === want, 'shown ' + n + ', expected ' + want);
  }
  for (const n of [1, 5, 12]) {
    await go('C05', 'f:factorial', 'subject', { c5n: n });
    await sleep(160);
    const rows = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#learnRoot table.c4-t')]
        .find(x => /result before/.test(x.querySelector('thead').textContent));
      return t ? t.querySelectorAll('tbody tr').length : -1;
    });
    check('factorial ' + n + ': one multiplication row per factor', rows === n, 'rows ' + rows);
  }

  /* ================= P1  overflow is never dressed up as the answer ===== */
  console.log('\n== a wrapped int is never presented as the mathematics ==');
  for (const n of [12, 13]) {
    await go('C05', 'f:factorial', 'subject', { c5n: n });
    await sleep(160);
    const r = await page.evaluate(() => ({
      expand: (((document.querySelector('#learnRoot .c5-expand') || {}).textContent) || '').replace(/\s+/g, ' ').trim(),
      over: [...document.querySelectorAll('#learnRoot .c4-warn')]
        .filter(e => /OUTSIDE THE RANGE/.test(e.textContent)).map(e => e.textContent.replace(/\s+/g, ' ')),
    }));
    const exact = fact(n).toString();
    const fits = fact(n) <= 2147483647n;
    check('factorial ' + n + ': the product shown is the true product',
          r.expand.endsWith('= ' + exact), r.expand.slice(-40));
    check('factorial ' + n + (fits ? ': no out-of-range notice' : ': says it is outside the int range'),
          fits ? r.over.length === 0 : r.over.length === 1,
          fits ? 'notices ' + r.over.length : (r.over[0] || '').slice(0, 90));
    if (!fits) check('factorial ' + n + ': names what the simulator produced without endorsing it',
      /1932053504/.test(r.over[0]) && /undefined behaviour/.test(r.over[0]));
  }
  for (const [nb, pw] of [[2, 0], [2, 1], [2, 10], [0, 0], [0, 5], [-2, 3], [-2, 4], [2, -3], [10, 10], [10, 16]]) {
    await go('C05', 'f:power', 'subject', { c5b: nb, c5p: pw });
    await sleep(150);
    const r = await page.evaluate(() => ({
      fin: (((document.querySelector('#learnRoot .c4-final') || {}).textContent) || '').replace(/\s+/g, ' ').trim(),
      verdict: (((document.querySelector('#learnRoot .c4-verdict') || {}).textContent) || '').replace(/\s+/g, ' ').trim(),
      over: [...document.querySelectorAll('#learnRoot .c4-warn')]
        .filter(e => /OUTSIDE THE RANGE/.test(e.textContent)).length,
    }));
    const exact = pw < 0 ? null : BigInt(nb) ** BigInt(pw);
    const fits = exact === null || (exact <= 2147483647n && exact >= -2147483648n);
    check('power ' + nb + '^' + pw + (fits ? ': no out-of-range notice' : ': flagged as outside the int range'),
          fits ? r.over === 0 : r.over === 1, 'notices ' + r.over);
    if (exact !== null && pw > 0)
      check('power ' + nb + '^' + pw + ': the value shown is the true value',
            r.fin.indexOf('= ' + exact.toString()) > 0, r.fin.slice(0, 70));
  }

  /* ================= P1  trace tab: return value vs stdout ============== */
  console.log('\n== the trace tab tells a returned value from what was printed ==');
  const traceCases = async (mod, ex) => {
    const n = await page.evaluate((m, x) => {
      c4.mod = m; c4.page = 'ex:' + x; c4.tab = 'trace'; c4.caseIx = {}; c4.step = null; showLearn();
      return document.querySelectorAll('#learnRoot [data-c4case]').length;
    }, mod, ex);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(await page.evaluate((m, x, k) => {
        c4.mod = m; c4.page = 'ex:' + x; c4.tab = 'trace'; c4.caseIx[m + ':' + x] = k; c4.step = null; showLearn();
        const e = document.querySelector('#learnRoot .c4-expect');
        return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
      }, mod, ex, i));
    }
    return out;
  };
  for (const ex of ['ex00', 'ex04', 'ex06']) {
    const rows = await traceCases('C05', ex);
    check('C05 ' + ex + ': every case reports a returned value, not just stdout',
          rows.every(r => /returned:/.test(r)), rows.length + ' cases');
    check('C05 ' + ex + ': stdout is labelled as stdout',
          rows.every(r => /stdout: \(nothing printed\)/.test(r)), rows[0]);
    const ticked = rows.filter(r => /returned: [^ ]+ ✓/.test(r)).length;
    check('C05 ' + ex + ': the returned value matches the subject expectation',
          ticked >= rows.length - 1, ticked + ' of ' + rows.length + ' tick (the overflow case cannot)');
  }
  const q = await traceCases('C05', 'ex08');
  check('C05 ex08: the 4x4 case really searches a 4x4 board',
        /returned: 2/.test(q[0]), q[0]);
  check('C05 ex08: the 5x5 case really searches a 5x5 board',
        /returned: 10/.test(q[1]), q[1]);
  const p2 = await traceCases('C04', 'ex02');
  check('C04 ex02 still compares against what was printed',
        p2.slice(0, 5).every(r => /stdout: [^ ]+ ✓/.test(r)), p2[1]);
  const p3 = await traceCases('C04', 'ex03');
  check('C04 ex03 still compares against what was returned',
        p3.every(r => /returned: [^ ]+ ✓/.test(r)), p3[1]);

  /* ================= P2  the panel matches its own heading ============== */
  console.log('\n== GIOPVC-LAC, module state and input ranges ==');
  const rows = await page.evaluate(() => {
    c4.mod = 'C05'; c4.page = 'ex:ex00'; c4.tab = 'understand'; showLearn();
    return [...document.querySelectorAll('#learnRoot .c4-g')].map(e =>
      (e.querySelector('.c4-g-l') || {}).textContent + '/' + (e.querySelector('.c4-g-n') || {}).textContent);
  });
  check('GIOPVC-LAC renders all nine steps, Code last',
        rows.join(' ') === 'G/Goal I/Input O/Output P/Prototype V/Variables C/Conditions L/Loop A/Algorithm C/Code',
        rows.join(' '));

  const key = await page.evaluate(() => {
    c4.caseIx = {};
    c4.mod = 'C05'; c4.page = 'ex:ex00'; c4.tab = 'trace'; showLearn();
    const chips = [...document.querySelectorAll('#learnRoot [data-c4case]')];
    chips[chips.length - 1].click();
    const keys = Object.keys(c4.caseIx);
    c4.mod = 'C04'; c4.page = 'ex:ex00'; c4.tab = 'trace'; showLearn();
    const on = [...document.querySelectorAll('#learnRoot [data-c4case]')].findIndex(e => e.classList.contains('on'));
    return { keys, on };
  });
  check('case selection is keyed by module, so C 04 ex00 is not moved by C 05 ex00',
        key.keys.length === 1 && key.keys[0] === 'C05:ex00' && key.on === 0,
        JSON.stringify(key.keys) + ', C04 selected ' + key.on);

  const defs = await page.evaluate(() => {
    for (const k of ['c5n', 'c5b', 'c5p', 'c5fib', 'c5sq', 'c5pr', 'c5np', 'c5qn', 'c5qsol']) delete c4[k];
    c4.c5np = 777;
    c5State();
    return { np: c4.c5np, n: c4.c5n, sq: c4.c5sq };
  });
  check('c5State fills each field on its own and keeps one already set',
        defs.np === 777 && defs.n === 5 && defs.sq === 144,
        'c5np ' + defs.np + ', c5n ' + defs.n + ', c5sq ' + defs.sq);

  const ranges = await page.evaluate(() => {
    const out = [];
    c4.mod = 'C05'; c4.c5n = 13; c4.page = 'f:factorial'; c4.step = null; showLearn();
    out.push(['#c5N3', document.querySelector('#c5N3')]);
    c4.page = 'f:iter-rec'; renderLearn(); out.push(['#c5N', document.querySelector('#c5N')]);
    c4.page = 'f:recursion'; renderLearn(); out.push(['#c5N2', document.querySelector('#c5N2')]);
    const bad = out.filter(([, e]) => e && (+e.value > +e.max || +e.value < +e.min))
      .map(([s, e]) => s + ' value ' + e.value + ' outside ' + e.min + '..' + e.max);
    c4.c5n = 0; renderLearn();
    const l = document.querySelector('#c5N2');
    if (l && +l.value < +l.min) bad.push('#c5N2 value ' + l.value + ' below min ' + l.min);
    return bad;
  });
  check('no shared-state input renders a value outside its own range',
        ranges.length === 0, ranges.join('; ') || 'three inputs checked at both ends');

  /* ================= nothing leaked ==================================== */
  const leak = await page.evaluate(() => {
    const hits = [];
    for (const mod of ['C04', 'C05']) {
      c4.mod = mod; c4.page = 'overview'; showLearn();
      for (const pg of c4Pages().map(x => x.key)) {
        for (const tab of ['subject', 'understand', 'visualize', 'trace']) {
          c4.mod = mod; c4.page = pg; c4.tab = tab; c4.step = null; showLearn();
          const t = (document.querySelector('#learnRoot .c4-main') || {}).textContent;
          if (/\[object Object\]|\bNaN\b|undefined\s*(×|,|\))/.test(t)) hits.push(mod + ' ' + pg + '/' + tab);
        }
      }
    }
    return hits;
  });
  check('no leaked JavaScript values on any C 04 or C 05 page', leak.length === 0, leak.join(', '));
  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log('\n----------------------------------------------------------------');
  console.log('C 05 audit fixes  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
