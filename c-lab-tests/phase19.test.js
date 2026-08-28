'use strict';
/* Phase 7.5 — the C03 string-function project.

   Behavioural. The point of these checks is that the six functions are really
   executed by the real engine and that what the page shows is what those runs
   produced: destination bytes read from engine memory, pointers from the
   pointer graph, return values from the caller's variable. A page that
   described these functions in prose would fail almost every check here. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { load } = require('./load-engine.js');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}

const E = load();
const KEYS = ['c03_strcmp', 'c03_strncmp', 'c03_strcat', 'c03_strncat', 'c03_strstr', 'c03_strlcat'];
const FNS = ['strcmp', 'strncmp', 'strcat', 'strncat', 'strstr', 'strlcat'];
const FNSJOIN = FNS.join(',');

/* Run a C03 example and report what the engine really produced. */
function runKey(key) {
  const ex = E.EXAMPLES[key];
  if (!ex) return { ok: false, error: 'missing example ' + key };
  const r = E.runToCompletion(ex.src);
  if (!r.history) return { ok: false, error: r.message };
  let result = null, buffers = null, states = [];
  for (let i = 0; i < r.history.length; i++) states.push(r.history.stateAt(i));
  for (let i = states.length - 1; i >= 0 && result === null; i--) {
    const v = states[i].vars.find(x => x.name === 'r');
    if (v && !v.uninitialized) {
      result = v.valueText;
      buffers = {};
      for (const f of states[i].frames) for (const x of f.vars) if (x.isArray) buffers[x.name] = x.valueText;
    }
  }
  return { ok: r.ok, src: ex.src, result, buffers, states, r };
}

(async () => {
  console.log('=== Phase 7.5 · part 1: the project uses the EXISTING system ===');
  for (const k of KEYS) check('EXAMPLES contains ' + k, !!E.EXAMPLES[k]);
  check('all six appear in the explorer ordering',
        KEYS.every(k => E.EXAMPLE_ORDER.indexOf(k) >= 0),
        E.EXAMPLE_ORDER.filter(k => k.indexOf('c03_') === 0).join(','));

  console.log('\n=== Phase 7.5 · part 2: all six really execute ===');
  const runs = {};
  for (let i = 0; i < KEYS.length; i++) {
    const r = runs[FNS[i]] = runKey(KEYS[i]);
    check(FNS[i] + ' runs through the real engine', r.ok, r.ok ? r.states.length + ' steps' : r.error);
  }
  check('strcmp("abc","abd") returns a NEGATIVE value',
        Number(runs.strcmp.result) < 0, runs.strcmp.result);
  check('strncmp("abcX","abcY",3) returns 0 — the difference is past n',
        runs.strncmp.result === '0', runs.strncmp.result);
  check('strcat leaves dest as "HiABC"',
        runs.strcat.buffers.dest === '"HiABC"', runs.strcat.buffers.dest);
  check('strncat with nb=3 leaves dest as "HiWor" — 3 SOURCE bytes',
        runs.strncat.buffers.dest === '"HiWor"', runs.strncat.buffers.dest);
  check('strlcat returns 9 = strlen(dest) + strlen(src), not what it copied',
        runs.strlcat.result === '9', runs.strlcat.result);
  check('strlcat leaves dest terminated within its 10-byte buffer',
        runs.strlcat.buffers.dest === '"HiABCDEFG"', runs.strlcat.buffers.dest);

  console.log('\n=== Phase 7.5 · part 3: memory really changes, and only where it should ===');
  // strcat must mutate dest and leave src alone
  const catStates = runs.strcat.states;
  const destOverTime = [];
  for (const st of catStates) {
    for (const f of st.frames) for (const v of f.vars) if (v.name === 'dest' && v.isArray) destOverTime.push(v.valueText);
  }
  const uniq = destOverTime.filter((v, i) => i === 0 || v !== destOverTime[i - 1]);
  check('the destination is seen changing, byte by byte, during execution',
        uniq.length >= 4 && uniq[0] === '"Hi"' && uniq[uniq.length - 1] === '"HiABC"',
        uniq.join(' -> '));
  const srcSeen = new Set();
  for (const st of catStates) for (const f of st.frames) for (const v of f.vars)
    if (v.name === 'src' && v.isArray) srcSeen.add(v.valueText);
  check('the SOURCE buffer is never modified', srcSeen.size === 1 && srcSeen.has('"ABC"'),
        [...srcSeen].join(','));
  // the comparison functions must not write at all
  for (const fn of ['strcmp', 'strncmp']) {
    const seen = new Set();
    for (const st of runs[fn].states) for (const f of st.frames) for (const v of f.vars)
      if (v.isArray) seen.add(v.name + '=' + v.valueText);
    check(fn + ' modifies no buffer at any step', seen.size === 2, [...seen].join(' '));
  }
  // the \0 must be visible in the byte view data
  const finalCat = catStates[catStates.length - 3];
  const destArr = (() => { for (const f of finalCat.frames) for (const v of f.vars)
    if (v.name === 'dest' && v.elements) return v; return null; })();
  check('the terminator is a real 0 byte in the destination',
        destArr && Number(destArr.elements[5].value) === 0,
        destArr ? 'dest[5]=' + destArr.elements[5].value : 'not found');

  console.log('\n=== Phase 7.5 · part 4: strstr returns a pointer INTO the haystack ===');
  const ss = runs.strstr;
  const hay = (() => { for (let i = ss.states.length - 1; i >= 0; i--)
    for (const f of ss.states[i].frames) for (const v of f.vars)
      if (v.name === 'haystack' && v.isArray) return v; return null; })();
  check('the returned pointer is haystack + 2, not a new string',
        hay && ss.result === '0x' + (hay.address + 2).toString(16),
        ss.result + ' vs haystack@0x' + (hay ? (hay.address + 2).toString(16) : '?'));
  // and the miss case
  const missSrc = E.EXAMPLES.c03_strstr.src.replace('char\tneedle[3] = "ll";', 'char\tneedle[3] = "xy";');
  const miss = E.runToCompletion(missSrc);
  let missRes = null;
  for (let i = miss.history.length - 1; i >= 0 && missRes === null; i--) {
    const v = miss.history.stateAt(i).vars.find(x => x.name === 'r');
    if (v && !v.uninitialized) missRes = v.valueText;
  }
  check('a failed search returns NULL', missRes === 'NULL', String(missRes));

  console.log('\n=== Phase 7.5 · part 5: the UI shows those runs ===');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1150 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.evaluate(() => { showLab(); lab.tab = 'c03'; renderLab(); });
  await sleep(450);

  check('the project is a tab in the existing lab, not a second shell',
        (await page.evaluate(() => document.querySelectorAll('.vl-tabs').length)) === 1 &&
        (await page.evaluate(() => [...document.querySelectorAll('.vl-tab')].map(e => e.dataset.labtab)))
          .indexOf('c03') >= 0);
  const matrix = await page.evaluate(() =>
    [...document.querySelectorAll('.c3-table tbody tr')].map(r =>
      [...r.querySelectorAll('td')].map(td => td.textContent.trim())));
  check('the matrix lists all six functions', matrix.length === 6 &&
        matrix.map(r => r[0]).join(',') === FNSJOIN, matrix.map(r => r[0]).join(','));
  check('the matrix has the nine required columns',
        (await page.evaluate(() => document.querySelectorAll('.c3-table thead th').length)) === 9);
  const drift = await page.evaluate(() => {
    const t = document.querySelector('.c3-table');
    const h = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
    return Math.max(...[...h.children].map((c, i) =>
      Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left)));
  });
  check('the new matrix obeys the fad8fd0 column contract', drift <= 1, 'drift ' + Math.round(drift) + 'px');
  check('writes/uses-size are shown per function, from metadata',
        matrix.find(r => r[0] === 'strcmp')[6] === 'no' &&
        matrix.find(r => r[0] === 'strlcat')[6] === 'yes' &&
        matrix.find(r => r[0] === 'strcmp')[7] === 'no' &&
        matrix.find(r => r[0] === 'strcat')[7] === 'yes');

  // the stepper must render the engine's buffers, and show them changing
  const catWalk = await page.evaluate(() => {
    lab.c03Fn = 'strcat'; renderLab();
    const run = c03Run('strcat');
    const seen = [];
    for (let i = 0; i < run.steps.length; i++) {
      lab.c03Step = i; renderLab();
      const dest = [...document.querySelectorAll('.c3-buf')]
        .find(x => x.querySelector('b').textContent.trim() === 'dest');
      if (!dest) continue;
      const cells = [...dest.querySelectorAll('.c3-cell-c')].map(c => c.textContent.trim()).join('');
      const hits = dest.querySelectorAll('.c3-cell.hit').length;
      const eng = (() => { for (const f of run.steps[i].state.frames) for (const v of f.vars)
        if (v.name === 'dest' && v.elements) return v.elements.map(e =>
          Number(e.value) === 0 ? '\\0' : String.fromCharCode(Number(e.value))).join(''); return null; })();
      seen.push({ i, cells, hits, eng, match: cells === eng });
    }
    return seen;
  });
  const bad = catWalk.filter(x => !x.match);
  check('every byte the view draws is the byte the engine holds',
        bad.length === 0, bad.length ? 'step ' + bad[0].i + ': ui ' + bad[0].cells + ' vs eng ' + bad[0].eng
          : catWalk.length + ' steps compared');
  const shapes = catWalk.map(x => x.cells).filter((v, i, a) => i === 0 || v !== a[i - 1]);
  check('the view shows dest growing Hi → HiA → HiAB → HiABC',
        shapes[0].indexOf('Hi\\0') === 0 && shapes.some(s => s.indexOf('HiA\\0') === 0) &&
        shapes.some(s => s.indexOf('HiAB\\0') === 0) && shapes.some(s => s.indexOf('HiABC') === 0),
        shapes.length + ' distinct states');
  check('the byte that just changed is highlighted',
        catWalk.some(x => x.hits === 1));
  check('pointers appear once execution is inside the function',
        await page.evaluate(() => {
          const run = c03Run('strcat');
          let maxP = 0;
          for (let i = 0; i < run.steps.length; i++) {
            lab.c03Step = i; renderLab();
            maxP = Math.max(maxP, document.querySelectorAll('.c3-ptr').length);
          }
          return maxP;
        }) >= 3);
  check('the executing source line is highlighted and follows the step',
        await page.evaluate(() => {
          const run = c03Run('strcat');
          const ok = [];
          for (const i of [5, 12, 20]) {
            lab.c03Step = i; renderLab();
            const on = document.querySelector('.c3-srcline.on');
            ok.push(on && on.textContent.trim().indexOf(String(run.steps[i].step.line)) === 0);
          }
          return ok.every(Boolean);
        }));

  console.log('\n=== Phase 7.5 · part 6: compare and experiments ===');
  const cmp = await page.evaluate(() => {
    lab.c03A = 'strncat'; lab.c03B = 'strlcat'; renderLab();
    return {
      differing: [...document.querySelectorAll('.c3-cmp-row.differ .c3-cmp-k')].map(e => e.textContent.trim()),
      runs: [...document.querySelectorAll('.c3-cmp-row.run .c3-cmp-v')].map(e => e.textContent.trim()),
    };
  });
  check('strncat vs strlcat marks the third-argument row as different',
        cmp.differing.indexOf('third argument means') >= 0, cmp.differing.join(', '));
  check('and shows each function\u2019s real return side by side',
        cmp.runs[1] === '9', cmp.runs.join(' | '));
  const cmp2 = await page.evaluate(() => {
    lab.c03A = 'strcmp'; lab.c03B = 'strncmp'; renderLab();
    return [...document.querySelectorAll('.c3-cmp-row.differ .c3-cmp-k')].map(e => e.textContent.trim());
  });
  check('strcmp vs strncmp marks the stop condition as the difference',
        cmp2.indexOf('stop condition') >= 0, cmp2.join(', '));

  const exp = await page.evaluate(() => {
    const out = {};
    for (const id of ['ncmp', 'cat', 'find']) {
      lab.c03Exp = id; renderLab();
      out[id] = [...document.querySelectorAll('.c3-exp-card')].map(c => ({
        label: c.querySelector('.c3-exp-h').textContent.trim(),
        res: c.querySelector('.c3-exp-r') ? c.querySelector('.c3-exp-r').textContent.trim() : null,
        buf: c.querySelector('.c3-exp-buf') ? c.querySelector('.c3-exp-buf').textContent.trim() : null,
      }));
    }
    return out;
  });
  check('changing n changes the strncmp answer: 0, 0, then non-zero',
        /returned 0$/.test(exp.ncmp[0].res) && /returned 0$/.test(exp.ncmp[1].res) &&
        !/returned 0$/.test(exp.ncmp[2].res),
        exp.ncmp.map(x => x.label + '=' + x.res).join(' | '));
  check('the same append gives different buffers under strncat and strlcat',
        /HiABC"/.test(exp.cat[0].buf) && /HiABCDEFG"/.test(exp.cat[1].buf),
        exp.cat.map(x => x.buf).join(' | '));
  check('strstr experiment shows an address on a hit and NULL on a miss',
        /0x/.test(exp.find[0].res) && /NULL/.test(exp.find[1].res),
        exp.find.map(x => x.res).join(' | '));

  console.log('\n=== Phase 7.5 · part 7: editor integration and honesty ===');
  const opened = await page.evaluate(() => {
    lab.c03Fn = 'strcat'; renderLab();
    document.querySelector('[data-c03open]').click();
    return { view: ui.view, key: ui.exampleKey,
             identical: document.querySelector('#sourceEdit').value === EXAMPLES['c03_strcat'].src };
  });
  check('opening a function loads it into the EXISTING editor',
        opened.view === 'workspace' && opened.key === 'c03_strcat', JSON.stringify(opened));
  check('the source in the editor is byte-identical to the source that runs',
        opened.identical);
  // the ceba821 cursor fix must still hold on this source
  await sleep(250);
  const caret = await page.evaluate(() => {
    switchToEditing();
    const view = document.querySelector('#sourceView');
    const ta = document.querySelector('#sourceEdit');
    const el = view.querySelector('.codeline[data-line="6"] .code');
    if (!el) return null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const flat = []; let n;
    while ((n = w.nextNode())) for (let i = 0; i < n.length; i++) flat.push({ nd: n, i });
    if (flat.length < 4) return null;
    const r = document.createRange();
    r.setStart(flat[3].nd, flat[3].i); r.setEnd(flat[3].nd, flat[3].i + 1);
    const rect = r.getBoundingClientRect();
    const lines = ta.value.split('\n');
    let base = 0; for (let k = 0; k < 5; k++) base += lines[k].length + 1;
    return { x: Math.round(rect.left + rect.width * 0.25), y: Math.round(rect.top + rect.height / 2),
             expect: base + 3 };
  });
  if (caret) {
    await page.mouse.click(caret.x, caret.y);
    const got = await page.evaluate(() => document.querySelector('#sourceEdit').selectionStart);
    check('the editor caret still lands where you click on this tab-indented source',
          got === caret.expect, 'expected ' + caret.expect + ' got ' + got);
  } else check('caret probe found a target line', false, 'no target');

  await page.evaluate(() => { showLab(); lab.tab = 'c03'; renderLab(); });
  await sleep(350);
  // Each function's mistake cards only exist while that function is selected,
  // so walk all six and concatenate what each render actually produced.
  const text = await page.evaluate(() => {
    let all = '';
    for (const f of ['strcmp','strncmp','strcat','strncat','strstr','strlcat']) {
      lab.c03Fn = f; renderLab();
      all += document.querySelector('#labRoot').textContent + '\n';
    }
    lab.c03Fn = 'strcmp'; renderLab();
    return all;
  });
  check('no exercise number is claimed while the subject is unsupplied',
        /official C03 subject has not been supplied/i.test(text) && !/\bex0[0-9]\b/.test(text));
  check('it states strlcat is not strncat with a size',
        /strncat.{0,40}bounds the SOURCE/i.test(text) && /strlcat.{0,40}bounds the DESTINATION/i.test(text));
  check('it corrects the "strcmp returns 1" mistake',
        /negative, zero or positive/i.test(text));
  check('it corrects the "strstr returns a copy" mistake',
        /returns a POINTER into the original string/i.test(text));
  check('it states strcat cannot check the destination capacity',
        /It cannot\. It never receives dest/i.test(text));

  console.log('\n=== Phase 7.5 · part 8: earlier fixes still hold ===');
  const clickRail = async (id) => {
    const r = await page.evaluate((x) => { const e = document.querySelector('#' + x);
      const bb = e.getBoundingClientRect();
      return { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2) }; }, id);
    await page.mouse.click(r.x, r.y); await sleep(320);
  };
  await clickRail('railHome');
  check('the rail still navigates away from the C03 tab',
        (await page.evaluate(() => ui.view)) === 'dashboard', await page.evaluate(() => ui.view));
  await clickRail('railLab');
  await page.evaluate(() => { lab.tab = 'ascii'; renderLab(); });
  await sleep(300);
  const asciiDrift = await page.evaluate(() => {
    const t = document.querySelector('.vl-table');
    const h = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
    return Math.max(...[...h.children].map((c, i) =>
      Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left)));
  });
  check('the ASCII table is still aligned', asciiDrift <= 1, 'drift ' + Math.round(asciiDrift) + 'px');
  check('no page errors across the whole phase', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { lab.tab = 'c03'; lab.c03Fn = 'strcat'; lab.c03Step = 20; renderLab(); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p19_c03.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 7.5  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
