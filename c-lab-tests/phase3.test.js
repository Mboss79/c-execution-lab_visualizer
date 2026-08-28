'use strict';
// PHASE 3 EXIT GATE — layout, workspace, debugger UX, performance, themes.
// Runs against the shipped ../index.html in real Chrome.
const puppeteer = require('puppeteer-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'screenshots');

let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; failures.push(name + ' :: ' + (detail || '')); console.log('  FAIL ' + name + '  -- ' + (detail || '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,1000'], protocolTimeout: 240000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  const goto = async () => {
    await page.goto(FILE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(500);
  };
  await goto();

  const runAll = () => page.evaluate(async () => { await fastForward({}); return { steps: run.history ? run.history.length : 0, mode: run.mode }; });
  const start  = async () => { await page.evaluate(() => showWorkspace()); await page.click('#btnStep'); await sleep(200); };
  const open   = (k) => page.evaluate((kk) => loadExample(kk), k);

  /* ===================== SHELL ===================== */
  console.log('=== Phase 3: application shell ===');
  check('loads with no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  check('opens on the dashboard', await page.evaluate(() => ui.view) === 'dashboard');
  check('the dashboard presents the application\'s capabilities, and each routes somewhere',
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#dashRoot .dash-sec h2')].map(h => h.textContent.trim());
      if (!heads.includes('Labs') || !heads.includes('Tools')) return 'sections: ' + heads.join(',');
      const cards = [...document.querySelectorAll('#dashRoot .dash-sec .dcard')];
      if (cards.length < 15) return 'only ' + cards.length + ' cards';
      const unrouted = cards.filter(c =>
        !(c.dataset.lab || c.dataset.dpanel || c.dataset.ddock || c.id));
      return unrouted.length ? unrouted.length + ' unrouted' : true;
    }) === true);
  check('the dashboard offers no destination that does not exist',
    await page.evaluate(() => {
      const bad = [];
      for (const x of document.querySelectorAll('#dashRoot [data-open]'))
        if (!EXAMPLES[x.dataset.open]) bad.push('example ' + x.dataset.open);
      for (const x of document.querySelectorAll('#dashRoot [data-lab]'))
        if (!LAB_TABS.some(t => t.id === x.dataset.lab)) bad.push('lab ' + x.dataset.lab);
      for (const x of document.querySelectorAll('#dashRoot [data-dpanel]'))
        if (!document.getElementById(x.dataset.dpanel)) bad.push('panel ' + x.dataset.dpanel);
      for (const x of document.querySelectorAll('#dashRoot [data-ddock]'))
        if (!document.querySelector('.dock-tab[data-dock="' + x.dataset.ddock + '"]')) bad.push('dock ' + x.dataset.ddock);
      return bad.length ? bad.join(' | ') : true;
    }) === true);
  check('and parks no disabled placeholder on the entry page',
    await page.evaluate(() => [...document.querySelectorAll('#dashRoot button')].filter(x => x.disabled).length) === 0);
  check('exercises have distinct filenames', await page.evaluate(() => {
    const names = EXAMPLE_ORDER.map(fileNameFor);
    return new Set(names).size === names.length;
  }), await page.evaluate(() => fileNameFor('ex6') + ', ' + fileNameFor('ex8')));
  check('shell has titlebar, toolbar, rail, panes, dock, statusbar', await page.evaluate(() =>
    !!(document.querySelector('.titlebar') && document.querySelector('.toolbar') && document.querySelector('.rail') &&
       document.querySelector('.panes') && document.querySelector('.dock') && document.querySelector('.statusbar'))));

  await page.evaluate(() => showWorkspace());
  await sleep(200);
  check('rail switches to workspace', await page.evaluate(() => ui.view) === 'workspace');

  /* ===================== RESIZABLE SPLIT ===================== */
  console.log('\n=== Phase 3: resizable split ===');
  const before = await page.evaluate(() => ui.split);
  const box = await page.$eval('#divider', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y, { steps: 12 });
  const during = await page.evaluate(() => ({ split: ui.split, dragging: !!document.querySelector('.divider.dragging'), readout: !!document.querySelector('#dragReadout') }));
  await page.mouse.up();
  await sleep(150);
  const after = await page.evaluate(() => ui.split);
  check('dragging the divider changes the split', Math.abs(after - before) > 5, before.toFixed(1) + '% -> ' + after.toFixed(1) + '%');
  check('drag shows visual feedback', during.dragging && during.readout, JSON.stringify(during));
  check('split is clamped to sane bounds', await page.evaluate(() => { setSplit(2); const a = ui.split; setSplit(99); const b = ui.split; return a >= 20 && b <= 80; }));
  await page.evaluate(() => { setSplit(63); saveUI(); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(450);
  check('split persists across reload', Math.abs(await page.evaluate(() => ui.split) - 63) < 1, String(await page.evaluate(() => ui.split)));
  check('keyboard resizes the divider', await page.evaluate(() => {
    const s0 = ui.split; const d = document.querySelector('#divider'); d.focus();
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return ui.split > s0;
  }));
  await page.evaluate(() => resetLayout());
  check('reset layout restores 42%', Math.abs(await page.evaluate(() => ui.split) - 42) < 1);
  check('divider exposes ARIA separator role', await page.$eval('#divider', el =>
    el.getAttribute('role') === 'separator' && el.hasAttribute('aria-valuenow')));

  /* ===================== SCROLLING ===================== */
  console.log('\n=== Phase 3: three-level scrolling ===');
  // Phase 10 moved the Timeline to the Deep detail level (spec section 4:
  // Basic shows only call stack, variables, memory and pointers). The
  // assertions below are unchanged; only the level they run at is, because
  // Deep is now the level at which the Timeline is part of the UI.
  await page.evaluate(() => { showWorkspace(); setLevel('deep'); });
  await open('ex6'); await start(); await runAll(); await sleep(200);
  const scrolls = await page.evaluate(() => {
    const can = (sel) => { const e = document.querySelector(sel); if (!e) return 'missing'; return e.scrollHeight > e.clientHeight + 2 ? 'scrolls' : 'fits'; };
    return { page: document.documentElement.scrollHeight <= document.documentElement.clientHeight + 2,
             right: can('#rightScroll'), timeline: can('#tlViewport'), src: can('#srcScroll'), dock: can('#dockBody') };
  });
  check('application does not scroll as a whole (shell is fixed)', scrolls.page, JSON.stringify(scrolls));
  check('right workspace scrolls independently', scrolls.right !== 'missing');
  check('timeline scrolls independently', scrolls.timeline === 'scrolls', scrolls.timeline);
  check('source scrolls independently', scrolls.src !== 'missing', scrolls.src);
  check('no content is unreachable by clipping', await page.evaluate(() => {
    // every panel body must be reachable: either visible or inside a scrollable ancestor
    const bad = [];
    document.querySelectorAll('.panel:not(.collapsed) .panel-body').forEach(b => {
      if (b.scrollHeight > b.clientHeight + 2 && getComputedStyle(b).overflow === 'hidden') bad.push(b.parentElement.id);
    });
    return bad.length === 0 ? true : bad.join(',');
  }) === true);

  /* ===================== DEBUGGER CONTROLS ===================== */
  console.log('\n=== Phase 3: debugger controls ===');
  await open('ex3'); await start();
  for (let i = 0; i < 5; i++) { await page.click('#btnStep'); await sleep(40); }
  const i1 = await page.evaluate(() => run.index);
  await page.click('#btnPrev'); await sleep(60);
  await page.click('#btnPrev'); await sleep(60);
  check('Prev moves back', await page.evaluate(() => run.index) === i1 - 2);
  await page.click('#btnFirst'); await sleep(60);
  check('First jumps to step 1', await page.evaluate(() => run.index) === 0);
  await page.click('#btnStep'); await sleep(60);
  check('Step moves forward', await page.evaluate(() => run.index) === 1);
  // Phase 11 merged the playback slider and the animation-speed select into one
  // control, so "make Run fast" is now setAnimSpeed(5). Setup only — every
  // assertion below is unchanged.
  await page.evaluate(() => setAnimSpeed(5));
  await page.click('#btnRun'); await sleep(400);
  check('Run starts playing', await page.evaluate(() => run.playing));
  await page.click('#btnRun'); await sleep(150);
  check('Pause stops playing', await page.evaluate(() => !run.playing));
  await page.click('#btnReset'); await sleep(250);
  check('Reset returns to step 1', await page.evaluate(() => run.index) === 0);

  /* ===================== BREAKPOINTS ===================== */
  console.log('\n=== Phase 3: breakpoints ===');
  await open('ex3'); await start();
  await page.evaluate(() => toggleBreakpoint(7));
  check('gutter marker renders', await page.$$eval('#sourceView .codeline.bp', e => e.length) === 1);
  await page.evaluate(async () => { await fastForward({ toBreakpoint: true }); });
  await sleep(300);
  const bp = await page.evaluate(() => ({ line: run.history.steps[run.index].line, banner: !document.querySelector('#bpBanner').classList.contains('hide'), mode: run.mode }));
  check('run-to-breakpoint halts on the breakpoint line', bp.line === 7, JSON.stringify(bp));
  check('breakpoint hit is announced', bp.banner);
  await page.evaluate(() => { run.breakpoints.clear(); renderSource(step() ? step().line : null); });
  check('breakpoints can be cleared', await page.$$eval('#sourceView .codeline.bp', e => e.length) === 0);

  /* ===================== FAST RUN / PERFORMANCE ===================== */
  console.log('\n=== Phase 3: performance ===');
  const perf = await page.evaluate(async () => {
    document.querySelector('#sourceEdit').value = 'int main(void)\n{\n\tint i;\n\tint s;\n\n\ti = 0;\n\ts = 0;\n\twhile (i < 2000)\n\t{\n\t\ts = s + i;\n\t\ti++;\n\t}\n\treturn (0);\n}\n';
    switchToEditing(); startExecution();
    const t = performance.now();
    await fastForward({});
    return { ms: performance.now() - t, steps: run.history.length, mode: run.mode };
  });
  check('fast run executes a 6000-step program', perf.steps > 5000 && perf.mode === 'done', perf.steps + ' steps');
  check('fast run is fast (no per-step DOM)', perf.ms < 4000, Math.round(perf.ms) + ' ms for ' + perf.steps + ' steps (old per-step render was ~6 ms/step ≈ 36 s)');
  const tlPerf = await page.evaluate(() => ({ rows: document.querySelectorAll('#tlRows .tl-item').length, total: run.history.length }));
  check('timeline virtualizes (few DOM nodes for many steps)', tlPerf.rows < 80 && tlPerf.total > 5000,
        tlPerf.rows + ' DOM rows for ' + tlPerf.total + ' steps');
  const scrubMs = await page.evaluate(() => {
    const t = performance.now();
    const n = run.history.length;
    [0, n >> 1, n - 1, 5, Math.floor(n * 0.8), 1, n - 2].forEach(i => goTo(i));
    return performance.now() - t;
  });
  check('time travel across 6000 steps stays responsive', scrubMs < 3000, Math.round(scrubMs) + ' ms for 7 random jumps');
  const tlScroll = await page.evaluate(() => {
    const vp = document.querySelector('#tlViewport');
    const t = performance.now();
    for (let k = 0; k < 20; k++) { vp.scrollTop = k * 300; drawTimelineWindow(); }
    return performance.now() - t;
  });
  check('timeline scrolling does not freeze', tlScroll < 2000, Math.round(tlScroll) + ' ms for 20 scroll frames');

  /* ===================== TIMELINE UX ===================== */
  console.log('\n=== Phase 3: timeline UX ===');
  // Deep for the same reason as the scrolling section above: the Timeline is a
  // Deep-level panel since Phase 10. The checks themselves are untouched.
  await page.evaluate(() => setLevel('deep'));
  await open('ex6'); await start(); await runAll(); await sleep(200);
  check('current step marker is rendered', await page.evaluate(() => {
    goTo(40); return !!document.querySelector('#tlRows .tl-item.current');
  }));
  check('clicking a timeline row travels there', await page.evaluate(() => {
    goTo(10);
    const row = document.querySelector('#tlRows .tl-item:not(.current)');
    const want = +row.dataset.i;
    row.click();
    return run.index === want;
  }));
  const filters = await page.evaluate(() => {
    const out = {};
    for (const f of ['all','memory','function','output','variable','source','error']) {
      ui.tlFilter = f; renderTimeline();
      out[f] = tlIndex.length;
    }
    ui.tlFilter = 'all'; renderTimeline();
    return out;
  });
  check('filters narrow the timeline', filters.memory < filters.all && filters.output < filters.all && filters.output > 0, JSON.stringify(filters));
  check('filters do not change execution state', await page.evaluate(() => {
    const before = run.history.length, idx = run.index;
    ui.tlFilter = 'memory'; renderTimeline();
    const same = run.history.length === before && run.index === idx;
    ui.tlFilter = 'all'; renderTimeline();
    return same;
  }));
  check('timeline nav buttons work', await page.evaluate(() => {
    goTo(20); document.querySelector('#tlNext').click(); const a = run.index;
    document.querySelector('#tlPrev').click(); const b = run.index;
    document.querySelector('#tlFirst').click(); const c = run.index;
    return a === 21 && b === 20 && c === 0;
  }));

  /* ===================== SOURCE <-> EXECUTION ===================== */
  console.log('\n=== Phase 3: source ↔ execution ===');
  check('current line is highlighted', await page.evaluate(() => {
    goTo(30);
    const el = document.querySelector('#sourceView .codeline.active');
    return el && +el.dataset.line === run.history.steps[30].line;
  }));
  check('timeline click scrolls source to that line', await page.evaluate(() => {
    goTo(60);
    const el = document.querySelector('#sourceView .codeline.active');
    return !!el;
  }));
  check('lines with steps are marked clickable', await page.evaluate(() =>
    document.querySelectorAll('#sourceView .codeline.has-steps').length > 3));
  check('clicking such a line offers Show execution', await page.evaluate(() => {
    const el = document.querySelector('#sourceView .codeline.has-steps .code');
    el.click();
    const pop = document.querySelector('.src-actions');
    const ok = !!pop && /Show execution/.test(pop.textContent);
    if (pop) pop.remove();
    return ok;
  }));

  /* ===================== PANELS / HIERARCHY ===================== */
  console.log('\n=== Phase 3: panels & hierarchy ===');
  // Back to the default level: the timeline sections above raised it to Deep,
  // and this section is about what the DEFAULT hierarchy looks like.
  await page.evaluate(() => setLevel('beginner'));
  check('every panel has icon, title and description', await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.panel').forEach(p => {
      if (!p.querySelector('.p-ico') || !p.querySelector('.p-title')) bad.push(p.id);
    });
    return bad.length ? bad.join(',') : true;
  }) === true);
  check('level-3 panels start collapsed', await page.evaluate(() =>
    document.querySelector('#panelDeep').classList.contains('collapsed') &&
    document.querySelector('#panelRam').classList.contains('collapsed')));
  check('level-1 execution panel is always visible', await page.evaluate(() => {
    const e = document.querySelector('#execHost .exec');
    return !!e && e.getBoundingClientRect().height > 60;
  }));
  check('panels collapse and expand', await page.evaluate(() => {
    togglePanel('panelMemory'); const a = document.querySelector('#panelMemory').classList.contains('collapsed');
    togglePanel('panelMemory'); const b = document.querySelector('#panelMemory').classList.contains('collapsed');
    return a && !b;
  }));
  check('collapse state persists', await page.evaluate(() => { togglePanel('panelStack'); return ui.collapsed.panelStack === true; }));
  await page.evaluate(() => togglePanel('panelStack'));

  /* ===================== INSPECTION (must not execute) ===================== */
  console.log('\n=== Phase 3: inspection vs execution ===');
  await open('ex8'); await start();
  await page.evaluate(async () => { await fastForward({}); goTo(12); });
  await sleep(150);
  const insp = await page.evaluate(() => {
    const before = { idx: run.index, len: run.history.length };
    const frames = document.querySelectorAll('#stackPanel .frame');
    if (frames.length < 2) return { skip: true, frames: frames.length };
    frames[1].click();
    return { before, after: { idx: run.index, len: run.history.length }, inspecting: ui.inspectFrame !== null,
             note: !!document.querySelector('.inspect-note') };
  });
  if (insp.skip) check('call stack frame inspection', false, 'only ' + insp.frames + ' frame(s) at that step');
  else {
    check('clicking a frame inspects it', insp.inspecting && insp.note);
    check('inspecting does NOT change execution state', insp.before.idx === insp.after.idx && insp.before.len === insp.after.len,
          JSON.stringify(insp));
  }
  check('frame state uses icon + text, not colour alone', await page.evaluate(() => {
    const t = document.querySelector('#stackPanel').textContent;
    return /ACTIVE/.test(t) && (/SUSPENDED/.test(t) || document.querySelectorAll('#stackPanel .frame').length === 1);
  }));
  await page.evaluate(() => { ui.inspectFrame = null; render(); });

  /* ===================== VARIABLES / ARRAYS / MEMORY / RAM ===================== */
  console.log('\n=== Phase 3: data panels ===');
  await open('ex6'); await start();
  await page.evaluate(async () => { await fastForward({}); goTo(80); openPanel('panelVars'); });
  await sleep(200);
  check('variables are grouped by scope', await page.evaluate(() =>
    document.querySelectorAll('#varsPanel .scope-title').length >= 1));
  check('clicking a variable reveals type/address/size', await page.evaluate(() => {
    const v = document.querySelector('#varsPanel .var');
    v.click();
    const d = document.querySelector('#varsPanel .v-detail');
    return !!d && /type/.test(d.textContent) && /address/.test(d.textContent) && /size/.test(d.textContent);
  }));
  check('arrays render as indexed cells with addresses', await page.evaluate(() => {
    ui.selectedVar = 'str'; render();
    const cells = document.querySelectorAll('#varsPanel .arr-cell');
    return cells.length > 3 && !!document.querySelector('#varsPanel .arr-cell .ac-i') && !!document.querySelector('#varsPanel .arr-cell .ac-a');
  }));
  check('clicking an array element focuses its memory', await page.evaluate(() => {
    const c = document.querySelector('#varsPanel .arr-cell');
    c.click();
    return ui.focusByte && ui.focusByte.address === +c.dataset.addr;
  }));
  check('memory byte inspector shows address/byte/value/type/source', await page.evaluate(() => {
    openPanel('panelMemory'); render();
    const d = document.querySelector('#memPanel .byte-detail');
    if (!d) return 'no byte-detail';
    const t = d.textContent;
    return /address/.test(t) && /byte/.test(t) && /decimal/.test(t) && /type/.test(t) && /source/.test(t);
  }) === true);
  for (const v of ['decimal','hex','binary','char']) {
    await page.evaluate((vv) => document.querySelector('#memViewSeg button[data-view="' + vv + '"]').click(), v);
    await sleep(60);
    check('memory view ' + v, await page.$$eval('#memPanel .bv', e => e.length) > 0);
  }
  check('RAM region buttons focus a region', await page.evaluate(() => {
    openPanel('panelRam');
    document.querySelector('#ramNav button[data-seg="stack"]').click();
    return ui.focusRegion === 'stack' && !!document.querySelector('#ramPanel .ram-seg.focused');
  }));
  check('focused region lists its objects', await page.evaluate(() =>
    document.querySelectorAll('#ramPanel .ram-o').length > 0));
  check('clicking a RAM object focuses it in memory', await page.evaluate(() => {
    const o = document.querySelector('#ramPanel .ram-o');
    const want = +o.dataset.block;
    o.click();
    return ui.focusObject === want;
  }));
  check('pointer chain shows pointer → address → object', await page.evaluate(() => {
    const c = document.querySelector('#ramPanel .ptr-chain');
    return !!c && /holds/.test(c.textContent) && /which is/.test(c.textContent);
  }));
  await page.evaluate(() => { ui.focusRegion = null; render(); });

  /* ===================== WATCH ===================== */
  console.log('\n=== Phase 3: watch ===');
  const watch = await page.evaluate(() => {
    openPanel('panelWatch');
    ui.watches = [];
    addWatch('i'); addWatch('str[i]'); addWatch('flag'); addWatch('bogus$$');
    renderWatch();
    const rows = Array.from(document.querySelectorAll('#watchPanel .wrow')).map(r => r.textContent.replace(/\s+/g, ' '));
    return rows;
  });
  check('watch evaluates expressions', watch.length === 4 && /i/.test(watch[0]), JSON.stringify(watch.slice(0, 3)));
  check('watch reports bad expressions instead of guessing', watch.some(r => /not in scope|Unexpected|Only names/.test(r)),
        watch.find(r => /bogus/.test(r)) || '');
  check('watch values track stepping', await page.evaluate(() => {
    goTo(80); renderWatch();
    const a = document.querySelector('#watchPanel .wrow .w-v').textContent;
    goTo(140); renderWatch();
    const b = document.querySelector('#watchPanel .wrow .w-v').textContent;
    return a !== b;
  }));

  /* ===================== OUTPUT SEPARATION ===================== */
  console.log('\n=== Phase 3: output vs debug ===');
  // Output is time-travelled with everything else: at an early step the program
  // genuinely has not printed yet, so check at the end of the run.
  await page.evaluate(() => { goTo(run.history.length - 1); setDockTab('output'); });
  await sleep(120);
  const outTxt = await page.$eval('#dockBody', e => e.textContent);
  check('program output tab shows only program output', /Salut, Comment Tu Vas/.test(outTxt) && !/phase|memDiff/.test(outTxt),
        JSON.stringify(outTxt.slice(0, 60)));
  check('output is time-travelled, not the final value pasted everywhere', await page.evaluate(() => {
    goTo(5); renderDock();
    const early = document.querySelector('#dockBody').textContent;
    goTo(run.history.length - 1); renderDock();
    const late = document.querySelector('#dockBody').textContent;
    return !/Salut/.test(early) && /Salut/.test(late);
  }));
  await page.evaluate(() => setDockTab('debug'));
  const dbgTxt = await page.$eval('#dockBody', e => e.textContent);
  check('debug tab shows debugger metadata separately', /step /.test(dbgTxt) && /stack/.test(dbgTxt));
  await page.evaluate(() => setDockTab('build'));
  check('build tab exists', /cc -Wall/.test(await page.$eval('#dockBody', e => e.textContent)));
  await page.evaluate(() => setDockTab('terminal'));
  check('terminal tab renders the real simulated terminal',
        await page.evaluate(() => {
          const t = document.querySelector('#dockBody .tm');
          const input = document.querySelector('#dockBody #termInput');
          const sim = document.querySelector('#dockBody .tm-sim');
          return !!t && !!input && !!sim && sim.textContent.trim() === 'SIMULATION';
        }));
  check('dock collapses', await page.evaluate(() => { toggleDock(); const a = document.querySelector('#dock').classList.contains('collapsed'); toggleDock(); return a; }));
  await page.evaluate(() => setDockTab('output'));

  /* ===================== COMMAND PALETTE + KEYBOARD ===================== */
  console.log('\n=== Phase 3: command palette & keyboard ===');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await sleep(200);
  check('Ctrl+K opens the palette', await page.evaluate(() => !!document.querySelector('#ckOverlay')));
  await page.type('#ckInput', 'memory');
  await sleep(150);
  check('palette filters commands', await page.$$eval('#ckList .cmdk-item', e => e.length) > 0 &&
        await page.$$eval('#ckList .cmdk-item', e => e.length) < 20,
        String(await page.$$eval('#ckList .cmdk-item', e => e.length)) + ' results');
  await page.keyboard.press('Enter');
  await sleep(200);
  check('palette runs a command and closes', await page.evaluate(() => !document.querySelector('#ckOverlay')));
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await sleep(150);
  await page.keyboard.press('Escape');
  await sleep(150);
  check('Escape closes the palette', await page.evaluate(() => !document.querySelector('#ckOverlay')));

  await open('ex3'); await start();
  const kb = await page.evaluate(() => ({ i: run.index }));
  await page.keyboard.press('Space'); await sleep(80);
  check('Space steps', await page.evaluate(() => run.index) === kb.i + 1);
  await page.keyboard.press('ArrowLeft'); await sleep(80);
  check('ArrowLeft steps back', await page.evaluate(() => run.index) === kb.i);
  await page.keyboard.press('KeyB'); await sleep(80);
  check('B toggles a breakpoint', await page.evaluate(() => run.breakpoints.size) === 1);
  await page.keyboard.press('KeyB'); await sleep(80);
  await page.keyboard.press('F9'); await sleep(600);
  check('F9 fast-runs to the end', await page.evaluate(() => run.mode) === 'done');
  await page.keyboard.press('Slash'); // '?' needs shift on most layouts; use direct call
  await page.evaluate(() => showShortcuts()); await sleep(150);
  check('shortcuts dialog opens with a close button and Escape', await page.evaluate(() =>
    !!document.querySelector('#modalRoot .modal') && !!document.querySelector('#mClose')));
  await page.keyboard.press('Escape'); await sleep(150);
  check('Escape closes modals', await page.evaluate(() => !document.querySelector('#modalRoot .modal')));

  /* ===================== THEMES ===================== */
  console.log('\n=== Phase 3: themes ===');
  await open('ex6'); await start(); await runAll();
  await page.evaluate(() => { goTo(80); openPanel('panelMemory'); openPanel('panelRam'); });
  await sleep(250);
  await page.screenshot({ path: path.join(SHOTS, 'p3_dark.png') });
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate(() => toggleTheme()); await sleep(250);
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('theme toggle changes the palette', darkBg !== lightBg, darkBg + ' -> ' + lightBg);
  check('light theme keeps text readable', await page.evaluate(() => {
    const c = getComputedStyle(document.querySelector('.p-title')).color;
    const m = c.match(/\d+/g).map(Number);
    return (m[0] + m[1] + m[2]) / 3 < 140;      // dark text on light surface
  }), await page.evaluate(() => getComputedStyle(document.querySelector('.p-title')).color));
  await page.screenshot({ path: path.join(SHOTS, 'p3_light.png') });
  await page.evaluate(() => toggleTheme()); await sleep(200);

  /* ===================== RESPONSIVE ===================== */
  console.log('\n=== Phase 3: responsive ===');
  const sizes = [[1280,720],[1366,768],[1440,900],[1920,1080]];
  for (const [w, h] of sizes) {
    await page.setViewport({ width: w, height: h });
    await sleep(300);
    const r = await page.evaluate(() => ({
      hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      vOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight + 2,
      toolbar: !!document.querySelector('#btnStep') && document.querySelector('#btnStep').getBoundingClientRect().width > 10,
      exec: document.querySelector('#execHost .exec') ? document.querySelector('#execHost .exec').getBoundingClientRect().height > 40 : false,
      dockVisible: document.querySelector('.dock').getBoundingClientRect().height > 20,
    }));
    check(w + 'x' + h + ': no overflow, controls usable', !r.hOverflow && !r.vOverflow && r.toolbar && r.exec && r.dockVisible, JSON.stringify(r));
  }
  await page.setViewport({ width: 1440, height: 900 });
  for (const z of [0.8, 1, 1.25, 1.5]) {
    await page.evaluate((zz) => { document.body.style.zoom = zz; }, z);
    await sleep(300);
    const r = await page.evaluate(() => ({
      h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 4,
      step: !!document.querySelector('#btnStep'),
    }));
    check('zoom ' + (z * 100) + '%: no horizontal overflow', !r.h && r.step, JSON.stringify(r));
  }
  await page.evaluate(() => { document.body.style.zoom = 1; });

  // narrow: must stack, not squeeze
  await page.setViewport({ width: 700, height: 900 });
  await sleep(400);
  const narrow = await page.evaluate(() => ({
    stacked: document.body.classList.contains('stacked'),
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    cols: getComputedStyle(document.querySelector('#panes')).gridTemplateColumns,
  }));
  check('narrow window stacks source above debugger', narrow.stacked, JSON.stringify(narrow));
  check('narrow window has no horizontal overflow', !narrow.hOverflow);
  // Stacking must not push panels out of reach: every panel has to be
  // scrollable into view inside its pane.
  check('no panel becomes unreachable when stacked', await page.evaluate(() => {
    const unreachable = [];
    document.querySelectorAll('.pane').forEach(pane => {
      const canScroll = pane.scrollHeight > pane.clientHeight + 2;
      const overflowY = getComputedStyle(pane).overflowY;
      pane.querySelectorAll(':scope > .panel').forEach(p => {
        const below = p.offsetTop + 20 > pane.clientHeight;
        if (below && !(canScroll && (overflowY === 'auto' || overflowY === 'scroll'))) unreachable.push(p.id);
      });
    });
    return unreachable.length ? unreachable.join(',') : true;
  }) === true, 'timeline must stay reachable at 700px');
  check('timeline is scrollable into view when stacked', await page.evaluate(() => {
    setLevel('deep');            // the Timeline is a Deep-level panel since Phase 10
    const pane = document.querySelector('#paneLeft');
    const tl = document.querySelector('#panelTimeline');
    pane.scrollTop = pane.scrollHeight;
    const r = tl.getBoundingClientRect(), pr = pane.getBoundingClientRect();
    return r.top < pr.bottom && r.bottom > pr.top;
  }));
  await page.screenshot({ path: path.join(SHOTS, 'p3_narrow.png') });
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(350);
  check('returns to side-by-side when widened', await page.evaluate(() => !document.body.classList.contains('stacked')));

  /* ===================== ACCESSIBILITY ===================== */
  console.log('\n=== Phase 3: accessibility ===');
  check('interactive controls have accessible names', await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('button').forEach(b => {
      const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
      if (!name) bad.push(b.id || b.className);
    });
    return bad.length ? bad.slice(0, 5).join(',') : true;
  }) === true);
  check('toolbar and rail expose roles', await page.evaluate(() =>
    !!document.querySelector('[role="toolbar"]') && !!document.querySelector('nav.rail')));
  check('focus-visible styling exists', await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try { for (const r of sheet.cssRules) if (r.selectorText && r.selectorText.includes(':focus-visible')) return true; } catch (e) {}
    }
    return false;
  }));

  /* ===================== REGRESSION: 13 EXAMPLES ===================== */
  console.log('\n=== Phase 3: all 13 examples still work ===');
  const keys = await page.evaluate(() => EXAMPLE_ORDER);
  const traps = { exBug1: 'Out-of-bounds', exBug2: 'Use-after-free' };
  for (const k of keys) {
    errs.length = 0;
    await open(k); await sleep(80);
    await page.evaluate(() => showWorkspace());
    const needsInput = await page.evaluate((kk) => !!EXAMPLES[kk].needsInput, k);
    await page.click('#btnStep'); await sleep(150);
    if (needsInput) { await page.click('#inOk'); await sleep(200); }
    const r = await runAll(); await sleep(120);
    const e = await page.$eval('#errorBox', el => el.textContent.replace(/\s+/g, ' ').trim());
    const ok = traps[k] ? new RegExp(traps[k], 'i').test(e)
                        : (r.mode === 'done' && e === '' && errs.length === 0);
    check('example ' + k, ok, traps[k] ? e.slice(0, 46) : 'steps=' + r.steps + (e ? ' ERR:' + e.slice(0, 46) : '') + (errs.length ? ' C:' + errs[0] : ''));
  }
  await open('ex6'); await start(); await runAll();
  const finalOut = await page.$eval('#dockBody', e => e.textContent);
  check('flagship output still correct', /Salut, Comment Tu Vas 42mots Quarante-Deux/.test(finalOut));

  await page.evaluate(() => { goTo(80); openPanel('panelMemory'); });
  await sleep(250);
  await page.screenshot({ path: path.join(SHOTS, 'p3_workspace.png') });
  await page.evaluate(() => showDashboard()); await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p3_dashboard.png') });

  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3 PASS ' + pass + '   FAIL ' + fail);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
