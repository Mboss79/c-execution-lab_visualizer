'use strict';
// PHASE 7 EXIT GATE — Trace Analyzer.
//
// The trace is produced by instrumenting the learner's program, compiling the
// instrumented copy with the SAME real compiler command as Phase 5, running it,
// and replaying the events it wrote. These tests therefore assert observable
// behaviour of a real run — never the presence of the word "Trace".
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
function rawPost(url, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ host: '127.0.0.1', port: 4242, path: url, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let s = ''; res.on('data', d => s += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) {} resolve({ code: res.statusCode, json: j, text: s }); });
    });
    req.on('error', (e) => resolve({ code: 0, json: null, text: String(e.message) }));
    req.setTimeout(200000, () => { req.destroy(); resolve({ code: 0, json: null, text: 'timeout' }); });
    req.end(data);
  });
}
function rawGet(p) {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:4242' + p, (res) => {
      let s = ''; res.on('data', d => s += d);
      res.on('end', () => resolve({ code: res.statusCode, text: s }));
    });
    req.on('error', () => resolve({ code: 0, text: '' }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ code: 0, text: '' }); });
  });
}
async function waitFor(fn, ms, every) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(every || 250);
  }
}

const SRC_PRECEDENCE = ['int\tmain(void)', '{', '\tint\ta;', '\tint\tb;', '\tint\tc;', '\tint\tr;', '',
  '\ta = 2;', '\tb = 3;', '\tc = 4;', '\tr = a + b * c;', '\tr = r - a * b + c;', '\treturn (0);', '}', ''].join('\n');
const SRC_PRINT = ['#include <unistd.h>', '', 'int\tmain(void)', '{', '\tint\ti;', '',
  '\ti = 0;', '\twhile (i < 3)', '\t{', '\t\twrite(1, "x", 1);', '\t\ti++;', '\t}', '\treturn (0);', '}', ''].join('\n');
// Both variables are declared long before they hold a value: the trace must not
// show either of them until an assignment has actually been observed.
const SRC_UNASSIGNED = ['int\tmain(void)', '{', '\tint\ta;', '\tint\tb;', '', '\ta = 4;', '\tb = a;', '\treturn (b);', '}', ''].join('\n');
// Parses fine for the engine, but cc -Wall -Wextra -Werror refuses it
// (implicit declaration of ft_missing) — the realistic "my code does not build" case.
const SRC_CCFAIL = ['int\tmain(void)', '{', '\tint\ta;', '', '\ta = ft_missing(3);', '\treturn (a);', '}', ''].join('\n');
const SRC_UNUSED_WERROR = ['int\tmain(void)', '{', '\tint\tunusedvar;', '', '\tunusedvar = 3;', '\treturn (0);', '}', ''].join('\n');
const SRC_SLOW = ['int\tmain(void)', '{', '\tint\ti;', '', '\ti = 0;', '\twhile (i < 2000000000)', '\t{', '\t\ti++;', '\t}', '\treturn (0);', '}', ''].join('\n');
const SRC_CRASH = ['int\tmain(void)', '{', '\tint\t*p;', '\tint\tq;', '',
  '\tq = 1;', '\tp = 0;', '\t*p = q;', '\treturn (0);', '}', ''].join('\n');
const SRC_UNSUPPORTED = ['struct\ts_point', '{', '\tint\tx;', '};', '',
  'int\tmain(void)', '{', '\tstruct s_point\tp;', '', '\tp.x = 1;', '\treturn (0);', '}', ''].join('\n');

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
    await sleep(500);
    await page.evaluate(() => showWorkspace());
  };
  const setSrc = (s) => page.evaluate((src) => { document.querySelector('#sourceEdit').value = src; switchToEditing(); }, s);
  const trace = async () => {
    await page.evaluate(() => runTrace());
    await waitFor(() => page.evaluate(() => !trc.busy), 250000, 250);
    await sleep(300);
  };
  const snap = () => page.evaluate(() => ({
    status: trc.status, n: trc.events.length, index: trc.index, mode: ui.execMode,
    cleaned: trc.meta.cleaned, exeRemoved: trc.meta.executableRemoved,
    truncated: !!trc.meta.truncated, source: trc.source,
    run: trc.meta.run ? { wait: trc.meta.run.wait, stdout: trc.meta.run.stdout, exitCode: trc.meta.run.exitCode } : null,
    compileCmd: trc.meta.compile ? trc.meta.compile.command : null,
    types: trc.events.map(e => e.type),
  }));
  const events = () => page.evaluate(() => JSON.parse(JSON.stringify(trc.events)));

  /* ===================== 1. ARCHITECTURE ===================== */
  console.log('=== Phase 7 · architecture ===');
  await startBridge();
  await load();
  check('[1] page loads with no console errors',
        errs.filter(e => !/ERR_CONNECTION|Failed to load/.test(e)).length === 0, errs.slice(0, 3).join(' | '));
  check('[2] CTrace is a separate module, and the engine gained no trace API', await page.evaluate(() =>
    typeof CTrace === 'object' && typeof CTrace.instrument === 'function' &&
    typeof CTrace.parseTrace === 'function' && typeof CTrace.replay === 'function' &&
    Object.keys(CEngine).every(k => !/trace|instrument/i.test(k))));
  check('[3] the trace reuses the engine parser instead of adding a second one', await page.evaluate(() => {
    const before = CEngine.parseC.toString();
    const bad = CTrace.instrument('int main(void) { return (0; }');
    return bad.ok === false && bad.reason === 'parse' && CEngine.parseC.toString() === before;
  }));
  check('[4] the trace introduces no second memory system', await page.evaluate(() =>
    Object.keys(CTrace).every(k => !/memory|heap|stackAlloc|bytes/i.test(k)) &&
    typeof CEngine.Memory === 'function'));
  check('[5] there is ONE debugger: the existing controls are trace-aware', await page.evaluate(() =>
    [doStep, doPrev, doFirst, fastForward, restart, togglePlay].every(f => /traceActive/.test(f.toString()))));
  check('[6] the trace validator does not fork the compiler flags', await page.evaluate(() =>
    JSON.stringify(CValidate.CC_FLAGS) === JSON.stringify(['-Wall', '-Wextra', '-Werror'])));

  /* ===================== 2. SECURITY (must not regress) ===================== */
  console.log('=== Phase 7 · execution bridge security ===');
  const health = await rawGet('/health');
  check('[7] bridge protocol advertises the trace-capable version',
        health.code === 200 && JSON.parse(health.text).protocol >= 4, health.text.slice(0, 80));
  const bad1 = await rawGet('/run?command=whoami');
  const bad2 = await rawGet('/shell');
  const bad3 = await rawPost('/exec', { cmd: 'whoami' });
  check('[8] no arbitrary-command endpoints exist',
        bad1.code === 404 && bad2.code === 404 && bad3.code === 404,
        'run=' + bad1.code + ' shell=' + bad2.code + ' exec=' + bad3.code);
  check('[9] the action list is a fixed allowlist', await (async () => {
    const src = fs.readFileSync(BRIDGE, 'utf8');
    const m = src.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
    if (!m) return false;
    const acts = (m[1].match(/'(\/[a-z]+)'/g) || []).map(s => s.replace(/'/g, ''));
    return acts.length === 6 && acts.includes('/trace') &&
      !acts.some(a => /shell|exec|run\b|cmd/.test(a));
  })());
  check('[10] the trace never interpolates a filename into a shell string', (() => {
    const src = fs.readFileSync(BRIDGE, 'utf8');
    // every wsl invocation passes an args array; the script text is a constant
    const scripts = src.match(/const [A-Z_]+_SCRIPT = '[^']*';/g) || [];
    return scripts.length >= 2 && scripts.every(s => !/\$\{/.test(s)) &&
      /spawn\('wsl\.exe', \['-e', 'bash', '-lc'/.test(src);
  })());
  const trav = await rawPost('/trace', { filename: '../../evil.c', source: 'int main(void){return (0);}',
    instrumented: 'int main(void){return (0);}', traceFile: '../../evil.log', timeoutMs: 3000 });
  check('[11] a traversal filename never reaches the workspace path',
        trav.json && typeof trav.json.filename === 'string' &&
        !/[\\/]|\.\./.test(trav.json.filename) && /^[\w.-]+\.c$/.test(trav.json.filename),
        trav.json && trav.json.filename);
  check('[12] a traversal trace-file name is refused and replaced',
        !fs.existsSync(path.join(ROOT, '..', 'evil.log')) && !fs.existsSync(path.join(ROOT, 'evil.log')));
  const big = await rawPost('/trace', { filename: 'main.c', source: 'x'.repeat(600 * 1024),
    instrumented: 'int main(void){return (0);}' });
  // The body cap fires while the request is still streaming, so the bridge either
  // answers 413 or cuts the connection — either way no compiler process starts.
  check('[13] an oversized source is refused before any process starts, and the bridge survives',
        (big.code === 413 || big.code === 0) && (await ping()) === true,
        'code=' + big.code + ' ' + (big.json ? big.json.reason : big.text.slice(0, 60)));
  const nostdin = await rawPost('/trace', { filename: 'main.c', source: 'int main(void){return (0);}',
    instrumented: 'int main(void){return (0);}', stdin: 'y'.repeat(300 * 1024) });
  check('[14] an oversized stdin is refused',
        nostdin.json && nostdin.json.status === 'ERROR' && /stdin/i.test(nostdin.json.reason));

  /* ===================== 3. INSTRUMENTATION ===================== */
  console.log('=== Phase 7 · instrumentation ===');
  const inst = await page.evaluate((s) => {
    const r = CTrace.instrument(s);
    return { ok: r.ok, code: r.code, traceFile: r.traceFile };
  }, SRC_PRECEDENCE);
  check('[15] instrumentation produces a DIFFERENT program, not the learner file',
        inst.ok && inst.code !== SRC_PRECEDENCE && inst.code.indexOf('__clab_assign') > 0);
  check('[16] the instrumented copy declares its own logging helpers only',
        inst.ok && /__attribute__\(\(unused\)\) static/.test(inst.code) &&
        inst.code.indexOf('__clab_open') > 0 && inst.traceFile === '__clab_trace.log');
  check('[17] regenerated expressions carry explicit precedence, so meaning cannot drift',
        inst.ok && /\(r = \(a \+ \(b \* c\)\)\)/.test(inst.code) &&
        /\(r = \(\(r - \(a \* b\)\) \+ c\)\)/.test(inst.code),
        'a + b * c and r - a * b + c');

  await setSrc(SRC_PRECEDENCE);
  await trace();
  let s = await snap();
  let ev = await events();
  check('[18] the learner source is preserved byte-for-byte',
        s.source === SRC_PRECEDENCE, 'len ' + s.source.length + ' vs ' + SRC_PRECEDENCE.length);
  check('[19] the editor still holds the learner source after tracing',
        (await page.evaluate(() => document.querySelector('#sourceEdit').value)) === SRC_PRECEDENCE);
  const rAssign = ev.filter(e => e.type === 'ASSIGNMENT' && e.name === 'r');
  check('[20] observed values match real C precedence (a + b*c = 14, then r - a*b + c = 12)',
        rAssign.length === 2 && rAssign[0].value === '14' && rAssign[1].value === '12',
        JSON.stringify(rAssign.map(a => a.value)));
  check('[21] the compile command is the fixed Phase 5 command',
        /cc -Wall -Wextra -Werror/.test(s.compileCmd || ''), s.compileCmd);
  check('[22] the workspace and the executable are removed after the run',
        s.cleaned === true && s.exeRemoved === true, 'cleaned=' + s.cleaned + ' exe=' + s.exeRemoved);

  /* ===================== 4. EVENT MODEL ===================== */
  console.log('=== Phase 7 · event model ===');
  check('[23] nine typed event kinds are declared', await page.evaluate(() =>
    ['PROGRAM_START','LINE','ASSIGNMENT','CONDITION','LOOP_ITERATION','FUNCTION_CALL',
     'FUNCTION_RETURN','PROGRAM_END','ERROR'].every(k => k in CTrace.EVENT)));
  check('[24] event sequence numbers are strictly increasing',
        ev.length > 3 && ev.every((e, i) => i === 0 || e.seq > ev[i - 1].seq));
  check('[25] every event carries a real source line inside the file',
        ev.every(e => e.line >= 1 && e.line <= SRC_PRECEDENCE.split('\n').length),
        'lines ' + ev.map(e => e.line).join(','));

  await page.evaluate(() => { trc.demoId = 'demo-while'; loadTraceDemo(); });
  await trace();
  ev = await events();
  const conds = ev.filter(e => e.type === 'CONDITION');
  const iters = ev.filter(e => e.type === 'LOOP_ITERATION');
  check('[26] a while loop yields N true condition checks then one false',
        conds.length === 4 && conds.slice(0, 3).every(c => c.result === true) && conds[3].result === false,
        JSON.stringify(conds.map(c => c.result)));
  check('[27] loop iterations are numbered 1..N',
        iters.length === 3 && iters.map(i => i.iteration).join(',') === '1,2,3',
        JSON.stringify(iters.map(i => i.iteration)));
  check('[28] the loop variable is observed falling 3 → 0',
        ev.filter(e => e.type === 'ASSIGNMENT' && e.name === 'x').map(e => e.value).join(',') === '3,2,1,0',
        ev.filter(e => e.type === 'ASSIGNMENT').map(e => e.name + '=' + e.value).join(' '));

  await page.evaluate(() => { trc.demoId = 'demo-func'; loadTraceDemo(); });
  await trace();
  ev = await events(); s = await snap();
  const ret = ev.find(e => e.type === 'FUNCTION_RETURN' && e.fn === 'ft_double');
  check('[29] a call raises the observed depth and the matching return lowers it again', await page.evaluate(() => {
    const ci = trc.events.findIndex(e => e.type === 'FUNCTION_CALL' && e.fn === 'ft_double');
    const ri = trc.events.findIndex(e => e.type === 'FUNCTION_RETURN' && e.fn === 'ft_double');
    if (ci < 1 || ri < ci) return false;
    const before = CTrace.replay(trc.events, ci - 1).depth;
    const inside = CTrace.replay(trc.events, ci).depth;
    const after = CTrace.replay(trc.events, ri).depth;
    return inside === before + 1 && after === before;
  }));
  check('[30] the returned value is observed, not inferred',
        !!ret && ret.known === true && ret.value === '10', ret && ret.value);
  check('[31] PROGRAM_END carries the process exit code the OS actually reported',
        (() => { const end = ev.find(e => e.type === 'PROGRAM_END');
                 return end && Number(end.exitCode) === 10 && s.run.wait === 10; })(),
        's.run.wait=' + (s.run && s.run.wait));

  await page.evaluate(() => { trc.demoId = 'demo-nested'; loadTraceDemo(); });
  await trace();
  ev = await events();
  const nc = ev.filter(e => e.type === 'CONDITION');
  check('[32] the inner condition only appears after the outer one is true',
        nc.length === 2 && !!nc[0].result && ev.indexOf(nc[0]) < ev.indexOf(nc[1]),
        JSON.stringify(nc.map(c => c.expr + '=' + c.result)));

  /* ===================== 5. REPLAY — NO FABRICATION ===================== */
  console.log('=== Phase 7 · replay and honesty ===');
  await setSrc(SRC_UNASSIGNED);
  await trace();
  const observed = await page.evaluate(() => {
    const firstA = trc.events.findIndex(e => e.type === 'ASSIGNMENT' && e.name === 'a');
    return { firstA,
      before: firstA > 0 ? CTrace.replay(trc.events, firstA - 1).variables.map(v => v.name + '=' + v.value) : null,
      after: firstA >= 0 ? CTrace.replay(trc.events, firstA).variables.map(v => v.name + '=' + v.value) : null,
      status: trc.status };
  });
  check('[33] a variable is only shown once an assignment has been OBSERVED',
        observed.firstA > 0 && !observed.before.some(x => x.startsWith('a=')) &&
        observed.after.indexOf('a=4') >= 0,
        JSON.stringify(observed));
  check('[34] replay is a pure function of the event list, not of navigation order', await page.evaluate(() => {
    const k = Math.min(3, trc.events.length - 1);
    const direct = JSON.stringify(CTrace.replay(trc.events, k));
    traceLast(); traceFirst(); traceGoTo(k);
    return JSON.stringify(CTrace.replay(trc.events, k)) === direct;
  }));
  check('[35] an unobservable value is marked unknown instead of invented', await page.evaluate(() => {
    // a side-effecting lvalue cannot be safely re-read, so it must log known=0
    const r = CTrace.instrument(['int\tmain(void)', '{', '\tint\ta[3];', '\tint\ti;', '',
      '\ti = 0;', '\ta[i++] = 5;', '\treturn (0);', '}', ''].join('\n'));
    // Phase 9 added an address and a size to the record. The intent is
    // unchanged and now checked harder: value unknown, NO address taken, and
    // the side-effecting expression never re-evaluated for logging.
    if (!r.ok) return false;
    const line = r.code.split('\n').find(l => l.indexOf('__clab_assign(7,') >= 0) || '';
    return line.indexOf('"a[i++]"') >= 0 &&
           line.indexOf(', 0, 0, (const void *)0, 0);') >= 0 &&
           (line.match(/i\+\+/g) || []).length === 1;
  }));
  check('[36] the UI renders an unknown value as unknown, never as a number', await page.evaluate(() => {
    const e = { seq: 0, type: 'ASSIGNMENT', line: 1, depth: 1, fn: 'main', name: 'z', varType: 'int', value: '0', known: 0 };
    const st = CTrace.replay([{ seq: 0, type: 'PROGRAM_START', line: 1, depth: 0, fn: 'main' }, e], 1);
    const v = st.variables.find(x => x.name === 'z');
    return v && v.known === false;
  }));

  /* ===================== 6. TOOLBAR = SAME DEBUGGER ===================== */
  console.log('=== Phase 7 · debugger integration ===');
  await page.evaluate(() => { trc.demoId = 'demo-for'; loadTraceDemo(); });
  await trace();
  const total = (await snap()).n;
  check('[37] Step advances the TRACE while trace mode is active', await page.evaluate(() => {
    traceFirst(); const a = trc.index, e = run.index; doStep(); doStep();
    return trc.index === a + 2 && run.index === e;
  }));
  check('[38] Prev and First drive the trace', await page.evaluate(() => {
    doPrev(); const p = trc.index; doFirst(); return p >= 0 && trc.index === 0;
  }));
  check('[39] To-end jumps to the last observed event, never past it', await page.evaluate(() => {
    fastForward({}); return trc.index === trc.events.length - 1;
  }));
  check('[40] Reset returns to the first event without re-running the program', await page.evaluate(() => {
    const n = trc.events.length; restart(); return trc.index === 0 && trc.events.length === n;
  }));
  check('[41] the toolbar readout reflects the trace position', await page.evaluate(() => {
    traceGoTo(2);
    return document.querySelector('#stepReadout').textContent.replace(/\s/g, '') === '3/' + trc.events.length;
  }));
  check('[42] the mode pill states this is a real traced run, not an interpretation', await page.evaluate(() =>
    document.querySelector('#modePill').classList.contains('mode-trace') &&
    document.querySelector('#modePill').textContent.length > 0));
  check('[43] the status bar shows the trace position', await page.evaluate(() =>
    /\d+\s*\/\s*\d+/.test(document.querySelector('#sbTrace').textContent)));

  /* ===================== 7. UI BEHAVIOUR ===================== */
  console.log('=== Phase 7 · UI behaviour ===');
  check('[44] the event list is virtualized, not fully materialized', await page.evaluate(() => {
    setDockTab('trace');
    const rows = document.querySelectorAll('#dockBody .tr-item').length;
    return trc.events.length > 20 && rows > 0 && rows < trc.events.length;
  }), '' );
  check('[45] clicking an event row moves the trace and the highlighted line', await page.evaluate(() => {
    setDockTab('trace'); traceFirst();
    const row = document.querySelectorAll('#dockBody .tr-item')[4];
    if (!row) return false;
    row.click();
    const hi = document.querySelector('.codeline.trace-line');
    return trc.index === Number(row.dataset.tri) && !!hi && Number(hi.dataset.line) === traceLine();
  }));
  check('[46] the trace panel substitutes observed values into the condition', await page.evaluate(() => {
    const i = trc.events.findIndex(e => e.type === 'CONDITION');
    if (i < 0) return false;
    traceGoTo(i);
    const txt = document.querySelector('#tracePanel .tr-reason').textContent;
    const e = trc.events[i];
    const sub = CTrace.substituted(e.expr, CTrace.replay(trc.events, i).variables);
    return !!sub && txt.indexOf(sub) >= 0 && txt.indexOf(e.expr) >= 0;
  }));
  check('[47] the panel states the consequence of the condition (branch taken)', await page.evaluate(() => {
    const t1 = document.querySelector('#tracePanel .tr-r-next');
    return !!t1 && t1.textContent.trim().length > 3;
  }));
  check('[48] the panel reuses the existing variable row component', await page.evaluate(() =>
    document.querySelectorAll('#tracePanel .tr-vars .var .v-name').length > 0));
  check('[49] the call stack is shown from the observed depth', await page.evaluate(() =>
    document.querySelectorAll('#tracePanel .tr-stack .tr-frame').length >= 1));
  check('[50] the Program output tab shows the REAL executable stdout', await (async () => {
    await setSrc(SRC_PRINT);
    await trace();
    return page.evaluate(() => {
      setDockTab('output');
      return trc.meta.run.stdout === 'xxx' && document.querySelector('#dockBody').textContent.indexOf('xxx') >= 0;
    });
  })());
  check('[51] editing the source leaves trace mode so a stale trace cannot be navigated', await page.evaluate(() => {
    switchToEditing();
    return ui.execMode === 'engine' && traceActive() === false;
  }));
  await setSrc(SRC_UNASSIGNED);
  check('[52] leaving trace mode restores the engine debugger', await page.evaluate(() => {
    doStep();                       // engine mode: this must compile and step the engine
    return ui.execMode === 'engine' && run.index >= 0 && run.history !== null;
  }));

  /* ===================== 8. DEMOS ===================== */
  console.log('=== Phase 7 · demo programs ===');
  check('[53] seven demo programs cover the required constructs', await page.evaluate(() => {
    const ids = CTrace.DEMOS.map(d => d.id);
    return ['demo-assign','demo-if','demo-while','demo-for','demo-func','demo-nested','demo-loopfunc']
      .every(i => ids.includes(i));
  }));
  check('[54] every demo is labelled DEMO in both languages and keeps an exercise slot', await page.evaluate(() =>
    CTrace.DEMOS.every(d => d.demo === true && 'exercise' in d && d.exercise === null &&
      /^DEMO/.test(d.name.en) && /^D[EÉ]MO/.test(d.name.fr))));
  check('[55] loading a demo fills the editor and does not silently execute it', await page.evaluate(() => {
    trc.demoId = 'demo-if'; loadTraceDemo();
    const d = CTrace.DEMOS.find(x => x.id === 'demo-if');
    return document.querySelector('#sourceEdit').value === d.program &&
           trc.events.length === 0 && trc.status === CTrace.STATUS.NOT_RUN;
  }));

  /* ===================== 9. EN / FR ===================== */
  console.log('=== Phase 7 · EN / FR ===');
  await page.evaluate(() => { trc.demoId = 'demo-if'; loadTraceDemo(); });
  await trace();
  const en = await page.evaluate(() => {
    const i = trc.events.findIndex(e => e.type === 'CONDITION');
    ui.lang = 'en'; applyI18n(); traceGoTo(i);
    return { panel: document.querySelector('#tracePanel').textContent,
             dock: (setDockTab('trace'), document.querySelector('#dockBody').textContent),
             sb: document.querySelector('#sbTrace').textContent };
  });
  const fr = await page.evaluate(() => {
    const i = trc.events.findIndex(e => e.type === 'CONDITION');
    ui.lang = 'fr'; applyI18n(); traceGoTo(i);
    return { panel: document.querySelector('#tracePanel').textContent,
             dock: (setDockTab('trace'), document.querySelector('#dockBody').textContent),
             sb: document.querySelector('#sbTrace').textContent };
  });
  check('[56] the trace panel is genuinely translated, not merely re-rendered',
        en.panel !== fr.panel && /VRAI|FAUX/.test(fr.panel) && /TRUE|FALSE/.test(en.panel));
  check('[57] the event list is translated too', en.dock !== fr.dock);
  check('[58] the teaching explanation exists in both languages', await page.evaluate(() => {
    const e = trc.events.find(x => x.type === 'CONDITION');
    const a = CTrace.explain(e, 'en'), b = CTrace.explain(e, 'fr');
    return a && b && a.what && b.what && a.what !== b.what && a.why !== b.why && a.look !== b.look;
  }));
  check('[59] every trace event type has an explanation in both languages', await page.evaluate(() =>
    Object.keys(CTrace.EVENT).every(k => CTrace.EXPLAIN[k] &&
      CTrace.EXPLAIN[k].en && CTrace.EXPLAIN[k].fr &&
      CTrace.EXPLAIN[k].en.what && CTrace.EXPLAIN[k].fr.what)));
  await page.evaluate(() => { ui.lang = 'en'; applyI18n(); });

  /* ===================== 10. FAILURE PATHS ===================== */
  console.log('=== Phase 7 · failure paths ===');
  await setSrc(SRC_CCFAIL);
  await trace();
  s = await snap();
  check('[60] a build failure is reported as COMPILE_FAILED with no fabricated events',
        s.status === 'COMPILE_FAILED' && s.n === 0, s.status + ' n=' + s.n);
  check('[61] the build failure reuses the Phase 5 compiler diagnostics', await page.evaluate(() => {
    const e = CValidate.store.get('compiler');
    return e.status === CValidate.STATUS.FAILED && e.diagnostics.length > 0 &&
           e.diagnostics.every(d => d.producer === 'compiler' && d.line >= 1);
  }));
  await setSrc(SRC_UNUSED_WERROR);
  await trace();
  s = await snap();
  check('[62] -Werror still stops the trace: the gate is not weakened to make tracing work',
        s.status === 'COMPILE_FAILED' && s.n === 0, s.status);

  await setSrc(SRC_UNSUPPORTED);
  await trace();
  s = await snap();
  check('[63] a construct the instrumenter cannot handle is declared UNSUPPORTED, not faked',
        s.status === 'UNSUPPORTED' && s.n === 0, s.status + ' n=' + s.n);
  check('[64] the unsupported notice tells the learner what happened', await page.evaluate(() =>
    document.querySelector('#tracePanel, #traceOutcome') &&
    (document.querySelector('#tracePanel').textContent + document.querySelector('#traceOutcome').textContent).length > 20));
  check('[65] the source is untouched after an unsupported attempt',
        (await page.evaluate(() => document.querySelector('#sourceEdit').value)) === SRC_UNSUPPORTED);

  await setSrc(SRC_CRASH);
  await trace();
  s = await snap();
  ev = await events();
  check('[66] a crashing program is reported as CRASHED, not as a clean finish',
        s.status === 'CRASHED', s.status + ' wait=' + (s.run && s.run.wait));
  check('[67] the events written before the crash survive and no PROGRAM_END is invented',
        ev.length > 0 && !ev.some(e => e.type === 'PROGRAM_END'),
        ev.length + ' events, types ' + ev.map(e => e.type).join(','));
  check('[68] a crashed run still cleans its workspace and executable',
        s.cleaned === true && s.exeRemoved === true);

  await setSrc(SRC_SLOW);
  await trace();
  s = await snap();
  check('[69] a runaway program is stopped by the timeout and labelled TIMEOUT',
        s.status === 'TIMEOUT', s.status + ' wait=' + (s.run && s.run.wait));
  check('[70] a timed-out trace reports no exit code rather than the timeout tool code', await page.evaluate(() =>
    trc.meta.run && (trc.meta.run.exitCode === null || trc.meta.run.exitCode === undefined)));
  check('[71] the timed-out run is cleaned up too', s.cleaned === true && s.exeRemoved === true);
  check('[72] an over-long trace is flagged as truncated instead of silently cut', await page.evaluate(() =>
    CTrace.MAX_EVENTS > 0 && CTrace.parseTrace('E\t5\tOVERFLOW\t1\t0\tmain\n').truncated === true));

  /* ===================== 11. BRIDGE UNAVAILABLE ===================== */
  console.log('=== Phase 7 · bridge unavailable ===');
  await stopBridge();
  await load();
  await setSrc(SRC_UNASSIGNED);
  await trace();
  s = await snap();
  check('[73] with no bridge the trace is UNAVAILABLE and nothing is simulated',
        s.status === 'UNAVAILABLE' && s.n === 0, s.status + ' n=' + s.n);
  check('[74] the unavailable state explains how to enable it', await page.evaluate(() =>
    (document.querySelector('#tracePanel').textContent + document.body.textContent).indexOf('node') >= 0 ||
    document.querySelector('#modalRoot').textContent.length > 0));
  await startBridge();

  /* ===================== 12. SCOPE BOUNDARY ===================== */
  console.log('=== Phase 7 · scope boundary ===');
  await load();
  check('[75] Exam Mode is declared but not yet built (the next boundary)', await page.evaluate(() => {
    const learn = MENUS.mLearn();
    const exam = learn.find(i => i && i.n === 'Exam Mode');
    const tr = learn.find(i => i && i.n === 'Trace Analyzer');
    return !!exam && exam.disabled === true && !!tr && !tr.disabled && typeof tr.a === 'function';
  }));
  check('[76] the Validate menu runs the real trace', await page.evaluate(() => {
    const v = MENUS.mValidate();
    return v.some(i => i && i.a === runTrace) && v.some(i => i && i.a === loadTraceDemo);
  }));
  check('[77] F3 is bound to the trace and no existing binding was taken', await page.evaluate(() =>
    commands().some(c => c.k === 'F3' && c.a === runTrace) &&
    commands().filter(c => c.k === 'F3').length === 1));

  /* ---- visual QA shots ---- */
  try {
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => { trc.demoId = 'demo-loopfunc'; loadTraceDemo(); });
    await trace();
    await page.evaluate(() => { setDockTab('trace'); openPanel('panelTrace'); traceGoTo(6); });
    await sleep(250);
    await page.screenshot({ path: path.join(SHOTS, 'p7_trace_dark_en.png') });
    await page.evaluate(() => { ui.lang = 'fr'; applyI18n(); ui.theme = 'light'; applyTheme(); });
    await sleep(250);
    await page.screenshot({ path: path.join(SHOTS, 'p7_trace_light_fr.png') });
  } catch (e) { console.log('  (screenshots skipped: ' + e.message + ')'); }

  const realErrs = errs.filter(e => !/ERR_CONNECTION|Failed to load|net::/.test(e));
  check('[78] no console errors accumulated across the whole phase 7 session',
        realErrs.length === 0, realErrs.slice(0, 4).join(' | '));

  await browser.close();
  await stopBridge();

  console.log('\n' + '-'.repeat(64));
  console.log('PHASE 7  pass ' + pass + '  fail ' + fail);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
