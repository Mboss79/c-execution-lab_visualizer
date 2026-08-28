'use strict';
/* Phase 12 — the Function Reproduction Lab.

   The claim under test: this lab executes nothing and computes nothing. Every
   number, byte, address, condition and return value it shows must be the
   engine's, for the step the UI is displaying. So almost every check here reads
   a value out of the DOM and compares it against history.stateAt(i) for that
   same step — a check that the UI merely CONTAINS some text would pass just as
   well against a hard-coded page, and is therefore worthless.

   The four defects the browser probe caught are each pinned by a named check
   below, so they cannot come back:
     - a partially-written buffer must stay visible (it was being hidden)
     - an int array must not be read as ASCII control characters
     - a function must open on a step where its own frame is alive
     - an unset scalar must say so rather than vanish */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { load, HTML } = require('./load-engine.js');
// load-engine exports HTML as the PATH to the shipped file, not its text.
const SHIPPED = fs.readFileSync(HTML, 'utf8');

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
  /* ============================ 1. SOURCE OF TRUTH ============================ */
  console.log('\n== source, structure and the no-second-engine rule ==');

  check('the lab module is present in the shipped file',
        SHIPPED.indexOf('==== REPROLAB START ====') > 0 && SHIPPED.indexOf('==== REPROLAB END ====') > 0);
  check('its stylesheet is present',
        SHIPPED.indexOf('==== REPROCSS START ====') > 0 && SHIPPED.indexOf('==== REPROCSS END ====') > 0);

  const mod = SHIPPED.slice(SHIPPED.indexOf('==== REPROLAB START ===='), SHIPPED.indexOf('==== REPROLAB END ===='));
  const css = SHIPPED.slice(SHIPPED.indexOf('==== REPROCSS START ===='), SHIPPED.indexOf('==== REPROCSS END ===='));

  // No second engine, parser, evaluator or ASCII table anywhere in this module.
  for (const banned of ['function tokenize', 'class Parser', 'function compile(',
                        'createRun', 'new Function', 'eval(',
                        'function asciiInfo', 'ASCII_TABLE =', 'toString(16)',
                        'function limitsOf', 'function representation'])
    check('the lab does not re-implement: ' + banned, mod.indexOf(banned) < 0);
  check('execution goes through the one engine entry point',
        /CEngine\.runToCompletion\(/.test(mod));
  check('the pointer view reads the Phase 4 graph rather than resolving pointers',
        /state\.graph/.test(mod) && mod.indexOf('pointerResolve') < 0);
  check('byte cells read the engine decode (element.repr) not a private converter',
        /el\.repr/.test(mod));

  // CSS containment: Phase 8 broke every lab table with one unscoped rule.
  // The slice begins inside the header comment, so restore its opener before
  // stripping — otherwise nothing is stripped and the prose is read as rules.
  const bare = ('/*' + css).replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleLines = bare.split('\n').filter(l => l.indexOf('{') >= 0);
  check('the stylesheet actually contains rules to inspect', ruleLines.length > 40,
        ruleLines.length + ' rules');
  const unscoped = ruleLines.filter(l => !/^\s*(#labRoot|@media)/.test(l));
  check('every Phase 12 CSS rule is scoped under #labRoot', unscoped.length === 0,
        unscoped.slice(0, 3).join(' | '));
  // A modifier like "#labRoot .rl-mode.on" is fine. What must never appear is a
  // selector whose target class belongs to another lab — that is exactly how
  // Phase 8's unscoped .vl-row rule broke every table on the site.
  const foreign = [];
  for (const line of ruleLines) {
    const sel = line.slice(0, line.indexOf('{'));
    for (const one of sel.split(',')) {
      const parts = one.trim().split(/[\s>+~]+/);
      let ownsIt = false;
      for (const part of parts) {
        const m = part.match(/^\.[a-z][a-z0-9-]*/);
        if (m && !/^\.rl-/.test(m[0]) && !ownsIt) foreign.push(m[0] + '  in  ' + one.trim());
        if (/\.rl-/.test(part)) ownsIt = true;   // from here the rule cannot escape this lab
      }
    }
  }
  check('a shared class is only ever restyled inside markup this lab owns',
        foreign.length === 0, foreign.slice(0, 4).join(' | '));

  /* ============================ 2. THE ENGINE RUNS IT ========================== */
  console.log('\n== the seed functions really execute ==');

  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1200 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|favicon/.test(m.text())) errs.push(m.text());
  });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(900);

  const openFn = async (id, mode) => {
    await page.evaluate((a) => {
      showLab(); lab.tab = 'repro'; lab.rpFn = a.id; lab.rpStep = null;
      lab.rpMode = a.mode || 'beginner'; renderLab();
    }, { id, mode });
    await sleep(160);
  };
  const setStep = async (i) => { await page.evaluate((k) => { lab.rpStep = k; renderLab(); }, i); await sleep(90); };

  const fns = await page.evaluate(() => REPRO_FUNCTIONS.map(f => ({ id: f.id, name: f.name, cat: f.category })));
  check('the function table is the single place functions are declared', fns.length >= 6, fns.length + ' entries');

  for (const f of fns) {
    await openFn(f.id);
    const r = await page.evaluate(() => {
      const run = reproRun();
      return { ok: run.ok, err: run.error, steps: run.ok ? run.steps.length : 0, src: run.src };
    });
    check(f.name + ' compiles and executes in the engine', r.ok && r.steps > 0,
          r.ok ? r.steps + ' steps' : r.err);

    // The decisive one: the text on screen is byte-for-byte the text executed.
    const same = await page.evaluate(() => {
      const shown = [...document.querySelectorAll('.rl-srcline')]
        .map(l => l.textContent.replace(/^\s*\d+  /, '')).join('\n');
      const executed = reproRun().src.split('\n');
      if (shown.split('\n').length !== executed.length) return 'line count ' +
        shown.split('\n').length + ' vs ' + executed.length;
      const a = shown.split('\n');
      for (let i = 0; i < a.length; i++)
        if (a[i].replace(/\s+$/, '') !== executed[i].replace(/\s+$/, '')) return 'line ' + (i + 1) + ': ' +
          JSON.stringify(a[i]) + ' vs ' + JSON.stringify(executed[i]);
      return true;
    });
    check(f.name + ': the source displayed IS the source executed', same === true, String(same));

    // Regression: opening on a dead frame made the lab useless for ft_sort_pass.
    const alive = await page.evaluate((n) => {
      const c = reproCur();
      return c ? c.cur.state.frames.some(fr => fr.name === n) : false;
    }, f.name);
    check(f.name + ' opens on a step where its own frame is alive', alive);
  }

  /* ====================== 3. UI VALUES == ENGINE SNAPSHOT ===================== */
  console.log('\n== every displayed value is the engine\'s, for the displayed step ==');

  await openFn('strcpy');
  const total = await page.evaluate(() => reproRun().steps.length);

  // Walk EVERY step and compare the whole frame/variable panel against stateAt(i).
  let mismatch = null, condSeen = 0, flowSeen = 0, diffSeen = 0, lineBad = null;
  for (let i = 0; i < total && !mismatch; i++) {
    await setStep(i);
    const cmp = await page.evaluate((k) => {
      const st = reproRun().steps[k].state;
      const step = reproRun().steps[k].step;
      // frames as the ENGINE has them, innermost first (that is how the UI prints)
      const want = st.frames.slice().reverse().map(f => f.name + ':' +
        f.vars.map(v => v.name + '=' + (v.uninitialized ? '?' : v.valueText)).join(','));
      const got = [...document.querySelectorAll('.rl-frame')].map(f =>
        f.querySelector('.rl-frame-h b').textContent.replace('()', '') + ':' +
        [...f.querySelectorAll('.rl-var')].map(v =>
          v.querySelector('.rl-var-n').textContent + '=' + v.querySelector('.rl-var-v').textContent).join(','));
      const onLine = document.querySelector('.rl-srcline.on');
      return {
        want, got,
        engineLine: step.line,
        shownLine: onLine ? +onLine.textContent.trim().split(/\s+/)[0] : null,
        hasCond: !!document.querySelector('.rl-cond'),
        engineCond: step.condition ? step.condition.expr + '|' + step.condition.result : null,
        shownCond: (() => { const c = document.querySelector('.rl-cond');
          if (!c) return null;
          return c.querySelector('.rl-cond-e').textContent + '|' +
                 /TRUE/.test(c.querySelector('.rl-cond-r').textContent); })(),
        hasFlow: !!document.querySelector('.rl-flow'),
        hasDiff: !!document.querySelector('.rl-diff'),
      };
    }, i);
    if (cmp.want.join(' || ') !== cmp.got.join(' || '))
      mismatch = 'step ' + (i + 1) + '\n  engine: ' + cmp.want.join(' || ') + '\n  shown : ' + cmp.got.join(' || ');
    if (cmp.shownLine !== cmp.engineLine)
      lineBad = lineBad || ('step ' + (i + 1) + ': engine line ' + cmp.engineLine + ', highlighted ' + cmp.shownLine);
    if (cmp.engineCond && cmp.shownCond !== cmp.engineCond)
      mismatch = mismatch || ('step ' + (i + 1) + ' condition: ' + cmp.engineCond + ' vs ' + cmp.shownCond);
    if (cmp.hasCond) condSeen++;
    if (cmp.hasFlow) flowSeen++;
    if (cmp.hasDiff) diffSeen++;
  }
  check('frames, parameters and locals match stateAt(i) at EVERY one of the ' + total + ' steps',
        !mismatch, mismatch);
  check('the highlighted source line is the engine\'s line at every step', !lineBad, lineBad);
  check('conditions are shown, with the engine\'s own operand text and result', condSeen >= 6, condSeen + ' steps');
  check('dataflow is shown for assignments', flowSeen >= 6, flowSeen + ' steps');
  check('a memory diff is shown when a byte changes', diffSeen >= 6, diffSeen + ' steps');

  /* ====================== 4. THE BUFFER FILLING UP =========================== */
  console.log('\n== the destination buffer, byte by byte ==');

  // Regression: a char[8] holding "Hello" is `uninitialized` to the engine
  // (2 bytes never written) and was being dropped from the watch panel.
  const destCells = async () => page.evaluate(() => {
    const o = [...document.querySelectorAll('.rl-obj')].find(x => {
      const h = x.querySelector('.rl-obj-h b'); return h && h.textContent === 'dest' && x.querySelector('.rl-cell2');
    });
    if (!o) return null;
    return [...o.querySelectorAll('.rl-cell2')].map(c => ({
      v: c.querySelector('.rl-c-v').textContent,
      hit: c.classList.contains('hit'),
      un: c.classList.contains('un'),
    }));
  });

  // The invariant: while dest is being filled, the engine flags the whole
  // char[8] as uninitialized (two bytes never written). That must NOT hide it —
  // watching it fill up is the entire lesson. Find the step where the engine is
  // in exactly that state and demand the UI renders it.
  const partialAt = await page.evaluate(() => {
    const r = reproRun();
    for (let i = 0; i < r.steps.length; i++)
      for (const f of r.steps[i].state.frames)
        for (const v of f.vars)
          if (v.name === 'dest' && v.elements && v.uninitialized &&
              v.elements.some(e => e.initialized) && v.elements.some(e => !e.initialized))
            return i;
    return -1;
  });
  check('the engine does flag the half-filled buffer as uninitialized', partialAt >= 0,
        'step ' + (partialAt + 1));
  await setStep(partialAt);
  let cells = await destCells();
  check('a partially-written buffer is still shown (not hidden as "uninitialized")',
        cells !== null && cells.some(c => !c.un) && cells.some(c => c.un),
        cells && cells.map(c => c.v).join(' '));

  // Compare the cells against the engine's element array at a mid-copy step.
  const midOk = await (async () => {
    for (let i = 0; i < total; i++) {
      await setStep(i);
      const cs = await destCells();
      if (!cs) continue;
      const eng = await page.evaluate((k) => {
        const st = reproRun().steps[k].state;
        for (const f of st.frames) for (const v of f.vars)
          if (v.name === 'dest' && v.elements)
            return v.elements.map(e => e.initialized ? (e.repr.ascii.code === 0 ? '\\0'
              : (e.repr.ascii.printable ? e.repr.ascii.display : e.repr.ascii.name)) : '?');
        return null;
      }, i);
      if (!eng) continue;
      if (eng.join(' ') !== cs.map(c => c.v).join(' '))
        return 'step ' + (i + 1) + ': engine ' + eng.join(' ') + ' vs shown ' + cs.map(c => c.v).join(' ');
    }
    return true;
  })();
  check('every dest byte cell equals the engine element at that step', midOk === true, String(midOk));

  // The terminator must read as \0, and it must be the byte the engine wrote 0 into.
  const nulOk = await (async () => {
    for (let i = total - 1; i >= 0; i--) {
      await setStep(i);
      const cs = await destCells();
      if (cs && cs.some(c => c.v === '\\0')) {
        const idx = cs.findIndex(c => c.v === '\\0');
        const eng = await page.evaluate((k) => {
          const st = reproRun().steps[k].state;
          for (const f of st.frames) for (const v of f.vars)
            if (v.name === 'dest' && v.elements) {
              const e = v.elements.find(x => x.initialized && x.repr.ascii.code === 0);
              return e ? e.index : null;
            }
          return null;
        }, i);
        return eng === idx ? true : 'shown at ' + idx + ', engine has it at ' + eng;
      }
    }
    return 'no terminator cell ever rendered';
  })();
  check('the NUL terminator renders as \\0 at the index the engine wrote it', nulOk === true, String(nulOk));

  // Only the byte that actually changed may be highlighted.
  const hitOk = await (async () => {
    for (let i = 0; i < total; i++) {
      await setStep(i);
      const cs = await destCells();
      if (!cs) continue;
      const hits = cs.map((c, k) => c.hit ? k : -1).filter(k => k >= 0);
      const eng = await page.evaluate((k) => {
        const s = reproRun().steps[k].step;
        const st = reproRun().steps[k].state;
        const addrs = (s.changed || []).concat(s.memDiff ? [s.memDiff.address] : []);
        for (const f of st.frames) for (const v of f.vars)
          if (v.name === 'dest' && v.elements)
            return v.elements.map((e, n) => addrs.indexOf(e.address) >= 0 ? n : -1).filter(n => n >= 0);
        return [];
      }, i);
      if (hits.join(',') !== eng.join(','))
        return 'step ' + (i + 1) + ': highlighted [' + hits + '] but engine changed [' + eng + ']';
    }
    return true;
  })();
  check('only the bytes the engine actually changed are highlighted', hitOk === true, String(hitOk));

  /* ====================== 5. INT ARRAYS ARE NOT ASCII ======================== */
  console.log('\n== an int array is not a string ==');

  await openFn('sort');
  const sortCells = await page.evaluate(() => {
    const o = [...document.querySelectorAll('.rl-obj')].find(x => {
      const h = x.querySelector('.rl-obj-h b');
      return h && h.textContent === 'a' && x.querySelector('.rl-cell2');
    });
    return o ? [...o.querySelectorAll('.rl-cell2')].map(c => c.querySelector('.rl-c-v').textContent) : null;
  });
  // Regression: {4,2,3,1} was rendering as the ASCII control names EOT STX ETX SOH.
  check('int array cells show numbers, not ASCII control-character names',
        sortCells && sortCells.every(c => /^-?\d+$/.test(c)), JSON.stringify(sortCells));
  const sortEngine = await page.evaluate(() => {
    const c = reproCur();
    for (const f of c.cur.state.frames) for (const v of f.vars)
      if (v.name === 'a' && v.elements) return v.elements.map(e => e.repr.decimal);
    return null;
  });
  check('and those numbers are the engine\'s element values',
        sortCells && sortEngine && sortCells.join(',') === sortEngine.join(','),
        JSON.stringify(sortCells) + ' vs ' + JSON.stringify(sortEngine));
  check('one bubble pass really reordered the array in memory',
        sortEngine && sortEngine.join(',') === '2,3,1,4', JSON.stringify(sortEngine));

  /* ====================== 6. RETURN AND FRAME DESTRUCTION ==================== */
  console.log('\n== return (dest), and the frame going away ==');

  await openFn('strcpy');
  const retIdx = await page.evaluate(() => {
    const r = reproRun();
    for (let i = 0; i < r.steps.length; i++) if (r.steps[i].step.phase === 'call-return') return i;
    return -1;
  });
  check('the engine produced a call-return step', retIdx >= 0);
  await setStep(retIdx);
  const ret = await page.evaluate(() => {
    const el = document.querySelector('.rl-ret');
    if (!el) return null;
    const c = reproCur();
    const rv = c.cur.step.returnValue;
    const node = c.cur.state.graph.nodes.find(n => String(n.address) === String(rv));
    return { text: el.textContent.replace(/\s+/g, ' ').trim(),
             engineValue: String(rv),
             engineHex: node ? CEngine.hexAddr(node.address) : null,
             engineLabel: node ? node.label : null,
             engineType: node ? node.typeName : null };
  });
  check('the return block shows the engine\'s returned value',
        ret && ret.text.indexOf(ret.engineValue) >= 0, ret && ret.text);
  check('it names what that address actually IS, from the pointer graph',
        ret && ret.engineLabel === 'dest' && ret.engineType === 'char[8]' &&
        ret.text.indexOf('dest') >= 0 && ret.text.indexOf('char[8]') >= 0,
        ret && (ret.engineLabel + ' ' + ret.engineType));
  check('and the address it names is the engine\'s hex for that object',
        ret && ret.engineHex && ret.text.indexOf(ret.engineHex) >= 0, ret && ret.engineHex);

  const popIdx = await page.evaluate(() => {
    const r = reproRun();
    for (let i = 0; i < r.steps.length; i++)
      if (r.steps[i].step.detail && r.steps[i].step.detail.poppedFrame) return i;
    return -1;
  });
  check('the engine reports the popped frame', popIdx >= 0);
  await setStep(popIdx);
  const pop = await page.evaluate(() => {
    const el = document.querySelector('.rl-pop');
    const c = reproCur();
    return { shown: el ? el.textContent.replace(/\s+/g, ' ').trim() : null,
             engine: c.cur.step.detail.poppedFrame,
             framesLeft: c.cur.state.frames.map(f => f.name) };
  });
  check('the destroyed frame is named, and it is the engine\'s',
        pop.shown && pop.shown.indexOf(pop.engine) >= 0, pop.shown);
  check('after the pop, ft_strcpy is genuinely gone from the frame list',
        pop.framesLeft.indexOf('ft_strcpy') < 0, JSON.stringify(pop.framesLeft));

  /* ====================== 7. POINTERS COME FROM THE GRAPH ==================== */
  console.log('\n== pointers, from the Phase 4 graph only ==');

  await openFn('strcpy', 'intermediate');
  const ptr = await page.evaluate(() => {
    const c = reproCur();
    const g = c.cur.state.graph;
    const shown = [...document.querySelectorAll('.rl-ptr')].map(p => ({
      name: p.querySelector('.rl-ptr-n').textContent,
      kind: p.querySelector('.rl-ptr-k').textContent,
      target: p.querySelector('.rl-ptr-t').textContent,
    }));
    const want = g.edges.map(e => {
      const to = e.to ? g.nodes.find(n => n.id === e.to) : null;
      return { name: e.name, kind: e.kind === 'points-to' ? 'points to' : e.kind,
               target: to ? to.label : (e.text || '—') };
    });
    return { shown, want };
  });
  check('every pointer row is a graph edge, with the graph\'s own target',
        JSON.stringify(ptr.shown) === JSON.stringify(ptr.want),
        JSON.stringify(ptr.shown) + ' vs ' + JSON.stringify(ptr.want));
  check('the graph resolves dest and src to real objects', ptr.want.length >= 2,
        ptr.want.map(w => w.name + '->' + w.target).join(', '));

  /* ====================== 8. EXPERIMENTS ARE REAL RUNS ======================= */
  console.log('\n== experiments run the engine again, they do not describe it ==');

  await openFn('strcpy');
  const exps = await page.evaluate(() => {
    const f = REPRO_FUNCTIONS.find(x => x.id === 'strcpy');
    return f.experiments.map(x => {
      const r = reproRun(x.patch);
      return { label: x.label, ok: r.ok, steps: r.ok ? r.steps.length : 0,
               patched: r.src.indexOf(x.patch[1]) >= 0, stale: r.src.indexOf(x.patch[0]) >= 0 };
    });
  });
  const base = await page.evaluate(() => reproRun().steps.length);
  check('each experiment compiles its own patched program',
        exps.every(e => e.ok && e.patched && !e.stale), JSON.stringify(exps));
  check('a shorter input really costs fewer steps',
        exps[0].steps < base, exps[0].steps + ' vs ' + base);
  check('a longer input really costs more steps',
        exps[1].steps > base, exps[1].steps + ' vs ' + base);
  const shownExp = await page.evaluate(() =>
    [...document.querySelectorAll('.rl-exp:not(.base) .rl-exp-s')].map(e => parseInt(e.textContent, 10)));
  check('the step counts on screen are those runs\' real lengths',
        shownExp.join(',') === exps.map(e => e.steps).join(','),
        shownExp.join(',') + ' vs ' + exps.map(e => e.steps).join(','));

  /* ====================== 9. THE THREE DETAIL LEVELS ========================= */
  console.log('\n== beginner / intermediate / expert describe ONE execution ==');

  const perMode = {};
  for (const m of ['beginner', 'intermediate', 'expert']) {
    await openFn('strcpy', m);
    await setStep(12);
    perMode[m] = await page.evaluate(() => {
      const c = reproCur();
      return {
        step: c.i,
        line: (document.querySelector('.rl-srcline.on') || {}).textContent.trim().split(/\s+/)[0],
        vars: [...document.querySelectorAll('.rl-var')].map(v =>
          v.querySelector('.rl-var-n').textContent + '=' + v.querySelector('.rl-var-v').textContent).join(','),
        addrs: !!document.querySelector('.rl-var-a'),
        ptrs: !!document.querySelector('.rl-ptrs'),
        ast: !!document.querySelector('.rl-facts'),
      };
    });
  }
  check('all three modes sit on the same engine step',
        perMode.beginner.step === perMode.expert.step && perMode.beginner.step === perMode.intermediate.step);
  check('all three report the same current line', perMode.beginner.line === perMode.expert.line);
  check('all three report identical variable values — they cannot disagree',
        perMode.beginner.vars === perMode.expert.vars && perMode.beginner.vars === perMode.intermediate.vars,
        perMode.beginner.vars + ' | ' + perMode.expert.vars);
  check('beginner hides raw addresses', !perMode.beginner.addrs);
  check('intermediate adds addresses and the pointer graph',
        perMode.intermediate.addrs && perMode.intermediate.ptrs);
  check('expert adds the parsed-program facts', perMode.expert.ast && !perMode.beginner.ast);
  const facts = await page.evaluate(() => {
    const f = {};
    for (const el of document.querySelectorAll('.rl-fact'))
      f[el.querySelector('span').textContent] = el.querySelector('b').textContent;
    return { f, steps: reproRun().steps.length, arch: CEngine.ARCH.short };
  });
  check('the expert step count is the engine\'s history length',
        +facts.f['execution steps'] === facts.steps, facts.f['execution steps'] + ' vs ' + facts.steps);
  check('the expert architecture line is CEngine.ARCH', facts.f['architecture'] === facts.arch);
  check('it reports both parsed functions', facts.f['functions parsed'] === '2');

  /* ====================== 10. UNSUPPORTED C IS REPORTED ====================== */
  console.log('\n== unsupported C is named, never quietly simplified ==');

  const uns = await page.evaluate(() => {
    REPRO_FUNCTIONS.push({ id:'__t', name:'probe', category:'custom', prototype:'x', goal:'x',
      input:'x', output:'x', variables:'x', conditions:'x', loop:'x', algorithm:'x',
      watch:[], concepts:[], mistakes:[], source:'struct S { int a; };\n',
      harness:'int\tmain(void)\n{\n\treturn (0);\n}\n' });
    lab.rpFn = '__t'; lab.rpStep = null; lab.rpRuns = null; renderLab();
    const el = document.querySelector('.rl-unsupported');
    const run = reproRun();
    const out = { shown: el ? el.textContent.replace(/\s+/g, ' ').trim() : null,
                  engineMsg: run.error, timeline: !!document.querySelector('.rl-srcline.on'),
                  srcIntact: (document.querySelector('.rl-src') || {}).textContent };
    REPRO_FUNCTIONS.pop(); lab.rpFn = 'strcpy'; lab.rpRuns = null; renderLab();
    return out;
  });
  check('an unsupported construct produces the UNSUPPORTED banner',
        uns.shown && /UNSUPPORTED BY SIMULATOR/.test(uns.shown));
  check('the banner carries the engine\'s own diagnostic, not a generic message',
        uns.shown && uns.engineMsg && uns.shown.indexOf(uns.engineMsg) >= 0, uns.engineMsg);
  check('it names the construct that failed', /struct/.test(uns.engineMsg || ''), uns.engineMsg);
  check('no fabricated timeline is shown for a program that never ran', !uns.timeline);
  check('the C is still displayed unchanged, not silently rewritten',
        (uns.srcIntact || '').indexOf('struct S') >= 0);

  /* ====================== 11. NAVIGATION AND REGRESSIONS ===================== */
  console.log('\n== the existing navigation, unchanged ==');

  const nav = await page.evaluate(() => ({
    strips: document.querySelectorAll('.vl-tabs').length,
    tabs: [...document.querySelectorAll('.vl-tab')].map(t => t.dataset.labtab),
    sidebars: document.querySelectorAll('.sidebar, #sidebar').length,
    editors: document.querySelectorAll('#sourceEdit').length,
  }));
  check('there is still exactly ONE lab tab strip', nav.strips === 1, String(nav.strips));
  check('the earlier tabs are unchanged and in order',
        nav.tabs.slice(0, 12).join(',') ===
        'ascii,convert,bits,arith,compare,types,functions,syscalls,c03,repr,ptr,argv',
        nav.tabs.join(','));
  check('Function Reproduction is appended to that same strip',
        nav.tabs[12] === 'repro' && nav.tabs.length === 13, nav.tabs.join(','));
  check('no second sidebar was introduced', nav.sidebars <= 1, String(nav.sidebars));
  check('no second editor was introduced', nav.editors === 1, String(nav.editors));

  // Clicking the real button, not setting state.
  await page.evaluate(() => { showLab(); lab.tab = 'ascii'; renderLab(); });
  await sleep(200);
  await page.click('.vl-tab[data-labtab="repro"]');
  await sleep(300);
  const clicked = await page.evaluate(() => ({
    tab: lab.tab, rendered: !!document.querySelector('.rl-block'),
    on: !!document.querySelector('.vl-tab[data-labtab="repro"].on'),
  }));
  check('clicking the tab navigates to the lab', clicked.tab === 'repro' && clicked.rendered && clicked.on);

  // Clicking a function button really switches the executed program.
  await page.click('.rl-fn[data-rpfn="strlen"]');
  await sleep(250);
  const switched = await page.evaluate(() => ({
    fn: lab.rpFn, src: reproRun().src.indexOf('ft_strlen') >= 0,
    shown: document.querySelector('.rl-src').textContent.indexOf('ft_strlen') >= 0,
  }));
  check('clicking a function switches both the display and the executed program',
        switched.fn === 'strlen' && switched.src && switched.shown);

  // Stepping with the real controls.
  await page.evaluate(() => { lab.rpFn = 'strcpy'; lab.rpStep = 4; renderLab(); });
  await sleep(150);
  await page.click('.vl-btn[data-rpstep="next"]');
  await sleep(150);
  const stepped = await page.evaluate(() => ({ i: lab.rpStep,
    line: (document.querySelector('.rl-srcline.on') || {}).textContent.trim().split(/\s+/)[0],
    engineLine: reproRun().steps[lab.rpStep].step.line }));
  check('the step control advances and the highlight follows the engine',
        stepped.i === 5 && +stepped.line === stepped.engineLine,
        JSON.stringify(stepped));

  // Every tab still renders.
  const tabsOk = [];
  for (const t of ['ascii', 'convert', 'bits', 'arith', 'compare', 'types', 'functions',
                   'syscalls', 'c03', 'repr', 'ptr', 'argv', 'repro']) {
    await page.evaluate((x) => { lab.tab = x; renderLab(); }, t);
    await sleep(80);
    const n = await page.evaluate(() => document.querySelector('#labRoot').textContent.length);
    if (n < 300) tabsOk.push(t + ':' + n);
  }
  check('all 13 tabs still render real content', tabsOk.length === 0, tabsOk.join(' '));

  // The alignment regression the bug-fix phase existed for.
  await page.evaluate(() => { lab.tab = 'ascii'; renderLab(); });
  await sleep(250);
  const align = await page.evaluate(() => {
    const th = [...document.querySelectorAll('.vl-table thead th')];
    const row = document.querySelector('.vl-table tbody tr.vl-row');
    if (!th.length || !row) return { err: 'selectors missing' };
    const cells = [...row.children];
    if (th.length !== cells.length) return { err: 'column count ' + th.length + ' vs ' + cells.length };
    return { drift: Math.max(...th.map((h, i) =>
      Math.abs(h.getBoundingClientRect().left - cells[i].getBoundingClientRect().left))), cols: th.length };
  });
  check('ASCII header columns still align with body columns',
        !align.err && align.drift < 1, align.err || (align.cols + ' cols, ' + align.drift.toFixed(2) + 'px'));

  // The caret fix from ceba821.
  // The ceba821 fix: the transparent textarea must sit exactly on the rendered
  // code column, and both layers must agree on the tab stop. Text origins are
  // compared, not border boxes — .code carries a padding-left, so a border-box
  // comparison is what called the layers aligned while the caret sat a column
  // to the left.
  const caret = await page.evaluate(() => {
    showWorkspace(); switchToEditing();
    const ta = document.querySelector('#sourceEdit');
    const code = document.querySelector('#sourceView .codeline .code');
    if (!code) return { err: 'code column missing' };
    const cs = getComputedStyle(ta), cc = getComputedStyle(code);
    const tr = ta.getBoundingClientRect(), cr = code.getBoundingClientRect();
    return {
      dx: Math.round((tr.left + parseFloat(cs.paddingLeft)) - (cr.left + parseFloat(cc.paddingLeft))),
      dy: Math.round((tr.top + parseFloat(cs.paddingTop)) - cr.top),
      sameTab: (cs.tabSize || cs.MozTabSize) === (cc.tabSize || cc.MozTabSize),
      tab: cs.tabSize + '/' + cc.tabSize,
      sameFont: cs.fontFamily === cc.fontFamily && cs.fontSize === cc.fontSize,
    };
  });
  check('the editing layer is still aligned to the code column to the pixel',
        !caret.err && Math.abs(caret.dx) <= 1 && Math.abs(caret.dy) <= 1, JSON.stringify(caret));
  check('both layers still agree on the tab stop and font metrics',
        caret.sameTab && caret.sameFont, JSON.stringify(caret));

  check('the browser reported no page or console errors',
        errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => {
    showLab(); lab.tab = 'repro'; lab.rpFn = 'strcpy'; lab.rpStep = null;
    lab.rpMode = 'beginner'; renderLab();
  });
  await sleep(320);
  await page.screenshot({ path: path.join(SHOTS, 'p24_repro.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 12  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
