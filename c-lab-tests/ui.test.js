'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; failures.push(name + ' :: ' + (detail||'')); console.log('  FAIL ' + name + '  -- ' + (detail||'')); }
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const consoleErrors = [];
  // same rule as every other suite: bridge probe failures are not page errors
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION|Failed to load resource|net::/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => showWorkspace());

  console.log('=== UI: load ===');
  check('page loads with no console errors', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' | '));
  check('engine exposed to page', await page.evaluate(() => typeof window.CEngine === 'object'));
  check('arch chip shows the model', /sim-64/.test(await page.$eval('#sbArch', e => e.textContent)),
        await page.$eval('#sbArch', e => e.textContent));
  check('default example loaded', (await page.$eval('#sourceEdit', e => e.value)).includes('ft_strcapitalize'));

  // ---------- run the flagship end to end ----------
  console.log('\n=== UI: flagship run (ex6) ===');
  await page.click('#btnStep');
  await new Promise(r => setTimeout(r, 200));
  const runAll = async () => page.evaluate(() => {
    let guard = 0;
    while (guard++ < 5000) {
      const h = run.history;
      if (!h) break;
      if (run.stopped) break;
      if (run.stepper.finished && run.index >= h.length - 1) break;
      doStep();
    }
    return { steps: run.history ? run.history.length : 0, stopped: run.stopped,             finished: run.stepper ? run.stepper.finished : false };
  });
  const r6 = await runAll();
  check('ex6 ran to completion', r6.finished && !r6.stopped, JSON.stringify(r6));
  const out6 = await page.$eval('#dockBody', e => e.textContent);
  check('ex6 output correct', out6.includes('Salut, Comment Tu Vas 42mots Quarante-Deux'), JSON.stringify(out6.slice(0,80)));
  check('no console errors during run', consoleErrors.length === 0, consoleErrors.slice(0,2).join(' | '));
check('timeline populated (virtualized)',        (await page.evaluate(() => run.history.length)) > 100 && (await page.$$eval('#tlRows .tl-item', e => e.length)) < 80,        'steps=' + (await page.evaluate(() => run.history.length)) + ' domRows=' + (await page.$$eval('#tlRows .tl-item', e => e.length)));

  // ---------- byte-accurate memory ----------
  console.log('\n=== UI: byte-accurate memory ===');
  await page.evaluate(() => { $('#sourceEdit').value = 'int main(void)\n{\n\tint x;\n\n\tx = 258;\n\treturn (0);\n}\n'; switchToEditing(); });
  await page.click('#btnStep');
  await new Promise(r => setTimeout(r, 150));
  await runAll();
  await page.evaluate(() => goTo(run.history.length - 3));
  const memInfo = await page.evaluate(() => {
    const objs = Array.from(document.querySelectorAll('#memPanel .mem-obj'));
    const x = objs.find(o => o.querySelector('.mo-name').textContent === 'x');
    if (!x) return null;
    return {
      type: x.querySelector('.mo-type').textContent,
      addr: x.querySelector('.mo-addr').textContent,
      value: x.querySelector('.mo-value').textContent.trim(),
      bytes: Array.from(x.querySelectorAll('.bv')).map(b => b.dataset.val),
      // the endianness note is shown once for the whole panel, not per object
      endian: !!document.querySelector('#memPanel .endian-note'),
    };
  });
  if (!memInfo) {
    console.log('    [diag] ' + JSON.stringify(await page.evaluate(() => ({
      idx: run.index, len: run.history ? run.history.length : null,
      phase: run.history ? run.history.steps[run.index].phase : null,
      src: document.querySelector('#sourceEdit').value.slice(0, 30),
      names: Array.from(document.querySelectorAll('#memPanel .mo-name')).map(e => e.textContent),
      panel: document.querySelector('#memPanel').textContent.replace(/\s+/g, ' ').slice(0, 120),
    }))));
  }
  check('int x renders as 4 separate bytes', memInfo && memInfo.bytes.length === 4, JSON.stringify(memInfo));
  check('bytes are little-endian 258 = 02 01 00 00',
        memInfo && memInfo.bytes.join(',') === '2,1,0,0', memInfo ? memInfo.bytes.join(',') : 'n/a');
  check('object header shows type and size', memInfo && /int/.test(memInfo.type) && /4 bytes/.test(memInfo.addr),
        memInfo ? memInfo.type + ' | ' + memInfo.addr : 'n/a');
  check('endianness explained in the panel', memInfo && memInfo.endian);

  // ---------- pointer arithmetic visualization ----------
  console.log('\n=== UI: pointer arithmetic ===');
  await page.evaluate(() => {
    $('#sourceEdit').value = 'int main(void)\n{\n\tint a[3];\n\tint *p;\n\n\ta[0] = 1;\n\tp = a;\n\tp = p + 1;\n\treturn (0);\n}\n';
    switchToEditing();
  });
  await page.click('#btnStep'); await new Promise(r => setTimeout(r, 150));
  await runAll();
  const pmStep = await page.evaluate(() => {
    const h = run.history;
    for (let i = 0; i < h.length; i++) {
      const d = h.steps[i].detail;
      if (d && d.pointerMath && d.pointerMath.calculation) { goTo(i); return i; }
    }
    return -1;
  });
  check('a pointer-arithmetic step exists', pmStep >= 0, 'step ' + pmStep);
  const pmText = await page.evaluate(() => {
    const el = document.querySelector('#execHost .ptr-math');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  check('pointer maths shown as a calculation with sizeof', pmText && /sizeof\(int\)=4/.test(pmText), pmText);
  check('result advances by 4, not 1', pmText && /= 0x[0-9a-f]*[48c0]\b/.test(pmText), pmText);

  // ---------- integer representation ----------
  console.log('\n=== UI: integer representation + overflow ===');
  await page.evaluate(() => {
    $('#levelSeg').querySelectorAll('button')[1].click();      // intermediate
    $('#sourceEdit').value = 'int main(void)\n{\n\tint a;\n\n\ta = 2147483647;\n\ta = a + 1;\n\treturn (0);\n}\n';
    switchToEditing();
  });
  await page.click('#btnStep'); await new Promise(r => setTimeout(r, 150));
  await runAll();
  const ovf = await page.evaluate(() => {
    const h = run.history;
    for (let i = 0; i < h.length; i++) if (h.steps[i].detail && h.steps[i].detail.overflow) { goTo(i); return true; }
    return false;
  });
  check('overflow step found', ovf);
  const heroTxt = await page.$eval('#execHost', e => e.textContent.replace(/\s+/g,' '));
  check('overflow explained in the UI', /Integer overflow/.test(heroTxt) && /-2147483648/.test(heroTxt),
        heroTxt.slice(heroTxt.indexOf('Integer overflow'), heroTxt.indexOf('Integer overflow')+120));
  check('representation panel shows hex+binary', /hex/.test(heroTxt) && /0x7fffffff|0x80000000/.test(heroTxt));

  // ---------- use-after-return ----------
  console.log('\n=== UI: use-after-return ===');
  await page.evaluate(() => {
    $('#sourceEdit').value = 'int\t*bad(void)\n{\n\tint\tx;\n\n\tx = 77;\n\treturn (&x);\n}\n\nint main(void)\n{\n\tint\t*p;\n\tint\tv;\n\n\tp = bad();\n\tv = *p;\n\treturn (0);\n}\n';
    switchToEditing();
  });
  await page.click('#btnStep'); await new Promise(r => setTimeout(r, 150));
  await runAll();
  const uarBox = await page.$eval('#errorBox', e => e.textContent.replace(/\s+/g,' ').trim());
  check('use-after-return reported in the UI', /Use-after-return/i.test(uarBox), uarBox.slice(0, 150));
  check('explains the destroyed frame', /destroyed/i.test(uarBox) && /bad/.test(uarBox));
  check('offers a jump to the causing step', await page.$('#errJump') !== null);

  // ---------- all 13 examples through the real UI ----------
  console.log('\n=== UI: all 13 examples ===');
  const keys = await page.evaluate(() => EXAMPLE_ORDER);
  const expectTrap = { exBug1: 'Out-of-bounds', exBug2: 'Use-after-free' };
  for (const k of keys) {
    consoleErrors.length = 0;
    await page.evaluate((kk) => loadExample(kk), k);
    await new Promise(r => setTimeout(r, 80));
    const needsInput = await page.evaluate((kk) => !!EXAMPLES[kk].needsInput, k);
    await page.click('#btnStep');
    await new Promise(r => setTimeout(r, 120));
    if (needsInput) { await page.click('#inOk'); await new Promise(r => setTimeout(r, 150)); }
    const res = await runAll();
    const err = await page.$eval('#errorBox', e => e.textContent.replace(/\s+/g,' ').trim());
    const out = await page.$eval('#dockBody', e => e.textContent);
    let ok, detail;
    if (expectTrap[k]) { ok = new RegExp(expectTrap[k], 'i').test(err); detail = err.slice(0, 70); }
    else { ok = res.finished && !res.stopped && err === '' && consoleErrors.length === 0;
           detail = 'steps=' + res.steps + (err ? ' ERR:' + err.slice(0,60) : '') + (consoleErrors.length ? ' CONSOLE:' + consoleErrors[0] : ''); }
    check('example ' + k, ok, detail);
  }

  // ---------- controls: time travel, breakpoints, views ----------
  console.log('\n=== UI: controls ===');
  await page.evaluate((kk) => loadExample(kk), 'ex3');
  await new Promise(r => setTimeout(r, 80));
  await page.click('#btnStep'); await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < 6; i++) { await page.click('#btnStep'); await new Promise(r => setTimeout(r, 30)); }
  const idxBefore = await page.evaluate(() => run.index);
  const snapA = await page.$eval('#varsPanel', e => e.textContent.replace(/\s+/g,' '));
  await page.click('#btnPrev'); await new Promise(r => setTimeout(r, 60));
  await page.click('#btnPrev'); await new Promise(r => setTimeout(r, 60));
  const idxMid = await page.evaluate(() => run.index);
  await page.click('#btnStep'); await new Promise(r => setTimeout(r, 60));
  await page.click('#btnStep'); await new Promise(r => setTimeout(r, 60));
  const snapB = await page.$eval('#varsPanel', e => e.textContent.replace(/\s+/g,' '));
  check('prev moves backwards', idxMid === idxBefore - 2, idxBefore + ' -> ' + idxMid);
  check('time travel returns to an identical state', snapA === snapB, snapA + ' || ' + snapB);

  await page.evaluate(() => toggleBreakpoint(6));
  const bpSet = await page.$$eval('#sourceView .codeline.bp', els => els.length);
  check('breakpoint marker renders', bpSet === 1, 'bp lines=' + bpSet);

  for (const v of ['decimal','hex','binary','char']) {
    await page.evaluate((vv) => { document.querySelector('#memViewSeg button[data-view="'+vv+'"]').click(); }, v);
    await new Promise(r => setTimeout(r, 50));
    const n = await page.$$eval('#memPanel .bv', els => els.length);
    check('memory view "' + v + '" renders bytes', n > 0, 'cells=' + n);
  }

  await page.click('#themeToggle'); await new Promise(r => setTimeout(r, 80));
  const themeLight = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('theme toggles to light', themeLight === 'light', themeLight);
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'shot_light.png'), fullPage: false });
  await page.click('#themeToggle'); await new Promise(r => setTimeout(r, 80));

  // ---------- model modal ----------
  await page.click('#sbModel'); await new Promise(r => setTimeout(r, 120));
  const modal = await page.$eval('#modalRoot', e => e.textContent.replace(/\s+/g,' '));
  check('memory-model modal documents sizes', /char 1 byte|char/.test(modal) && /little-endian/.test(modal) && /simplification/i.test(modal),
        modal.slice(0, 90));
  await page.click('#mOk'); await new Promise(r => setTimeout(r, 80));

  // ---------- screenshots ----------
  await page.evaluate((kk) => loadExample(kk), 'ex6');
  await new Promise(r => setTimeout(r, 80));
  await page.click('#btnStep'); await new Promise(r => setTimeout(r, 120));
  await page.evaluate(() => { for (let i=0;i<60;i++) doStep(); });
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'shot_main.png') });
  await page.evaluate(() => { $('#levelSeg').querySelectorAll('button')[2].click(); });
  await new Promise(r => setTimeout(r, 150));
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'shot_deep.png') });

  // responsive
  await page.setViewport({ width: 720, height: 900 });
  await new Promise(r => setTimeout(r, 200));
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  check('no horizontal page scroll at 720px', !hScroll,
        await page.evaluate(() => document.documentElement.scrollWidth + ' vs ' + document.documentElement.clientWidth));
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'shot_narrow.png') });

  console.log('\n' + '='.repeat(60));
  console.log('UI PASS ' + pass + '   FAIL ' + fail);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
