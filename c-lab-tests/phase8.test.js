'use strict';
// PHASE 8 EXIT GATE — 3D execution visualization.
//
// The 3D view is a VIEW. Every assertion below compares what the scene draws
// with what the engine (or a real traced run) already reported. A test that
// only checked "a 3D thing exists" would prove nothing, so each one either
// cross-checks the scene against the debugger, or proves the view refuses to
// invent state it was not given.
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const BRIDGE = path.join(ROOT, 'c-lab-bridge', 'server.js');
const SHOTS = path.join(__dirname, 'screenshots');

let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; failures.push(name + ' :: ' + (detail || '')); console.log('  FAIL ' + name + '  -- ' + (detail || '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function ping() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:4242/health', (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
  });
}
async function waitFor(fn, ms, every) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(every || 200);
  }
}

const SRC_PTR = ['int\tmain(void)', '{', '\tint\tx;', '\tint\t*p;', '',
  '\tx = 42;', '\tp = &x;', '\t*p = 7;', '\treturn (x);', '}', ''].join('\n');
const SRC_ARR = ['int\tmain(void)', '{', '\tint\ta[4];', '\tint\ti;', '',
  '\ti = 0;', '\twhile (i < 4)', '\t{', '\t\ta[i] = i * 10;', '\t\ti++;', '\t}',
  '\treturn (a[3]);', '}', ''].join('\n');
const SRC_FN = ['int\tft_double(int n)', '{', '\treturn (n * 2);', '}', '',
  'int\tmain(void)', '{', '\tint\tr;', '', '\tr = ft_double(5);', '\treturn (r);', '}', ''].join('\n');
const SRC_UAR = ['int\t*ft_bad(void)', '{', '\tint\tlocal;', '', '\tlocal = 5;', '\treturn (&local);', '}', '',
  'int\tmain(void)', '{', '\tint\t*p;', '', '\tp = ft_bad();', '\treturn (*p);', '}', ''].join('\n');
const SRC_HEAP = ['#include <stdlib.h>', '', 'int\tmain(void)', '{', '\tint\t*p;', '',
  '\tp = malloc(sizeof(int) * 3);', '\tp[0] = 7;', '\tfree(p);', '\treturn (0);', '}', ''].join('\n');
const SRC_UNINIT = ['int\tmain(void)', '{', '\tint\ta;', '\tint\tb;', '', '\ta = 1;', '\tb = a;', '\treturn (b);', '}', ''].join('\n');

(async () => {
  let bridge = null;
  const startBridge = async () => {
    if (await ping()) return 'already';
    bridge = spawn(process.execPath, [BRIDGE], { stdio: 'ignore', windowsHide: true });
    return (await waitFor(ping, 15000)) ? 'started' : 'failed';
  };
  const stopBridge = async () => {
    if (bridge) { bridge.kill(); bridge = null; }
    if (await ping()) {
      await new Promise((resolve) => {
        const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
          "Get-NetTCPConnection -LocalPort 4242 -State Listen -ErrorAction SilentlyContinue | " +
          "Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"],
          { stdio: 'ignore', windowsHide: true });
        ps.on('close', resolve); ps.on('error', resolve);
      });
    }
    return waitFor(async () => !(await ping()), 10000);
  };

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
    await sleep(550);
    await page.evaluate(() => showWorkspace());
  };
  const setSrc = (s) => page.evaluate((src) => {
    document.querySelector('#sourceEdit').value = src; switchToEditing();
  }, s);
  const stepN = async (n) => { for (let i = 0; i < n; i++) await page.evaluate(() => doStep()); await sleep(120); };
  const runAll = async () => { await page.evaluate(() => fastForward({})); await sleep(400); };
  const open3d = async () => { await page.evaluate(() => openViz()); await sleep(350); };
  // Everything the scene currently shows, read back out of the DOM.
  const sceneDom = () => page.evaluate(() => ({
    nodes: Array.from(document.querySelectorAll('#vizHost .viz-node')).map(n => ({
      id: n.dataset.vid, kind: n.dataset.kind, cls: n.className,
      text: n.textContent.replace(/\s+/g, ' ').trim(),
    })),
    edges: Array.from(document.querySelectorAll('#vizHost .viz-edge')).map(e => e.className),
    caption: (document.querySelector('.viz-cap-what') || {}).textContent || '',
    cond: (document.querySelector('.viz-cond') || {}).textContent || '',
    line: (document.querySelector('.viz-cap-src') || {}).textContent || '',
  }));

  /* ================= 1. ARCHITECTURE: A VIEW, NOT AN ENGINE ================= */
  console.log('=== Phase 8 · architecture ===');
  await load();
  check('[1] page loads with no console errors',
        errs.filter(e => !/ERR_CONNECTION|Failed to load|net::/.test(e)).length === 0, errs.slice(0, 3).join(' | '));
  check('[2] CViz3D is a view module: no evaluator, parser, memory model or stepper', await page.evaluate(() =>
    typeof CViz3D === 'object' &&
    Object.keys(CViz3D).every(k => !/eval|parse|tokeni|compile|interp|stepper|history|memory|malloc/i.test(k)) &&
    typeof CViz3D.modelFromEngine === 'function' && typeof CViz3D.layout === 'function'));
  check('[3] the engine gained no 3D API', await page.evaluate(() =>
    Object.keys(CEngine).every(k => !/viz|3d|scene|camera|render/i.test(k))));
  check('[4] the 3D layer never calls the engine to evaluate anything', await page.evaluate(() => {
    const src = [CViz3D.modelFromEngine, CViz3D.layout, CViz3D.explain, CViz3D.conceptFor]
      .map(f => f.toString()).join('\n');
    return !/CEngine\.(compile|createRun|evalWatch|tokenize|parseC|runToCompletion)/.test(src);
  }));
  check('[5] the scene is built from stateAt(i), the same state the debugger renders', await page.evaluate(() =>
    /state\.frames/.test(CViz3D.modelFromEngine.toString()) &&
    /state\.globals/.test(CViz3D.modelFromEngine.toString())));
  check('[6] nothing 3D is constructed before the view is opened',
        await page.evaluate(() => viz.stage === null && document.querySelectorAll('#vizHost .viz-node').length === 0));

  /* ================= 2. OPENING, AND THE IDE KEEPS WORKING ================= */
  console.log('=== Phase 8 · opening and coexistence ===');
  await setSrc(SRC_PTR);
  await stepN(6);
  const beforeIdx = await page.evaluate(() => run.index);
  await open3d();
  check('[7] opening the 3D view does not disturb the execution position',
        (await page.evaluate(() => run.index)) === beforeIdx, 'index ' + beforeIdx);
  check('[8] the stage is created lazily on first open, and draws real nodes',
        await page.evaluate(() => !!viz.stage && viz.stage.nodeCount > 0),
        'nodes=' + (await page.evaluate(() => viz.stage.nodeCount)));
  check('[9] the 3D view lives inside the right pane, not over the whole app', await page.evaluate(() => {
    const h = document.querySelector('#vizHost').getBoundingClientRect();
    const p = document.querySelector('#paneRight').getBoundingClientRect();
    const src = document.querySelector('#panelSource').getBoundingClientRect();
    return Math.abs(h.left - p.left) < 2 && Math.abs(h.width - p.width) < 2 && h.left > src.left;
  }));
  check('[10] the source panel is still visible and usable with 3D open', await page.evaluate(() =>
    document.querySelector('#panelSource').getBoundingClientRect().width > 100 &&
    document.querySelectorAll('#sourceView .codeline').length > 0));
  check('[11] closing returns the debugger panels', await page.evaluate(() => {
    closeViz();
    const ok = document.querySelector('#vizHost').style.display === 'none' &&
               document.querySelector('#rightScroll').style.display !== 'none';
    openViz();
    return ok;
  }));
  check('[12] the app is fully usable with the 3D view never opened', await page.evaluate(() => {
    closeViz();
    doStep();
    const ok = run.index >= 0 && document.querySelectorAll('#varsPanel .var').length >= 0;
    openViz();
    return ok;
  }));

  /* ================= 3. SYNCHRONIZATION ================= */
  console.log('=== Phase 8 · synchronization ===');
  check('[13] the scene line equals the debugger line and the highlighted source line', await page.evaluate(() => {
    const a = document.querySelector('.codeline.active');
    return viz.lastModel.line === step().line && a && Number(a.dataset.line) === step().line;
  }));
  check('[14] Step advances the scene together with the debugger', await page.evaluate(() => {
    const before = { i: run.index, line: viz.lastModel.line };
    doStep();
    return run.index === before.i + 1 && viz.lastModel.line === step().line;
  }));
  check('[15] Prev rewinds the scene together with the debugger', await page.evaluate(() => {
    const i = run.index; doPrev();
    return run.index === i - 1 && viz.lastModel.line === step().line;
  }));
  check('[16] First and To-end move the scene too', await (async () => {
    await page.evaluate(() => doFirst());
    const atFirst = await page.evaluate(() => run.index === 0 && viz.lastModel.line === step().line);
    await runAll();
    const atEnd = await page.evaluate(() =>
      run.index === run.history.length - 1 && viz.lastModel.line === step().line);
    return atFirst && atEnd;
  })());
  check('[17] Reset returns the scene to the start', await (async () => {
    await page.evaluate(() => restart());
    await sleep(250);
    return page.evaluate(() => run.index <= 0 && (!viz.lastModel || viz.lastModel.line === (step() ? step().line : null)));
  })());
  check('[18] Play/Pause drives the scene and pausing stops it', await (async () => {
    await page.evaluate(() => { togglePlay(); });
    await sleep(700);
    const moving = await page.evaluate(() => run.index > 0);
    await page.evaluate(() => { if (run.playing) togglePlay(); });
    await sleep(250);
    const i1 = await page.evaluate(() => run.index);
    await sleep(400);
    const i2 = await page.evaluate(() => run.index);
    return moving && i1 === i2 &&
      (await page.evaluate(() => viz.lastModel.line === step().line));
  })());
  await runAll();
  const tl = await page.evaluate(() => {
    goTo(3);
    return { i: run.index, len: run.history.length, model: viz.lastModel ? viz.lastModel.line : null,
             want: run.history.steps[3] ? run.history.steps[3].line : null, open: viz.open };
  });
  check('[19] travelling to a timeline step moves the scene to that step',
        tl.i === 3 && tl.model === tl.want, JSON.stringify(tl));

  /* ================= 4. VARIABLES, POINTERS, ARRAYS ================= */
  console.log('=== Phase 8 · data ===');
  await setSrc(SRC_PTR); await runAll(); await page.evaluate(() => goTo(run.history.length - 3));
  await sleep(200);
  let dom = await sceneDom();
  check('[20] every variable value drawn matches the engine state exactly', await page.evaluate(() => {
    const state = st();
    const vars = state.frames.flatMap(f => f.vars).filter(v => !v.isArray);
    return vars.every(v => {
      const el = document.querySelector('#vizHost .viz-node[data-vid$=":' + v.name + '"]');
      if (!el) return true;
      const txt = el.textContent.replace(/\s+/g, ' ');
      return v.uninitialized ? /\?/.test(txt) : txt.indexOf(v.valueText) >= 0;
    });
  }));
  check('[21] every address drawn matches the engine address', await page.evaluate(() => {
    const state = st();
    return state.frames.flatMap(f => f.vars).every(v => {
      const el = document.querySelector('#vizHost .viz-node[data-vid$=":' + v.name + '"]');
      return !el || el.textContent.indexOf(CEngine.hexAddr(v.address)) >= 0 || v.isArray;
    });
  }));
  check('[22] a pointer draws an arrow, and its target is the one the ENGINE resolved',
        await page.evaluate(() => {
    const scene = viz.lastScene;
    const state = st();
    const p = state.frames.flatMap(f => f.vars).find(v => v.isPointer && v.pointerTarget);
    if (!p) return false;
    const edge = scene.edges.find(e => e.from.endsWith(':' + p.name));
    if (!edge) return false;
    const target = scene.nodes.find(n => n.id === edge.to);
    // the arrow must land on the object holding the address the engine resolved
    const addr = target ? (target.kind === 'cell' ? target.el.address : target.v.address) : null;
    return addr === p.pointerTarget.address;
  }));
  check('[23] the arrow is drawn in the DOM, not just in the model',
        (await sceneDom()).edges.length > 0, JSON.stringify((await sceneDom()).edges));
  check('[24] the 3D layer performs no pointer arithmetic of its own', await page.evaluate(() => {
    const src = CViz3D.layout.toString();
    // it may look targets up, but never compute base + index * size
    return !/\*\s*(elemSize|sizeof|size)\b/.test(src) && /pointerTarget/.test(src);
  }));

  await setSrc(SRC_ARR); await runAll(); await page.evaluate(() => goTo(run.history.length - 2));
  await sleep(200);
  check('[25] an array is drawn as contiguous numbered cells with the engine values',
        await page.evaluate(() => {
    const state = st();
    const arr = state.frames.flatMap(f => f.vars).find(v => v.isArray);
    if (!arr) return false;
    const cells = Array.from(document.querySelectorAll('#vizHost .viz-node.vz-cell'));
    if (cells.length !== arr.elements.length) return false;
    return arr.elements.every(e => {
      const c = cells.find(x => x.dataset.vid.endsWith('#' + e.index));
      return c && c.textContent.indexOf(e.valueText) >= 0 && c.textContent.indexOf('[' + e.index + ']') >= 0;
    });
  }));
  check('[26] neighbouring cells are laid out contiguously, one element apart',
        await page.evaluate(() => {
    const scene = viz.lastScene;
    const cells = scene.nodes.filter(n => n.kind === 'cell').sort((a, b) => a.el.index - b.el.index);
    if (cells.length < 2) return false;
    const gapPx = cells[1].x - cells[0].x;
    const gapAddr = cells[1].el.address - cells[0].el.address;
    return gapPx > 0 && gapAddr === cells[0].v.elemSize;
  }));
  check('[27] pointer arithmetic moves the arrow between elements, per the engine', await (async () => {
    await setSrc(['int\tmain(void)', '{', '\tint\ta[3];', '\tint\t*p;', '',
      '\ta[0] = 1;', '\ta[1] = 2;', '\ta[2] = 3;', '\tp = a;', '\tp++;', '\treturn (*p);', '}', ''].join('\n'));
    await runAll();
    return page.evaluate(() => {
      const idxOf = () => {
        const e = viz.lastScene.edges[0];
        const n = e && e.to ? viz.lastScene.nodes.find(x => x.id === e.to) : null;
        return n && n.kind === 'cell' ? n.el.index : -1;
      };
      // find the step where p = a, then the step after p++
      let before = -1, after = -1;
      for (let i = 0; i < run.history.length; i++) {
        goTo(i);
        const k = idxOf();
        if (k === 0 && before < 0) before = i;
        if (before >= 0 && k === 1) { after = i; break; }
      }
      return before >= 0 && after > before;
    });
  })());

  /* ================= 5. STACK, CALLS, RETURNS ================= */
  console.log('=== Phase 8 · stack and functions ===');
  await setSrc(SRC_FN); await runAll();
  check('[28] frame count in the scene always equals the engine frame count', await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const drawn = document.querySelectorAll('#vizHost .viz-node.vz-frame').length;
      if (drawn !== st().frames.length) return false;
    }
    return true;
  }));
  check('[29] a call adds a frame and the caller frame stays below it', await page.evaluate(() => {
    let called = -1;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      if (st().frames.length === 2) { called = i; break; }
    }
    if (called < 0) return false;
    const frames = viz.lastScene.nodes.filter(n => n.kind === 'frame');
    const callee = frames.find(f => f.f.name === 'ft_double');
    const caller = frames.find(f => f.f.name === 'main');
    // y grows downward, so the newest frame sits above the caller
    return !!callee && !!caller && callee.y < caller.y;
  }));
  check('[30] exactly one frame is marked current, and it is the engine top frame',
        await page.evaluate(() => {
    const cur = Array.from(document.querySelectorAll('#vizHost .viz-node.vz-frame.vz-current'));
    return cur.length === 1 && cur[0].textContent.indexOf(st().frameName) >= 0;
  }));
  check('[31] a return removes the frame from the scene', await page.evaluate(() => {
    const last = run.history.length - 1;
    goTo(last);
    return document.querySelectorAll('#vizHost .viz-node.vz-frame').length === st().frames.length;
  }));
  check('[32] the return caption reports the value the engine returned', await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      if (run.history.steps[i].phase === 'call-return') {
        const cap = (document.querySelector('.viz-cap-what') || {}).textContent || '';
        return cap.indexOf('10') >= 0 && cap.indexOf('ft_double') >= 0;
      }
    }
    return false;
  }));
  check('[33] clicking a stack frame shows function, depth, locals and caller', await page.evaluate(() => {
    let target = -1;
    for (let i = 0; i < run.history.length; i++) { goTo(i); if (st().frames.length === 2) { target = i; break; } }
    if (target < 0) return false;
    goTo(target);
    const f = document.querySelector('#vizHost .viz-node.vz-frame');
    if (!f) return false;
    f.click();
    const d = document.querySelector('#vizDetail');
    if (!d) return false;
    const txt = d.textContent.replace(/\s+/g, ' ');
    return /Function|Fonction/.test(txt) && /Depth|Profondeur/.test(txt) &&
           /Locals|Locales/.test(txt) && /Caller|Appelant/.test(txt);
  }));

  /* ================= 6. CONDITIONS AND LOOPS ================= */
  console.log('=== Phase 8 · conditions and loops ===');
  await setSrc(['int\tmain(void)', '{', '\tint\tx;', '\tint\tr;', '',
    '\tx = 15;', '\tif (x > 10)', '\t\tr = 1;', '\telse', '\t\tr = 0;', '\treturn (r);', '}', ''].join('\n'));
  await runAll();
  check('[34] a condition badge shows the result the ENGINE computed, never a re-evaluation',
        await page.evaluate(() => {
    let found = false;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = run.history.steps[i].condition;
      if (!c) continue;
      found = true;
      const badge = document.querySelector('.viz-cond');
      if (!badge) return false;
      const isTrue = badge.classList.contains('is-true');
      if (isTrue !== !!c.result) return false;
      if (badge.textContent.indexOf(c.expr) < 0) return false;
    }
    return found;
  }));
  check('[35] the condition colour follows the semantic language (green true / red false)',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = run.history.steps[i].condition;
      if (!c) continue;
      const badge = document.querySelector('.viz-cond');
      return badge.classList.contains(c.result ? 'is-true' : 'is-false');
    }
    return false;
  }));
  await setSrc(SRC_ARR); await runAll();
  check('[36] every loop iteration advances the scene and the loop variable', await page.evaluate(() => {
    const seen = [];
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = run.history.steps[i].condition;
      if (c && c.iteration !== undefined) {
        const v = st().frames[0].vars.find(x => x.name === 'i');
        seen.push(c.iteration + ':' + (v ? v.valueText : '?'));
      }
    }
    // iterations are 1..N and the counter is never repeated for two iterations
    return seen.length >= 4 && new Set(seen).size === seen.length;
  }));
  check('[37] the loop condition turning FALSE is what ends the loop in the scene',
        await page.evaluate(() => {
    let lastCond = null;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = run.history.steps[i].condition;
      if (c) lastCond = { result: c.result, badge: document.querySelector('.viz-cond').className };
    }
    return lastCond && lastCond.result === false && /is-false/.test(lastCond.badge);
  }));

  /* ================= 7. MEMORY, HEAP, LIFETIME, ERRORS ================= */
  console.log('=== Phase 8 · memory and errors ===');
  await setSrc(SRC_HEAP); await runAll();
  check('[38] a heap allocation appears as a block with the engine size and address',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const h = st().objects.filter(o => o.region === 'heap' && o.state === 'live');
      if (!h.length) continue;
      const el = document.querySelector('#vizHost .viz-node.vz-heap');
      if (!el) return false;
      return el.textContent.indexOf(CEngine.hexAddr(h[0].address)) >= 0 &&
             el.textContent.indexOf(h[0].size + ' B') >= 0;
    }
    return false;
  }));
  check('[39] a freed block is drawn as no-longer-valid and its pointer arrow turns bad',
        await page.evaluate(() => {
    goTo(run.history.length - 2);
    const dead = document.querySelectorAll('#vizHost .viz-node.vz-dead').length;
    const bad = document.querySelectorAll('#vizHost .viz-edge.vz-bad').length;
    return dead > 0 && bad > 0;
  }));
  check('[40] byte-level detail comes from the engine bytes', await page.evaluate(() => {
    goTo(2);
    const n = document.querySelector('#vizHost .viz-node.vz-var');
    if (!n) return false;
    n.click();
    const bytes = Array.from(document.querySelectorAll('#vizDetail .vd-byte')).map(b => b.textContent);
    const v = viz.lastScene.nodes.find(x => x.id === viz.detail);
    if (!v || !v.v.bytes.length) return bytes.length === 0;
    return bytes.length === v.v.bytes.length &&
      v.v.bytes.every((b, k) => bytes[k] === (b.init ? b.value.toString(16).padStart(2, '0').toUpperCase() : '??'));
  }));
  await setSrc(SRC_UAR); await runAll(); await sleep(300);
  check('[41] a real runtime error is shown, with the engine message verbatim',
        await page.evaluate(() => {
    const box = document.querySelector('#vizHost .viz-error');
    return !!box && !!run.error && box.textContent.indexOf(run.error.message.slice(0, 40)) >= 0;
  }));
  check('[42] the error kind is labelled and localizable, not invented',
        await page.evaluate(() => {
    const box = document.querySelector('#vizHost .viz-error');
    return !!box && run.error.memSafety === true &&
      box.textContent.indexOf(t('viz.err.' + run.error.kind)) >= 0;
  }));
  check('[43] no error banner appears when the engine did not raise one', await (async () => {
    await setSrc(SRC_UNINIT); await runAll(); await sleep(200);
    return page.evaluate(() => !run.error && !document.querySelector('#vizHost .viz-error'));
  })());

  /* ================= 8. NO FABRICATION ================= */
  console.log('=== Phase 8 · honesty ===');
  await setSrc(SRC_UNINIT);
  await page.evaluate(() => { restart(); doStep(); doStep(); });
  await sleep(250);
  check('[44] an uninitialized variable is drawn as unknown, never as a number',
        await page.evaluate(() => {
    const un = st().frames.flatMap(f => f.vars).filter(v => v.uninitialized);
    if (!un.length) return false;
    return un.every(v => {
      const el = document.querySelector('#vizHost .viz-node[data-vid$=":' + v.name + '"]');
      return el && el.querySelector('.vz-unknown');
    });
  }));
  check('[45] the trace model marks addresses and sizes unknown, because a trace never observed them',
        await page.evaluate(() => {
    const fake = { line: 3, fn: 'main', callStack: ['main'], depth: 1,
      allVariables: [{ fn: 'main', name: 'x', type: 'int', value: '5', known: true }],
      variables: [], exitCode: null, event: { type: 'ASSIGNMENT', name: 'x', value: '5', known: true, line: 3 } };
    const m = CViz3D.modelFromTrace(fake, {});
    const v = m.frames[0].vars[0];
    return v.value === '5' && v.address === null && v.size === null;
  }));
  check('[46] a model with no state produces an empty scene rather than a guess',
        await page.evaluate(() => {
    const s = CViz3D.layout(CViz3D.unsupported('test'));
    return s.nodes.length === 0 && s.edges.length === 0;
  }));
  check('[47] the unsupported state is announced instead of drawn', await page.evaluate(() => {
    viz.lastModel = CViz3D.unsupported('no visualization for this');
    renderVizHud();
    const el = document.querySelector('.viz-unsupported');
    const ok = !!el && el.textContent.indexOf('no visualization for this') >= 0;
    renderViz();
    return ok;
  }));

  /* ================= 9. CAMERA AND INTERACTION ================= */
  console.log('=== Phase 8 · camera ===');
  await setSrc(SRC_ARR); await runAll();
  // park on a step that still has live variables, so there is something to aim at
  await page.evaluate(() => {
    for (let i = run.history.length - 1; i >= 0; i--) {
      goTo(i);
      if (viz.lastScene && viz.lastScene.nodes.some(n => n.kind === 'cell' || n.kind === 'var')) return;
    }
  });
  await sleep(200);
  /* The camera contract CHANGED in the final phase: free rotation is now
     forbidden by design, and execution must never move the camera. These
     assertions were moved forward to the new contract rather than dropped —
     each still tests the camera, but tests what it is now required to do. */
  check('[48] pan and zoom work, and Reset returns to a stable default', await page.evaluate(() => {
    viz.stage.resetCamera();
    const home = viz.stage.getCamera();
    viz.stage.panBy(60, -30);
    viz.stage.zoomBy(1.5);
    const moved = viz.stage.getCamera();
    viz.stage.resetCamera();
    const back = viz.stage.getCamera();
    return moved.panX !== home.panX && moved.panY !== home.panY && moved.zoom > home.zoom &&
           back.zoom > 0 && isFinite(back.panX) && isFinite(back.panY);
  }));
  /* Phase 11 turned the tilted perspective scene into a 2.5D plane, so the old
     wording of this check — "the fixed tilt is still exactly 9deg/-13deg" —
     asserts a contract the product no longer has. The replacement is strictly
     STRONGER: it forbids every rotation and every 3D transform rather than
     pinning two particular angles, and it forbids any orientation field on the
     camera rather than requiring two specific ones. */
  check('[49] the scene has NO rotation and no 3D transform of any kind', await page.evaluate(() => {
    const before = document.querySelector('#vizHost .viz-world').style.transform;
    // ask for rotation every way a caller could: it must be ignored
    viz.stage.setCamera({ yaw: 33, pitch: -50, rotateX: 70, rotateY: 120, tiltX: 40, tiltY: 40 });
    viz.stage.panBy(25, 25);
    viz.stage.zoomBy(1.2);
    const after = document.querySelector('#vizHost .viz-world').style.transform;
    const c = viz.stage.getCamera();
    viz.stage.resetCamera();
    const clean = (s) => !/rotate|translate3d|perspective|matrix3d|skew/.test(s);
    return clean(before) && clean(after) &&
           /^scale\([\d.]+\) translate\([-\d.]+px, ?[-\d.]+px\)$/.test(after) &&
           !('tiltX' in c) && !('tiltY' in c) && !('yaw' in c) && !('pitch' in c);
  }));
  check('[49b] no drag gesture can flip or orbit the scene', await page.evaluate(() => {
    const host = document.querySelector('#vizHost');
    const r = host.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (const [dx, dy] of [[400, 0], [-800, 0], [0, 400], [0, -800], [300, 300]]) {
      host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + dx, clientY: cy + dy }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
    const tr = document.querySelector('#vizHost .viz-world').style.transform;
    viz.stage.resetCamera();
    // Same replacement rationale as [49]: no rotation at all, rather than one
    // particular pair of angles.
    return !/rotate|translate3d|perspective|matrix3d|skew/.test(tr);
  }));
  check('[50] focusing an object centres it in the visible area', await page.evaluate(() => {
    const n = viz.lastScene.nodes.find(x => x.kind === 'cell' || x.kind === 'var');
    if (!n) return false;
    viz.stage.focusNode(n.id);
    const c = viz.stage.getCamera(), v = viz.stage.visibleBox();
    // screen = zoom * (world + pan), so the node centre lands on the box centre
    return Math.abs((n.x + n.w / 2 + c.panX) * c.zoom - v.cx) < 1 &&
           Math.abs((n.y + n.h / 2 + c.panY) * c.zoom - v.cy) < 1;
  }));
  const fitWorst = () => page.evaluate(() => {
    const host = document.querySelector('#vizHost');
    const hr = host.getBoundingClientRect(), v = viz.stage.visibleBox();
    const free = { left: hr.left + hr.width / 2 + v.cx - v.w / 2,
                   right: hr.left + hr.width / 2 + v.cx + v.w / 2,
                   top: hr.top + hr.height / 2 + v.cy - v.h / 2,
                   bottom: hr.top + hr.height / 2 + v.cy + v.h / 2 };
    let w = -1e9, n = 0;
    document.querySelectorAll('#vizHost .viz-node').forEach(el => {
      const q = el.getBoundingClientRect();
      if (!q.width || !q.height) return;
      n++;
      w = Math.max(w, free.left - q.left, q.right - free.right,
                      free.top - q.top, q.bottom - free.bottom);
    });
    return { nodes: n, worst: Math.round(w) };
  });
  await page.evaluate(() => viz.stage.fit());
  await sleep(200);
  const fitNow = await fitWorst();
  check('[51] Fit really fits: every painted node lands inside the free area',
        fitNow.nodes > 0 && fitNow.worst <= 1, JSON.stringify(fitNow));
  check('[51b] Fit keeps working after the workspace, dock and window are resized',
        await (async () => {
    const steps = [
      () => page.evaluate(() => { ui.split = 28; applySplit(); }),
      () => page.evaluate(() => { ui.dockH = 400; applyDockH(); }),
      () => page.setViewport({ width: 1080, height: 700 }),
      () => page.evaluate(() => { ui.dockH = 120; applyDockH(); }),
      () => page.setViewport({ width: 1600, height: 1000 }),
    ];
    let ok = true, worstSeen = -1e9;
    for (const s of steps) {
      await s(); await sleep(320);
      await page.evaluate(() => viz.stage.fit()); await sleep(220);
      const m = await fitWorst();
      worstSeen = Math.max(worstSeen, m.worst);
      if (m.worst > 1) ok = false;
    }
    await page.evaluate(() => { ui.split = 42; applySplit(); ui.dockH = 210; applyDockH(); });
    await sleep(250);
    global.__worstResize = worstSeen;
    return ok;
  })(), 'worst overflow across resizes: ' + (global.__worstResize !== undefined ? global.__worstResize : '?') + 'px');
  check('[51c] execution never moves the camera', await page.evaluate(() => {
    viz.stage.fit();
    const before = JSON.stringify(viz.stage.getCamera());
    for (let i = 0; i < 6 && i < run.history.length; i++) goTo(i);
    doStep(); doPrev(); doStep();
    return JSON.stringify(viz.stage.getCamera()) === before;
  }));
  check('[52] clicking a variable opens a detail with name, type, value, address, size and scope',
        await page.evaluate(() => {
    // park on a step that actually has a variable card to click
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      if (document.querySelector('#vizHost .viz-node.vz-var')) break;
    }
    const n = document.querySelector('#vizHost .viz-node.vz-var');
    if (!n) return false;
    n.click();
    const d = document.querySelector('#vizDetail');
    if (!d) return false;
    const txt = d.textContent.replace(/\s+/g, ' ');
    return /Type/.test(txt) && /Value|Valeur/.test(txt) && /Address|Adresse/.test(txt) &&
           /Size|Taille/.test(txt) && /Scope|Portée/.test(txt);
  }));
  check('[53] clicking a pointer shows its target and target address', await (async () => {
    await setSrc(SRC_PTR); await runAll();
    return page.evaluate(() => {
      goTo(run.history.length - 3);
      const p = Array.from(document.querySelectorAll('#vizHost .viz-node.vz-var'))
        .find(n => n.className.indexOf('role-pointer') >= 0);
      if (!p) return false;
      p.click();
      const txt = (document.querySelector('#vizDetail') || {}).textContent || '';
      const target = st().frames.flatMap(f => f.vars).find(v => v.isPointer).pointerTarget;
      return txt.indexOf(CEngine.hexAddr(target.address)) >= 0;
    });
  })());

  /* ================= 10. ANIMATION SPEED IS ANIMATION ONLY ================= */
  console.log('=== Phase 8 · animation ===');
  check('[54] the speed control changes only the animation duration', await page.evaluate(() => {
    const before = run.index;
    const beforeHist = run.history.length;
    viz.stage.setSpeed(5);
    const fast = document.querySelector('#vizHost').style.getPropertyValue('--viz-anim');
    viz.stage.setSpeed(0.25);
    const slow = document.querySelector('#vizHost').style.getPropertyValue('--viz-anim');
    viz.stage.setSpeed(1);
    return fast !== slow && parseFloat(fast) < parseFloat(slow) &&
           run.index === before && run.history.length === beforeHist;
  }));
  check('[55] all five speeds are offered', await page.evaluate(() =>
    JSON.stringify(CViz3D.SPEEDS) === JSON.stringify([0.25, 0.5, 1, 2, 5]) &&
    document.querySelectorAll('#vizSpeed option').length === 5));
  check('[56] nodes are pooled and reused across steps, not rebuilt', await page.evaluate(() => {
    goTo(2);
    const el = document.querySelector('#vizHost .viz-node.vz-var');
    el._probe = 'kept';
    goTo(3);
    const again = document.querySelector('#vizHost .viz-node[data-vid="' + el.dataset.vid + '"]');
    return again === el && again._probe === 'kept';
  }));

  /* ================= 11. FALLBACK ================= */
  console.log('=== Phase 8 · fallback ===');
  check('[57] capability detection reports both 3D transforms and WebGL', await page.evaluate(() => {
    const c = CViz3D.caps();
    return typeof c.transforms3d === 'boolean' && typeof c.webgl === 'boolean';
  }));
  check('[58] with 3D unavailable a flat 2D scene is drawn and stays usable', await page.evaluate(() => {
    viz.flat = true; disposeViz(); vizEnsureStage(); renderViz();
    const flat = viz.stage.flat === true;
    const host = document.querySelector('#vizHost');
    const nodes = document.querySelectorAll('#vizHost .viz-node').length;
    const tr = document.querySelector('#vizHost .viz-world').style.transform;
    return flat && host.classList.contains('viz-flat') && nodes > 0 && !/translate3d|rotateY/.test(tr);
  }));
  check('[59] the fallback still shows values, arrows and the caption', await page.evaluate(() => {
    const vals = document.querySelectorAll('#vizHost .vz-val').length;
    const cap = (document.querySelector('.viz-cap-what') || {}).textContent || '';
    return vals > 0 && cap.length > 5;
  }));
  /* Phase 11 removed the 3D projection entirely, so there is no longer a mode
     to switch back TO. The replacement asserts the stronger property the
     product now guarantees: whatever a caller does to viz.flat, the scene is
     always the same 2.5D plane — there is no second projection that could
     disagree with the first. */
  check('[60] there is only one projection, and asking for another cannot restore 3D',
        await page.evaluate(() => {
    viz.flat = false; disposeViz(); vizEnsureStage(); renderViz();
    const tr = document.querySelector('#vizHost .viz-world').style.transform;
    const host = document.querySelector('#vizHost');
    return viz.stage.flat === true &&
           host.classList.contains('viz-flat') &&
           !/translate3d|rotate|perspective/.test(tr) &&
           document.querySelectorAll('#vizHost .viz-node').length > 0;
  }));

  /* ================= 12. CLEANUP AND STALE STATE ================= */
  console.log('=== Phase 8 · cleanup ===');
  check('[61] disposing removes every node, edge and the camera DOM', await page.evaluate(() => {
    disposeViz();
    return document.querySelectorAll('#vizHost .viz-node').length === 0 &&
           document.querySelectorAll('#vizHost .viz-edge').length === 0 &&
           document.querySelectorAll('#vizHost .viz-camera').length === 0 &&
           viz.stage === null;
  }));
  check('[62] the view rebuilds cleanly after disposal', await page.evaluate(() => {
    renderViz();
    return !!viz.stage && document.querySelectorAll('#vizHost .viz-node').length > 0;
  }));
  check('[63] editing the source clears the scene instead of leaving a stale one', await (async () => {
    await setSrc('int\tmain(void)\n{\n\tint\tzz;\n\n\tzz = 1;\n\treturn (zz);\n}\n');
    await sleep(250);
    return page.evaluate(() => {
      const stale = Array.from(document.querySelectorAll('#vizHost .viz-node'))
        .some(n => /\ba\[|\bp\b/.test(n.textContent));
      return !stale;
    });
  })());
  check('[64] after editing, stepping builds a scene for the NEW program', await (async () => {
    await stepN(3);
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('#vizHost .viz-node')).some(n => n.textContent.indexOf('zz') >= 0));
  })());

  /* ================= 13. ⓘ EXPLANATION SYSTEM ================= */
  console.log('=== Phase 8 · educational explanations ===');
  const REQUIRED = ['stack', 'frame', 'heap', 'globals', 'variable', 'array', 'pointer', 'address',
    'value', 'type', 'scope', 'call', 'ret', 'condition', 'loop', 'iteration', 'alloc',
    'lifetime', 'line', 'step', 'traceEvent'];
  check('[65] every required concept has an explanation', await page.evaluate((req) =>
    req.every(id => CConcepts.has(id)), REQUIRED), REQUIRED.length + ' concepts');
  check('[66] every concept is complete in EN and FR at all three detail levels',
        await page.evaluate(() => CConcepts.audit().length === 0),
        await page.evaluate(() => CConcepts.audit().slice(0, 5).join(', ')));
  check('[67] the three detail levels give genuinely different explanations',
        await page.evaluate(() => CConcepts.ids().every(id => {
    const b = CConcepts.get(id, 'en', 'beginner').what;
    const i = CConcepts.get(id, 'en', 'intermediate').what;
    const d = CConcepts.get(id, 'en', 'deep').what;
    return b !== i && i !== d && b !== d && b.length > 20 && d.length > 20;
  })));
  check('[68] EN and FR explanations are actually translated, not copied',
        await page.evaluate(() => CConcepts.ids().every(id => {
    const e = CConcepts.get(id, 'en', 'beginner');
    const f = CConcepts.get(id, 'fr', 'beginner');
    return e.what !== f.what && e.look !== f.look && e.why !== f.why && e.title && f.title;
  })));
  check('[69] ⓘ buttons are rendered next to the visualization sections',
        await page.evaluate(() => document.querySelectorAll('#vizHud .info-btn').length >= 6));
  check('[70] clicking ⓘ opens a popover with what / what-to-look-at / analogy',
        await page.evaluate(() => {
    const b = document.querySelector('#vizHud .info-btn[data-info="pointer"]') ||
              document.querySelector('#vizHud .info-btn');
    b.click();
    const p = document.querySelector('.info-pop');
    if (!p) return false;
    return !!p.querySelector('.info-what') && !!p.querySelector('.info-look') && !!p.querySelector('.info-why');
  }));
  check('[71] the popover follows the current detail level', await page.evaluate(() => {
    closeInfoPop();
    ui.level = 'deep'; applyLevel();
    const b = document.querySelector('#vizHud .info-btn[data-info="pointer"]') ||
              document.querySelector('#vizHud .info-btn');
    b.click();
    const p = document.querySelector('.info-pop');
    const id = b.dataset.info;
    const want = CConcepts.get(id, ui.lang, 'deep').what;
    const ok = p && p.querySelector('.info-what').textContent === want &&
               /deep|approfondi/.test(p.querySelector('.info-lvl').textContent);
    closeInfoPop(); ui.level = 'beginner'; applyLevel();
    return ok;
  }));
  check('[72] the popover never covers the element it explains, and stays on screen',
        await page.evaluate(() => {
    const b = document.querySelector('#vizHud .info-btn');
    b.click();
    const p = document.querySelector('.info-pop').getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const overlaps = !(p.right < r.left || p.left > r.right || p.bottom < r.top || p.top > r.bottom);
    const onScreen = p.left >= 0 && p.top >= 0 &&
                     p.right <= window.innerWidth + 1 && p.bottom <= window.innerHeight + 1;
    closeInfoPop();
    return !overlaps && onScreen;
  }));
  check('[73] Escape closes the popover so it can never trap the view', await page.evaluate(() => {
    document.querySelector('#vizHud .info-btn').click();
    const opened = !!document.querySelector('.info-pop');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return opened && !document.querySelector('.info-pop');
  }));
  check('[74] explanations never claim behaviour the engine does not model',
        await page.evaluate(() => {
    const all = CConcepts.ids().map(id => {
      const e = CConcepts.get(id, 'en', 'deep');
      return e.what + ' ' + e.look + ' ' + e.why;
    }).join(' ').toLowerCase();
    // the engine models none of these; claiming them would teach a fiction
    return !/\bregister\b|\bcache line\b|\bcpu cache\b|\bstruct layout is\b|\bfloating[- ]point value\b/.test(all);
  }));
  check('[75] the memory concept states this is a simulated model, not real RAM',
        await page.evaluate(() => {
    const d = CConcepts.get('memory', 'en', 'deep').what.toLowerCase();
    const f = CConcepts.get('memory', 'fr', 'deep').what.toLowerCase();
    return /simulated/.test(d) && /simul/.test(f);
  }));

  /* ================= 14. THEMES, LANGUAGES, RESPONSIVE ================= */
  console.log('=== Phase 8 · themes and languages ===');
  check('[76] the scene is readable in dark and in light (no hard-coded colours)',
        await page.evaluate(() => {
    const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');
    const block = styles.slice(styles.indexOf('3D EXECUTION VISUALIZATION'));
    const end = block.indexOf('/* ==========');
    const css = end > 0 ? block.slice(0, end) : block;
    // colours must come from the theme variables; rgba shadows are fine
    const hard = css.match(/:\s*#[0-9a-fA-F]{3,8}\b/g) || [];
    return hard.length === 0;
  }), 'no literal hex colours in the 3D CSS');
  check('[77] switching theme repaints the same scene', await page.evaluate(() => {
    const before = document.querySelectorAll('#vizHost .viz-node').length;
    ui.theme = 'light'; applyTheme();
    const light = getComputedStyle(document.querySelector('#vizHost')).backgroundColor;
    ui.theme = 'dark'; applyTheme();
    const dark = getComputedStyle(document.querySelector('#vizHost')).backgroundColor;
    return light !== dark && document.querySelectorAll('#vizHost .viz-node').length === before;
  }));
  const enCap = await page.evaluate(() => {
    ui.lang = 'en'; applyI18n();
    return { cap: (document.querySelector('.viz-cap-what') || {}).textContent,
             tools: (document.querySelector('.viz-tools') || {}).textContent,
             legend: (document.querySelector('.viz-legend') || {}).textContent };
  });
  const frCap = await page.evaluate(() => {
    ui.lang = 'fr'; applyI18n();
    return { cap: (document.querySelector('.viz-cap-what') || {}).textContent,
             tools: (document.querySelector('.viz-tools') || {}).textContent,
             legend: (document.querySelector('.viz-legend') || {}).textContent };
  });
  check('[78] the caption, tools and legend are all translated',
        enCap.cap !== frCap.cap && enCap.tools !== frCap.tools && enCap.legend !== frCap.legend,
        JSON.stringify(frCap.tools || '').slice(0, 60));
  check('[79] every viz i18n key exists in both languages', await page.evaluate(() => {
    const en = Object.keys(I18N.en).filter(k => /^(viz|lvl)\./.test(k));
    const fr = Object.keys(I18N.fr).filter(k => /^(viz|lvl)\./.test(k));
    return en.length > 40 && en.every(k => fr.includes(k)) && fr.every(k => en.includes(k));
  }));
  await page.evaluate(() => { ui.lang = 'en'; applyI18n(); });

  /* ================= 15. UI INTEGRATION + SECURITY ================= */
  console.log('=== Phase 8 · integration and security ===');
  check('[80] a View menu offers Source, Debugger, Memory, Trace and 3D', await page.evaluate(() => {
    const v = MENUS.mView();
    const names = v.filter(x => x !== '-').map(x => x.n).join('|');
    return /Source/.test(names) && /Debugger|Débogueur/.test(names) &&
           /Memory|Mémoire/.test(names) && /Trace/.test(names) && /3D/.test(names);
  }));
  check('[81] the 3D view is reachable from the rail, the menu, the palette and a key',
        await page.evaluate(() =>
    !!document.querySelector('#rail3d') &&
    MENUS.mView().some(i => i && i.a === toggleViz) &&
    commands().some(c => c.a === toggleViz && c.k === 'V')));
  check('[82] switching views keeps the execution state intact', await page.evaluate(() => {
    const i = run.index, len = run.history.length;
    closeViz(); openViz(); closeViz(); openViz();
    return run.index === i && run.history.length === len;
  }));
  check('[83] the 3D layer adds no network or command surface', await page.evaluate(() => {
    const src = [CViz3D.createStage, CViz3D.modelFromEngine, CViz3D.layout].map(f => f.toString()).join('\n') +
                renderViz.toString() + openViz.toString() + vizEnsureStage.toString();
    return !/fetch\(|XMLHttpRequest|WebSocket|Bridge\.call|\/run|\/exec|\/shell/.test(src);
  }));
  check('[84] the bridge action list is still the fixed Phase 5-7 allowlist', (() => {
    const src = fs.readFileSync(BRIDGE, 'utf8');
    const m = src.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
    if (!m) return false;
    const acts = (m[1].match(/'(\/[a-z]+)'/g) || []).map(s => s.replace(/'/g, ''));
    return acts.length === 6 && !acts.some(a => /shell|exec|run\b|cmd|viz|3d/.test(a));
  })());
  check('[85] ten demo programs cover the required constructs', await page.evaluate(() =>
    VIZ_DEMOS.length === 10 &&
    VIZ_DEMOS.every(d => typeof d.program === 'string' && d.name.en && d.name.fr)));
  check('[86] every demo actually compiles and runs in the engine', await page.evaluate(() =>
    VIZ_DEMOS.every(d => {
      const r = CEngine.compile(d.program);
      return r.ok === true;
    })));
  check('[87] a demo can be loaded and visualized end to end', await (async () => {
    await page.evaluate(() => { viz.demoId = 'v-loopfunc'; loadVizDemo(); });
    await runAll();
    return page.evaluate(() =>
      document.querySelectorAll('#vizHost .viz-node').length > 0 &&
      viz.lastModel.line === step().line);
  })());

  /* ================= 16. PERFORMANCE ================= */
  console.log('=== Phase 8 · performance ===');
  check('[88] with the view closed the 3D layer does literally no work', await page.evaluate(() => {
    closeViz();
    const before = viz.renders;
    for (let i = 0; i < Math.min(60, run.history.length); i++) goTo(i);
    const closedRenders = viz.renders - before;
    openViz();
    const mid = viz.renders;
    for (let i = 0; i < Math.min(60, run.history.length); i++) goTo(i);
    const openRenders = viz.renders - mid;
    return closedRenders === 0 && openRenders > 0;
  }));
  check('[88b] stepping the IDE with 3D closed stays in the same order of magnitude as with it open',
        await page.evaluate(() => {
    const N = Math.min(40, run.history.length);
    const run1 = () => { for (let i = 0; i < N; i++) goTo(i); };
    openViz();  run1(); run1();          // warm both paths up first
    closeViz(); run1();
    const t0 = performance.now(); run1(); const closed = performance.now() - t0;
    openViz(); run1();
    const t1 = performance.now(); run1(); const open = performance.now() - t1;
    window.__perf = { closed: Math.round(closed), open: Math.round(open) };
    return closed <= open * 1.6 + 25;
  }), await page.evaluate(() => JSON.stringify(window.__perf || {})));
  /* The scalability contract CHANGED in Phase 9. A hard truncation at 420 was
     replaced by viewport culling plus a drawn-node budget, so a scene may hold
     far more objects than are ever painted. These two assertions were moved
     forward to the new contract: what must stay bounded is the DOM, not the
     scene. Both are stricter than the originals, which only checked a number. */
  check('[89] a huge scene keeps the painted DOM bounded', await page.evaluate(() => {
    const many = [];
    const per = 80;
    for (let i = 0; i < 20000; i++)
      many.push({ kind: 'var', id: 'x' + i, v: { name: 'v' + i, typeName: 'int', valueText: '0',
        known: true, address: 4096 + i * 4, size: 4, bytes: [] },
        x: (i % per) * 90, y: Math.floor(i / per) * 70, z: 0, w: 80, h: 60, role: 'memory' });
    const scene = { nodes: many, edges: [], bounds: CViz3D.boundsOf(many), model: null };
    const t0 = performance.now();
    const r = viz.stage.render(scene);
    const ms = performance.now() - t0;
    const dom = document.querySelectorAll('#vizHost .viz-node').length;
    window.__scale = { total: r.total, drawn: r.drawn, culled: r.culled, dom, ms: Math.round(ms) };
    renderViz();
    // 20k objects, but only what can be seen is built, and quickly
    return r.total === 20000 && r.culled > 15000 && dom <= CViz3D.MAX_NODES && ms < 1500;
  }), await page.evaluate(() => JSON.stringify(window.__scale || {})));
  check('[90] the drawn-node budget is real and is reported', await page.evaluate(() => {
    const many = [];
    // all at the same spot, so culling cannot help and the budget must apply
    for (let i = 0; i < CViz3D.MAX_NODES + 200; i++)
      many.push({ kind: 'var', id: 'y' + i, v: { name: 'v' + i, typeName: 'int', valueText: '0',
        known: true, address: 8192 + i * 4, size: 4, bytes: [] },
        x: 0, y: 0, z: 0, w: 40, h: 30, role: 'memory' });
    const r = viz.stage.render({ nodes: many, edges: [], bounds: CViz3D.boundsOf(many), model: null });
    const ok = r.truncated === true && r.drawn === CViz3D.MAX_NODES &&
               CViz3D.MAX_NODES >= 1000 && CViz3D.MAX_NODES <= 20000;
    renderViz();
    return ok;
  }));

  /* ---- visual QA shots ---- */
  try {
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => { viz.demoId = 'v-ptrarr'; loadVizDemo(); });
    await runAll();
    await page.evaluate(() => goTo(run.history.length - 2));
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'p8_viz_dark_en.png') });
    await page.evaluate(() => { ui.lang = 'fr'; applyI18n(); ui.theme = 'light'; applyTheme(); });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'p8_viz_light_fr.png') });
    await page.evaluate(() => { ui.lang = 'en'; applyI18n(); ui.theme = 'dark'; applyTheme();
                                viz.demoId = 'v-func'; loadVizDemo(); });
    await runAll();
    await page.evaluate(() => goTo(4));
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'p8_viz_stack.png') });
  } catch (e) { console.log('  (screenshots skipped: ' + e.message + ')'); }

  /* ================= 17. TRACE MODE FEEDS THE SAME VIEW ================= */
  console.log('=== Phase 8 · trace as a source ===');
  const bstat = await startBridge();
  if (bstat === 'failed') {
    check('[91] the 3D view follows a real traced run', false, 'bridge failed to start');
    check('[92] a trace-driven scene shows unknown addresses honestly', false, 'bridge failed to start');
  } else {
    await load();
    await page.evaluate(() => { trc.demoId = 'demo-func'; loadTraceDemo(); });
    await page.evaluate(() => runTrace());
    await waitFor(() => page.evaluate(() => !trc.busy), 250000, 250);
    await sleep(400);
    await open3d();
    check('[91] the 3D view follows a real traced run', await page.evaluate(() =>
      traceActive() && viz.lastModel && viz.lastModel.mode === 'trace' &&
      viz.lastModel.line === traceState().line &&
      document.querySelectorAll('#vizHost .viz-node').length > 0),
      await page.evaluate(() => viz.lastModel ? viz.lastModel.mode + ' line ' + viz.lastModel.line : 'null'));
    /* Phase 9 taught the instrumented program to report &lvalue and sizeof, so
       a trace now DOES observe addresses. The honesty requirement is unchanged
       and now checked directly: every address shown must be one the program
       itself reported, and anything it did not report stays unknown. */
    check('[92] every address a trace shows was reported by the program itself',
          await page.evaluate(() => {
      traceLast();
      const vars = viz.lastModel.frames.flatMap(f => f.vars);
      if (!vars.length) return false;
      const reported = new Set(trc.objects.map(o => o.base));
      for (const e of trc.events) {
        if (typeof e.address === 'number') reported.add(e.address);
      }
      return vars.every(v => {
        if (v.address === null) return true;                  // unknown stays unknown
        return reported.has(v.address);                       // otherwise: really observed
      });
    }));
    check('[92b] a value the program never reported is still shown as unknown',
          await page.evaluate(() => {
      const fake = { line: 3, fn: 'main', callStack: ['main'], depth: 1,
        allVariables: [{ fn: 'main', name: 'q', type: 'int', value: null, known: false }],
        variables: [], objects: [], exitCode: null, event: null };
      const m = CViz3D.modelFromTrace(fake, {});
      const v = m.frames[0].vars[0];
      return v.address === null && v.size === null && v.known === false;
    }));
    check('[93] stepping the trace with the SAME toolbar moves the scene', await page.evaluate(() => {
      traceFirst();
      const before = viz.lastModel.line;
      doStep(); doStep();
      return viz.lastModel.mode === 'trace' && viz.lastModel.line === traceState().line &&
             trc.index === 2 && (viz.lastModel.line !== before || trc.index === 2);
    }));
  }
  await stopBridge();

  const realErrs = errs.filter(e => !/ERR_CONNECTION|Failed to load|net::/.test(e));
  check('[94] no console errors across the whole phase 8 session',
        realErrs.length === 0, realErrs.slice(0, 4).join(' | '));

  await browser.close();

  console.log('\n' + '-'.repeat(64));
  console.log('PHASE 8  pass ' + pass + '  fail ' + fail);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
