'use strict';
/* The Memory module — argc/argv, dynamic allocation, and the address space.

   The claim under test is not "the pages render". It is that every value shown
   was produced by executing the C printed beside it, and is right. So the
   expectations here are computed in this file — argc from the argument list,
   block sizes from sizeof, the prime/pointer arithmetic from the addresses the
   engine reports — and never read back out of the same panel that displays them.

   Where the module says it is showing a DEFINITION rather than a builtin
   (calloc, realloc) the suite checks that the limitation is actually stated,
   because an unlabelled substitution would be the dishonest kind.

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

  const go = (pg, state) => page.evaluate((p, st) => {
    c4.mod = 'MEM'; c4.page = p; c4.step = null;
    Object.assign(c4, st || {});
    showLearn();
  }, pg, state || {});
  const txt = (sel) => page.evaluate(s => {
    const e = document.querySelector('#learnRoot ' + s);
    return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  }, sel);
  const all = (sel) => page.evaluate(s => [...document.querySelectorAll('#learnRoot ' + s)]
    .map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);

  /* ================= the module exists and is reachable ================ */
  console.log('\n== the module is registered like any other ==');
  const mods = await page.evaluate(() => learnModules().map(m =>
    ({ id: m.id, kind: m.kind || 'subject', ex: m.ex.length, found: m.founds.length })));
  const ids = mods.map(m => m.id);
  const mem = mods.find(m => m.id === 'MEM');
  /* Not a fixed list: this suite is about the Memory module, so it checks that
     the module is there with the shape it expects, and that it still sits after
     the two courses whose material it assumes. Other modules may follow. */
  check('the Memory module is registered as a topic module with its lessons and no exercises',
        !!mem && mem.kind === 'topic' && mem.ex === 0 && mem.found === 24, JSON.stringify(mem));
  check('and it comes after C 04 and C 05, which it builds on',
        ids.indexOf('MEM') > ids.indexOf('C04') && ids.indexOf('MEM') > ids.indexOf('C05'),
        ids.join(','));
  const pages = await page.evaluate(() => { c4.mod = 'MEM'; c4.page = 'overview'; showLearn();
    return c4Pages().map(x => x.key); });
  check('the module contributes 24 lessons plus overview, practice and bugs',
        pages.filter(k => k.indexOf('f:') === 0).length === 24 && pages.length === 27, pages.length + ' pages');
  check('and declares no exercises, so no ex: page is invented',
        pages.every(k => k.indexOf('ex:') !== 0));

  /* ================= argc is the count the engine saw ================== */
  console.log('\n== argc comes from a real run, and is a count ==');
  for (const args of [[], ['hello'], ['hello', 'world'], ['10', '20', '30'], ['']]) {
    await go('f:argc', { mProg: './a', mArgs: args });
    await sleep(140);
    const want = args.length + 1;
    const big = await txt('.mem-count-big');
    const rules = await all('.mem-rule .mem-rule-i');
    const engineArgc = await page.evaluate(() => {
      const r = memArgvRun();
      if (!r.ok) return null;
      const st = memLive(r);
      const v = memVar(st, 'argc');
      return v ? +v.valueText : null;
    });
    check('argc for ' + JSON.stringify(args) + ' is ' + want,
          (big || '').replace(/\s+/g, '') === 'argc' + want && engineArgc === want,
          big + ' / engine ' + engineArgc);
    check('  and the ruler shows indexes 0..' + (want - 1) + ' plus the NULL slot',
          rules.join(',') === Array.from({ length: want + 1 }, (_, i) => i).join(','), rules.join(','));
  }
  const say = await txt('.mem-count-say');
  check('the page states the count/last-index distinction in words',
        /valid indexes 0 to/.test(say) && /NULL/.test(say), (say || '').slice(0, 90));

  /* ================= argv is a real pointer chain ====================== */
  console.log('\n== argv: pointer array, strings, NULL sentinel ==');
  await go('f:argv-array', { mProg: './prog', mArgs: ['hello', 'world'], mSel: 1, mSelCh: 0 });
  await sleep(180);
  const model = await page.evaluate(() => {
    const m = memArgvModel();
    if (!m) return null;
    return {
      argc: m.argc, ptrSize: m.ptrSize,
      slotAddrs: m.slots.map(s => s.addr), targets: m.slots.map(s => s.target),
      nullSlot: m.nullSlot, argvVal: m.argv.valueText, arrBase: m.arr ? m.arr.base : null,
      arrSize: m.arr ? m.arr.size : null,
    };
  });
  check('argv holds the address of the pointer array',
        model && parseInt(model.argvVal, 16) === model.arrBase,
        model ? model.argvVal + ' vs ' + model.arrBase : 'no model');
  check('the slots are one pointer apart',
        model && model.slotAddrs.every((a, i) => a === model.arrBase + i * model.ptrSize),
        model ? model.slotAddrs.join(',') + ' step ' + model.ptrSize : '');
  check('the NULL slot sits immediately after the last argument',
        model && model.nullSlot === model.arrBase + model.argc * model.ptrSize);
  check('the pointer array is big enough for argc pointers plus the sentinel',
        model && model.arrSize >= (model.argc + 1) * model.ptrSize,
        model ? model.arrSize + ' bytes for ' + (model.argc + 1) + ' pointers' : '');
  check('each slot points at a different string',
        model && new Set(model.targets).size === model.targets.length);
  const slotsShown = await all('.mem-slot .mem-slot-i');
  check('the diagram draws argv[0..2] and the NULL slot',
        slotsShown.join(',') === 'argv[0],argv[1],argv[2],argv[3]', slotsShown.join(','));

  /* ================= bytes and the terminator ========================== */
  console.log('\n== an argument is bytes ending in \\0 ==');
  await go('f:argv-bytes', { mProg: './prog', mArgs: ['hello', 'world'], mSel: 1 });
  await sleep(160);
  const chars = await page.evaluate(() => {
    const m = memArgvModel();
    return memArgChars(m, 1).map(c => ({ ch: c.ch, code: c.code, addr: c.addr }));
  });
  check('"hello" is six bytes: five characters and one \\0',
        chars.length === 6 && chars.slice(0, 5).map(c => c.ch).join('') === 'hello' &&
        chars[5].code === 0, chars.map(c => c.ch).join(''));
  check('the bytes are consecutive addresses',
        chars.every((c, i) => i === 0 || c.addr === chars[i - 1].addr + 1));
  check('the terminator is the byte 0, not the character "0"',
        chars[5].code === 0 && chars[0].code === 104, 'first=' + chars[0].code + ' last=' + chars[5].code);
  const boxn = await all('.c4-boxnote');
  check('the page says \\0 is not the digit zero', boxn.some(t => /48/.test(t) && /\\0/.test(t)));

  /* ================= the arithmetic identity =========================== */
  console.log('\n== argv[i][j] expands to *(*(argv + i) + j) ==');
  await go('f:argv-arith', { mProg: './prog', mArgs: ['hello', 'world'], mSel: 1, mSelCh: 2 });
  await sleep(160);
  const steps = await all('.mem-step .mem-step-v');
  const arith = await page.evaluate(() => {
    const m = memArgvModel();
    const chars = memArgChars(m, 1);
    return { slotAddr: m.slots[1].addr, target: m.slots[1].target,
             charAddr: chars[2].addr, code: chars[2].code, ptrSize: m.ptrSize,
             argvVal: parseInt(m.argv.valueText, 16) };
  });
  check('argv + 1 is one POINTER further on',
        arith.slotAddr === arith.argvVal + arith.ptrSize,
        arith.argvVal + ' + ' + arith.ptrSize + ' = ' + arith.slotAddr);
  check('argv[1] + 2 is two BYTES further on',
        arith.charAddr === arith.target + 2, arith.target + ' + 2 = ' + arith.charAddr);
  check('the last row reads the character l (108)', arith.code === 108, String(arith.code));
  check('all five expansion rows are shown', steps.length === 5, steps.length + ' rows');
  const rule = await txt('.mem-rule-box');
  check('the identity a[b] == *(a + b) is stated',
        /a\[b\] is \*\(a \+ b\)/.test(rule || ''), (rule || '').slice(0, 60));

  /* ================= write ============================================= */
  console.log('\n== write(1, argv[1], n) ==');
  await go('f:argv-write', { mProg: './p', mArgs: ['hello'], mSel: 1, mBytes: 5 });
  await sleep(200);
  const out = (await all('.mem-out b'))[0];
  check('writing 5 bytes of "hello" prints hello', out === 'hello', out);
  await go('f:argv-write', { mProg: './p', mArgs: ['hello'], mSel: 1, mBytes: 2 });
  await sleep(200);
  const out2 = (await all('.mem-out b'))[0];
  check('writing 2 bytes prints only he', out2 === 'he', out2);
  const warn = await all('.c4-boxnote');
  check('the danger of a hardcoded count is explained',
        warn.some(t => /undefined behaviour/.test(t) && /count/i.test(t)));

  /* ================= malloc ============================================ */
  console.log('\n== malloc: bytes, uninitialised, and a block that exists ==');
  for (const n of [1, 3, 5]) {
    await go('f:malloc', { mBytes: n });
    await sleep(180);
    const blk = await page.evaluate(() => {
      const st = memLive(memRun('int\tmain(void)\n{\n\tint\t*p;\n\n\tp = malloc(' + c4.mBytes +
        ' * sizeof(int));\n\treturn (0);\n}\n', null));
      const h = memBlocks(st, 'heap')[0];
      const node = ((st.graph && st.graph.nodes) || []).find(x => h && x.blockId === h.id);
      return h ? { size: h.size, section: h.sectionLabel, state: h.state,
                   uninit: (node.bytes || []).filter(x => !x.init).length } : null;
    });
    check('malloc(' + n + ' * sizeof(int)) reserves ' + (n * 4) + ' bytes on the heap',
          blk && blk.size === n * 4 && blk.section === 'heap', blk ? blk.size + ' bytes' : 'no block');
    check('  and every one of them is uninitialised',
          blk && blk.uninit === blk.size, blk ? blk.uninit + '/' + blk.size : '');
  }
  const mtxt = await all('.c4-warn');
  check('the page refuses to show a plausible zero for indeterminate bytes',
        mtxt.some(t => /UNDEFINED BEHAVIOUR/.test(t) && /uninitialized|indeterminate/i.test(t)));

  /* ================= calloc and realloc are labelled substitutions ===== */
  console.log('\n== calloc and realloc say what they are actually running ==');
  await go('f:calloc');
  await sleep(200);
  const cl = await all('.c4-limit');
  check('the calloc page states that calloc is not an engine builtin',
        cl.some(t => /calloc is not among them|not among them/.test(t)), (cl[0] || '').slice(0, 90));
  check('and that the zeros shown were executed, not drawn',
        cl.some(t => /executed, not drawn/.test(t)));
  const zeros = await page.evaluate(() => {
    const st = memLive(memRun('int\tmain(void)\n{\n\tint\t*p;\n\tint\ti;\n\n\tp = malloc(4 * sizeof(int));\n' +
      '\ti = 0;\n\twhile (i < 4)\n\t{\n\t\tp[i] = 0;\n\t\ti++;\n\t}\n\treturn (0);\n}\n', null));
    const h = memBlocks(st, 'heap')[0];
    const node = ((st.graph && st.graph.nodes) || []).find(x => x.blockId === h.id);
    return (node.bytes || []).filter(x => x.init && x.value === 0).length;
  });
  check('the calloc panel\'s zeroed bytes really are zero after the loop ran',
        zeros === 16, zeros + ' zero bytes of 16');

  for (const k of ['grow', 'shrink', 'move', 'fail']) {
    await go('f:realloc', { mRe: k });
    await sleep(180);
    const body = await txt('.c4-block');
    check('realloc case "' + k + '" renders', (body || '').length > 200, (body || '').length + ' chars');
  }
  await go('f:realloc', { mRe: 'fail' });
  await sleep(160);
  const ud = await all('.c4-ud-r');
  check('the failure case shows the leaking pattern and the safe one',
        ud.length >= 2 && ud.some(t => /p = realloc\(p/.test(t)) && ud.some(t => /tmp = realloc/.test(t)));
  const rl = await all('.c4-limit');
  check('realloc says it is running the definition, not a builtin',
        rl.some(t => /realloc is not one of the engine/.test(t)));
  const r0 = await all('.c4-boxnote');
  check('realloc(ptr, 0) is flagged as subtle rather than given a false rule',
        r0.some(t => /realloc\(p, 0\)/.test(t) && /differs between implementations|changed across/.test(t)));

  /* ================= free, dangling, leaks ============================= */
  console.log('\n== free: the object dies, the pointer does not ==');
  await go('f:free');
  await sleep(220);
  const freeState = await page.evaluate(() => {
    const run = memRun('int\tmain(void)\n{\n\tint\t*p;\n\n\tp = malloc(2 * sizeof(int));\n\tp[0] = 7;\n\tfree(p);\n\treturn (0);\n}\n', null);
    let before = null, after = null;
    for (const s of run.steps) {
      const blk = memBlocks(s.state, 'heap')[0];
      if (blk && blk.state === 'live') before = s.state;
      if (blk && blk.state === 'freed' && !after) after = s.state;
    }
    const pv = (st) => { const v = memVar(st, 'p'); return v ? v.valueText : null; };
    return { beforeP: pv(before), afterP: pv(after),
             beforeState: memBlocks(before, 'heap')[0].state,
             afterState: memBlocks(after, 'heap')[0].state,
             afterKind: memVar(after, 'p').pointerTarget.kind };
  });
  check('the block goes from live to freed',
        freeState.beforeState === 'live' && freeState.afterState === 'freed');
  check('and p holds exactly the same address before and after',
        freeState.beforeP === freeState.afterP, freeState.beforeP + ' -> ' + freeState.afterP);
  check('the engine calls what p now points at a freed block',
        freeState.afterKind === 'freed', freeState.afterKind);
  const diags = await all('.mem-diag-v');
  check('use-after-free is demonstrated by the engine stopping',
        diags.some(t => /Use-after-free/.test(t)), diags.join(' | ').slice(0, 90));
  check('double free is demonstrated by the engine stopping',
        diags.some(t => /Double free/.test(t)));

  console.log('\n== leaks are counted, not asserted ==');
  await go('f:free');
  await sleep(200);
  const leak = await page.evaluate(() => {
    const bad = memRun('int\tmain(void)\n{\n\tint\t*p;\n\n\tp = malloc(4);\n\tp = malloc(4);\n\treturn (0);\n}\n', null);
    const st = memLive(bad);
    const blocks = memBlocks(st, 'heap');
    const p = memVar(st, 'p');
    const reachable = blocks.filter(x => p.pointerTarget && p.pointerTarget.blockId === x.id).length;
    return { live: blocks.filter(x => x.state === 'live').length, reachable };
  });
  check('two allocations, one pointer: 2 live and 1 reachable',
        leak.live === 2 && leak.reachable === 1, JSON.stringify(leak));
  const leakLimit = await all('.c4-limit');
  check('the leak model says it is not Valgrind',
        leakLimit.some(t => /Valgrind|AddressSanitizer/.test(t)));

  /* ================= the RAM map ====================================== */
  console.log('\n== the RAM map: six regions, honestly labelled ==');
  await go('f:ram-map');
  await sleep(220);
  const regions = await all('.mem-region-h b');
  check('all five region bands are drawn',
        regions.join('|') === 'STACK|HEAP|DATA / BSS|RODATA|TEXT / CODE', regions.join('|'));
  const sections = await page.evaluate(() => {
    const st = memLive(memRun(MEM_MAP_SRC, null));
    const out = {};
    memBlocks(st).forEach(b => { out[b.sectionLabel] = (out[b.sectionLabel] || []).concat(b.label); });
    return out;
  });
  check('an initialised global lands in .data', (sections['.data'] || []).indexOf('g') >= 0,
        JSON.stringify(sections['.data']));
  check('a static with no initialiser lands in .bss', (sections['.bss'] || []).indexOf('z') >= 0,
        JSON.stringify(sections['.bss']));
  check('a string literal lands in .rodata', (sections['.rodata'] || []).some(l => /hi/.test(l)),
        JSON.stringify(sections['.rodata']));
  check('the malloc block lands in the heap', (sections['heap'] || []).length === 1,
        JSON.stringify(sections['heap']));
  const disc = await all('.c4-warn');
  check('the map is labelled a conceptual model, not a photograph',
        disc.some(t => /conceptual process memory map/.test(t)));
  check('and names what actually varies',
        disc.some(t => /operating system/.test(t) && /randomisation|randomization/.test(t)));
  check('and says the standard describes durations, not sections',
        disc.some(t => /storage/.test(t) && /durations/.test(t) && /says nothing about sections/.test(t)));

  /* ================= literal vs array ================================= */
  console.log('\n== char *s = "hi" versus char s[] = "hi" ==');
  await go('f:regions');
  await sleep(200);
  const lv = await page.evaluate(() => {
    const a = memLive(memRun('int\tmain(void)\n{\n\tchar\t*s;\n\n\ts = "hi";\n\treturn (0);\n}\n', null));
    const b = memLive(memRun('int\tmain(void)\n{\n\tchar\ts[] = "hi";\n\n\treturn (0);\n}\n', null));
    const va = memVar(a, 's');
    const lit = memBlocks(a).find(x => x.id === va.pointerTarget.blockId);
    const arr = memBlocks(b).find(x => x.label === 's');
    const w = memRun('int\tmain(void)\n{\n\tchar\t*s;\n\n\ts = "hi";\n\ts[0] = 72;\n\treturn (0);\n}\n', null);
    return { litSection: lit.sectionLabel, litRO: lit.readonly,
             arrSection: arr.sectionLabel, arrRO: arr.readonly, writeKind: w.kind };
  });
  check('the literal is read-only and in .rodata',
        lv.litSection === '.rodata' && lv.litRO === true, lv.litSection + ' ro=' + lv.litRO);
  check('the array is writable and on the stack',
        lv.arrSection === 'stack' && lv.arrRO === false, lv.arrSection + ' ro=' + lv.arrRO);
  check('writing through the literal pointer is caught by the engine',
        lv.writeKind === 'readonly-write', String(lv.writeKind));

  /* ================= stack frames ===================================== */
  console.log('\n== stack frames ==');
  await go('f:frames', { mFrame: 0 });
  await sleep(180);
  const deepest = await page.evaluate(() => {
    const run = memRun('int\tbar(int n)\n{\n\tint\tb;\n\n\tb = n * 2;\n\treturn (b);\n}\n\n' +
      'int\tfoo(int x)\n{\n\tint\ta;\n\n\ta = bar(x + 1);\n\treturn (a);\n}\n\n' +
      'int\tmain(void)\n{\n\tint\tr;\n\n\tr = foo(10);\n\treturn (0);\n}\n', null);
    let best = 0, at = 0;
    run.steps.forEach((s, i) => { if (s.state.frames.length > best) { best = s.state.frames.length; at = i; } });
    const names = run.steps[at].state.frames.map(f => f.name);
    return { best, names, at };
  });
  check('the demo really reaches three live frames',
        deepest.best === 3 && deepest.names.join('>') === 'main>foo>bar', deepest.names.join('>'));
  await go('f:frames', { mFrame: deepest.at });
  await sleep(180);
  const drawn = await all('.mem-frame-h');
  check('and the panel draws them newest first',
        drawn.length === 3 && /bar/.test(drawn[0]) && /main/.test(drawn[2]), drawn.join(' | '));
  const lifo = await all('.c4-boxnote');
  check('the lesson connects the stack to C 05 recursion',
        lifo.some(t => /C 05/.test(t) && /recursion/i.test(t)));

  /* ================= pointer vs pointee =============================== */
  console.log('\n== pointer, pointee, and the double pointer ==');
  await go('f:pointee');
  await sleep(200);
  const pv = await page.evaluate(() => {
    const run = memRun('int\tmain(void)\n{\n\tint\tx;\n\tint\t*p;\n\tint\t**pp;\n\n\tx = 42;\n\tp = &x;\n\tpp = &p;\n\t*p = 99;\n\treturn (0);\n}\n', null);
    const st = memLive(run);
    const x = memVar(st, 'x'), p = memVar(st, 'p'), pp = memVar(st, 'pp');
    return { x: x.valueText, pAddr: parseInt(p.valueText, 16), xAddr: x.address,
             ppAddr: parseInt(pp.valueText, 16), pOwn: p.address };
  });
  check('p holds the address of x', pv.pAddr === pv.xAddr, pv.pAddr + ' vs ' + pv.xAddr);
  check('pp holds the address of p', pv.ppAddr === pv.pOwn, pv.ppAddr + ' vs ' + pv.pOwn);
  check('*p = 99 changed x, not p', pv.x === '99', 'x = ' + pv.x);
  const arrRows = await page.evaluate(() => {
    const st = memLive(memRun('int\tmain(void)\n{\n\tint\tai[4];\n\tchar\tac[4];\n\n\tai[0] = 10;\n\tai[1] = 20;\n\tai[2] = 30;\n\tai[3] = 40;\n' +
      '\tac[0] = 65;\n\tac[1] = 66;\n\tac[2] = 67;\n\tac[3] = 0;\n\treturn (0);\n}\n', null));
    const ai = memVar(st, 'ai'), ac = memVar(st, 'ac');
    return { i: ai.elements[1].address - ai.elements[0].address,
             c: ac.elements[1].address - ac.elements[0].address };
  });
  check('int elements are one sizeof(int) apart', arrRows.i === 4, '+' + arrRows.i);
  check('char elements are one byte apart', arrRows.c === 1, '+' + arrRows.c);

  /* ================= the explorer ===================================== */
  console.log('\n== the unified explorer ==');
  await go('f:explorer', { mExp: null, mExpStep: null });
  await sleep(260);
  const expBlocks = await all('.mem-explore-map .mem-obj .mem-obj-l');
  check('the explorer lists blocks from several regions',
        expBlocks.length >= 6, expBlocks.length + ': ' + expBlocks.join(', ').slice(0, 110));
  const heapId = await page.evaluate(() => {
    const run = memRun(MEM_EXPLORE_SRC, ['hello'], './prog');
    const last = run.steps.reduce((b, s, i) => s.state.frames.length ? i : b, 0);
    const st = run.steps[last].state;
    const h = memBlocks(st, 'heap')[0];
    return h ? h.id : null;
  });
  await go('f:explorer', { mExp: String(heapId), mExpStep: null });
  await sleep(220);
  const insp = await txt('.mem-explore-i');
  check('clicking the heap block inspects it',
        /heap/.test(insp || '') && /malloc/.test(insp || ''), (insp || '').slice(0, 110));
  const bytesShown = await all('.mem-explore-i .mem-byte-v');
  check('and shows its 12 bytes — a malloc block has no type of its own',
        bytesShown.length === 12 && bytesShown[0] === '100' && bytesShown[4] === '200',
        bytesShown.join(','));
  const pId = await page.evaluate(() => {
    const run = memRun(MEM_EXPLORE_SRC, ['hello'], './prog');
    const last = run.steps.reduce((b, s, i) => s.state.frames.length ? i : b, 0);
    const st = run.steps[last].state;
    const blk = memBlocks(st, 'stack').find(x => x.label === 'p');
    return blk ? blk.id : null;
  });
  await go('f:explorer', { mExp: String(pId), mExpStep: null });
  await sleep(220);
  const target = await all('.mem-target');
  check('selecting the pointer p offers its target as a link',
        target.length === 1 && /malloc/.test(target[0]), target.join(' | ').slice(0, 90));

  /* ================= learning checks =================================== */
  console.log('\n== learning checks ==');
  const totalChecks = await page.evaluate(() => {
    let n = 0;
    c4.mod = 'MEM';
    for (const k of c4Pages().map(x => x.key)) {
      c4.page = k; c4.step = null; showLearn();
      n += document.querySelectorAll('#learnRoot .mem-chk').length;
    }
    return n;
  });
  check('the module carries interactive checks across its lessons',
        totalChecks >= 20, totalChecks + ' checks');
  await go('f:argc', { mQuiz: {} });
  await sleep(160);
  const before = await all('.mem-chk-a');
  await page.evaluate(() => document.querySelector('#learnRoot [data-memq]').click());
  await sleep(160);
  const after = await all('.mem-chk-a');
  check('a check reveals its answer when clicked and hides it again',
        before.length === 0 && after.length === 1, before.length + ' -> ' + after.length);
  check('the revealed answer for "./prog hello world" is 3',
        /^3(?!\d)/.test(after[0] || ''), (after[0] || '').slice(0, 60));

  /* ================= interactivity ==================================== */
  console.log('\n== the argument editor drives the engine ==');
  await go('f:argc', { mProg: './a', mArgs: ['x'] });
  await sleep(180);
  const argcBefore = await txt('.mem-count-big');
  await page.evaluate(() => document.querySelector('#learnRoot [data-memadd]').click());
  await sleep(220);
  const argcAfter = await txt('.mem-count-big');
  const noSp = (x) => (x || '').replace(/\s+/g, '');
  check('adding an argument raises argc by one',
        noSp(argcBefore) === 'argc2' && noSp(argcAfter) === 'argc3', argcBefore + ' -> ' + argcAfter);
  await page.evaluate(() => document.querySelector('#learnRoot [data-memdel]').click());
  await sleep(220);
  const argcBack = await txt('.mem-count-big');
  check('removing one lowers it again', noSp(argcBack) === 'argc2', argcBack);

  /* ================= curriculum connections =========================== */
  console.log('\n== prerequisites and what it unlocks ==');
  await go('overview');
  await sleep(200);
  const ov = await txt('.c4-main');
  check('the overview names the modules this one assumes',
        /C 00/.test(ov || '') && /C 03/.test(ov || '') && /C 05/.test(ov || ''));
  check('and what it adds', /argc \/ argv/.test(ov || '') && /the heap/.test(ov || ''));
  check('the overview does not claim exercises it does not have',
        !/0 exercises/.test(ov || ''), (ov || '').slice(0, 80));

  /* ================= C04 / C05 untouched ============================== */
  console.log('\n== the existing modules are unaffected ==');
  const other = await page.evaluate(() => {
    const out = {};
    for (const m of ['C04', 'C05']) {
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
  check('C 04 still has its 19 pages and all render',
        other.C04.pages === 19 && !other.C04.bad, other.C04.bad || '19 pages');
  check('C 05 still has its 22 pages and all render',
        other.C05.pages === 22 && !other.C05.bad, other.C05.bad || '22 pages');

  /* ================= nothing leaked, nothing overflowed =============== */
  console.log('\n== hygiene ==');
  const leaks = await page.evaluate(() => {
    const hits = [];
    c4.mod = 'MEM';
    for (const k of c4Pages().map(x => x.key)) {
      c4.page = k; c4.step = null; showLearn();
      const t = (document.querySelector('#learnRoot .c4-main') || {}).textContent || '';
      if (/\[object Object\]|\bNaN\b|>undefined|undefined</.test(t)) hits.push(k);
      if (/MISSING VISUALIZER/.test(document.querySelector('#learnRoot .c4-main').innerHTML)) hits.push(k + ' (missing viz)');
    }
    return hits;
  });
  check('no leaked JavaScript values and no missing visualizer', leaks.length === 0, leaks.join(', '));
  const overflow = await page.evaluate(() => {
    const out = [];
    c4.mod = 'MEM';
    for (const k of c4Pages().map(x => x.key)) {
      c4.page = k; c4.step = null; showLearn();
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(k);
    }
    return out;
  });
  check('no page makes the document scroll horizontally', overflow.length === 0, overflow.join(', '));

  for (const w of [420, 768, 1024, 1280, 1500]) {
    await page.setViewport({ width: w, height: 900 });
    await sleep(150);
    const bad = await page.evaluate(() => {
      const out = [];
      c4.mod = 'MEM';
      for (const k of c4Pages().map(x => x.key)) {
        c4.page = k; c4.step = null; showLearn();
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(k);
      }
      return out;
    });
    check('no horizontal overflow at ' + w + 'px', bad.length === 0, bad.join(', '));
  }
  await page.setViewport({ width: 1500, height: 950 });

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log('\n----------------------------------------------------------------');
  console.log('Memory module  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
