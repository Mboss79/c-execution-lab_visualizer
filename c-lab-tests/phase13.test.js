'use strict';
/* Phase 12b — memory architecture: the six linker sections.

   The engine decides which section an object lands in, using the rule a real
   toolchain uses. Every view reads that decision back. These checks fail if the
   classification drifts, if the sections stop being disjoint and ordered, if a
   view invents its own idea of where something lives, or if the honesty notes
   that keep the model from lying are dropped. */
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

const PROGRAM = [
  'int      initialized = 7;',
  'int      explicitZero = 0;',
  'int      uninitialized;',
  'char     name[6] = "Mboss";',
  'char     blank[8];',
  'int      allZero[3] = {0, 0, 0};',
  'int      someNonZero[3] = {0, 1, 0};',
  'int helper(int n)',
  '{',
  '\treturn (n * 2);',
  '}',
  'int main(void)',
  '{',
  '\tchar\t*lit;',
  '\tint\tlocal;',
  '\tchar\t*h;',
  '',
  '\tlit = "hello";',
  '\tlocal = helper(initialized);',
  '\th = malloc(4);',
  '\treturn (0);',
  '}',
].join('\n');

(async () => {
  console.log('=== Phase 12b · part 1: the linker rule (engine) ===');
  const E = load();
  const r = E.runToCompletion(PROGRAM);
  check('the program with every storage class runs', r.ok, r.ok ? '' : String(r.message));
  const blocks = r.stepper.I.blocks;
  const sec = (label) => { const b = blocks.find(x => x.label === label); return b ? b.section : '(missing)'; };

  const WANT = [
    ['initialized',   'data',   'a non-zero initializer goes in .data'],
    ['explicitZero',  'bss',    'an explicit = 0 still goes in .bss'],
    ['uninitialized', 'bss',    'no initializer goes in .bss'],
    ['name',          'data',   'a string-initialized array goes in .data'],
    ['blank',         'bss',    'an uninitialized array goes in .bss'],
    ['allZero',       'bss',    'an all-zero initializer list goes in .bss'],
    ['someNonZero',   'data',   'one non-zero element puts the list in .data'],
    ['"hello"',       'rodata', 'a string literal goes in .rodata'],
    ['lit',           'stack',  'a local pointer lives on the stack'],
    ['local',         'stack',  'a local int lives on the stack'],
    ['malloc(4)',     'heap',   'malloc returns heap memory'],
    ['main()',        'text',   'a function has an entry point in .text'],
    ['helper()',      'text',   'every function gets one, not just main'],
  ];
  for (const [label, want, why] of WANT) {
    check(why, sec(label) === want, label + ' -> ' + sec(label));
  }

  console.log('\n=== Phase 12b · part 2: one address space ===');
  const ranges = {};
  for (const s of ['text', 'rodata', 'data', 'bss', 'heap', 'stack']) {
    const bs = blocks.filter(b => b.section === s);
    if (bs.length) ranges[s] = [Math.min(...bs.map(b => b.base)), Math.max(...bs.map(b => b.base + b.size))];
  }
  const order = ['text', 'rodata', 'data', 'bss', 'heap', 'stack'].filter(s => ranges[s]);
  check('every section is present in a program that uses them all',
        order.length === 6, order.join(' < '));
  let ordered = true, overlap = null;
  for (let i = 0; i + 1 < order.length; i++) {
    if (ranges[order[i]][1] > ranges[order[i + 1]][0]) { ordered = false; overlap = order[i] + '/' + order[i + 1]; }
  }
  check('sections occupy disjoint ranges, low to high, in linker order',
        ordered, ordered ? order.map(s => s + '@0x' + ranges[s][0].toString(16)).join(' ') : 'overlap at ' + overlap);
  check('.data and .bss are separate ranges, not one "static" blob',
        ranges.data && ranges.bss && ranges.data[1] <= ranges.bss[0],
        '.data ends 0x' + ranges.data[1].toString(16) + ', .bss starts 0x' + ranges.bss[0].toString(16));
  check('the stack holds the highest addresses and grows down',
        ranges.stack[0] > ranges.heap[1], 'stack 0x' + ranges.stack[0].toString(16));

  console.log('\n=== Phase 12b · part 3: region is DERIVED, never assigned ===');
  const MAP = { text:'text', rodata:'static', data:'global', bss:'global', heap:'heap', stack:'stack' };
  const wrong = blocks.filter(b => MAP[b.section] !== b.region)
                      .map(b => b.label + ':' + b.section + '/' + b.region);
  check('every block\'s region matches the section it was derived from',
        wrong.length === 0, wrong.length ? wrong.join(', ') : blocks.length + ' blocks');
  check('the pre-section region vocabulary is unchanged, so old consumers still work',
        blocks.find(b => b.label === 'initialized').region === 'global' &&
        blocks.find(b => b.label === '"hello"').region === 'static' &&
        blocks.find(b => b.label === 'malloc(4)').region === 'heap');
  check('a string literal is still read-only',
        blocks.find(b => b.label === '"hello"').readonly === true);

  console.log('\n=== Phase 12b · part 4: the model does not lie ===');
  const html = fs.readFileSync(HTML, 'utf8');
  check('SIMPLIFICATIONS says .rodata is not physical ROM',
        /rodata is not physical ROM/i.test(html));
  check('SIMPLIFICATIONS says function code size is not modelled',
        /SIZE of a function's code is not modelled|not drawn to scale/i.test(html));
  check('SIMPLIFICATIONS says section bases are illustrative and ASLR moves them',
        /ASLR/i.test(html) && /illustrative/i.test(html));

  console.log('\n=== Phase 12b · part 5: the views read the engine ===');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(FILE, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  await p.evaluate(() => { showWorkspace(); setLevel('deep'); });
  await p.evaluate((s) => { document.querySelector('#sourceEdit').value = s; switchToEditing(); }, PROGRAM);
  await sleep(200);
  await p.evaluate(() => {
    let last = -2;
    for (let i = 0; i < 4000 && !run.stopped; i++) {
      if (run.index === last && run.history) break;
      last = run.index; doStep();
    }
  });
  await sleep(400);
  await p.evaluate(() => openPanel('panelRam'));
  await sleep(400);

  const nav = await p.evaluate(() => [...document.querySelectorAll('#ramNav button')].map(e => e.dataset.seg));
  check('the RAM map offers all six sections',
        JSON.stringify(nav) === JSON.stringify(['stack','heap','bss','data','rodata','text']), nav.join(','));

  const view = await p.evaluate(() => ({
    segs: [...document.querySelectorAll('#ramPanel .ram-seg')].map(e => e.dataset.seg),
    caps: [...document.querySelectorAll('#ramPanel .ram-addr-cap')].map(e => e.textContent.trim()),
    note: document.querySelector('#ramPanel .ram-note') ? document.querySelector('#ramPanel .ram-note').textContent : '',
    addrs: [...document.querySelectorAll('#ramPanel .ram-seg')].map(e => {
      const a = e.querySelector('.ram-seg-addr');
      return { seg: e.dataset.seg, txt: a ? a.textContent.trim() : null };
    }),
  }));
  check('the map is drawn high address at the top, low at the bottom',
        view.caps[0] === 'HIGH ADDRESS' && view.caps[view.caps.length - 1] === 'LOW ADDRESS', view.caps.join(' -> '));
  check('the map shows the sections in address order',
        JSON.stringify(view.segs) === JSON.stringify(['stack','heap','bss','data','rodata','text']), view.segs.join(','));
  check('each section shows its real address range from the engine',
        view.addrs.every(a => a.txt && (/0x[0-9a-f]+ – 0x[0-9a-f]+/.test(a.txt) || /nothing allocated/.test(a.txt))),
        JSON.stringify(view.addrs.find(a => a.seg === 'data')));
  check('the map says this is a virtual address space, not physical RAM',
        /virtual address space/i.test(view.note) && /not physical RAM/i.test(view.note));

  // the engine's .data range must be the one the view prints
  const dataRange = await p.evaluate(() => {
    const e = [...document.querySelectorAll('#ramPanel .ram-seg')].find(x => x.dataset.seg === 'data');
    return e.querySelector('.ram-seg-addr').textContent.trim();
  });
  check('the printed .data range is the engine\'s .data range, not a guess',
        dataRange.indexOf('0x' + ranges.data[0].toString(16)) === 0,
        dataRange + ' vs engine 0x' + ranges.data[0].toString(16));

  // clicking a section filters the memory panel to the same section
  await p.evaluate(() => {
    [...document.querySelectorAll('#ramPanel .ram-seg')].find(e => e.dataset.seg === 'rodata').click();
  });
  await sleep(350);
  const filtered = await p.evaluate(() => ({
    focus: ui.focusRegion,
    objs: [...document.querySelectorAll('#ramPanel .ram-seg.focused .ram-o .ro-n')].map(e => e.textContent),
    memNote: document.querySelector('#memPanel .inspect-note')
      ? document.querySelector('#memPanel .inspect-note').textContent : '',
  }));
  check('clicking .rodata focuses it and lists only what lives there',
        filtered.focus === 'rodata' && filtered.objs.length === 1 && filtered.objs[0].indexOf('hello') >= 0,
        JSON.stringify(filtered.objs));
  check('the memory panel agrees with the RAM map about the focused section',
        /\.rodata/.test(filtered.memNote), filtered.memNote.replace(/\s+/g, ' ').trim());

  check('no page errors while rendering the memory architecture', errs.length === 0, errs.join(' | '));
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await p.screenshot({ path: path.join(SHOTS, 'p13_sections.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 12b  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
