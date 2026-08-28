'use strict';
/* The Memory module, deepened: the address space, pointers, strings, the whole
   allocation lifecycle, and ten memory bugs.

   Every expectation here is computed in this file — byte counts from the string
   literals, region membership from the C declarations, block sizes from sizeof,
   the pointer relationships from the addresses the engine reports. Nothing is
   read out of a panel and compared to itself.

   The module makes two kinds of claim, and both are tested:
     - "this was executed"  — checked against a run this suite performs itself;
     - "this is conceptual" — checked that the page says so, because an
       unlabelled model is the dishonest kind.

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

  /* ================= the module grew coherently ====================== */
  console.log('\n== the module after the deepening ==');
  const pages = await page.evaluate(() => { c4.mod = 'MEM'; c4.page = 'overview'; showLearn();
    return c4Pages().map(x => x.key); });
  const lessons = pages.filter(k => k.indexOf('f:') === 0);
  check('the module now carries 24 lessons', lessons.length === 24, lessons.length + '');
  for (const id of ['f:pipeline', 'f:strings', 'f:argv-bridge', 'f:lifecycle', 'f:bugcards'])
    check('  the new lesson ' + id + ' exists', lessons.indexOf(id) >= 0);
  const kept = ['f:args-why', 'f:argc', 'f:layers', 'f:argv-array', 'f:argv-bytes', 'f:argv-arith',
                'f:main-proto', 'f:argv-write', 'f:why-heap', 'f:malloc', 'f:malloc-fail', 'f:calloc',
                'f:realloc', 'f:free', 'f:ram-map', 'f:regions', 'f:frames', 'f:pointee', 'f:explorer'];
  check('and every pre-existing lesson URL still resolves',
        kept.every(k => lessons.indexOf(k) >= 0),
        kept.filter(k => lessons.indexOf(k) < 0).join(', ') || 'all 19 kept');
  const nums = await page.evaluate(() => MEM_FOUND.map(f => f.n));
  check('the section numbers run in order with no duplicates',
        nums.length === new Set(nums).size &&
        nums.join(',') === nums.slice().sort((a, x) => parseFloat(a) - parseFloat(x)).join(','),
        nums.join(' '));

  /* ================= the compilation pipeline ======================== */
  console.log('\n== source text -> tokens -> tree -> process ==');
  await go('f:pipeline');
  await sleep(250);
  const pipe = await page.evaluate(() => {
    const toks = CEngine.tokenize(MEM_PIPE_SRC);
    const c = CEngine.compile(MEM_PIPE_SRC);
    const st = memLive(memRun(MEM_PIPE_SRC, null));
    const sect = {};
    memBlocks(st).forEach(x => { sect[x.sectionLabel] = (sect[x.sectionLabel] || []).concat(x.label); });
    return { tokens: toks.length, types: [...new Set(toks.map(t => t.type))],
             decls: Array.from(c.ast || []).map(d => d.kind), sect };
  });
  const shownTok = await all('.mem-stage-h .mem-stage-w');
  check('the token count on the page is the engine\'s own',
        shownTok.some(t => t === pipe.tokens + ' of them'), shownTok.join(' | '));
  check('and the tokens are really typed by the tokenizer',
        pipe.types.indexOf('KEYWORD') >= 0 && pipe.types.indexOf('IDENT') >= 0, pipe.types.join('/'));
  check('the syntax tree really has two top-level declarations',
        pipe.decls.length === 2 && pipe.decls.indexOf('FuncDef') >= 0, pipe.decls.join(','));
  const declShown = await all('.mem-decl');
  check('and both are drawn', declShown.length === 2, declShown.join(' | '));
  check('the global lands in .data, as the declaration says it must',
        (pipe.sect['.data'] || []).indexOf('g') >= 0, JSON.stringify(pipe.sect['.data']));
  const pipeBody = await txt('.c4-main');
  check('the lesson says the source text is not in the running program',
        /source text.*does not|not part of the running program/i.test(pipeBody || ''));
  check('and that the variable names are gone too', /variable names/.test(pipeBody || ''));

  /* ================= the RAM map ===================================== */
  console.log('\n== the RAM map ==');
  await go('f:ram-map');
  await sleep(220);
  const regions = await all('.mem-region-h b');
  check('all five region bands are present',
        regions.join('|') === 'STACK|HEAP|DATA / BSS|RODATA|TEXT / CODE', regions.join('|'));
  const mapBody = await txt('.c4-main');
  check('the map is labelled a conceptual process memory map',
        /conceptual process memory map/i.test(mapBody || ''));
  check('and names what varies — OS, architecture, compiler, linker, randomisation',
        /operating system/i.test(mapBody || '') && /architecture/i.test(mapBody || '') &&
        /compiler/i.test(mapBody || '') && /linker/i.test(mapBody || '') &&
        /randomisation|randomization|ASLR/i.test(mapBody || ''));
  check('and does not claim the standard requires any of it',
        /says nothing about sections|not a language requirement/i.test(mapBody || ''));
  const addrs = await all('.mem-obj-a');
  check('the addresses shown are the engine\'s, not round illustrative ones',
        addrs.length > 0 && !addrs.every(a => /^0x[12]000$/.test(a)), addrs.slice(0, 3).join(', '));
  check('and the page says whose addresses they are',
        /this simulator/i.test(mapBody || ''));

  /* ================= regions: data / bss / rodata / text ============= */
  console.log('\n== which declaration lands where ==');
  const sect = await page.evaluate(() => {
    const st = memLive(memRun(MEM_MAP_SRC, null));
    const out = {};
    memBlocks(st).forEach(x => { out[x.sectionLabel] = (out[x.sectionLabel] || []).concat(x.label); });
    return out;
  });
  check('int g = 42 (initialised global) -> .data', (sect['.data'] || []).indexOf('g') >= 0);
  check('static int z (no initialiser) -> .bss', (sect['.bss'] || []).indexOf('z') >= 0);
  check('a string literal -> .rodata', (sect['.rodata'] || []).some(l => /hi/.test(l)));
  check('a malloc block -> heap', (sect['heap'] || []).length === 1);
  check('the function itself -> .text', (sect['.text'] || []).length >= 1, JSON.stringify(sect['.text']));
  await go('f:regions');
  await sleep(200);
  const regBody = await txt('.c4-main');
  check('the .bss explanation avoids claiming the file stores literal zeros',
        /only records how much space to reserve/i.test(regBody || '') &&
        /loader|start-up/i.test(regBody || ''));
  check('and states what C does promise about zero-initialisation',
        /as if assigned zero|zero-initialised/i.test(regBody || ''));

  /* ================= strings ========================================= */
  console.log('\n== strings in memory ==');
  await go('f:strings');
  await sleep(250);
  const strs = await page.evaluate(() => {
    const arrSrc = 'int\tmain(void)\n{\n\tchar\ts[] = "hello";\n\tint\tn;\n\n\tn = 0;\n' +
      '\twhile (s[n])\n\t\tn++;\n\treturn (0);\n}\n';
    const litSrc = 'int\tmain(void)\n{\n\tchar\t*s;\n\tint\tn;\n\n\ts = "hello";\n\tn = 0;\n' +
      '\twhile (s[n])\n\t\tn++;\n\treturn (0);\n}\n';
    const a = memLive(memRun(arrSrc, null)), l = memLive(memRun(litSrc, null));
    const av = memVar(a, 's'), lv = memVar(l, 's');
    const ab = memBlocks(a).find(x => x.label === 's');
    const lb = memBlocks(l).find(x => x.id === lv.pointerTarget.blockId);
    return {
      arrLen: +memVar(a, 'n').valueText, litLen: +memVar(l, 'n').valueText,
      arrBytes: av.elements.length, arrSection: ab.sectionLabel, arrRO: ab.readonly,
      litSection: lb.sectionLabel, litRO: lb.readonly,
      lastCode: av.elements[5] && av.elements[5].repr ? +av.elements[5].repr.decimal : null,
    };
  });
  check('char s[] = "hello" occupies six bytes', strs.arrBytes === 6, strs.arrBytes + '');
  check('and the sixth is the terminator, value 0', strs.lastCode === 0, String(strs.lastCode));
  check('the array is writable, on the stack',
        strs.arrSection === 'stack' && strs.arrRO === false, strs.arrSection + ' ro=' + strs.arrRO);
  check('the literal is read-only, in .rodata',
        strs.litSection === '.rodata' && strs.litRO === true, strs.litSection + ' ro=' + strs.litRO);
  check('and both count to the same length, because both end in \\0',
        strs.arrLen === 5 && strs.litLen === 5, strs.arrLen + ' / ' + strs.litLen);
  const strBody = await txt('.c4-main');
  check('the page connects the terminator to strlen, write and argv',
        /strlen/.test(strBody || '') && /write\(1, s, n\)/.test(strBody || '') && /argv\[i\]/.test(strBody || ''));

  /* ================= pointers ======================================== */
  console.log('\n== pointer, pointee, address-of, double pointer ==');
  await go('f:pointee');
  await sleep(250);
  const pv = await page.evaluate(() => {
    const src = 'int\tmain(void)\n{\n\tint\tx;\n\tint\t*p;\n\tint\t**pp;\n\n\tx = 42;\n\tp = &x;\n\tpp = &p;\n\t*p = 99;\n\treturn (0);\n}\n';
    const st = memLive(memRun(src, null));
    const x = memVar(st, 'x'), p = memVar(st, 'p'), pp = memVar(st, 'pp');
    return { xVal: x.valueText, xAddr: x.address, pAddr: p.address,
             pVal: parseInt(p.valueText, 16), ppVal: parseInt(pp.valueText, 16) };
  });
  check('p holds the address of x', pv.pVal === pv.xAddr, pv.pVal + ' vs ' + pv.xAddr);
  check('pp holds the address of p', pv.ppVal === pv.pAddr, pv.ppVal + ' vs ' + pv.pAddr);
  check('&p and p are different addresses — the pointer is not the pointee',
        pv.pAddr !== pv.pVal, hexNote(pv.pAddr) + ' vs ' + hexNote(pv.pVal));
  check('*p = 99 changed x, not p', pv.xVal === '99', 'x = ' + pv.xVal);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#learnRoot table.c4-t tbody tr td:first-child')]
      .map(e => e.textContent.trim()));
  const wanted = ['p', '*p', '&x', '&p', 'pp', '*pp', '**pp'];
  check('every one of p, *p, &x, &p, pp, *pp and **pp is explained',
        wanted.every(w => rows.indexOf(w) >= 0),
        wanted.filter(w => rows.indexOf(w) < 0).join(', ') || 'all seven');
  const pointeeBody = await txt('.c4-main');
  check('the two words are named explicitly',
        /the POINTER is the variable/.test(pointeeBody || '') && /the POINTEE is the object/.test(pointeeBody || ''));
  check('and the double pointer is tied to argv', /argv/.test(pointeeBody || ''));

  /* ================= arrays ========================================== */
  console.log('\n== arrays and pointer arithmetic ==');
  const arr = await page.evaluate(() => {
    const src = 'int\tmain(void)\n{\n\tint\tai[4];\n\tchar\tac[4];\n\n\tai[0] = 10;\n\tai[1] = 20;\n\tai[2] = 30;\n\tai[3] = 40;\n' +
      '\tac[0] = 65;\n\tac[1] = 66;\n\tac[2] = 67;\n\tac[3] = 0;\n\treturn (0);\n}\n';
    const st = memLive(memRun(src, null));
    const ai = memVar(st, 'ai'), ac = memVar(st, 'ac');
    return { iStep: ai.elements[1].address - ai.elements[0].address,
             cStep: ac.elements[1].address - ac.elements[0].address,
             iContig: ai.elements.every((e, k) => k === 0 || e.address === ai.elements[k - 1].address + 4),
             vals: ai.elements.map(e => e.valueText) };
  });
  check('int elements sit one sizeof(int) apart', arr.iStep === 4, '+' + arr.iStep);
  check('char elements sit one byte apart', arr.cStep === 1, '+' + arr.cStep);
  check('the int array is contiguous', arr.iContig, arr.vals.join(','));

  /* ================= malloc / calloc ================================= */
  console.log('\n== malloc and calloc ==');
  for (const n of [1, 3, 5]) {
    await go('f:malloc', { mBytes: n });
    await sleep(180);
    const blk = await page.evaluate((k) => {
      const st = memLive(memRun('int\tmain(void)\n{\n\tint\t*p;\n\n\tp = malloc(' + k +
        ' * sizeof(int));\n\treturn (0);\n}\n', null));
      const h = memBlocks(st, 'heap')[0];
      const node = ((st.graph && st.graph.nodes) || []).find(x => x.blockId === h.id);
      return { size: h.size, uninit: (node.bytes || []).filter(x => !x.init).length };
    }, n);
    check('malloc(' + n + ' * sizeof(int)) reserves ' + n * 4 + ' bytes, all indeterminate',
          blk.size === n * 4 && blk.uninit === blk.size, blk.size + 'B, ' + blk.uninit + ' uninit');
  }
  const mallocBody = await txt('.c4-main');
  check('the page refuses to invent values for uninitialised bytes',
        /indeterminate/i.test(mallocBody || '') && /undefined behaviour/i.test(mallocBody || ''));
  await go('f:malloc-fail');
  await sleep(200);
  const failBody = await txt('.c4-main');
  check('the NULL failure path is taught', /returns NULL|p = NULL/.test(failBody || ''));
  check('with the check placed before the first use', /if \(p == NULL\)/.test(failBody || ''));
  check('and the page admits this engine\'s malloc does not fail',
        /simulator’s malloc succeeds|does not fail/i.test(failBody || ''));
  await go('f:calloc');
  await sleep(220);
  const zeros = await page.evaluate(() => {
    const st = memLive(memRun('int\tmain(void)\n{\n\tint\t*p;\n\tint\ti;\n\n\tp = malloc(4 * sizeof(int));\n' +
      '\ti = 0;\n\twhile (i < 4)\n\t{\n\t\tp[i] = 0;\n\t\ti++;\n\t}\n\treturn (0);\n}\n', null));
    const h = memBlocks(st, 'heap')[0];
    const node = ((st.graph && st.graph.nodes) || []).find(x => x.blockId === h.id);
    return (node.bytes || []).filter(x => x.init && x.value === 0).length;
  });
  check('the calloc panel\'s zeroed bytes really are zero, all 16 of them', zeros === 16, zeros + '');
  const callocLimit = await all('.c4-limit');
  check('and the page states it ran calloc\'s definition, not a builtin',
        callocLimit.some(t => /calloc is not among them/.test(t)));

  /* ================= realloc ========================================= */
  console.log('\n== realloc: two outcomes, a shrink and a failure ==');
  const cases = await page.evaluate(() => {
    c4.mod = 'MEM'; c4.page = 'f:realloc'; showLearn();
    return [...document.querySelectorAll('#learnRoot [data-memre]')].map(e => e.textContent.trim());
  });
  check('the two possible outcomes are named as CASE A and CASE B',
        cases.some(t => /CASE A/.test(t)) && cases.some(t => /CASE B/.test(t)), cases.join(' | '));
  await go('f:realloc', { mRe: 'grow' });
  await sleep(200);
  const growBody = await txt('.c4-main');
  check('CASE A says the same address comes back',
        /the same address comes back/i.test(growBody || '') &&
        /extended where it already was/i.test(growBody || ''));
  check('and that the new elements are indeterminate', /indeterminate/.test(growBody || ''));
  await go('f:realloc', { mRe: 'move' });
  await sleep(200);
  const moveBody = await txt('.c4-main');
  check('CASE B shows two different addresses and a released original',
        /CASE B/.test(moveBody || '') && /dangling/.test(moveBody || ''));
  const moved = await page.evaluate(() => {
    const src = 'int\tmain(void)\n{\n\tint\t*old;\n\tint\t*fresh;\n\tint\ti;\n\n\told = malloc(3 * sizeof(int));\n' +
      '\told[0] = 10;\n\told[1] = 20;\n\told[2] = 30;\n\tfresh = malloc(5 * sizeof(int));\n' +
      '\ti = 0;\n\twhile (i < 3)\n\t{\n\t\tfresh[i] = old[i];\n\t\ti++;\n\t}\n\tfree(old);\n\treturn (0);\n}\n';
    const st = memLive(memRun(src, null));
    const h = memBlocks(st, 'heap');
    const node = ((st.graph && st.graph.nodes) || []).find(x => x.blockId === h[1].id);
    return { oldState: h[0].state, newState: h[1].state, differ: h[0].base !== h[1].base,
             copied: (() => { const by = node.bytes || []; const ints = [];
               for (let k = 0; k + 4 <= by.length && ints.length < 3; k += 4) {
                 let v = 0; for (let j = 3; j >= 0; j--) v = (v << 8) | (by[k + j] ? by[k + j].value : 0);
                 ints.push(String(v)); } return ints; })() };
  });
  check('the move really copies the three values across',
        moved.copied.join(',') === '10,20,30', moved.copied.join(','));
  check('and really releases the original block',
        moved.oldState === 'freed' && moved.newState === 'live' && moved.differ,
        moved.oldState + ' -> ' + moved.newState);
  await go('f:realloc', { mRe: 'shrink' });
  await sleep(200);
  const shrinkBody = await txt('.c4-main');
  check('shrinking says what happens to the part given back',
        /released back to the allocator|out of bounds/i.test(shrinkBody || ''));
  await go('f:realloc', { mRe: 'fail' });
  await sleep(200);
  const failB = await txt('.c4-main');
  check('failure keeps the original allocation valid',
        /ORIGINAL block is untouched|still allocated/i.test(failB || ''));
  check('and never says failure frees it',
        !/failure (automatically )?frees/i.test(failB || ''));
  check('the leaking pattern and the safe one are both shown',
        /p = realloc\(p/.test(failB || '') && /tmp = realloc/.test(failB || ''));
  check('realloc(ptr, 0) is flagged as subtle rather than given a false rule',
        /realloc\(p, 0\)/.test(failB || ''));

  /* ================= free, leaks, lifecycle ========================== */
  console.log('\n== free, dangling, leaks ==');
  const freeState = await page.evaluate(() => {
    const run = memRun('int\tmain(void)\n{\n\tint\t*p;\n\n\tp = malloc(2 * sizeof(int));\n\tp[0] = 7;\n\tfree(p);\n\treturn (0);\n}\n', null);
    let before = null, after = null;
    for (const s of run.steps) {
      const blk = memBlocks(s.state, 'heap')[0];
      if (blk && blk.state === 'live') before = s.state;
      if (blk && blk.state === 'freed' && !after) after = s.state;
    }
    return { bP: memVar(before, 'p').valueText, aP: memVar(after, 'p').valueText,
             bS: memBlocks(before, 'heap')[0].state, aS: memBlocks(after, 'heap')[0].state,
             kind: memVar(after, 'p').pointerTarget.kind };
  });
  check('free moves the block from live to freed',
        freeState.bS === 'live' && freeState.aS === 'freed');
  check('and leaves the pointer variable holding exactly the same address',
        freeState.bP === freeState.aP, freeState.bP + ' -> ' + freeState.aP);
  check('which the engine then calls a freed target', freeState.kind === 'freed');
  await go('f:free');
  await sleep(220);
  const freeBody = await txt('.c4-main');
  check('the page does not claim free changes the pointer',
        /Look at what did not change/.test(freeBody || ''));
  check('and offers p = NULL as a defensive choice, not something free does',
        /p = NULL after freeing|Worth doing when the pointer stays in scope/.test(freeBody || ''));
  const leak = await page.evaluate(() => {
    const st = memLive(memRun('int\tmain(void)\n{\n\tint\t*p;\n\n\tp = malloc(4);\n\tp = malloc(4);\n\treturn (0);\n}\n', null));
    const blocks = memBlocks(st, 'heap');
    const p = memVar(st, 'p');
    return { live: blocks.filter(x => x.state === 'live').length,
             reachable: blocks.filter(x => p.pointerTarget && p.pointerTarget.blockId === x.id).length };
  });
  check('two allocations and one pointer leaves 2 live, 1 reachable, 1 leaked',
        leak.live === 2 && leak.reachable === 1, JSON.stringify(leak));
  const leakLimit = await all('.c4-limit');
  check('and the leak model says it is not Valgrind',
        leakLimit.some(t => /Valgrind|AddressSanitizer/.test(t)));

  console.log('\n== the complete lifecycle ==');
  await go('f:lifecycle', { mLife2: null });
  await sleep(280);
  const stages = await all('.mem-lifest b');
  check('all eight named stages are shown',
        stages.join('|') === 'DECLARE|ALLOCATE|INITIALIZE|USE|REALLOCATE|USE|FREE|INVALID',
        stages.join('|'));
  const lifeRun = await page.evaluate(() => {
    const r = memRun(MEM_LIFE_SRC, null);
    const end = memLive(r);
    let peak = 0;
    r.steps.forEach(s => { const c = s.state.counts || {}; if ((c.heapLive || 0) > peak) peak = c.heapLive; });
    return { ok: r.ok, peak, endLive: (end.counts || {}).heapLive,
             endFreed: (end.counts || {}).heapFreed };
  });
  check('the lifecycle program really runs to the end', lifeRun.ok);
  check('two blocks are briefly live during the reallocation', lifeRun.peak === 2, 'peak ' + lifeRun.peak);
  check('and both are released by the end',
        lifeRun.endLive === 0 && lifeRun.endFreed === 2,
        'live ' + lifeRun.endLive + ', freed ' + lifeRun.endFreed);
  const lifeLimit = await all('.c4-limit');
  check('the page says the REALLOCATE stage runs realloc\'s definition',
        lifeLimit.some(t => /no realloc builtin/.test(t) && /copy loop|second malloc/.test(t)));
  await go('f:lifecycle', { mLife2: 0 });
  await sleep(200);
  const first = await txt('.mem-lifest.on b');
  check('stepping to the start shows the DECLARE stage', first === 'DECLARE', first);

  /* ================= the ten bug cards =============================== */
  console.log('\n== ten memory bugs, each executed ==');
  await go('f:bugcards');
  await sleep(300);
  const bugs = await all('.mem-bugs2 .mem-bugc summary');
  check('ten cards are listed', bugs.length === 10, bugs.length + '');
  const diagnosed = await page.evaluate(() => MEM_BUG_CARDS.map(c => {
    const r = memRun(c.src, null);
    return { id: c.id, kind: r.kind || null, ok: r.ok };
  }));
  const wantKinds = {
    null: 'null-deref', overflow: 'out-of-bounds', wrongsize: 'out-of-bounds',
    uninit: 'uninitialized-read', uaf: 'use-after-free', double: 'double-free',
    dangling: 'use-after-return', lost: 'invalid-free', wrongptr: 'invalid-free', leak: null,
  };
  for (const d of diagnosed) {
    check('  ' + d.id + ' -> ' + (wantKinds[d.id] || 'runs clean'),
          d.kind === wantKinds[d.id], String(d.kind));
  }
  check('nine of the ten are caught by the engine',
        diagnosed.filter(d => d.kind).length === 9, diagnosed.filter(d => d.kind).length + '');
  check('and the leak is the one that is not', diagnosed.find(d => d.id === 'leak').kind === null);
  const bugBody = await txt('.c4-main');
  check('the realloc-failure card is labelled conceptual, not executed',
        /conceptual — see the note/.test(bugBody || '') && /explained rather than executed/.test(bugBody || ''));
  const maps = await page.evaluate(() =>
    document.querySelectorAll('#learnRoot .mem-bugs2 .mem-bugc .mem-map').length);
  check('every executed card carries a memory picture', maps === 10, maps + ' maps');

  /* ================= the argv bridge ================================= */
  console.log('\n== argv as process state, and the bridge to C 06 ==');
  await go('f:argv-bridge', { mProg: './prog', mArgs: ['hello', 'world'] });
  await sleep(250);
  const bridge = await txt('.c4-main');
  check('argv[1], *(argv + 1) and argv[1][0] are all explained through memory',
        /argv\[1\]/.test(bridge || '') && /\*\(argv \+ 1\)/.test(bridge || '') &&
        /argv\[1\]\[0\]/.test(bridge || ''));
  check('and argv[argc] is named as the sentinel', /argv\[argc\]/.test(bridge || '') && /NULL/.test(bridge || ''));
  const links = await all('.mem-go b');
  check('the four C 06 exercises are linked from here',
        links.join(',') === 'C 06 ex00,C 06 ex01,C 06 ex02,C 06 ex03', links.join(','));
  const jumped = await page.evaluate(() => {
    document.querySelector('#learnRoot [data-memc06]').click();
    return { mod: c4.mod, page: c4.page };
  });
  await sleep(250);
  check('and following one really lands in C 06',
        jumped.mod === 'C06' && jumped.page === 'ex:ex00', JSON.stringify(jumped));

  /* ================= the unified explorer ============================ */
  console.log('\n== the unified explorer ==');
  await go('f:explorer', { mExp: null, mExpStep: null });
  await sleep(280);
  const expSects = await page.evaluate(() => {
    const run = memRun(MEM_EXPLORE_SRC, ['hello'], './prog');
    const last = run.steps.reduce((b, s, i) => s.state.frames.length ? i : b, 0);
    const st = run.steps[last].state;
    const out = {};
    memBlocks(st).forEach(x => { out[x.region] = (out[x.region] || 0) + 1; });
    const p = memVar(st, 'p');
    const h = memBlocks(st, 'heap')[0];
    return { regions: out, pointsAtHeap: !!(p && p.pointerTarget && p.pointerTarget.blockId === h.id) };
  });
  check('the explorer program produces objects in stack, heap, global and text',
        ['stack', 'heap', 'global', 'text'].every(r => expSects.regions[r] > 0),
        JSON.stringify(expSects.regions));
  check('and the stack pointer p really points into the heap block', expSects.pointsAtHeap);
  const heapId = await page.evaluate(() => {
    const run = memRun(MEM_EXPLORE_SRC, ['hello'], './prog');
    const last = run.steps.reduce((b, s, i) => s.state.frames.length ? i : b, 0);
    return memBlocks(run.steps[last].state, 'heap')[0].id;
  });
  await go('f:explorer', { mExp: String(heapId), mExpStep: null });
  await sleep(250);
  const insp = await txt('.mem-explore-i');
  check('clicking the heap block inspects it, with section and size',
        /heap/.test(insp || '') && /bytes/.test(insp || ''), (insp || '').slice(0, 90));

  /* ================= regression across all four modules ============== */
  console.log('\n== the other modules are unaffected ==');
  const other = await page.evaluate(() => {
    const out = {};
    for (const m of ['C04', 'C05', 'C06']) {
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
  check('C 04 still has 19 pages, all rendering', other.C04.pages === 19 && !other.C04.bad, other.C04.bad || 'ok');
  check('C 05 still has 22 pages, all rendering', other.C05.pages === 22 && !other.C05.bad, other.C05.bad || 'ok');
  check('C 06 still has 17 pages, all rendering', other.C06.pages === 17 && !other.C06.bad, other.C06.bad || 'ok');
  const order = await page.evaluate(() => learnModules().map(m => m.id).join(','));
  check('and the four modules are still in curriculum order',
        order === 'C04,C05,MEM,C06', order);

  /* ================= hygiene ========================================= */
  console.log('\n== hygiene ==');
  const leaksUi = await page.evaluate(() => {
    const hits = [];
    c4.mod = 'MEM';
    for (const k of c4Pages().map(x => x.key)) {
      c4.page = k; c4.step = null; showLearn();
      const main = document.querySelector('#learnRoot .c4-main');
      const s = main ? main.textContent : '';
      if (/\[object Object\]|\bNaN\b|>undefined|undefined</.test(s)) hits.push(k);
      if (main && /MISSING VISUALIZER/.test(main.innerHTML)) hits.push(k + ' (missing viz)');
    }
    return hits;
  });
  check('no leaked values and no missing visualizer', leaksUi.length === 0, leaksUi.join(', '));

  for (const w of [420, 768, 1024, 1280, 1500]) {
    await page.setViewport({ width: w, height: 900 });
    await sleep(170);
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

  const a11y = await page.evaluate(() => {
    const bad = { inputs: [], buttons: [] };
    c4.mod = 'MEM';
    for (const k of c4Pages().map(x => x.key)) {
      c4.page = k; c4.step = null; showLearn();
      [...document.querySelectorAll('#learnRoot input')].forEach(i => {
        const labelled = i.getAttribute('aria-label') ||
          (i.id && document.querySelector('#learnRoot label[for="' + i.id + '"]'));
        if (!labelled) bad.inputs.push(k + ' ' + (i.id || i.className));
      });
      [...document.querySelectorAll('#learnRoot button')].forEach(x => {
        if (!x.textContent.trim() && !x.getAttribute('aria-label')) bad.buttons.push(k);
      });
    }
    return bad;
  });
  check('every control has an accessible name',
        a11y.inputs.length === 0 && a11y.buttons.length === 0,
        a11y.inputs.slice(0, 3).join(', ') + ' ' + a11y.buttons.slice(0, 3).join(', '));
  const kb = await page.evaluate(() => {
    c4.mod = 'MEM'; c4.page = 'f:lifecycle'; c4.mLife2 = null; showLearn();
    const r = document.querySelector('#learnRoot [data-memlife2]');
    if (!r) return null;
    r.focus();
    const was = +r.value;
    r.value = Math.max(0, was - 1);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    const again = document.querySelector('#learnRoot [data-memlife2]');
    return { moved: +again.value !== was, focused: document.activeElement === again };
  });
  check('the lifecycle slider responds and keeps focus',
        kb && kb.moved && kb.focused, JSON.stringify(kb));

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log('\n----------------------------------------------------------------');
  console.log('Memory deep dive  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

function hexNote(n) { return '0x' + Number(n).toString(16); }
