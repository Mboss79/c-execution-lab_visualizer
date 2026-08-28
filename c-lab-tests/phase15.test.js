'use strict';
/* Phase 12d — the Value & Representation Lab.

   Two things these checks defend:
   1. ONE representation layer. Every number the lab shows must come from
      CEngine.representation / asciiInfo / conversionSteps, never from a private
      decimalToHex or asciiLookup inside a component.
   2. NO second evaluator. Arithmetic and comparisons must be whatever the
      execution engine really did, including integer promotion and short-circuit. */
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
const CH = E.scalarT('char', false);

(async () => {
  console.log('=== Phase 12d · part 1: the representation layer ===');

  // --- ASCII, the spec's exact cases ---
  const cases = [
    [65, '0x41', '01000001', '0101', 'A', 'upper'],
    [97, '0x61', '01100001', '0141', 'a', 'lower'],
    [48, '0x30', '00110000', '060',  '0', 'digit'],
    [0,  '0x00', '00000000', '0',    'NUL', 'control'],
    [9,  '0x09', '00001001', '011',  'TAB', 'control'],
    [10, '0x0a', '00001010', '012',  'LF',  'control'],
    [32, '0x20', '00100000', '040',  'SPACE', 'whitespace'],
  ];
  for (const [code, hex, bin, oct, disp, kind] of cases) {
    const r = E.representation(BigInt(code), CH);
    const a = E.asciiInfo(code);
    check(code + ' is ' + hex + ' / ' + bin + ' / octal ' + oct + ' / ' + disp,
          r.hex === hex && r.binary === bin && r.octal === oct &&
          a.display === disp && a.kind === kind,
          r.hex + ' ' + r.binary + ' ' + r.octal + ' ' + a.display + ' ' + a.kind);
  }
  check('control characters are marked as control, not printable',
        E.asciiInfo(10).printable === false && E.asciiInfo(65).printable === true);
  check('the table is exactly the 128 codes of 7-bit ASCII',
        E.ASCII_TABLE.length === 128 && E.ASCII_TABLE[127].name === 'DEL');
  check('a byte above 127 is reported as NOT ASCII rather than given a glyph',
        E.asciiInfo(200) === null && E.representation(200n, CH).ascii === null);

  // --- every conversion direction the spec lists ---
  console.log('\n=== Phase 12d · part 2: conversion, in both directions ===');
  const parses = [
    ['65', 65n, 'decimal'], ['0x41', 65n, 'hex'], ['01000001', 65n, 'binary'],
    ["'A'", 65n, 'char'], ['0b1000001', 65n, 'binary'], ['0177', 127n, 'octal'],
  ];
  for (const [text, val, from] of parses) {
    const p = E.parseValueInput(text);
    check('reads ' + text + ' as ' + from + ' = ' + val,
          p.ok && p.value === val && p.from === from,
          p.ok ? p.value + ' (' + p.from + ')' : p.error);
  }
  check('01000001 reads as BINARY, not as C octal',
        E.parseValueInput('01000001').value === 65n);
  check('but the C-octal reading of a leading-zero binary string is DISCLOSED',
        E.parseValueInput('01000001').ambiguous &&
        E.parseValueInput('01000001').ambiguous.value === '262145',
        JSON.stringify(E.parseValueInput('01000001').ambiguous));
  check('garbage is rejected with a message, not silently coerced',
        E.parseValueInput('zzz!').ok === false);

  const bin = E.conversionSteps(65n, 'binary');
  check('decimal to binary shows the repeated division, reading upward to 1000001',
        bin.rows.length === 7 && bin.rows[0].remainder === '1' && bin.read === '1000001',
        bin.read);
  const dec = E.conversionSteps(65n, 'decimal');
  check('binary to decimal shows the positional sum reaching 65',
        dec.terms.length === 7 && dec.read === '65' &&
        dec.terms.filter(t => t.bit === '1').map(t => t.weight).join('+') === '64+1',
        dec.terms.filter(t => t.bit === '1').map(t => t.weight).join('+'));

  // --- width and signedness are respected (this is what Phase 6 builds on) ---
  console.log('\n=== Phase 12d · part 3: width and signedness ===');
  const asChar = E.representation(65n, CH), asInt = E.representation(65n, E.scalarT('int', true));
  check('the same value reports different widths for char and int',
        asChar.bits === 8 && asInt.bits === 32 && asChar.decimal === asInt.decimal,
        asChar.bits + ' vs ' + asInt.bits + ' bits');
  check('binary is padded to the type width, not to the value',
        asChar.binary.length === 8 && asInt.binary.length === 32);
  const neg = E.representation(-1n, E.scalarT('char', true));
  check('a signed char holding -1 reads as 255 unsigned and -1 signed',
        neg.unsigned === '255' && neg.signed === '-1' && neg.binary === '11111111',
        neg.binary + ' u=' + neg.unsigned + ' s=' + neg.signed);
  check('signedness is reported so Phase 6 can build on it',
        E.representation(65n, E.scalarT('char', false)).isSigned === false &&
        E.representation(65n, E.scalarT('char', true)).isSigned === true);
  const cells = asChar.bitCells;
  check('bit cells carry index and positional weight, high bit first',
        cells.length === 8 && cells[0].index === 7 && cells[0].weight === '128' &&
        cells[7].weight === '1' &&
        cells.filter(c => c.bit).map(c => c.weight).join('+') === '64+1',
        cells.filter(c => c.bit).map(c => c.weight).join('+'));

  // --- arithmetic and comparison come from the ENGINE ---
  console.log('\n=== Phase 12d · part 4: the engine evaluates, the lab reports ===');
  const runExpr = (expr) => {
    const src = 'int main(void)\n{\n\tint\t_r;\n\n\t_r = (' + expr + ');\n\treturn (0);\n}';
    const r = E.runToCompletion(src);
    const exprs = [];
    for (let i = 0; i < r.history.length; i++) {
      const st = r.history.steps[i];
      if (st.exprs) for (const ex of st.exprs) exprs.push(ex);
    }
    return { r, exprs };
  };
  const arith = [
    ["'A' + 1", '66'], ["'a' - 'A'", '32'], ["'7' - '0'", '7'], ['5 + 3', '8'], ['10 - 4', '6'],
  ];
  for (const [expr, want] of arith) {
    const { exprs } = runExpr(expr);
    const top = exprs[exprs.length - 1];
    check(expr + ' = ' + want + ' (from the engine)', top && top.result === want,
          top ? top.result : 'no operand record');
  }
  const cmps = [
    ["'A' < 'a'", '1'], ["'A' >= 'a'", '0'], ["'0' <= '9'", '1'],
    ["'A' == 'A'", '1'], ["'A' != 'A'", '0'],
  ];
  for (const [expr, want] of cmps) {
    const { exprs } = runExpr(expr);
    const top = exprs[exprs.length - 1];
    check(expr + ' is ' + (want === '1' ? 'true' : 'false'), top && top.result === want,
          top ? top.result : 'no record');
  }
  const promo = runExpr("'A' + 1").exprs[0];
  check('char + int is recorded with the promoted result type, not as char',
        promo.typeName === 'int' && promo.operands[0].typeName === 'char',
        promo.operands[0].typeName + ' + ' + promo.operands[1].typeName + ' -> ' + promo.typeName);
  const rangeOk = runExpr("'m' >= 'a' && 'm' <= 'z'");
  const logical = rangeOk.exprs.find(e => e.kind === 'logical');
  check('a range check records both comparisons AND the && that joins them',
        rangeOk.exprs.length === 3 && logical && logical.result === '1',
        rangeOk.exprs.map(e => e.expr).join(' | '));
  const shorted = runExpr("'A' >= 'a' && 'A' <= 'z'").exprs.find(e => e.kind === 'logical');
  check('&& short-circuits, and the skipped operand says so rather than showing a value',
        shorted.shortCircuited === true && shorted.operands[1].valueText === 'not evaluated',
        JSON.stringify(shorted.operands[1].valueText));
  check('|| short-circuits too',
        runExpr("'a' >= 'a' || 'a' <= 'z'").exprs.find(e => e.kind === 'logical').shortCircuited === true);

  // --- no second implementation anywhere in the shipped file ---
  console.log('\n=== Phase 12d · part 5: one source of truth ===');
  const html = fs.readFileSync(HTML, 'utf8');
  const labSrc = html.slice(html.indexOf('==== VALUELAB START ===='), html.indexOf('==== VALUELAB END ===='));
  check('the lab ships between its markers', labSrc.length > 3000, labSrc.length + ' bytes');
  check('the lab defines no private hex/binary/ascii conversion of its own',
        !/function\s+(decimalToHex|toHex|toBinary|asciiLookup|charCodeTable)/.test(labSrc) &&
        labSrc.indexOf('String.fromCharCode') < 0,
        'no private converters');
  check('the lab asks the engine for every representation',
        (labSrc.match(/CEngine\.representation\(/g) || []).length >= 3 &&
        labSrc.indexOf('CEngine.asciiInfo') >= 0 &&
        labSrc.indexOf('CEngine.conversionSteps') >= 0);
  check('the lab evaluates expressions through the real engine',
        labSrc.indexOf('CEngine.runToCompletion') >= 0);

  // --- the UI ---
  console.log('\n=== Phase 12d · part 6: the lab in the browser ===');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1050 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);

  check('the lab is reachable from the existing rail, not a new nav system',
        await page.evaluate(() => !!document.querySelector('#railLab')));
  await page.evaluate(() => document.querySelector('#railLab').click());
  await sleep(400);
  check('opening it shows the lab',
        await page.evaluate(() => getComputedStyle(document.querySelector('#labRoot')).display === 'block'));
  const tabIds = await page.evaluate(() =>
    [...document.querySelectorAll('.vl-tab')].map(e => e.dataset.labtab));
  const wantOrder = ['ascii', 'convert', 'bits', 'arith', 'compare'];
  check('the tools are one coherent area, not separate pages',
        JSON.stringify(tabIds.slice(0, 5)) === JSON.stringify(wantOrder) &&
        (await page.evaluate(() => document.querySelectorAll('.vl-tabs').length)) === 1,
        tabIds.join(','));
  check('all 128 ASCII rows render', await page.evaluate(() => document.querySelectorAll('.vl-row').length) === 128);

  const strip = async () => page.evaluate(() => {
    const o = {};
    for (const e of document.querySelectorAll('.vl-rep'))
      o[e.querySelector('.vl-rep-k').textContent] = e.querySelector('.vl-rep-v').textContent.trim();
    return o;
  });
  await page.evaluate(() => [...document.querySelectorAll('.vl-row')].find(e => e.dataset.code === '65').click());
  await sleep(280);
  let s = await strip();
  check('clicking A in the table shows 65 / 0x41 / 0101 / 01000001 together',
        s.decimal === '65' && s.hex === '0x41' && s.octal === '0101' &&
        s.binary === '01000001' && s.ascii === "'A'", JSON.stringify(s));

  // the converter, every direction, against the engine
  await page.evaluate(() => [...document.querySelectorAll('.vl-tab')].find(e => e.dataset.labtab === 'convert').click());
  await sleep(250);
  for (const input of ['0x41', '01000001', "'A'", '65']) {
    await page.evaluate((v) => {
      const i = document.querySelector('#labInput');
      i.value = v; i.dispatchEvent(new Event('input', { bubbles: true }));
    }, input);
    await sleep(200);
    s = await strip();
    const eng = E.representation(65n, CH);
    check('typing ' + input + ' yields the engine\u2019s representation of 65',
          s.decimal === eng.decimal && s.hex === eng.hex && s.octal === eng.octal &&
          s.binary === eng.binary, JSON.stringify(s.hex + ' ' + s.binary));
  }
  check('the leading-zero ambiguity is surfaced in the UI, not hidden',
        await page.evaluate(() => {
          const i = document.querySelector('#labInput');
          i.value = '01000001'; i.dispatchEvent(new Event('input', { bubbles: true }));
          return !!document.querySelector('.vl-warn');
        }));
  await page.evaluate(() => document.querySelector('#labSteps').click());
  await sleep(250);
  check('Show steps reveals both the division method and the positional method',
        await page.evaluate(() => document.querySelectorAll('.vl-steps').length) === 2);

  // switching the type must re-read the SAME value at a different width
  await page.evaluate(() => [...document.querySelectorAll('[data-labtype]')].find(e => e.dataset.labtype === 'int').click());
  await sleep(250);
  s = await strip();
  check('reinterpreting as int widens the binary but keeps the value',
        s.decimal === '65' && s.binary.replace(/ /g, '').length === 32 && s.width === '32 bits · 4 B',
        s.width + ' / ' + s.binary);
  await page.evaluate(() => [...document.querySelectorAll('[data-labtype]')].find(e => e.dataset.labtype === 'char').click());
  await sleep(200);

  // arithmetic in the UI, compared against the engine
  await page.evaluate(() => [...document.querySelectorAll('.vl-tab')].find(e => e.dataset.labtab === 'arith').click());
  await sleep(350);
  const arithUI = await page.evaluate(() => ({
    src: [...document.querySelectorAll('.vl-expr-src')].map(e => e.textContent.trim()),
    res: [...document.querySelectorAll('.vl-expr-res-v')].map(e => e.textContent.trim()),
    bits: [...document.querySelectorAll('.vl-binop')].map(e => e.textContent.trim()),
    note: [...document.querySelectorAll('.vl-note')].map(e => e.textContent).join(' '),
    badge: document.querySelector('.vl-engine-badge') ? document.querySelector('.vl-engine-badge').textContent : '',
  }));
  check("'A' + 1 shows the staged result 66 from the engine",
        arithUI.src[0] === "'A' + 1" && arithUI.res[0] === '66', JSON.stringify(arithUI.res));
  check('the addition is also shown in binary columns',
        arithUI.bits.length === 3 && arithUI.bits[0] === '01000001' &&
        arithUI.bits[2] === '01000010', JSON.stringify(arithUI.bits));
  check('integer promotion is explained rather than pretended away',
        /integer promotion/i.test(arithUI.note), arithUI.note.slice(0, 80));
  check('the panel states that the execution engine produced this',
        /execution engine/i.test(arithUI.badge), arithUI.badge.trim());
  check('an int operand is NOT annotated with an ASCII control-character name',
        await page.evaluate(() => {
          const opnds = [...document.querySelectorAll('.vl-opnd')];
          const one = opnds.find(o => o.querySelector('.vl-opnd-src').textContent.trim() === '1');
          return one && !one.querySelector('.vl-opnd-ascii');
        }), 'the literal 1 is not called SOH');

  // comparison + range check + short-circuit in the UI
  await page.evaluate(() => [...document.querySelectorAll('.vl-tab')].find(e => e.dataset.labtab === 'compare').click());
  await sleep(300);
  await page.evaluate(() => {
    const i = document.querySelector('#labExprInput');
    i.value = "'m' >= 'a' && 'm' <= 'z'";
    document.querySelector('#labExprGo').click();
  });
  await sleep(350);
  const cmpUI = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.vl-expr')].map(e => ({
      src: e.querySelector('.vl-expr-src').textContent.trim(),
      res: e.querySelector('.vl-expr-res-v').textContent.trim(),
    })),
    final: document.querySelector('.vl-final') ? document.querySelector('.vl-final').textContent.trim() : '',
  }));
  check('a range check shows both bounds and the && that combines them',
        cmpUI.cards.length === 3 && cmpUI.cards[2].res === 'true (1)',
        cmpUI.cards.map(c => c.src + '=' + c.res).join(' | '));
  check('comparison operands show their numeric ASCII codes',
        await page.evaluate(() => [...document.querySelectorAll('.vl-opnd-ascii')].length > 0));
  await page.evaluate(() => {
    const i = document.querySelector('#labExprInput');
    i.value = "'A' >= 'a' && 'A' <= 'z'";
    document.querySelector('#labExprGo').click();
  });
  await sleep(350);
  check('a short-circuited operand is shown as not evaluated, not as a value',
        await page.evaluate(() => {
          const sk = document.querySelector('.vl-opnd-skip');
          return !!sk && /not evaluated/i.test(sk.textContent);
        }));

  check('the lab names the simulated architecture its widths belong to',
        await page.evaluate(() => /simulated architecture/i.test(document.querySelector('.vl-foot').textContent)));
  check('leaving the lab restores the workspace',
        await page.evaluate(() => {
          showWorkspace();
          return getComputedStyle(document.querySelector('#labRoot')).display === 'none';
        }));
  check('no page errors anywhere in the lab', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => showLab());
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p15_lab.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 12d  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
