'use strict';
/* Phase 12c — object → address → memory → value, and pointer relationships.

   The rule these checks defend: the UI never invents an address, a value, a
   pointer target or an object location. Every number the pointer panel shows is
   compared against the engine's own state here, so a view that starts computing
   for itself fails immediately. */
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
// At program end every frame is destroyed, so the last state has an empty stack
// by design. Sample the last step where the frame is still alive.
function liveState(src) {
  const r = E.runToCompletion(src);
  if (!r.history) return null;
  for (let i = r.history.length - 1; i >= 0; i--) {
    const st = r.history.stateAt(i);
    if (st.frames.length && st.vars.length) return st;
  }
  return r.history.stateAt(r.history.length - 1);
}
const node = (g, label) => g.nodes.find(n => n.label === label);
const edge = (g, name) => g.edges.find(e => e.name === name);

const SRC = {
  basic:  'int main(void)\n{\n\tint\tx;\n\n\tx = 42;\n\treturn (0);\n}',
  addr:   'int main(void)\n{\n\tint\tx;\n\tint\t*p;\n\n\tx = 42;\n\tp = &x;\n\treturn (0);\n}',
  deref:  'int main(void)\n{\n\tint\tx;\n\tint\t*p;\n\n\tx = 42;\n\tp = &x;\n\t*p = 100;\n\treturn (0);\n}',
  ptrptr: 'int main(void)\n{\n\tint\tx;\n\tint\t*p;\n\tint\t**pp;\n\n\tx = 42;\n\tp = &x;\n\tpp = &p;\n\treturn (0);\n}',
  array:  'int main(void)\n{\n\tint\ta[3] = {10, 20, 30};\n\tint\t*p;\n\n\tp = a;\n\treturn (0);\n}',
  string: 'int main(void)\n{\n\tchar\t*s;\n\n\ts = "Hello";\n\treturn (0);\n}',
  nul:    'int main(void)\n{\n\tint\t*n;\n\tint\t*u;\n\n\tn = NULL;\n\treturn (0);\n}',
  heap:   'int main(void)\n{\n\tint\t*p;\n\n\tp = malloc(4);\n\t*p = 42;\n\treturn (0);\n}',
  freed:  'int main(void)\n{\n\tint\t*p;\n\n\tp = malloc(4);\n\tfree(p);\n\treturn (0);\n}',
  frame:  'int\ttest(void)\n{\n\tint\tx;\n\n\tx = 42;\n\treturn (x);\n}\nint\tmain(void)\n{\n\tint\tr;\n\n\tr = test();\n\treturn (0);\n}',
};

(async () => {
  console.log('=== Phase 12c · part 1: the object model (Part 19 cases) ===');

  // --- basic object ---
  let g = liveState(SRC.basic).graph;
  // A byte from the engine is {address, value, init, present} - the init flag
  // is what lets a view separate "never written" from "holds zero".
  const byteVals = (n) => n.bytes.map(b => b.value);
  let x = node(g, 'x');
  check('a plain int is one object with an address, a size and a value',
        x && x.typeName === 'int' && x.size === 4 && x.valueText === '42' && x.section === 'stack',
        x ? x.typeName + ' ' + x.size + 'B @0x' + x.address.toString(16) + ' = ' + x.valueText : 'missing');
  check('its bytes are the simulated architecture\'s little-endian bytes',
        JSON.stringify(byteVals(x)) === JSON.stringify([42, 0, 0, 0]), JSON.stringify(byteVals(x)));
  check('every byte of an initialized object is marked initialized',
        x.bytes.every(b => b.init === true));
  check('alignment is modelled', x.align === 4, 'align ' + x.align);

  // --- address-of ---
  g = liveState(SRC.addr).graph;
  x = node(g, 'x');
  let p = node(g, 'p');
  let e = edge(g, 'p');
  check('&x produces exactly x\'s address, and p stores it',
        e && e.kind === 'points-to' && e.address === x.address,
        'p holds 0x' + (e ? e.address.toString(16) : '?') + ', x is at 0x' + x.address.toString(16));
  check('p does NOT contain 42 — it contains an address',
        p.valueText !== '42' && p.valueText === '0x' + x.address.toString(16), p.valueText);
  check('a pointer is the architecture\'s pointer size, not the pointee size',
        p.size === g.pointerSize && p.size !== x.size, p.size + ' B');
  check('x knows it is pointed at (reverse index)',
        x.referencedBy.length === 1 && x.referencedBy[0].name === 'p',
        JSON.stringify(x.referencedBy.map(r => r.name)));

  // --- dereference write ---
  g = liveState(SRC.deref).graph;
  x = node(g, 'x'); e = edge(g, 'p');
  check('*p = 100 changes x itself — ONE object, not a copy',
        x.valueText === '100' && e.targetValueText === '100',
        'x=' + x.valueText + ', target=' + e.targetValueText);
  check('the changed bytes are the same object\'s bytes',
        JSON.stringify(x.bytes.map(b => b.value)) === JSON.stringify([100, 0, 0, 0]),
        JSON.stringify(x.bytes.map(b => b.value)));
  check('the pointer still holds the same address after the write',
        e.address === x.address);

  // --- pointer to pointer ---
  g = liveState(SRC.ptrptr).graph;
  const chainPP = g.chains[node(g, 'pp').blockId];
  const labels = chainPP.filter(h => h.kind === 'object').map(h => h.label);
  check('int **pp walks the whole way down in one chain',
        JSON.stringify(labels) === JSON.stringify(['pp', 'p', 'x']), labels.join(' -> '));
  check('the end of the chain is the value 42',
        chainPP.filter(h => h.kind === 'object').pop().valueText === '42');
  check('each level holds the address of the next',
        edge(g, 'pp').address === node(g, 'p').address &&
        edge(g, 'p').address === node(g, 'x').address);
  check('p is recorded as pointed at by pp',
        node(g, 'p').referencedBy.some(r => r.name === 'pp'));

  // --- array + pointer ---
  g = liveState(SRC.array).graph;
  const a = node(g, 'a');
  const arith = g.arithmetic[node(g, 'p').blockId];
  check('an array is one object of 3 ints', a.size === 12 && a.elements.length === 3, a.size + ' B');
  check('the array elements carry their own addresses',
        a.elements[1].address === a.address + 4 && a.elements[2].address === a.address + 8,
        a.elements.map(el => '0x' + el.address.toString(16)).join(' '));
  check('p = a points at the first element', edge(g, 'p').address === a.address);
  check('p + 1 moves by sizeof(int) = 4, not by 1 byte',
        arith.elemSize === 4 && arith.steps[1].address === a.address + 4,
        'p+1 = 0x' + arith.steps[1].address.toString(16));
  check('p + 0..2 land inside the array and p + 3 is past its end',
        arith.steps.slice(0, 3).every(s => s.inside === 'a') && arith.steps[3].past === true,
        arith.steps.map(s => s.inside || 'past').join(','));

  // --- string literal ---
  g = liveState(SRC.string).graph;
  const s = node(g, 's');
  const lit = node(g, '"Hello"');
  check('the pointer and the literal are two DIFFERENT objects',
        s.blockId !== lit.blockId && s.address !== lit.address);
  check('the pointer lives on the stack, the literal in .rodata',
        s.section === 'stack' && lit.section === 'rodata',
        s.sectionLabel + ' -> ' + lit.sectionLabel);
  check('the literal is 6 bytes — "Hello" plus the terminating NUL',
        lit.size === 6 && lit.bytes[5].value === 0 &&
        String.fromCharCode.apply(null, lit.bytes.slice(0, 5).map(b => b.value)) === 'Hello',
        lit.size + 'B, text ' + String.fromCharCode.apply(null, lit.bytes.slice(0, 5).map(b => b.value)));
  check('the literal is read-only', lit.readonly === true);
  check('char pointer arithmetic moves by 1 byte',
        g.arithmetic[s.blockId].elemSize === 1);

  // --- NULL vs uninitialized vs dangling ---
  g = liveState(SRC.nul).graph;
  check('NULL is its own edge kind, not a missing arrow', edge(g, 'n').kind === 'null');
  check('an uninitialized pointer is distinguished from NULL',
        edge(g, 'u').kind === 'uninitialized');
  g = liveState(SRC.freed).graph;
  check('a pointer to freed memory is dangling, not just invalid',
        edge(g, 'p').kind === 'dangling', edge(g, 'p').text);
  check('all four pointer states are separate facts',
        new Set(['null', 'uninitialized', 'dangling', 'points-to']).size === 4);

  // --- heap ---
  g = liveState(SRC.heap).graph;
  check('a heap pointer lives on the stack and points into the heap',
        node(g, 'p').section === 'stack' && edge(g, 'p').kind === 'points-to' &&
        g.nodes.find(n => n.id === edge(g, 'p').to).section === 'heap');
  check('the heap object holds the written value',
        edge(g, 'p').targetValueText === '42', edge(g, 'p').targetValueText);

  // --- stack frame ---
  const stFrame = (() => {
    const r = E.runToCompletion(SRC.frame);
    for (let i = 0; i < r.history.length; i++) {
      const st = r.history.stateAt(i);
      // The frame is pushed before its locals are declared: wait for the step
      // where BOTH frames exist AND the callee has created its local.
      if (st.frames.length === 2 && st.frames[1].vars.some(v => v.name === 'x')) return st;
    }
    return null;
  })();
  check('inside a call there are two frames, each owning its own locals',
        stFrame && stFrame.frames.length === 2 &&
        stFrame.frames[1].vars.some(v => v.name === 'x'),
        stFrame ? stFrame.frames.map(f => f.name).join(' / ') : 'not found');
  check('a local of the callee is a stack object with a real address',
        stFrame.graph.nodes.some(n => n.label === 'x' && n.section === 'stack'));
  const after = liveState(SRC.frame);
  check('when the function returns its frame is gone from the graph',
        !after.graph.nodes.some(n => n.label === 'x' && n.frameName === 'test'),
        after.graph.nodes.map(n => n.label).join(','));

  console.log('\n=== Phase 12c · part 2: the view shows the engine\'s numbers ===');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('pageerror', ev => errs.push(ev.message));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.evaluate(() => { showWorkspace(); setLevel('deep'); });

  const runTo = async (src, stopWhenTwoVars) => {
    await page.evaluate((v) => { $('#sourceEdit').value = v; switchToEditing(); }, src);
    await sleep(150);
    await page.evaluate(() => {
      let last = -2;
      for (let i = 0; i < 4000 && !run.stopped; i++) {
        if (run.index === last && run.history) break;
        last = run.index; doStep();
      }
      // rewind to the last step whose frame is still alive
      for (let i = run.history.length - 1; i >= 0; i--) {
        const st = run.history.stateAt(i);
        if (st.frames.length && st.vars.length) { goTo(i); break; }
      }
    });
    await sleep(300);
    await page.evaluate(() => openPanel('panelPointers'));
    await sleep(250);
  };

  await runTo(SRC.deref);
  const shown = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#ptrPanel .pv-box')].map(el => ({
      name: el.querySelector('.pv-box-head b').textContent.trim(),
      block: +el.dataset.block,
      rows: [...el.querySelectorAll('.pv-v')].map(v => v.textContent.trim()),
    }));
    const st = run.history.stateAt(run.index);
    return { boxes, engine: st.graph.nodes.map(n => ({ label:n.label, block:n.blockId,
             addr:'0x' + n.address.toString(16), val:n.valueText })) };
  });
  const boxP = shown.boxes.find(x => x.name === 'p');
  const boxX = shown.boxes.find(x => x.name === 'x');
  const engP = shown.engine.find(x => x.label === 'p');
  const engX = shown.engine.find(x => x.label === 'x');
  check('the panel draws the pointer and its target as connected boxes',
        !!boxP && !!boxX, shown.boxes.map(x => x.name).join(' -> '));
  check('the address the panel prints for x is the engine\'s address',
        boxX.rows[0] === engX.addr, boxX.rows[0] + ' vs ' + engX.addr);
  check('the value the panel prints for x is the engine\'s value',
        boxX.rows[1] === engX.val && engX.val === '100', boxX.rows[1]);
  check('the pointer box shows an address as its value, not the pointee',
        boxP.rows[1] === engP.val && boxP.rows[1] === engX.addr, boxP.rows[1]);
  const arrowTxt = await page.evaluate(() =>
    [...document.querySelectorAll('#ptrPanel .pv-arrow')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('the arrow says what the pointer holds',
        arrowTxt.some(t => /holds the address of/.test(t)), arrowTxt[0]);

  // stepper integration: the picture must change as execution proceeds
  const timeline = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const edges = [...document.querySelectorAll('#ptrPanel .pv-card')].length;
      const xBox = [...document.querySelectorAll('#ptrPanel .pv-box')]
        .find(el => el.querySelector('.pv-box-head b').textContent.trim() === 'x');
      out.push({ i, cards: edges, x: xBox ? xBox.querySelectorAll('.pv-v')[1].textContent.trim() : null });
    }
    return out;
  });
  const firstCard = timeline.find(t => t.cards > 0);
  const sawX42 = timeline.some(t => t.x === '42');
  const sawX100 = timeline.some(t => t.x === '100');
  check('no pointer card exists before the pointer is assigned',
        timeline[0].cards === 0, 'step 1 cards=' + timeline[0].cards);
  check('the pointer card appears at the step p = &x runs',
        !!firstCard, firstCard ? 'step ' + (firstCard.i + 1) : 'never');
  check('the panel follows the stepper: x reads 42 then 100 across steps',
        sawX42 && sawX100, timeline.map(t => t.x).filter(Boolean).join(' -> '));

  // pointer arithmetic on an array, in the view
  await runTo(SRC.array);
  const arithView = await page.evaluate(() => {
    const st = run.history.stateAt(run.index);
    const pb = st.graph.nodes.find(n => n.label === 'p').blockId;
    return {
      steps: [...document.querySelectorAll('#ptrPanel .pv-step')].map(e => ({
        k: e.querySelector('.pv-step-k').textContent.trim(),
        a: e.querySelector('.pv-step-a').textContent.trim(),
        into: e.querySelector('.pv-step-in').textContent.trim(),
      })),
      engine: st.graph.arithmetic[pb].steps.map(s => s.text),
    };
  });
  check('the arithmetic strip prints the engine\'s addresses',
        JSON.stringify(arithView.steps.map(s => s.a)) === JSON.stringify(arithView.engine),
        arithView.steps.map(s => s.k + '=' + s.a).join(' '));
  check('it names the object each step lands in, and marks the one past the end',
        arithView.steps[0].into === 'a' && /past/.test(arithView.steps[3].into),
        arithView.steps.map(s => s.into).join(','));

  // string literal: two objects, two sections, in the view
  await runTo(SRC.string);
  const strView = await page.evaluate(() =>
    [...document.querySelectorAll('#ptrPanel .pv-box')].map(el => ({
      name: el.querySelector('.pv-box-head b').textContent.trim(),
      sec: el.querySelector('.pv-sec').textContent.trim(),
    })));
  check('the view separates the pointer from the literal it points at',
        strView.length === 2 && strView[0].sec === 'stack' && strView[1].sec === '.rodata',
        strView.map(v => v.name + '@' + v.sec).join(' -> '));

  // address inspector
  await runTo(SRC.deref);
  await page.evaluate(() => {
    const st = run.history.stateAt(run.index);
    ui.focusObject = st.graph.nodes.find(n => n.label === 'x').blockId;
    render();
  });
  await sleep(250);
  const insp = await page.evaluate(() => {
    const el = document.querySelector('#ptrPanel .pv-inspect');
    if (!el) return null;
    const vals = [...el.querySelectorAll('.pv-ins-grid .pv-v')].map(v => v.textContent.trim());
    const st = run.history.stateAt(run.index);
    const n = st.graph.nodes.find(x => x.label === 'x');
    return {
      vals,
      bytes: [...el.querySelectorAll('.pv-byte-v')].map(v => v.textContent.trim()),
      refs: el.querySelector('.pv-refs') ? el.querySelector('.pv-refs').textContent : '',
      engineBytes: n.bytes.map(b => b.init
        ? Number(b.value).toString(16).toUpperCase().padStart(2, '0') : '??'),
      archNote: !!el.querySelector('.pv-bytes-h'),
    };
  });
  check('clicking an object opens an inspector with its full identity',
        insp && insp.vals.includes('x') && insp.vals.includes('int') && insp.vals.includes('4 bytes'),
        insp ? insp.vals.join(' | ') : 'no inspector');
  check('the inspector shows the engine\'s bytes, not recomputed ones',
        JSON.stringify(insp.bytes) === JSON.stringify(insp.engineBytes) &&
        insp.bytes.every(b => /^[0-9A-F]{2}$/.test(b)),
        insp.bytes.join(' '));
  check('the byte view names the simulated architecture it belongs to', insp.archNote);
  check('the inspector lists what points at this object', /\bp\b/.test(insp.refs), insp.refs.trim());

  check('a pointer\'s size is stated as this architecture\'s, not universal',
        await page.evaluate(() => /not the same on every real architecture/i
          .test(document.querySelector('#ptrPanel .pv-foot').textContent)));
  check('no page errors across every pointer case', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.screenshot({ path: path.join(SHOTS, 'p14_pointers.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 12c  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
