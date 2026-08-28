'use strict';
/* Phase 12e — integer representation, limits, two's complement, overflow.

   These are behavioural checks, not string checks. Where the UI shows a number,
   it is compared against the engine's own answer for the same type and pattern,
   so a view that prints 255 while the selected interpretation says -1 fails.

   The check this phase exists for: the interface must say that unsigned
   wraparound is DEFINED by C and signed overflow is UNDEFINED, and must not
   present a rollover as a portable C result. */
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
const T = (base, signed) => E.scalarT(base, signed);
const ungroup = (s) => String(s).replace(/,/g, '');

(async () => {
  console.log('=== Phase 12e · part 1: limits, from one formula ===');
  const want = [
    ['char',           T('char', true),   8,  '-128', '127'],
    ['unsigned char',  T('char', false),  8,  '0', '255'],
    ['short',          T('short', true),  16, '-32768', '32767'],
    ['unsigned short', T('short', false), 16, '0', '65535'],
    ['int',            T('int', true),    32, '-2147483648', '2147483647'],
    ['unsigned int',   T('int', false),   32, '0', '4294967295'],
    ['long',           T('long', true),   64, '-9223372036854775808', '9223372036854775807'],
    ['unsigned long',  T('long', false),  64, '0', '18446744073709551615'],
  ];
  for (const [name, t, bits, min, max] of want) {
    const L = E.limitsOf(t);
    check(name + ': ' + bits + ' bits, ' + min + ' .. ' + max,
          L.bits === bits && L.min === min && L.max === max,
          L.bits + ' bits ' + L.min + '..' + L.max);
  }
  check('signed and unsigned of the same width hold the SAME number of patterns',
        E.limitsOf(T('char', true)).patterns === E.limitsOf(T('char', false)).patterns &&
        E.limitsOf(T('char', true)).patterns === '256');
  check('patterns really is 2^N for every supported width',
        [T('char', true), T('short', true), T('int', true), T('long', true)]
          .every(t => { const L = E.limitsOf(t); return BigInt(L.patterns) === (1n << BigInt(L.bits)); }));
  check('the endpoint BIT PATTERNS are reported, not just the numbers',
        E.limitsOf(T('char', true)).minBits === '10000000' &&
        E.limitsOf(T('char', true)).maxBits === '01111111' &&
        E.limitsOf(T('char', false)).minBits === '00000000' &&
        E.limitsOf(T('char', false)).maxBits === '11111111');
  const w16 = E.limitsForWidth(16, true), w16u = E.limitsForWidth(16, false);
  check('the range calculator is generic over width and signedness',
        w16.min === '-32768' && w16.max === '32767' && w16u.max === '65535',
        w16.min + '..' + w16.max + ' / 0..' + w16u.max);

  console.log('\n=== Phase 12e · part 2: same bits, two interpretations ===');
  const both = (patternBits) => {
    const v = BigInt(parseInt(patternBits, 2));
    return { u: E.representation(v, T('char', false)).unsigned,
             s: E.representation(v, T('char', true)).signed,
             bin: E.representation(v, T('char', false)).binary };
  };
  const pat = [
    ['11111111', '255', '-1'],
    ['10000000', '128', '-128'],
    ['01111111', '127', '127'],
    ['00000000', '0', '0'],
  ];
  for (const [bits, u, s] of pat) {
    const r = both(bits);
    check(bits + ' is ' + u + ' unsigned and ' + s + ' signed',
          r.u === u && r.s === s && r.bin === bits, r.u + ' / ' + r.s);
  }
  check('the bits are IDENTICAL in both readings — only the label changes',
        E.representation(255n, T('char', false)).binary ===
        E.representation(-1n, T('char', true)).binary);

  console.log('\n=== Phase 12e · part 3: two\u2019s complement ===');
  const tc5 = E.twosComplementSteps(5, 8);
  check('+5 is 00000101', tc5.magnitudeBits === '00000101' && tc5.negative === false, tc5.magnitudeBits);
  check('inverting +5 gives 11111010', tc5.invertedBits === '11111010', tc5.invertedBits);
  check('adding one gives 11111011, the pattern for -5', tc5.plusOneBits === '11111011', tc5.plusOneBits);
  const tcm5 = E.twosComplementSteps(-5, 8);
  check('-5 is stored as 11111011', tcm5.storedBits === '11111011' && tcm5.negative === true, tcm5.storedBits);
  check('reading 11111011 back recovers magnitude 5 and sign 1',
        tcm5.magnitude === '5' && tcm5.signBit === 1 && tcm5.signedReading === '-5',
        'mag ' + tcm5.magnitude + ' sign ' + tcm5.signBit);
  const tcMin = E.twosComplementSteps(-128, 8);
  check('-128 is its own two\u2019s complement — the asymmetric endpoint',
        tcMin.storedBits === '10000000' && tcMin.plusOneBits === '10000000', tcMin.storedBits);

  console.log('\n=== Phase 12e · part 4: overflow, and what C actually promises ===');
  const ovOf = (src) => {
    const r = E.runToCompletion(src);
    for (let i = 0; i < r.history.length; i++) {
      const s = r.history.steps[i];
      if (s.exprs) for (const e of s.exprs) if (e.overflow) return e.overflow;
      if (s.detail && s.detail.overflow) return s.detail.overflow;
    }
    return null;
  };
  const uo = ovOf('int main(void){ unsigned int x; x = 4294967295; x = x + 1; return 0; }');
  check('unsigned overflow reports the UNSIGNED range, not a signed one',
        uo && uo.min === '0' && uo.max === '4294967295',
        uo ? uo.min + '..' + uo.max : 'no record');
  check('unsigned overflow is marked DEFINED and says so in words',
        uo.defined === true && /defined by C to wrap modulo/i.test(uo.rule));
  const so = ovOf('int main(void){ int x; x = 2147483647; x = x + 1; return 0; }');
  check('signed overflow is marked NOT defined',
        so && so.defined === false && so.isSigned === true);
  check('signed overflow is described as undefined behaviour, not as wrapping',
        /undefined behaviour/i.test(so.rule) && /does not promise/i.test(so.rule),
        so.rule.slice(0, 70));

  // what the engine really stores, for the narrowing cases the lab demonstrates
  const stored = (decl, start, op) => {
    const src = 'int main(void)\n{\n\t' + decl + '\tx;\n\n\tx = ' + start + ';\n\tx = x ' + op + ';\n\treturn (0);\n}';
    const r = E.runToCompletion(src);
    let last = null;
    for (let i = 0; i < r.history.length; i++) {
      const st = r.history.stateAt(i);
      const v = st.vars.find(x => x.name === 'x');
      if (v && !v.uninitialized) last = v.value;
    }
    return last;
  };
  check('unsigned char 255 + 1 stores 0', stored('unsigned char', '255', '+ 1') === '0',
        stored('unsigned char', '255', '+ 1'));
  check('unsigned char 0 - 1 stores 255', stored('unsigned char', '0', '- 1') === '255',
        stored('unsigned char', '0', '- 1'));
  check('signed char 127 + 1 stores -128 in THIS simulator',
        stored('char', '127', '+ 1') === '-128', stored('char', '127', '+ 1'));

  console.log('\n=== Phase 12e · part 5: the UI shows the engine\u2019s numbers ===');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1200 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.evaluate(() => { showLab(); lab.tab = 'types'; renderLab(); });
  await sleep(400);

  const facts = async () => page.evaluate(() => {
    const o = {};
    for (const e of document.querySelectorAll('.tl-fact'))
      o[e.querySelector('.tl-fact-k').textContent] = e.querySelector('.tl-fact-v').textContent.trim();
    return o;
  });
  const readings = async () => page.evaluate(() => ({
    bits: document.querySelector('.tl-two-bits').textContent.replace(/\s/g, ''),
    u: document.querySelectorAll('.tl-read')[0].querySelector('b').textContent.trim(),
    s: document.querySelectorAll('.tl-read')[1].querySelector('b').textContent.trim(),
    active: [...document.querySelectorAll('.tl-read.on')].length,
  }));

  // the explorer must agree with limitsOf for every type it offers
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-limtype]')]
    .map(e => e.dataset.limtype).filter((v, i, a) => a.indexOf(v) === i));
  let mismatch = [];
  for (const id of ids) {
    await page.evaluate((x) => {
      document.querySelector('.tl-types [data-limtype="' + x + '"]').click();
    }, id);
    await sleep(120);
    const f = await facts();
    const eng = await page.evaluate((x) => {
      const t = LIMIT_TYPES.find(y => y.id === x).make();
      const L = CEngine.limitsOf(t);
      return { min: L.min, max: L.max, bits: L.bits, patterns: L.patterns };
    }, id);
    if (ungroup(f.minimum) !== eng.min || ungroup(f.maximum) !== eng.max ||
        f.width !== eng.bits + ' bits' || ungroup(f['bit patterns']) !== eng.patterns) {
      mismatch.push(id + ': ui ' + f.minimum + '..' + f.maximum + ' vs engine ' + eng.min + '..' + eng.max);
    }
  }
  check('every type in the explorer prints the engine\u2019s own limits',
        mismatch.length === 0, mismatch.length ? mismatch.join(' | ') : ids.length + ' types checked');

  // the bit editor: clicking a bit must change the value the way the engine says
  await page.evaluate(() => { lab.bitWidth = 8; lab.bitPattern = 255n; lab.bitSigned = false; renderLab(); });
  await sleep(250);
  let r = await readings();
  check('11111111 shows 255 unsigned and -1 signed at the same time',
        r.bits === '11111111' && r.u === '255' && r.s === '-1', JSON.stringify(r));
  await page.evaluate(() => document.querySelector('[data-bit="7"]').click());
  await sleep(250);
  r = await readings();
  check('clicking the MSB gives 01111111 = 127 in BOTH readings',
        r.bits === '01111111' && r.u === '127' && r.s === '127', JSON.stringify(r));
  await page.evaluate(() => { lab.bitPattern = 128n; renderLab(); });
  await sleep(250);
  r = await readings();
  check('10000000 is 128 unsigned but -128 signed',
        r.u === '128' && r.s === '-128', JSON.stringify(r));

  // the switch changes which reading is active WITHOUT changing the bits
  const beforeSwitch = (await readings()).bits;
  await page.evaluate(() => document.querySelector('[data-signed="1"]').click());
  await sleep(220);
  const afterSwitch = await readings();
  check('switching interpretation does not alter a single bit',
        afterSwitch.bits === beforeSwitch && afterSwitch.active === 1,
        beforeSwitch + ' -> ' + afterSwitch.bits);
  check('the active reading follows the switch',
        await page.evaluate(() =>
          document.querySelectorAll('.tl-read')[1].classList.contains('on')));

  // width change
  await page.evaluate(() => { [...document.querySelectorAll('[data-bitwidth]')].find(e => e.dataset.bitwidth === '16').click(); });
  await sleep(250);
  check('switching to 16-bit widens the pattern and the range accordingly',
        await page.evaluate(() => document.querySelectorAll('.vl-bitcell').length) === 16);

  // two's complement stages in the UI
  await page.evaluate(() => { lab.bitWidth = 8; lab.bitPattern = 251n; lab.bitSigned = true; renderLab(); });
  await sleep(280);
  const stages = await page.evaluate(() =>
    [...document.querySelectorAll('.tl-stage')].map(e => e.querySelector('.tl-stage-v').textContent.trim()));
  check('the UI walks 11111011 back to magnitude 5',
        stages.some(s => s.indexOf('00000101') >= 0) && stages.some(s => s.indexOf('11111011') >= 0),
        stages.join(' / '));

  // overflow: the two claims must both be present and must differ by case
  const claims = async () => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.tl-ovrow')].map(e => e.textContent.trim()),
    kinds: [...document.querySelectorAll('.tl-claim')].map(e => e.className.replace('tl-claim ', '')),
    text: [...document.querySelectorAll('.tl-claim-b')].map(e => e.textContent).join(' '),
  }));
  await page.evaluate(() => { lab.ovExpr = 'unsigned char'; lab.ovRun = null; renderLab(); });
  await sleep(300);
  let c = await claims();
  check('unsigned overflow shows the discarded carry and the stored 8 bits',
        c.rows.some(x => x.indexOf('100000000') >= 0) && c.rows.some(x => /stored: 0\b/.test(x)),
        c.rows.join(' | '));
  check('unsigned overflow is presented as DEFINED behaviour',
        c.kinds.indexOf('def') >= 0 && /defined/i.test(c.text) && /portable/i.test(c.text));
  check('unsigned overflow is NOT described as undefined behaviour',
        !/undefined behaviour/i.test(c.text));

  await page.evaluate(() => {
    [...document.querySelectorAll('[data-ovcase]')].find(e => e.dataset.ovcase === 'signed char').click();
  });
  await sleep(320);
  c = await claims();
  check('signed overflow is presented as UNDEFINED behaviour',
        c.kinds.indexOf('ub') >= 0 && /undefined behaviour/i.test(c.text),
        c.kinds.join(','));
  check('signed overflow explicitly warns it is not reliable wrapping',
        /not "wrapping that you can rely on"|assume it never happens/i.test(c.text));
  check('the bit-level story and the language rule are two SEPARATE claims',
        await page.evaluate(() => document.querySelectorAll('.tl-claim').length) === 2 &&
        await page.evaluate(() =>
          [...document.querySelectorAll('.tl-claim-h')].map(e => e.textContent).join('|')) ===
          'WHAT THE BITS DID|WHAT C GUARANTEES');

  // the reference table must be computed, not copied
  const table = await page.evaluate(() =>
    [...document.querySelectorAll('.tl-table tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => td.textContent.trim())));
  check('the limits table lists every type with computed values',
        table.length === 8 &&
        table.every(row => ungroup(row[4]) === E_min(row[0]) && ungroup(row[5]) === E_max(row[0])),
        table.map(r => r[0]).join(','));
  function E_min(label) { return limitsFor(label).min; }
  function E_max(label) { return limitsFor(label).max; }
  function limitsFor(label) {
    const m = { 'char':[ 'char', true], 'unsigned char':['char', false],
                'short':['short', true], 'unsigned short':['short', false],
                'int':['int', true], 'unsigned int':['int', false],
                'long':['long', true], 'unsigned long':['long', false] }[label];
    return E.limitsOf(T(m[0], m[1]));
  }
  check('the table says the widths are the simulated architecture\u2019s, not universal',
        await page.evaluate(() => {
          const n = [...document.querySelectorAll('.vl-note')].map(e => e.textContent).join(' ');
          return /depend on the compiler, the ABI/i.test(n) && /limits\.h/i.test(n);
        }));
  check('plain char is flagged as implementation-defined in signedness',
        await page.evaluate(() => {
          document.querySelector('.tl-types [data-limtype="char"]').click();
          return [...document.querySelectorAll('.vl-note')].some(e =>
            /implementation-defined/i.test(e.textContent));
        }));

  console.log('\n=== Phase 12e · part 6: memory \u2192 representation ===');
  await page.evaluate(() => showWorkspace());
  await sleep(200);
  const SRC = 'int main(void)\n{\n\tunsigned char\tx;\n\tunsigned char\t*p;\n\n\tx = 255;\n\tp = &x;\n\treturn (0);\n}';
  await page.evaluate((s) => { $('#sourceEdit').value = s; switchToEditing(); }, SRC);
  await sleep(150);
  await page.evaluate(() => {
    let last = -2;
    for (let i = 0; i < 4000 && !run.stopped; i++) {
      if (run.index === last && run.history) break;
      last = run.index; doStep();
    }
    for (let i = run.history.length - 1; i >= 0; i--) {
      const st = run.history.stateAt(i);
      if (st.frames.length && st.vars.length) { goTo(i); break; }
    }
  });
  await sleep(300);
  const obj = await page.evaluate(() => {
    const st = run.history.stateAt(run.index);
    const n = st.graph.nodes.find(x => x.label === 'x');
    ui.focusObject = n.blockId;
    openPanel('panelPointers');
    render();
    return { raw: n.valueRaw, ty: n.typeName };
  });
  await sleep(320);
  check('an integer object offers a link into the representation lab',
        await page.evaluate(() => !!document.querySelector('#pvOpenLab')));
  check('the link carries the object\u2019s REAL value and type',
        await page.evaluate(() => {
          const e = document.querySelector('#pvOpenLab');
          return e.dataset.val + '|' + e.dataset.ty;
        }) === obj.raw + '|' + obj.ty, obj.raw + '|' + obj.ty);
  await page.evaluate(() => document.querySelector('#pvOpenLab').click());
  await sleep(420);
  const bridged = await facts();
  const br = await readings();
  check('following it opens the Types tab on that object\u2019s type',
        bridged.type === 'unsigned char' && bridged.width === '8 bits' &&
        bridged.minimum === '0' && bridged.maximum === '255', JSON.stringify(bridged));
  check('and on that object\u2019s actual bit pattern, in its own interpretation',
        br.bits === '11111111' && br.u === '255' && br.s === '-1' &&
        await page.evaluate(() => document.querySelectorAll('.tl-read')[0].classList.contains('on')),
        JSON.stringify(br));
  check('the pointer graph still works after the bridge exists',
        await page.evaluate(() => {
          showWorkspace();
          const st = run.history.stateAt(run.index);
          const e = st.graph.edges.find(x => x.name === 'p');
          return !!e && e.kind === 'points-to';
        }));

  check('no page errors across the whole phase', errs.length === 0, errs.join(' | '));
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { showLab(); lab.tab = 'types'; renderLab(); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p16_types.png'), fullPage: true });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 12e  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
