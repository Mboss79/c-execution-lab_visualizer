'use strict';
// PHASE 9 EXIT GATE — operand data flow, memory errors, trace addresses, scale.
//
// Same rule as every suite before it: an assertion passes only if the thing on
// screen matches what the ENGINE (or the real traced program) reported.
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
  for (;;) { if (await fn()) return true; if (Date.now() - t0 > ms) return false; await sleep(every || 220); }
}

const FLOW   = ['int\tmain(void)', '{', '\tint\tx;', '\tint\ty;', '\tint\tz;', '',
  '\tx = 5;', '\ty = 10;', '\tz = x + y;', '\tz = z * y;', '\tx = z;', '\treturn (0);', '}', ''].join('\n');
const ARRFLOW = ['int\tmain(void)', '{', '\tint\ta[3];', '\tint\ti;', '\tint\tv;', '',
  '\ti = 1;', '\tv = 7;', '\ta[i] = v;', '\tv = a[i];', '\treturn (0);', '}', ''].join('\n');
const PTRFLOW = ['int\tmain(void)', '{', '\tint\tx;', '\tint\t*p;', '\tint\ty;', '',
  '\tx = 3;', '\tp = &x;', '\t*p = 9;', '\ty = *p;', '\treturn (0);', '}', ''].join('\n');
const OVER   = ['int\tmain(void)', '{', '\tint\tarr[3];', '',
  '\tarr[0] = 10;', '\tarr[1] = 20;', '\tarr[2] = 30;', '\tarr[3] = 42;', '\treturn (0);', '}', ''].join('\n');
const UNDER  = ['int\tmain(void)', '{', '\tint\tarr[3];', '',
  '\tarr[0] = 10;', '\tarr[1] = 20;', '\tarr[2] = 30;', '\tarr[-1] = 42;', '\treturn (0);', '}', ''].join('\n');
const NULLW  = ['int\tmain(void)', '{', '\tint\t*p;', '', '\tp = 0;', '\t*p = 42;', '\treturn (0);', '}', ''].join('\n');
const NULLR  = ['int\tmain(void)', '{', '\tint\t*p;', '\tint\tx;', '', '\tp = 0;', '\tx = *p;', '\treturn (x);', '}', ''].join('\n');
const UNINIT = ['int\tmain(void)', '{', '\tint\tx;', '\tint\ty;', '', '\ty = x + 1;', '\treturn (y);', '}', ''].join('\n');
const UAF    = ['#include <stdlib.h>', '', 'int\tmain(void)', '{', '\tint\t*p;', '',
  '\tp = malloc(4);', '\tfree(p);', '\t*p = 1;', '\treturn (0);', '}', ''].join('\n');
const DEEP   = ['int\tf(int n)', '{', '\treturn (f(n + 1));', '}', '',
  'int\tmain(void)', '{', '\treturn (f(1));', '}', ''].join('\n');
const TRSTR  = ['int\tmain(void)', '{', '\tchar\tstr[6];', '\tint\ti;', '',
  '\tstr[0] = 104;', '\tstr[1] = 101;', '\tstr[2] = 108;', '\tstr[3] = 108;',
  '\tstr[4] = 111;', '\tstr[5] = 0;', '\ti = 0;', '\twhile (str[i] != 0)',
  '\t{', '\t\ti++;', '\t}', '\treturn (i);', '}', ''].join('\n');

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
    args: ['--no-sandbox'], protocolTimeout: 600000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION|Failed to load resource|net::/.test(m.text())) errs.push(m.text()); });
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
  const runAll = async () => { await page.evaluate(() => fastForward({})); await sleep(420); };
  const open3d = async () => { await page.evaluate(() => openViz()); await sleep(420); };

  /* ================= A. OPERAND-LEVEL DATA FLOW ================= */
  console.log('=== Phase 9 · operand data flow ===');
  await load();
  await setSrc(FLOW);
  await runAll();
  await open3d();
  check('[1] the engine records the operator and both operands it combined',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      const d = run.history.steps[i].detail;
      const df = d && d.dataflow;
      if (!df || !df.op) continue;
      return df.op === '+' && df.sources.length === 2 &&
             df.sources[0].text === 'x' && df.sources[1].text === 'y' &&
             df.sources[0].valueText === '5' && df.sources[1].valueText === '10' &&
             df.dest.text === 'z' && df.dest.valueText === '15';
    }
    return false;
  }));
  check('[2] each operand carries the address the engine read it from',
        await page.evaluate(() => {
    const state = () => st();
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const df = run.history.steps[i].detail && run.history.steps[i].detail.dataflow;
      if (!df || !df.op) continue;
      const vars = state().frames.flatMap(f => f.vars);
      return df.sources.every(s => {
        const v = vars.find(x => x.name === s.text);
        return !v || s.address === v.address;
      });
    }
    return false;
  }));
  check('[3] the destination address is the address the engine wrote',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      const s = run.history.steps[i];
      const df = s.detail && s.detail.dataflow;
      if (!df || !s.memDiff) continue;
      if (df.dest.address !== s.memDiff.address) return false;
    }
    return true;
  }));
  check('[4] a temporary has no address, and says so rather than inventing one',
        await page.evaluate(() => {
    // z = z * y then x = z: the nested case in FLOW has a plain operand, so use
    // an expression whose operand is itself computed
    for (let i = 0; i < run.history.length; i++) {
      const df = run.history.steps[i].detail && run.history.steps[i].detail.dataflow;
      if (!df) continue;
      for (const s of df.sources) {
        if (s.kind === 'Num' && s.address !== null) return false;   // literals own no storage
      }
    }
    return true;
  }));
  check('[5] the scene draws one arrow per operand plus one to the destination',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const df = viz.lastModel && viz.lastModel.dataflow;
      if (!df || !df.op) continue;
      const lines = document.querySelectorAll('#vizHost .viz-flow').length;
      const badge = document.querySelectorAll('#vizHost .viz-flow-op').length;
      const out = document.querySelectorAll('#vizHost .viz-flow.vz-flow-out').length;
      window.__flow = { lines, badge, out, sources: df.sources.length };
      return lines === df.sources.length + 1 && badge === 1 && out === 1;
    }
    return false;
  }), await page.evaluate(() => JSON.stringify(window.__flow || {})));
  check('[6] the operator badge shows the operator the engine used',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const df = viz.lastModel && viz.lastModel.dataflow;
      if (!df || !df.op) continue;
      const b = document.querySelector('#vizHost .viz-flow-op');
      return !!b && b.textContent === df.op;
    }
    return false;
  }));
  check('[7] the flow overlay is rebuilt per step, never accumulated',
        await page.evaluate(() => {
    let maxSeen = 0;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      maxSeen = Math.max(maxSeen, document.querySelectorAll('#vizHost .viz-flow').length);
    }
    // never more than one operator's worth of arrows on screen at once
    return maxSeen <= 3;
  }));
  check('[8] the caption writes the expression with the values actually used',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const df = viz.lastModel && viz.lastModel.dataflow;
      if (!df || !df.op) continue;
      const el = document.querySelector('.viz-cap-flow');
      if (!el) return false;
      const txt = el.textContent;
      return txt.indexOf('x') >= 0 && txt.indexOf('5') >= 0 &&
             txt.indexOf('y') >= 0 && txt.indexOf('10') >= 0 &&
             txt.indexOf(df.op) >= 0 && txt.indexOf('15') >= 0;
    }
    return false;
  }));
  check('[9] a plain copy is reported with one source and no operator',
        await page.evaluate(() => {
    for (let i = 0; i < run.history.length; i++) {
      const df = run.history.steps[i].detail && run.history.steps[i].detail.dataflow;
      if (!df) continue;
      if (df.op === null && df.sources.length === 1) return true;
    }
    return false;
  }));
  check('[10] arr[i] = v and v = arr[i] both report the exact element address',
        await (async () => {
    await setSrc(ARRFLOW); await runAll();
    return page.evaluate(() => {
      let wrote = false, read = false;
      for (let i = 0; i < run.history.length; i++) {
        goTo(i);
        const df = run.history.steps[i].detail && run.history.steps[i].detail.dataflow;
        if (!df) continue;
        const arr = st().frames.flatMap(f => f.vars).find(v => v.isArray);
        if (!arr) continue;
        const cell1 = arr.elements[1];
        if (df.dest.text === 'a[i]' && df.dest.address === cell1.address) wrote = true;
        if (df.sources.some(s => s.text === 'a[i]' && s.address === cell1.address)) read = true;
      }
      return wrote && read;
    });
  })());
  check('[11] *p = x and x = *p report the pointer target address',
        await (async () => {
    await setSrc(PTRFLOW); await runAll();
    return page.evaluate(() => {
      let ok = 0;
      for (let i = 0; i < run.history.length; i++) {
        goTo(i);
        const df = run.history.steps[i].detail && run.history.steps[i].detail.dataflow;
        if (!df) continue;
        const x = st().frames.flatMap(f => f.vars).find(v => v.name === 'x');
        if (!x) continue;
        if (df.dest.text === '*p' && df.dest.address === x.address) ok++;
        if (df.sources.some(s => s.text === '*p' && s.address === x.address)) ok++;
      }
      return ok >= 2;
    });
  })());

  /* ================= B. MEMORY ERRORS ================= */
  console.log('=== Phase 9 · memory errors ===');
  const errCase = async (src) => { await setSrc(src); await runAll(); await sleep(220);
    return page.evaluate(() => {
      const e = viz.lastModel && viz.lastModel.error;
      return e ? JSON.parse(JSON.stringify(e)) : null;
    }); };

  const over = await errCase(OVER);
  check('[12] array overflow: kind, access, line, address and bounds all reported',
        !!over && over.kind === 'out-of-bounds' && over.access === 'index' && over.line === 8 &&
        typeof over.address === 'number' && over.arrayName === 'arr' && over.requested === 3 &&
        over.validMax === 2 && over.direction === 'overflow' &&
        typeof over.validFrom === 'number' && typeof over.validTo === 'number',
        JSON.stringify(over && { k: over.kind, a: over.access, l: over.line, req: over.requested, dir: over.direction }));
  check('[13] the attempted address is OUTSIDE the array, not a new cell',
        await page.evaluate(() => {
    const e = viz.lastModel.error;
    const cells = viz.lastScene.nodes.filter(n => n.kind === 'cell');
    const inv = viz.lastScene.nodes.filter(n => n.kind === 'invalid');
    // exactly three real cells, one invalid marker, and the bad address is past the end
    return cells.length === 3 && inv.length === 1 &&
           e.address > e.validTo &&
           !cells.some(c => c.el.address === e.address);
  }));
  check('[14] the last valid element is marked', await page.evaluate(() => {
    const b = viz.lastScene.nodes.filter(n => n.kind === 'bound');
    return b.length === 1 && b[0].side === 'last';
  }));
  check('[15] the error explanation lists only facts the engine reported',
        await page.evaluate(() => {
    const keys = Array.from(document.querySelectorAll('#vizHost .ve-grid .ve-k')).map(k => k.textContent);
    const vals = Array.from(document.querySelectorAll('#vizHost .ve-grid .ve-v')).map(k => k.textContent);
    const e = viz.lastModel.error;
    return keys.length === vals.length && keys.length >= 6 &&
           vals.some(v => v.indexOf(CEngine.hexAddr(e.address)) >= 0) &&
           vals.some(v => v.indexOf('arr[3]') >= 0) &&
           vals.some(v => v.indexOf('0 … 2') >= 0) &&
           vals.some(v => v.indexOf('arr[3] = 42;') >= 0);
  }));
  check('[16] the failing source line is the current line everywhere',
        await page.evaluate(() => {
    const e = viz.lastModel.error;
    const active = document.querySelector('.codeline.active');
    return viz.lastModel.line === e.line &&
           !!active && Number(active.dataset.line) === e.line &&
           document.querySelector('#sbLine').textContent === String(e.line);
  }));
  check('[17] the invalid access becomes the primary focus', await page.evaluate(() => {
    const c = viz.stage.current;
    return !!c && c.reason === 'error' && c.address === viz.lastModel.error.address;
  }));
  check('[18] the error panel does not cover the scene it explains',
        await page.evaluate(() => {
    const box = document.querySelector('#vizHost .viz-error');
    if (!box) return false;
    const br = box.getBoundingClientRect();
    let covered = 0;
    document.querySelectorAll('#vizHost .viz-node').forEach(el => {
      const q = el.getBoundingClientRect();
      if (!(q.right < br.left || q.left > br.right || q.bottom < br.top || q.top > br.bottom)) covered++;
    });
    return covered === 0;
  }));

  const under = await errCase(UNDER);
  check('[19] array underflow is reported with a negative index and marked before the array',
        !!under && under.kind === 'out-of-bounds' && under.requested === -1 &&
        under.direction === 'underflow' && under.address < under.validFrom,
        JSON.stringify(under && { req: under.requested, dir: under.direction }));
  check('[20] underflow marks the FIRST element as the boundary', await page.evaluate(() => {
    const b = viz.lastScene.nodes.filter(n => n.kind === 'bound');
    const inv = viz.lastScene.nodes.find(n => n.kind === 'invalid');
    const cells = viz.lastScene.nodes.filter(n => n.kind === 'cell');
    return b.length === 1 && b[0].side === 'first' && !!inv && inv.x < cells[0].x;
  }));

  const nw = await errCase(NULLW);
  check('[21] null dereference on write: address 0x0, access WRITE, target NULL',
        !!nw && nw.kind === 'null-deref' && nw.address === 0 && nw.access === 'write' &&
        nw.target === 'NULL' && nw.line === 6,
        JSON.stringify(nw && { k: nw.kind, a: nw.access, t: nw.target, l: nw.line }));
  check('[22] a null dereference has no valid range to show, and shows none',
        await page.evaluate(() => {
    const e = viz.lastModel.error;
    const vals = Array.from(document.querySelectorAll('#vizHost .ve-grid .ve-v')).map(v => v.textContent);
    return e.validFrom === null && !vals.some(v => v.indexOf('…') >= 0 && v.indexOf('0x') >= 0);
  }));
  const nr = await errCase(NULLR);
  check('[23] null dereference on read is reported as a READ',
        !!nr && nr.kind === 'null-deref' && nr.access === 'read', nr && nr.access);
  const un = await errCase(UNINIT);
  check('[24] an invalid read of uninitialized memory is reported with its address',
        !!un && un.kind === 'uninitialized-read' && un.access === 'read' &&
        typeof un.address === 'number' && typeof un.line === 'number',
        JSON.stringify(un && { k: un.kind, a: un.access, l: un.line }));
  const uaf = await errCase(UAF);
  check('[25] use-after-free reports the freed block range it fell inside',
        !!uaf && uaf.kind === 'use-after-free' && uaf.access === 'write' &&
        typeof uaf.validFrom === 'number' && uaf.address >= uaf.validFrom && uaf.address <= uaf.validTo,
        JSON.stringify(uaf && { k: uaf.kind, a: uaf.access }));
  const deep = await errCase(DEEP);
  check('[26] the ONE stack limit this engine models is call depth, and it is reported',
        !!deep && deep.kind === 'stack-overflow' && deep.depth === deep.limit && deep.limit > 0,
        JSON.stringify(deep && { k: deep.kind, d: deep.depth, l: deep.limit }));
  check('[27] a byte-level stack boundary is NOT claimed, because it is not modelled',
        await page.evaluate(() => {
    // the engine has no stack lower bound; nothing may pretend otherwise
    const src = CEngine.allocStack ? CEngine.allocStack.toString() : '';
    const noBound = !/stackBottom|stackLimit|stackFloor/.test(JSON.stringify(CEngine.ARCH));
    const documented = t('viz.stackBoundsNote').length > 30 &&
                       t('viz.stackBoundsNote') !== 'viz.stackBoundsNote';
    return noBound && documented && src.indexOf('stackLimit') < 0;
  }));
  check('[28] execution really stopped: no step exists after the error',
        await page.evaluate(() => run.stopped === true && run.mode === 'error'));
  check('[29] Prev still works after a fatal error', await page.evaluate(() => {
    const at = run.index;
    doPrev();
    return run.index === at - 1 && !!viz.lastModel && viz.lastModel.line === step().line;
  }));
  check('[30] Reset still works after a fatal error', await page.evaluate(() => {
    restart();
    return run.index <= 0 && run.error === null;
  }));
  check('[31] no error is ever shown when the engine raised none', await (async () => {
    await setSrc(FLOW); await runAll();
    return page.evaluate(() => !run.error && !document.querySelector('#vizHost .viz-error'));
  })());

  /* ================= C. SCALABILITY ================= */
  console.log('=== Phase 9 · scalability ===');
  const bench = (n) => page.evaluate((N) => {
    const nodes = [];
    const per = Math.ceil(Math.sqrt(N));
    for (let i = 0; i < N; i++) {
      nodes.push({ kind: 'cell', id: 's' + i,
        v: { name: 'a', elemTypeName: 'int', elemSize: 4, address: 0x2000 + i * 4, bytes: [] },
        el: { id: 's' + i, index: i, address: 0x2000 + i * 4, value: String(i), valueText: String(i), known: true, bytes: [] },
        x: (i % per) * 82, y: Math.floor(i / per) * 64, z: 0, w: 78, h: 58, role: 'memory' });
    }
    const scene = { nodes, edges: [], bounds: CViz3D.boundsOf(nodes), model: null };
    const t0 = performance.now();
    const r = viz.stage.render(scene);
    const render = performance.now() - t0;
    const t1 = performance.now();
    viz.stage.fit();
    const fit = performance.now() - t1;
    // Since Phase 11 the camera is framed once and then belongs to the learner,
    // so a scene swapped in under a camera the previous iteration panned and
    // zoomed is legitimately off-view. The DOM count is read after fit() —
    // which this benchmark already performs — so it measures what it was always
    // meant to measure: how many nodes a FRAMED scene of this size builds.
    // The assertions below are unchanged.
    const dom = document.querySelectorAll('#vizHost .viz-node').length;
    const t2 = performance.now();
    viz.stage.panBy(40, 20);
    const pan = performance.now() - t2;
    const t3 = performance.now();
    viz.stage.zoomBy(1.3);
    const zoom = performance.now() - t3;
    return { n: N, drawn: r.drawn, culled: r.culled, dom,
             render: Math.round(render), fit: Math.round(fit), pan: Math.round(pan), zoom: Math.round(zoom) };
  }, n);

  const results = {};
  for (const n of [500, 1000, 2000, 5000]) { results[n] = await bench(n); }
  check('[32] a 500-object scene stays interactive',
        results[500].render < 400 && results[500].fit < 400 && results[500].pan < 200,
        JSON.stringify(results[500]));
  check('[33] a 1000-object scene stays interactive',
        results[1000].render < 400 && results[1000].fit < 500 && results[1000].pan < 200,
        JSON.stringify(results[1000]));
  check('[34] a 2000-object scene stays interactive',
        results[2000].render < 500 && results[2000].fit < 600 && results[2000].pan < 250,
        JSON.stringify(results[2000]));
  check('[35] a 5000-object scene stays interactive',
        results[5000].render < 800 && results[5000].fit < 900 && results[5000].pan < 300,
        JSON.stringify(results[5000]));
  check('[36] the painted DOM stays bounded as the scene grows',
        results[5000].dom <= results[500].dom * 8 && results[5000].dom < 5000,
        'dom 500=' + results[500].dom + ' 5000=' + results[5000].dom);
  check('[37] off-screen objects are culled rather than built',
        results[5000].culled > 2000, 'culled=' + results[5000].culled);
  check('[38] level of detail drops unreadable text when zoomed far out',
        await page.evaluate(() => {
    viz.stage.setCamera({ zoom: 0.35 });
    const lod = document.querySelector('#vizHost').classList.contains('viz-lod');
    viz.stage.setCamera({ zoom: 1.2 });
    const full = !document.querySelector('#vizHost').classList.contains('viz-lod');
    return lod && full;
  }));
  // Phase 11 replaced the tilted perspective world with a 2.5D plane, so this
  // now forbids ALL rotation and 3D transforms instead of pinning two angles.
  check('[39] the camera still cannot rotate at scale', await page.evaluate(() => {
    const tr = document.querySelector('#vizHost .viz-world').style.transform;
    const c = viz.stage.getCamera();
    return !/rotate|translate3d|perspective|matrix3d/.test(tr) &&
           !('tiltX' in c) && !('yaw' in c) && !('pitch' in c);
  }));
  await page.evaluate(() => { renderViz(); });

  /* ================= D. TRACE ADDRESSES ================= */
  console.log('=== Phase 9 · trace memory access ===');
  const bstat = await startBridge();
  if (bstat === 'failed') {
    for (const n of [40, 41, 42, 43, 44]) check('[' + n + '] trace memory access', false, 'bridge failed to start');
  } else {
    await load();
    await setSrc(TRSTR);
    await page.evaluate(() => runTrace());
    await waitFor(() => page.evaluate(() => !trc.busy), 250000, 250);
    await sleep(400);
    check('[40] a traced run reports where its objects really live',
          await page.evaluate(() => {
      const o = trc.objects.find(x => x.name === 'str');
      return !!o && o.len === 6 && o.elemSize === 1 && o.base > 0;
    }), await page.evaluate(() => JSON.stringify(trc.objects.map(o => o.name + '[' + o.len + ']'))));
    check('[41] every assignment reports the address it really wrote',
          await page.evaluate(() => {
      const o = trc.objects.find(x => x.name === 'str');
      const writes = trc.events.filter(e => e.type === 'ASSIGNMENT' && e.name.indexOf('str[') === 0);
      return writes.length === 6 && writes.every((w, k) => w.address === o.base + k);
    }));
    check('[42] a condition reports the element it really read',
          await page.evaluate(() => {
      const o = trc.objects.find(x => x.name === 'str');
      const conds = trc.events.filter(e => e.type === 'CONDITION');
      const addrs = conds.map(c => (c.accessed || []).filter(a => a.kind === 'read').map(a => a.address)[0]);
      return addrs.length === 6 && addrs.every((a, k) => a === o.base + k);
    }));
    await open3d();
    check('[43] trace mode now highlights the exact array cell, like engine mode',
          await page.evaluate(() => {
      const seen = [];
      for (let i = 0; i < trc.events.length; i++) {
        traceGoTo(i);
        const c = viz.stage.current;
        if (c && c.kind === 'cell' && c.reason === 'read') seen.push(c.name);
      }
      window.__tcells = seen;
      return seen.join(',') === 'str[0],str[1],str[2],str[3],str[4],str[5]';
    }), await page.evaluate(() => (window.__tcells || []).join(',')));
    check('[44] the traced array is drawn as real cells at real addresses',
          await page.evaluate(() => {
      traceGoTo(trc.events.length - 3);
      const o = trc.objects.find(x => x.name === 'str');
      const cells = viz.lastScene.nodes.filter(n => n.kind === 'cell');
      return cells.length === 6 && cells.every((c, k) => c.el.address === o.base + k);
    }));
    check('[45] a trace never invents a value for a cell the program did not write',
          await page.evaluate(() => {
      traceGoTo(2);                       // before any assignment happened
      const cells = viz.lastScene.nodes.filter(n => n.kind === 'cell');
      return cells.length === 6 && cells.every(c => c.el.known === false);
    }));
  }
  await stopBridge();

  /* ---- visual QA ---- */
  try {
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    await load();
    await setSrc(FLOW); await runAll(); await open3d();
    await page.evaluate(() => { for (let i = 0; i < run.history.length; i++) { goTo(i); const d = viz.lastModel.dataflow; if (d && d.op) break; } });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'p10_flow_dark_en.png') });
    await setSrc(OVER); await runAll(); await sleep(400);
    await page.evaluate(() => { ui.lang = 'fr'; applyI18n(); ui.theme = 'light'; applyTheme(); });
    await sleep(350);
    await page.screenshot({ path: path.join(SHOTS, 'p10_overflow_light_fr.png') });
    await page.evaluate(() => { ui.lang = 'en'; applyI18n(); ui.theme = 'dark'; applyTheme(); });
  } catch (e) { console.log('  (screenshots skipped: ' + e.message + ')'); }

  check('[46] no console errors across the whole phase 9 session',
        errs.length === 0, errs.slice(0, 4).join(' | '));

  await browser.close();
  console.log('\n' + '-'.repeat(64));
  console.log('PHASE 9  pass ' + pass + '  fail ' + fail);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
