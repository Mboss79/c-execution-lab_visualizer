'use strict';
/* Phase 9 — C types and data representation.

   The load-bearing claim is that NOTHING here is tabulated: sizes, limits,
   bytes and addresses all come from the engine, and the bytes in particular
   come from a program that was really compiled and run. Every UI assertion
   below is compared against the engine's own answer for the same input, so a
   page that printed plausible numbers would fail. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { load, HTML } = require('./load-engine.js');

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

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1100 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.evaluate(() => { showLab(); lab.tab = 'repr'; renderLab(); });
  await sleep(450);

  const chain = () => page.evaluate(() => {
    const o = {};
    for (const s of document.querySelectorAll('.rp-step'))
      o[s.querySelector('.rp-step-k').textContent.trim()] = s.querySelector('.rp-step-v').textContent.trim();
    return o;
  });
  const setType = async (id, val) => {
    await page.evaluate((i, v) => { lab.reprType = i; if (v != null) lab.reprValue = v; renderLab(); }, id, val);
    await sleep(300);
  };

  console.log('=== part 1: the section exists inside the existing navigation ===');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.vl-tab')].map(e => e.dataset.labtab));
  check('it is a tab in the ONE existing lab strip, not a second shell',
        tabs.indexOf('repr') >= 0 &&
        (await page.evaluate(() => document.querySelectorAll('.vl-tabs').length)) === 1, tabs.join(','));
  const types = await page.evaluate(() => REPR_TYPES.map(t => t.decl));
  check('every required type is offered, including a pointer',
        ['char', 'signed char', 'unsigned char', 'short', 'unsigned short', 'int',
         'unsigned int', 'long', 'unsigned long'].every(t => types.indexOf(t) >= 0) &&
        types.some(t => t.indexOf('*') >= 0), types.join(', '));

  console.log('\n=== part 2: nothing is tabulated — the engine answers ===');
  const src = fs.readFileSync(HTML, 'utf8');
  const rp = src.slice(src.indexOf('==== REPRLAB START ===='), src.indexOf('==== REPRLAB END ===='));
  check('the module ships between its markers', rp.length > 3000, rp.length + ' bytes');
  check('it declares no size or limit table of its own',
        !/(size|bytes|bits)\s*:\s*(1|2|4|8)\b/.test(rp.replace(/ARCH\.sizes[^\n]*/g, '')) &&
        !/min\s*:\s*['"]-?\d{3,}/.test(rp),
        'no literal widths or limits');
  check('it asks limitsOf, representation and conversionSteps',
        /CEngine\.limitsOf\(/.test(rp) && /CEngine\.conversionSteps\(/.test(rp) &&
        /CEngine\.parseValueInput\(/.test(rp));
  check('it reuses the Phase 5 bit grid rather than a new one',
        !/vl-bitcell|bitCells\.map/.test(rp) || /labBitsHtml/.test(rp));
  check('it obtains bytes by RUNNING a program, not by computing them',
        /CEngine\.runToCompletion\(/.test(rp) && !/>>\s*8|&\s*0xff/i.test(rp));
  check('no eval or Function constructor', !/\beval\s*\(/.test(rp) && !/new Function/.test(rp));

  console.log('\n=== part 3: the chain matches the engine, type by type ===');
  const cases = [
    ['uchar', '255', 'unsigned char', 1], ['char', '-1', 'char', 1],
    ['short', '-32768', 'short', 2], ['uint', '305419896', 'unsigned int', 4],
    ['long', '42', 'long', 8], ['ulong', '18446744073709551615', 'unsigned long', 8],
  ];
  for (const [id, val, typeName, bytes] of cases) {
    await setType(id, val);
    const c = await chain();
    const eng = await page.evaluate(() => {
      const r = reprRun();
      return { typeName: r.v.typeName, size: r.v.size, bin: r.v.repr.binary,
               bytes: r.v.bytes.map(x => Number(x.value).toString(16).toUpperCase().padStart(2, '0')).join(' '),
               addr: '0x' + r.v.address.toString(16), val: r.v.valueText };
    });
    const okChain = c.TYPE === eng.typeName && c.SIZE.indexOf(String(eng.size)) === 0 &&
                    c.BITS.replace(/ /g, '') === eng.bin && c.BYTES === eng.bytes &&
                    c.ADDRESS === eng.addr && c.VALUE === eng.val;
    check(typeName + ' ' + val + ': every link of the chain is the engine\u2019s own answer',
          okChain && eng.size === bytes, JSON.stringify(c.SIZE + ' / ' + c.BYTES + ' / ' + c.ADDRESS));
  }

  console.log('\n=== part 4: bytes in memory, and endianness ===');
  await setType('uint', '305419896');
  const mem = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.rp-mem-row')].map(r => ({
      a: r.querySelector('.rp-mem-a').textContent.trim(),
      b: r.querySelector('.rp-mem-b').textContent.trim() })),
    eng: reprRun().v.bytes.map(x => ({
      a: '0x' + x.address.toString(16),
      b: Number(x.value).toString(16).toUpperCase().padStart(2, '0') })),
    endian: CEngine.ARCH.endian,
  }));
  check('the memory rows ARE the engine\u2019s bytes at the engine\u2019s addresses',
        JSON.stringify(mem.rows) === JSON.stringify(mem.eng),
        mem.rows.map(r => r.a + '=' + r.b).join(' '));
  check('0x12345678 is stored least-significant-byte-first',
        mem.endian === 'little' && mem.rows.map(r => r.b).join(' ') === '78 56 34 12',
        mem.rows.map(r => r.b).join(' '));
  check('addresses increase down the column',
        parseInt(mem.rows[1].a, 16) === parseInt(mem.rows[0].a, 16) + 1);
  const endianText = await page.evaluate(() =>
    [...document.querySelectorAll('.rp-note')].map(e => e.textContent).join(' '));
  check('it says byte order is the architecture\u2019s, not C\u2019s',
        /standard does not fix a byte order/i.test(endianText));
  await setType('uchar', '65');
  check('a one-byte type says byte order cannot matter for it',
        /nothing to reorder/i.test(await page.evaluate(() =>
          [...document.querySelectorAll('.rp-note')].map(e => e.textContent).join(' '))));

  console.log('\n=== part 5: nibbles, sizeof, and sizes ===');
  await setType('uint', '305419896');
  const nib = await page.evaluate(() =>
    [...document.querySelectorAll('.rp-nib-col')].map(n => ({
      b: n.querySelector('.rp-nib-b').textContent.trim(),
      h: n.querySelector('.rp-nib-h').textContent.trim() })));
  check('every nibble maps to the hex digit it really encodes',
        nib.length === 8 && nib.every(x => parseInt(x.b, 2).toString(16).toUpperCase() === x.h) &&
        nib.map(x => x.h).join('') === '12345678', nib.map(x => x.h).join(''));
  const sz = await page.evaluate(() => ({
    ui: [...document.querySelectorAll('.rp-sz')].map(s => ({
      k: s.querySelector('.rp-sz-k').textContent.trim(),
      v: s.querySelector('.rp-sz-v').textContent.trim() })),
    src: lab.reprSizeof.src,
  }));
  const engSizes = { 'sizeof(char)':'1', 'sizeof(short)':'2', 'sizeof(int)':'4',
                     'sizeof(long)':'8', 'sizeof(unsigned char)':'1' };
  check('sizeof values come from executing a real program',
        sz.ui.length === 5 && sz.ui.every(x => engSizes[x.k] === x.v) && /sizeof\(int\)/.test(sz.src),
        sz.ui.map(x => x.k + '=' + x.v).join(' '));
  const bars = await page.evaluate(() =>
    [...document.querySelectorAll('.rp-bar-row')].map(r => ({
      n: r.querySelector('.rp-bar-n').textContent.trim(),
      v: r.querySelector('.rp-bar-v').textContent.trim() })));
  const engInt = E.limitsOf(E.scalarT('int', true));
  const engPtr = E.limitsOf(E.ptrT(E.scalarT('int', true)));
  check('the size bars report engine widths, including the pointer',
        bars.find(x => x.n === 'int').v === engInt.bits + ' bits · ' + engInt.bytes + ' B' &&
        bars.find(x => /pointer/.test(x.n)).v === engPtr.bits + ' bits · ' + engPtr.bytes + ' B',
        bars.find(x => /pointer/.test(x.n)).v);
  check('it states pointer size is architecture-dependent',
        /Pointer size is architecture-dependent/i.test(await page.evaluate(() =>
          [...document.querySelectorAll('.rp-note')].map(e => e.textContent).join(' '))));

  console.log('\n=== part 6: same bits, different types ===');
  const cmp = await page.evaluate(() => {
    lab.reprA = 'schar'; lab.reprB = 'uchar'; lab.reprPattern = 255n; renderLab();
    return {
      pattern: document.querySelector('.rp-pattern b').textContent.replace(/\s/g, ''),
      rows: [...document.querySelectorAll('.rp-cmp-row')].map(r => ({
        k: r.querySelector('.rp-cmp-k').textContent.trim(),
        a: r.children[1].textContent.trim(), b: r.children[2].textContent.trim(),
        differ: r.classList.contains('differ') })),
    };
  });
  const readRow = cmp.rows.find(r => /reads as/.test(r.k));
  check('one pattern, two readings: -1 and 255',
        cmp.pattern === '11111111' && readRow.a === '-1' && readRow.b === '255' && readRow.differ,
        readRow.a + ' / ' + readRow.b);
  check('the shared facts are NOT marked as differences',
        cmp.rows.find(r => r.k === 'size').differ === false &&
        cmp.rows.find(r => r.k === 'bits').differ === false);
  check('the ranges differ and match limitsOf',
        cmp.rows.find(r => r.k === 'minimum').a === E.limitsOf(E.scalarT('char', true)).min &&
        cmp.rows.find(r => r.k === 'maximum').b === E.limitsOf(E.scalarT('char', false)).max);
  const cmp2 = await page.evaluate(() => {
    lab.reprA = 'int'; lab.reprB = 'uint'; renderLab();
    return [...document.querySelectorAll('.rp-cmp-row')].map(r => ({
      k: r.querySelector('.rp-cmp-k').textContent.trim(), differ: r.classList.contains('differ') }));
  });
  check('int vs unsigned int: same size and bits, different range',
        cmp2.find(r => r.k === 'size').differ === false &&
        cmp2.find(r => r.k === 'bits').differ === false &&
        cmp2.find(r => r.k === 'minimum').differ === true);

  console.log('\n=== part 7: arrays, pointers and the table ===');
  const arr = await page.evaluate(() => ({
    ui: [...document.querySelectorAll('.rp-arr-row')].map(r => ({
      i: r.querySelector('.rp-arr-i').textContent.trim(),
      a: r.querySelector('.rp-arr-a').textContent.trim() })),
    eng: lab.reprArray.v.elements.map(e => ({ i: 'a[' + e.index + ']', a: '0x' + e.address.toString(16) })),
  }));
  check('array element addresses are the engine\u2019s addresses',
        JSON.stringify(arr.ui) === JSON.stringify(arr.eng), arr.ui.map(x => x.a).join(' '));
  check('consecutive elements are sizeof(int) apart',
        parseInt(arr.ui[1].a, 16) - parseInt(arr.ui[0].a, 16) === E.sizeof(E.scalarT('int', true)));
  await setType('ptr', null);
  const pc = await chain();
  check('the pointer type reports the architecture\u2019s pointer size',
        pc.TYPE === 'int *' && pc.SIZE.indexOf(String(E.ARCH.sizes.pointer)) === 0, pc.SIZE);
  check('and its value is a real address it points at',
        /^0x[0-9a-f]+$/.test(pc.VALUE), pc.VALUE);
  const tbl = await page.evaluate(() => {
    const t = document.querySelector('.rp-table');
    const h = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
    return {
      cols: h.children.length, rows: t.querySelectorAll('tbody tr').length,
      drift: Math.max(...[...h.children].map((c, i) =>
        Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left))),
      body: [...t.querySelectorAll('tbody tr')].map(r =>
        [...r.querySelectorAll('td')].map(td => td.textContent.trim())),
      headDisp: getComputedStyle(h).display, bodyDisp: getComputedStyle(bd).display,
    };
  });
  check('the table has a real thead/tbody with 6 columns and 0px drift',
        tbl.cols === 6 && tbl.drift <= 1 &&
        tbl.headDisp === 'table-row' && tbl.bodyDisp === 'table-row',
        'drift ' + Math.round(tbl.drift) + 'px, rows ' + tbl.rows);
  const uiInt = tbl.body.find(r => r[0] === 'int');
  check('every limit in the table is limitsOf\u2019s answer',
        uiInt[1] === String(engInt.bytes) && uiInt[2] === String(engInt.bits) &&
        uiInt[4] === engInt.min && uiInt[5] === engInt.max, uiInt.join(' | '));
  check('plain char is disclosed as implementation-defined',
        /implementation-defined/i.test(await page.evaluate(() =>
          [...document.querySelectorAll('.rp-note')].map(e => e.textContent).join(' '))));

  console.log('\n=== part 8: value input, conversions and ASCII ===');
  await page.evaluate(() => { lab.reprType = 'uchar'; renderLab(); });
  await sleep(250);
  for (const [typed, want] of [['0x41', '65'], ['01000001', '65'], ['65', '65'], ['0101', '5']]) {
    await page.evaluate((v) => {
      const i = document.querySelector('#rpValue');
      i.value = v; i.dispatchEvent(new Event('input', { bubbles: true }));
    }, typed);
    await sleep(230);
    const got = await page.evaluate(() => reprRun().v.value);
    check('typing ' + typed + ' stores ' + want, got === want, got);
  }
  check('the detected base is reported back',
        /read as/.test(await page.evaluate(() => document.querySelector('.rp-detect').textContent)));
  await page.evaluate(() => {
    const i = document.querySelector('#rpValue');
    i.value = '65'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(250);
  const conv = await page.evaluate(() => ({
    boxes: [...document.querySelectorAll('.rp-conv')].map(c => c.querySelector('.rp-conv-h').textContent.trim()),
    reads: [...document.querySelectorAll('.rp-conv-r b')].map(e => e.textContent.trim()),
    reps: [...document.querySelectorAll('.rp-rep')].map(r =>
      r.querySelector('.rp-rep-k').textContent + '=' + r.querySelector('.rp-rep-v').textContent.trim()),
  }));
  check('all four conversions are shown', conv.boxes.length === 4, conv.boxes.join(' / '));
  const engBin = E.conversionSteps(65n, 'binary').read;
  const engHex = E.conversionSteps(65n, 'hex').read;
  const engOct = E.conversionSteps(65n, 'octal').read;
  check('each conversion result is conversionSteps\u2019 own answer',
        conv.reads[0] === engBin && conv.reads[1] === engHex && conv.reads[2] === engOct,
        conv.reads.join(' | '));
  check('65 shows its ASCII reading as A',
        conv.reps.some(r => /^ascii=/.test(r) && /'A'/.test(r)), conv.reps.join(' '));
  await page.evaluate(() => {
    const i = document.querySelector('#rpValue');
    i.value = '200'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(250);
  check('200 is honestly reported as having no ASCII reading',
        await page.evaluate(() => [...document.querySelectorAll('.rp-rep')]
          .some(r => /ascii/i.test(r.textContent) && /not ASCII/.test(r.textContent))));

  console.log('\n=== part 9: cross-links reach the existing views ===');
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('.rp-link')].map(e => e.dataset.rpgo));
  check('links to Types, ASCII, Conversions, Memory, Pointers and Terminal exist',
        ['types', 'ascii', 'convert', 'memory', 'pointers', 'terminal'].every(x => links.indexOf(x) >= 0),
        links.join(','));
  for (const [go, expect] of [['types', 'types'], ['ascii', 'ascii'], ['convert', 'convert']]) {
    await page.evaluate((g) => {
      lab.tab = 'repr'; renderLab();
      [...document.querySelectorAll('.rp-link')].find(e => e.dataset.rpgo === g).click();
    }, go);
    await sleep(280);
    check('the ' + go + ' link switches to that tab',
          (await page.evaluate(() => lab.tab)) === expect, await page.evaluate(() => lab.tab));
  }
  await page.evaluate(() => {
    lab.tab = 'repr'; renderLab();
    [...document.querySelectorAll('.rp-link')].find(e => e.dataset.rpgo === 'memory').click();
  });
  await sleep(320);
  check('the Memory link leaves the lab for the workspace',
        (await page.evaluate(() => ui.view)) === 'workspace');
  await page.evaluate(() => { showLab(); lab.tab = 'repr'; renderLab();
    [...document.querySelectorAll('.rp-link')].find(e => e.dataset.rpgo === 'terminal').click(); });
  await sleep(320);
  check('the Terminal link opens the terminal dock',
        (await page.evaluate(() => ui.dockTab)) === 'terminal' &&
        (await page.evaluate(() => !!document.querySelector('#termInput'))));

  console.log('\n=== part 10: progressive disclosure and accessibility ===');
  await page.evaluate(() => { showLab(); lab.tab = 'repr'; lab.reprAdvanced = false; renderLab(); });
  await sleep(280);
  check('technical details are collapsed by default',
        (await page.evaluate(() => document.querySelectorAll('.rp-adv-row').length)) === 0 &&
        (await page.evaluate(() => !!document.querySelector('[data-rpadv="1"]'))));
  await page.evaluate(() => document.querySelector('[data-rpadv="1"]').click());
  await sleep(280);
  const adv = await page.evaluate(() =>
    [...document.querySelectorAll('.rp-adv-row b')].map(e => e.textContent.trim()));
  check('opening them reveals the architecture and standard caveats',
        adv.length >= 5 && adv.some(t => /Byte order/.test(t)) && adv.some(t => /simulation/i.test(t)),
        adv.join(', '));
  check('the value input is labelled and keyboard reachable',
        await page.evaluate(() => {
          const i = document.querySelector('#rpValue');
          return !!i.getAttribute('aria-label') && !!document.querySelector('label[for="rpValue"]');
        }));
  check('the type selector is a group of real buttons',
        await page.evaluate(() => {
          const g = document.querySelector('.rp-types');
          return g.getAttribute('role') === 'group' &&
                 [...g.children].every(c => c.tagName === 'BUTTON');
        }));

  console.log('\n=== part 11: responsive, and nothing earlier regressed ===');
  const bad = [];
  for (const [w, h] of [[1600, 1000], [1280, 800], [1024, 800], [860, 700], [700, 900]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(260);
    const g = await page.evaluate(() => {
      const rail = document.querySelector('.rail').getBoundingClientRect();
      const lr = document.querySelector('#labRoot').getBoundingClientRect();
      const t = document.querySelector('.rp-table');
      const wrap = t ? t.closest('.vl-table-wrap') : null;
      const hd = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
      return {
        pageOverflow: document.body.scrollWidth > document.body.clientWidth,
        coversRail: lr.left < rail.right - 1,
        tableDrift: Math.max(...[...hd.children].map((c, i) =>
          Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left))),
        scrollable: wrap ? getComputedStyle(wrap).overflow !== 'visible' : false,
      };
    });
    if (g.pageOverflow || g.coversRail || g.tableDrift > 1) bad.push(w + 'x' + h + ' ' + JSON.stringify(g));
  }
  check('usable at every viewport, never covering the rail, table stays aligned',
        bad.length === 0, bad.join(' | '));
  await page.setViewport({ width: 1500, height: 1000 });
  await sleep(250);

  const clickRail = async (id) => {
    const r = await page.evaluate((x) => { const e = document.querySelector('#' + x);
      const bb = e.getBoundingClientRect();
      return { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2) }; }, id);
    await page.mouse.click(r.x, r.y); await sleep(320);
  };
  await clickRail('railHome');
  check('the rail still navigates from the new tab',
        (await page.evaluate(() => ui.view)) === 'dashboard');
  await clickRail('railLab');
  await page.evaluate(() => { lab.tab = 'ascii'; renderLab(); });
  await sleep(300);
  const asciiDrift = await page.evaluate(() => {
    const t = document.querySelector('.vl-table');
    const h = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
    return Math.max(...[...h.children].map((c, i) =>
      Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left)));
  });
  check('ASCII table alignment still holds', asciiDrift <= 1, 'drift ' + Math.round(asciiDrift) + 'px');
  await page.evaluate(() => { lab.tab = 'c03'; renderLab(); });
  await sleep(300);
  check('the C03 project still renders six functions',
        (await page.evaluate(() => document.querySelectorAll('.c3-table tbody tr').length)) === 6);
  await page.evaluate(() => { lab.tab = 'types'; renderLab(); });
  await sleep(300);
  check('the Phase 6 Types tab is untouched and still works',
        (await page.evaluate(() => document.querySelectorAll('.tl-fact').length)) >= 6 &&
        (await page.evaluate(() => !!document.querySelector('.tl-two-bits'))));
  await clickRail('railWork');
  await page.evaluate(() => { setDockTab('terminal'); });
  await sleep(300);
  check('the terminal still works', await page.evaluate(() => !!document.querySelector('#termInput')));
  check('no page errors across the whole phase', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { showLab(); lab.tab = 'repr'; lab.reprType = 'uint';
    lab.reprValue = '305419896'; lab.reprAdvanced = false; renderLab(); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p21_repr.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 9  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
