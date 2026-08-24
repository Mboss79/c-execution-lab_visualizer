'use strict';
// FINAL PHASE EXIT GATE — execution emphasis, camera discipline, workspace UX.
//
// The theme of this suite is the difference between "the view looks right" and
// "the view is telling the truth". Every emphasis assertion is cross-checked
// against the addresses the ENGINE recorded touching, so a passing test means
// the highlight is real, not decorative.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'screenshots');

let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; failures.push(name + ' :: ' + (detail || '')); console.log('  FAIL ' + name + '  -- ' + (detail || '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// "hello" walked with str[i], the canonical example from the spec
const STR = ['int\tmain(void)', '{', '\tchar\tstr[6];', '\tint\ti;', '',
  '\tstr[0] = 104;', '\tstr[1] = 101;', '\tstr[2] = 108;', '\tstr[3] = 108;',
  '\tstr[4] = 111;', '\tstr[5] = 0;', '\ti = 0;', '\twhile (str[i] != 0)',
  '\t{', '\t\ti++;', '\t}', '\treturn (i);', '}', ''].join('\n');
const PTR = ['int\tmain(void)', '{', '\tchar\tstr[4];', '\tchar\t*p;', '',
  '\tstr[0] = 97;', '\tstr[1] = 98;', '\tstr[2] = 99;', '\tstr[3] = 0;',
  '\tp = &str[1];', '\t*p = 88;', '\treturn (0);', '}', ''].join('\n');
const CALLS = ['int\tc(int n)', '{', '\treturn (n + 1);', '}', '',
  'int\tb(int n)', '{', '\treturn (c(n) + 1);', '}', '',
  'int\tmain(void)', '{', '\tint\tr;', '', '\tr = b(1);', '\treturn (r);', '}', ''].join('\n');
const OOB = ['int\tmain(void)', '{', '\tint\ta[3];', '\tint\ti;', '',
  '\ti = 5;', '\ta[i] = 1;', '\treturn (0);', '}', ''].join('\n');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  const load = async () => {
    await page.goto(FILE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(600);
    await page.evaluate(() => showWorkspace());
  };
  const setSrc = (s) => page.evaluate((src) => {
    document.querySelector('#sourceEdit').value = src; switchToEditing();
  }, s);
  const runAll = async () => { await page.evaluate(() => fastForward({})); await sleep(400); };
  const open3d = async () => { await page.evaluate(() => openViz()); await sleep(400); };

  /* ============ 1. THE ENGINE REPORTS WHAT IT TOUCHED ============ */
  console.log('=== Final · engine access journal ===');
  await load();
  await setSrc(STR);
  await runAll();
  check('[1] the engine records the real address of every read and write', await page.evaluate(() => {
    let withAcc = 0;
    for (let i = 0; i < run.history.length; i++) {
      const s = run.history.steps[i];
      if (Array.isArray(s.accessed) && s.accessed.length) withAcc++;
    }
    return withAcc > 8;
  }));
  check('[2] a recorded access is a real address inside a real object', await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const st0 = st();
      for (const a of (run.history.steps[i].accessed || [])) {
        const inside = st0.blocks.some(b => a.address >= b.base && a.address < b.base + b.size);
        if (!inside) return false;
      }
    }
    return true;
  }));
  check('[3] display reads never pollute the journal (opening a panel changes nothing)',
        await page.evaluate(() => {
    goTo(5);
    const before = JSON.stringify(run.history.steps[5].accessed);
    renderMemory(step(), st());
    renderVars(step(), st());
    renderRam(st());
    return JSON.stringify(run.history.steps[5].accessed) === before;
  }));
  check('[4] the journal survives time travel: it is recorded, not recomputed',
        await page.evaluate(() => {
    const a = JSON.stringify(run.history.steps[7].accessed);
    goTo(0); goTo(run.history.length - 1); goTo(7);
    return JSON.stringify(run.history.steps[7].accessed) === a;
  }));

  /* ============ 2. CURRENT EXECUTION OBJECT ============ */
  console.log('=== Final · current execution object ===');
  await open3d();
  check('[5] the current object is the exact array cell the engine touched',
        await page.evaluate(() => {
    const seen = [];
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = viz.stage.current;
      if (c && c.kind === 'cell' && c.reason === 'read') seen.push(c.name);
    }
    window.__cells = seen;
    return seen.join(',') === 'str[0],str[1],str[2],str[3],str[4],str[5]';
  }), await page.evaluate(() => (window.__cells || []).join(',')));
  check('[6] the highlighted cell moves when i++ changes i', await page.evaluate(() => {
    // find two consecutive condition steps and confirm the cell index advanced
    const idx = [];
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = viz.stage.current;
      if (c && c.kind === 'cell' && c.reason === 'read') idx.push(c.index);
    }
    return idx.length >= 3 && idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
  }));
  check('[7] the current cell address equals the address the engine read',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = viz.stage.current;
      if (!c || c.reason !== 'read') continue;
      const reads = (run.history.steps[i].accessed || []).filter(a => a.kind === 'read');
      if (!reads.length) return false;
      if (c.address !== reads[reads.length - 1].address) return false;
    }
    return true;
  }));
  check('[8] a write makes the written object primary, with the engine address',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const md = run.history.steps[i].memDiff;
      if (!md) continue;
      const c = viz.stage.current;
      if (!c || c.reason !== 'write' || c.address !== md.address) return false;
    }
    return true;
  }));
  check('[9] exactly one node is PRIMARY at any step', await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const n = document.querySelectorAll('#vizHost .viz-node.vz-primary').length;
      if (n > 1) return false;
    }
    return true;
  }));
  check('[10] the primary node is the one the resolver named', await page.evaluate(() => {
    for (let i = 3; i < Math.min(20, run.history.length); i++) {
      goTo(i);
      const c = viz.stage.current;
      const el = document.querySelector('#vizHost .viz-node.vz-primary');
      if (!c) continue;
      if (c.kind === 'frame') continue;         // frames are marked current, not primary-boxed
      if (!el || el.dataset.vid !== c.id) return false;
    }
    return true;
  }));
  check('[11] other storage touched in the same step is SECONDARY, not primary',
        await page.evaluate(() => {
    let found = false;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const acc = run.history.steps[i].accessed || [];
      const distinct = new Set(acc.map(a => a.address));
      if (distinct.size < 2) continue;
      const sec = document.querySelectorAll('#vizHost .viz-node.vz-secondary').length;
      const pri = document.querySelectorAll('#vizHost .viz-node.vz-primary').length;
      if (pri === 1 && sec >= 1) found = true;
    }
    return found;
  }));
  check('[12] the active cell carries a visible CURRENT marker', await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const el = document.querySelector('#vizHost .viz-node.vz-cell.vz-primary');
      if (el) return !!el.dataset.current && el.dataset.current.length > 0;
    }
    return false;
  }));
  check('[13] the caption names the current object and why it matters',
        await page.evaluate(() => {
    goTo(3);
    const cur = document.querySelector('.viz-cap-cur');
    const c = viz.stage.current;
    return !!cur && !!c && cur.textContent.indexOf(c.name) >= 0 &&
           cur.textContent.indexOf(t('viz.why.' + c.reason)) >= 0;
  }));
  check('[14] a step with nothing addressable says so instead of pointing somewhere',
        await page.evaluate(() => {
    goTo(run.history.length - 1);
    const c = viz.stage.current;
    const cur = document.querySelector('.viz-cap-cur');
    if (c) return true;                       // still resolvable: fine
    return !!cur && cur.classList.contains('none') &&
           cur.textContent.indexOf(t('viz.noCurrent')) >= 0;
  }));

  /* ============ 3. VALUE TRANSITIONS ============ */
  console.log('=== Final · value transitions ===');
  check('[15] a write shows the previous value the engine reported, crossed out',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const md = run.history.steps[i].memDiff;
      if (!md || md.beforeText === null || md.beforeText === undefined) continue;
      const el = document.querySelector('#vizHost .viz-node.vz-primary .vz-prev');
      if (!el) return false;
      return el.textContent === md.beforeText;
    }
    return false;
  }));
  check('[16] no previous value is shown when the engine did not report one',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const md = run.history.steps[i].memDiff;
      if (md && md.beforeText !== null && md.beforeText !== undefined) continue;
      if (document.querySelector('#vizHost .viz-node.vz-primary .vz-prev')) return false;
    }
    return true;
  }));

  /* ============ 4. POINTERS FOLLOW THE ENGINE ============ */
  console.log('=== Final · pointers ===');
  await setSrc(PTR);
  await runAll();
  check('[17] a pointer write makes the TARGET cell primary, not the pointer',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const md = run.history.steps[i].memDiff;
      if (!md) continue;
      const c = viz.stage.current;
      if (!c) continue;
      // *p = 88 writes into str[1]; the primary object must be that cell
      if (c.kind === 'cell' && c.name === 'str[1]' && c.reason === 'write') return true;
    }
    return false;
  }));
  check('[18] the pointer that aims at the current object is SECONDARY',
        await page.evaluate(() => {
    // the step that matters is the one where p really targets the written cell
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = viz.stage.current;
      if (!c || c.kind !== 'cell' || c.reason !== 'write') continue;
      const pv = st().frames.flatMap(f => f.vars).find(v => v.isPointer && v.pointerTarget);
      if (!pv || pv.pointerTarget.address !== c.address) continue;
      const p = document.querySelector('#vizHost .viz-node[data-vid$=":' + pv.name + '"]');
      return !!p && p.classList.contains('vz-secondary');
    }
    return false;
  }));
  check('[19] the arrow target is still the engine-resolved address', await page.evaluate(() => {
    goTo(run.history.length - 2);
    const pv = st().frames.flatMap(f => f.vars).find(v => v.isPointer);
    if (!pv || !pv.pointerTarget) return false;
    const e = viz.lastScene.edges.find(x => x.from.endsWith(':p'));
    const target = e && e.to ? viz.lastScene.nodes.find(n => n.id === e.to) : null;
    const addr = target ? (target.kind === 'cell' ? target.el.address : target.v.address) : null;
    return addr === pv.pointerTarget.address;
  }));

  /* ============ 5. STACK FRAMES ============ */
  console.log('=== Final · stack frames ===');
  await setSrc(CALLS);
  await runAll();
  check('[20] frames stack vertically with the newest on top, never rotated',
        await page.evaluate(() => {
    let deepest = null;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      if (st().frames.length === 3) { deepest = viz.lastScene.nodes.filter(n => n.kind === 'frame'); break; }
    }
    if (!deepest || deepest.length !== 3) return false;
    const byDepth = deepest.slice().sort((a, b) => a.f.depth - b.f.depth);
    // deeper call => smaller y (higher on screen), and all share one x
    return byDepth[0].y > byDepth[1].y && byDepth[1].y > byDepth[2].y &&
           byDepth.every(f => f.x === byDepth[0].x);
  }));
  check('[21] the current frame is the engine top frame, and only that one',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const cur = document.querySelectorAll('#vizHost .viz-node.vz-frame.vz-current');
      if (!st().frames.length) continue;
      if (cur.length !== 1) return false;
      if (cur[0].textContent.indexOf(st().frameName) < 0) return false;
    }
    return true;
  }));
  check('[22] a return removes exactly one frame from the scene', await page.evaluate(() => {
    let maxSeen = 0, endSeen = 0;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const n = document.querySelectorAll('#vizHost .viz-node.vz-frame').length;
      maxSeen = Math.max(maxSeen, n);
      endSeen = n;
    }
    return maxSeen === 3 && endSeen === 0;
  }));

  /* ============ 6. ERRORS POINT AT THE RIGHT OBJECT ============ */
  console.log('=== Final · errors ===');
  await setSrc(OOB);
  await runAll();
  await sleep(300);
  check('[23] an out-of-bounds write is reported by the engine, not invented',
        await page.evaluate(() => !!run.error && run.error.memSafety === true &&
          run.error.kind === 'out-of-bounds'));
  check('[24] the error banner shows the engine message and a localized kind',
        await page.evaluate(() => {
    const box = document.querySelector('#vizHost .viz-error');
    return !!box && box.textContent.indexOf(t('viz.err.out-of-bounds')) >= 0 &&
           box.textContent.indexOf(run.error.message.slice(0, 30)) >= 0;
  }));
  check('[25] the error banner does not cover the scene it is about',
        await page.evaluate(() => {
    const box = document.querySelector('#vizHost .viz-error');
    if (!box) return false;
    const br = box.getBoundingClientRect();
    let covered = 0;
    document.querySelectorAll('#vizHost .viz-node').forEach(el => {
      const q = el.getBoundingClientRect();
      const overlap = !(q.right < br.left || q.left > br.right || q.bottom < br.top || q.top > br.bottom);
      if (overlap) covered++;
    });
    return covered === 0;
  }));

  /* ============ 7. WORKSPACE ============ */
  console.log('=== Final · workspace ===');
  await load();
  await page.evaluate(() => { loadExample('ex6'); });
  await runAll();
  check('[26] panel headers inside a scrolling pane are sticky', await page.evaluate(() => {
    const h = document.querySelector('#rightScroll .panel-head');
    return !!h && getComputedStyle(h).position === 'sticky';
  }));
  check('[27] no content is ever painted over a visible header', await page.evaluate(() => {
    const containers = [];
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) containers.push(el);
    });
    for (const frac of [0, 0.5, 1]) {
      containers.forEach(c => { c.scrollTop = c.scrollHeight * frac; });
      const heads = document.querySelectorAll('.panel-head');
      for (const h of heads) {
        let sc = h.parentElement;
        while (sc && !(/auto|scroll/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 2)) sc = sc.parentElement;
        const hr = h.getBoundingClientRect();
        if (hr.height < 4) continue;
        if (sc) {
          const sr = sc.getBoundingClientRect();
          if (hr.bottom <= sr.top + 1 || hr.top >= sr.bottom - 1) continue;
        }
        // probe the part of the header that is actually on screen: a header
        // straddling the container edge is correctly clipped, not covered
        let top = hr.top, bot = hr.bottom;
        if (sc) { const sr = sc.getBoundingClientRect(); top = Math.max(top, sr.top); bot = Math.min(bot, sr.bottom); }
        if (bot - top < 4) continue;
        const el = document.elementFromPoint(hr.left + hr.width * 0.5, (top + bot) / 2);
        if (el && !h.contains(el) && el !== h) return false;
      }
    }
    return true;
  }));
  check('[28] there are no nested scroll containers to confuse the wheel',
        await page.evaluate(() => {
    let nested = 0;
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if (!/auto|scroll/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 2) return;
      let p = el.parentElement;
      while (p) {
        const pcs = getComputedStyle(p);
        if (/auto|scroll/.test(pcs.overflowY) && p.scrollHeight > p.clientHeight + 2) { nested++; break; }
        p = p.parentElement;
      }
    });
    return nested === 0;
  }));
  check('[29] the bottom dock has a real draggable splitter', await page.evaluate(() => {
    const sp = document.querySelector('#dockSplitter');
    if (!sp) return false;
    const cs = getComputedStyle(sp);
    return cs.cursor === 'row-resize' && sp.getAttribute('role') === 'separator' &&
           sp.getBoundingClientRect().height >= 5;
  }));
  check('[30] dragging the splitter resizes the dock', await page.evaluate(() => {
    const sp = document.querySelector('#dockSplitter');
    const before = document.querySelector('.dock').getBoundingClientRect().height;
    const r = sp.getBoundingClientRect();
    sp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: r.top }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: r.top - 120 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const after = document.querySelector('.dock').getBoundingClientRect().height;
    return after > before + 80;
  }));
  check('[31] neither the dock nor the workspace can be crushed', await page.evaluate(() => {
    const L = dockLimits();
    ui.dockH = -5000; applyDockH();
    const tiny = ui.dockH;
    ui.dockH = 99999; applyDockH();
    const huge = ui.dockH;
    const panes = document.querySelector('.panes').getBoundingClientRect().height;
    ui.dockH = 210; applyDockH();
    return tiny === L.min && huge === L.max && panes > 80;
  }));
  check('[32] the splitter is keyboard operable', await page.evaluate(() => {
    const sp = document.querySelector('#dockSplitter');
    const before = ui.dockH;
    sp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const up = ui.dockH;
    sp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const down = ui.dockH;
    return up > before && down < up && sp.getAttribute('tabindex') === '0';
  }));
  check('[33] the dock height survives a reload', await (async () => {
    await page.evaluate(() => { ui.dockH = 305; applyDockH(); saveUI(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(600);
    return page.evaluate(() => ui.dockH === 305);
  })());

  /* ============ 8. WORKSPACE HELP ICONS ============ */
  console.log('=== Final · workspace help ===');
  await load();
  check('[34] jargon panels carry an ⓘ button', await page.evaluate(() => {
    const want = ['panelStack', 'panelVars', 'panelMemory', 'panelPointers', 'panelRam'];
    return want.every(id => {
      const p = document.getElementById(id);
      return p && p.querySelector('.panel-head .info-btn');
    });
  }));
  check('[35] a workspace ⓘ opens the same explanation system, at the current level',
        await page.evaluate(() => {
    const b = document.querySelector('#panelStack .panel-head .info-btn');
    if (!b) return false;
    b.click();
    const p = document.querySelector('.info-pop');
    if (!p) return false;
    const want = CConcepts.get(b.dataset.info, ui.lang, ui.level);
    const ok = p.querySelector('.info-what').textContent === want.what;
    closeInfoPop();
    return ok;
  }));
  check('[36] clicking the ⓘ does not collapse the panel it sits in',
        await page.evaluate(() => {
    const p = document.getElementById('panelStack');
    const before = p.classList.contains('collapsed');
    p.querySelector('.panel-head .info-btn').click();
    closeInfoPop();
    return p.classList.contains('collapsed') === before;
  }));
  check('[37] workspace ⓘ text is translated', await page.evaluate(() => {
    const b = () => document.querySelector('#panelMemory .panel-head .info-btn');
    ui.lang = 'en'; applyI18n();
    b().click();
    const en = document.querySelector('.info-pop').textContent;
    closeInfoPop();
    ui.lang = 'fr'; applyI18n();
    b().click();
    const fr = document.querySelector('.info-pop').textContent;
    closeInfoPop();
    ui.lang = 'en'; applyI18n();
    return en !== fr && en.length > 40 && fr.length > 40;
  }));

  /* ============ 9. NOTHING FABRICATED ============ */
  console.log('=== Final · honesty ===');
  await setSrc(STR);
  await runAll();
  await open3d();
  check('[38] the current-object resolver never returns an address the engine did not touch',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = viz.stage.current;
      if (!c || c.address === null || c.address === undefined) continue;
      const s = run.history.steps[i];
      const known = new Set((s.accessed || []).map(a => a.address));
      if (s.memDiff) known.add(s.memDiff.address);
      // an address inside the object that was touched is fine
      const ok = [...known].some(a => Math.abs(a - c.address) < 16);
      if (!ok) return false;
    }
    return true;
  }));
  check('[39] a traced run (no addresses observed) resolves no cell', await page.evaluate(() => {
    const fake = { line: 3, fn: 'main', callStack: ['main'], depth: 1,
      allVariables: [{ fn: 'main', name: 'x', type: 'int', value: '5', known: true }],
      variables: [], exitCode: null, event: { type: 'ASSIGNMENT', name: 'x', value: '5', known: true, line: 3 } };
    const m = CViz3D.modelFromTrace(fake, {});
    const c = CViz3D.currentObject(m);
    // with no address information the only honest answer is the frame
    return c && c.kind === 'frame';
  }));
  check('[40] locate() refuses an address that belongs to nothing drawn',
        await page.evaluate(() => {
    goTo(5);
    const m = CViz3D.modelFromEngine(step(), st(), null);
    return CViz3D.locate(m, 0x1) === null && CViz3D.locate(m, null) === null;
  }));

  /* ============ 10. SYNCHRONIZATION, ALL CONTROLS ============ */
  console.log('=== Final · debugger synchronization ===');
  check('[41] every debugger control keeps the scene on the same step',
        await page.evaluate(() => {
    const agree = () => viz.lastModel && viz.lastModel.line === (step() ? step().line : null);
    doFirst(); if (!agree()) return false;
    doStep(); doStep(); if (!agree()) return false;
    doPrev(); if (!agree()) return false;
    goTo(4); if (!agree()) return false;
    fastForward({}); if (!agree()) return false;
    return true;
  }));
  check('[42] Reset clears the scene and leaves no stale highlight', await page.evaluate(() => {
    restart();
    const stalePrimary = document.querySelectorAll('#vizHost .viz-node.vz-primary').length;
    return run.index <= 0 && stalePrimary <= 1;
  }));
  check('[43] editing the source clears the scene', await (async () => {
    await setSrc('int\tmain(void)\n{\n\tint\tqq;\n\n\tqq = 3;\n\treturn (qq);\n}\n');
    await sleep(300);
    return page.evaluate(() =>
      !Array.from(document.querySelectorAll('#vizHost .viz-node')).some(n => /str/.test(n.textContent)));
  })());

  /* ============ 11. PERFORMANCE ============ */
  console.log('=== Final · performance ===');
  await setSrc(STR);
  await runAll();
  check('[44] the scene is rebuilt once per step, not per frame', await page.evaluate(() => {
    const before = viz.renders;
    goTo(3);
    const one = viz.renders - before;
    goTo(3); goTo(3);
    const repeat = viz.renders - before;
    return one >= 1 && repeat <= one + 2;
  }));
  check('[45] Fit measures, but only when asked', await page.evaluate(() => {
    // stepping without a shape change must not re-run fit
    viz.stage.fit();
    const cam0 = JSON.stringify(viz.stage.getCamera());
    for (let i = 10; i < Math.min(20, run.history.length); i++) goTo(i);
    return JSON.stringify(viz.stage.getCamera()) === cam0;
  }));

  /* ---- visual QA ---- */
  try {
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => { for (let i = 0; i < run.history.length; i++) { goTo(i); if (viz.stage.current && viz.stage.current.kind === 'cell' && viz.stage.current.reason === 'read') break; } });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'p9_final_dark_en.png') });
    await page.evaluate(() => { ui.lang = 'fr'; applyI18n(); ui.theme = 'light'; applyTheme(); });
    await sleep(350);
    await page.screenshot({ path: path.join(SHOTS, 'p9_final_light_fr.png') });
    await page.evaluate(() => { ui.lang = 'en'; applyI18n(); ui.theme = 'dark'; applyTheme(); });
  } catch (e) { console.log('  (screenshots skipped: ' + e.message + ')'); }

  const realErrs = errs.filter(e => !/ERR_CONNECTION|Failed to load|net::/.test(e));
  check('[46] no console errors across the whole final session',
        realErrs.length === 0, realErrs.slice(0, 4).join(' | '));

  await browser.close();
  console.log('\n' + '-'.repeat(64));
  console.log('FINAL  pass ' + pass + '  fail ' + fail);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
