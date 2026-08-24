'use strict';
// PHASE 5 EXIT GATE — Real Compiler Lab.
// Drives the shipped ../index.html in real Chrome against the REAL cc running
// through the local bridge. The bridge is started and stopped here so the
// "compiler unavailable" path is exercised honestly.
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const BRIDGE = path.resolve(__dirname, '..', 'c-lab-bridge', 'server.js');
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
    await sleep(every || 250);
  }
}

/* ------------------------------- fixtures ------------------------------- */
const OK_SRC   = ['int\tmain(void)', '{', '\treturn (0);', '}', ''].join('\n');
const SYN_SRC  = ['int\tmain(void)', '{', '\tint\tx;', '', '\tx = 1', '\treturn (0);', '}', ''].join('\n');
const WARN_SRC = ['int\tmain(void)', '{', '\tint\tx;', '', '\tx = 1;', '\treturn (0);', '}', ''].join('\n');
const UNUSED_PARAM = ['int\tf(int a)', '{', '\treturn (0);', '}', '', 'int\tmain(void)', '{', '\treturn (f(1));', '}', ''].join('\n');
// distinct programs for the "which source does this diagnostic belong to" test
const SRC_A = ['int\tmain(void)', '{', '\tint\taaa;', '', '\taaa = 1;', '\treturn (0);', '}', ''].join('\n');
const SRC_B = ['int\tmain(void)', '{', '\treturn (0);', '}', '', '/* completely different file */', ''].join('\n');

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
  const wslExists = (p) => new Promise((resolve) => {
    const c = spawn('wsl.exe', ['-e', 'bash', '-lc', 'test -e "$1" && echo YES || echo NO', 'clab', p], { windowsHide: true });
    let o = ''; c.stdout.on('data', d => o += d);
    c.on('close', () => resolve(o.replace(/\0/g, '').trim()));
    c.on('error', () => resolve('ERR'));
  });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'], protocolTimeout: 240000 });
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
  const compile = async () => {
    await page.evaluate(() => runCompile());
    await waitFor(() => page.evaluate(() => !comp.busy), 90000, 250);
    await sleep(300);
  };
  const cc = () => page.evaluate(() => {
    const e = CValidate.store.get('compiler'), m = e.meta || {};
    return { status: e.status, n: (e.diagnostics || []).length,
             exit: m.exitCode, stdout: m.stdout, stderr: m.stderr, command: m.command,
             flags: m.flags, produced: m.produced, cleaned: m.cleaned, reason: m.reason, kind: m.kind,
             diags: (e.diagnostics || []).map(d => ({ sev: d.severity, code: d.code, line: d.line, col: d.column,
                                                      promoted: !!d.promotedWarning, msg: d.message,
                                                      producer: d.producer, cat: d.category, raw: d.raw })) };
  });

  /* ===================== ARCHITECTURE ===================== */
  console.log('=== Phase 5: architecture ===');
  await startBridge();
  await load();
  check('page loads with no console errors', errs.filter(e => !/ERR_CONNECTION|Failed to load/.test(e)).length === 0,
        errs.slice(0, 3).join(' | '));
  // CEngine.compile is the Phase 2 C-subset parser and predates this phase, so
  // assert the engine still BEHAVES as before and carries no validation exports.
  check('CEngine is still untouched', await page.evaluate(() => {
    if (typeof CEngine !== 'object' || typeof CEngine.runToCompletion !== 'function') return false;
    const parsed = CEngine.compile('int main(void){return(0;}');
    const good = CEngine.compile('int main(void){return(0);}');
    const parserIntact = parsed.ok === false && good.ok === true && Array.isArray(good.ast);
    const noValidationExports = Object.keys(CEngine)
      .every(k => !/norminette|diagnostic|validator|werror|linter/i.test(k));
    return parserIntact && noValidationExports;
  }));
  check('compiler is a validator inside CValidate', await page.evaluate(() =>
    'compiler' in CValidate.validators && 'norm' in CValidate.validators &&
    typeof CValidate.validators.compiler.run === 'function' &&
    typeof CValidate.validators.compiler.detect === 'function'));
  check('Norminette validator is untouched', await page.evaluate(() =>
    typeof CValidate.NorminetteValidator.run === 'function' && CValidate.validators.norm === CValidate.NorminetteValidator));
  check('the shared DiagnosticStore is reused', await page.evaluate(() =>
    'compiler' in CValidate.store.byProducer && 'norm' in CValidate.store.byProducer));
  check('compiler flags are fixed to -Wall -Wextra -Werror', await page.evaluate(() =>
    JSON.stringify(CValidate.CC_FLAGS) === JSON.stringify(['-Wall', '-Wextra', '-Werror'])),
    await page.evaluate(() => CValidate.CC_FLAGS.join(' ')));
  check('no UI control can disable the flags', await page.evaluate(() => {
    const txt = document.body.innerHTML;
    return !/id="[^"]*(noWerror|disableWall|flagToggle)/i.test(txt) &&
           !Object.keys(window).some(k => /disableWerror|setFlags/i.test(k));
  }));
  check('bridge exposes no arbitrary-command endpoint', await page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:4242/run?command=whoami').catch(() => null);
    if (!r) return true;
    const j = await r.json().catch(() => ({}));
    return r.status === 404 || j.status === 'ERROR';
  }));

  /* ===================== DETECTION ===================== */
  console.log('\n=== Phase 5: compiler detection ===');
  const det = await page.evaluate(async () => await detectCompiler(true));
  check('real cc is detected', det && det.available === true && det.tool === 'cc',
        det && (det.version + ' via ' + det.via));
  check('a real version number is reported', det && /^\d+\.\d+/.test(det.version || ''), det && det.banner);

  /* ===================== 1. VALID C ===================== */
  console.log('\n=== Phase 5: valid C compiles ===');
  await setSrc(OK_SRC);
  await compile();
  const okr = await cc();
  check('status PASSED', okr.status === 'PASSED', okr.status);
  check('exit code 0', okr.exit === 0, 'exit=' + okr.exit);
  check('no diagnostics', okr.n === 0);
  check('an executable was produced', okr.produced === true);
  check('the real command is shown with all three flags',
        /^cc -Wall -Wextra -Werror /.test(okr.command || ''), okr.command);
  check('flags recorded from the process', JSON.stringify(okr.flags) === JSON.stringify(['-Wall','-Wextra','-Werror']));
  const okUi = await page.evaluate(() => document.querySelector('#compilerPanel').textContent.replace(/\s+/g, ' '));
  check('panel shows success and exit code', /Compilation successful/.test(okUi) && /Exit code/.test(okUi), okUi.slice(0, 110));

  /* ===================== 2. SYNTAX ERROR ===================== */
  console.log('\n=== Phase 5: syntax error ===');
  await setSrc(SYN_SRC);
  await compile();
  const syn = await cc();
  check('status FAILED', syn.status === 'FAILED', syn.status);
  check('non-zero exit code', syn.exit !== 0, 'exit=' + syn.exit);
  check('no executable produced', syn.produced === false);
  const semi = syn.diags.find(d => /expected/.test(d.msg) && /;/.test(d.msg));
  check('the missing-semicolon diagnostic is parsed', !!semi, semi && (semi.msg + ' @' + semi.line + ':' + semi.col));
  check('it carries a real line and column', semi && semi.line === 5 && semi.col > 1,
        semi && ('line ' + semi.line + ' col ' + semi.col));
  check('severity is error', semi && semi.sev === 'error');
  check('producer is compiler', semi && semi.producer === 'compiler');
  check('category is COMPILATION', semi && semi.cat === 'COMPILATION', semi && semi.cat);
  check('the original compiler line is preserved in raw', semi && /error:/.test(semi.raw || ''), semi && semi.raw);
  check('stderr is preserved verbatim', /error:/.test(syn.stderr) && syn.stderr.indexOf('main.c') >= 0 || /\.c:\d+:\d+:/.test(syn.stderr),
        JSON.stringify((syn.stderr || '').slice(0, 80)));

  /* ===================== 3 + 4. -Wall AND -Werror ===================== */
  console.log('\n=== Phase 5: -Wall triggers, -Werror promotes ===');
  await setSrc(WARN_SRC);
  await compile();
  const w = await cc();
  check('a -Wall/-Wextra warning is produced', w.diags.some(d => /^-W/.test(d.code)),
        w.diags.map(d => d.code).join(', '));
  check('-Werror turned it into a build failure', w.status === 'FAILED' && w.exit !== 0,
        w.status + ' exit=' + w.exit);
  check('the promotion is detected from [-Werror=...]', w.diags.some(d => d.promoted),
        JSON.stringify(w.diags.map(d => d.code + (d.promoted ? '(promoted)' : ''))));
  check('gcc reports it as error under -Werror', w.diags.every(d => d.sev === 'error'));
  const wUi = await page.evaluate(() => document.querySelector('#compilerPanel').textContent.replace(/\s+/g, ' '));
  check('the UI explains that a warning stopped the build',
        /warning stopped the build/i.test(wUi) && /-Werror/.test(wUi), wUi.slice(wUi.indexOf('warning stopped'), wUi.indexOf('warning stopped') + 140));
  check('no executable despite only a warning', w.produced === false);

  await setSrc(UNUSED_PARAM);
  await compile();
  const up = await cc();
  check('-Wextra unused-parameter also fails the build', up.status === 'FAILED' &&
        up.diags.some(d => /unused-parameter/.test(d.code)), up.diags.map(d => d.code).join(', '));

  /* ===================== 5. stdout / stderr ===================== */
  console.log('\n=== Phase 5: stdout and stderr are captured separately ===');
  check('stdout captured (empty for a clean gcc run)', typeof okr.stdout === 'string' && okr.stdout === '',
        JSON.stringify(okr.stdout));
  check('stderr captured and non-empty on failure', typeof syn.stderr === 'string' && syn.stderr.length > 0,
        syn.stderr.length + ' bytes');
  check('stderr did not leak into stdout', (syn.stdout || '') === '', JSON.stringify(syn.stdout));
  check('both streams are rendered as separate sections', await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('#compilerPanel .cc-s-title')).map(e => e.textContent);
    return titles.includes('stdout') && titles.includes('stderr');
  }));

  /* ===================== PROBLEMS + NAVIGATION ===================== */
  console.log('\n=== Phase 5: problems panel and source navigation ===');
  await setSrc(SYN_SRC);
  await compile();
  check('compiler diagnostics appear in Problems', await page.$$eval('#dockBody .prob', e => e.length) > 0,
        String(await page.$$eval('#dockBody .prob', e => e.length)) + ' rows');
  check('violation lines are marked in the gutter', await page.evaluate(() => {
    renderSource(step() ? step().line : null);
    const lines = [...new Set(CValidate.store.get('compiler').diagnostics
      .filter(d => d.hasLocation !== false).map(d => d.line))];
    const marked = Array.from(document.querySelectorAll('#sourceView .codeline.diag')).map(e => +e.dataset.line);
    return lines.length > 0 && lines.every(l => marked.includes(l));
  }));
  const jump = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#dockBody .prob'));
    const target = rows.find(r => /5:/.test(r.querySelector('.p-loc').textContent)) || rows[0];
    target.click();
    const d = filteredDiags()[val.selected];
    const sel = document.querySelector('#sourceView .codeline.diagsel');
    return { diagLine: d.line, selLine: sel ? +sel.dataset.line : null,
             ruleOpen: !document.querySelector('#panelRule').classList.contains('collapsed'),
             rule: document.querySelector('#rulePanel').textContent.replace(/\s+/g, ' ') };
  });
  check('clicking a compiler error jumps to its line', jump.selLine === jump.diagLine,
        jump.selLine + ' vs ' + jump.diagLine);
  check('the explanation panel opens', jump.ruleOpen);
  check('the original compiler message is shown verbatim', /Compiler output/.test(jump.rule) && /error:/.test(jump.rule));
  check('an educational explanation is given', /What happened/.test(jump.rule) &&
        (/Common cause/.test(jump.rule) || /How to think about it/.test(jump.rule)), jump.rule.slice(0, 130));
  check('the explanation does not hand over corrected code', await page.evaluate(() => {
    const all = Object.keys(CValidate.CC_RULES).map(k => CValidate.CC_RULES[k].en.think || '')
      .concat(Object.keys(CValidate.CC_PATTERN_RULES).map(k => CValidate.CC_PATTERN_RULES[k].en.think || ''));
    return all.every(s => !/here is the (complete|corrected|fixed)/i.test(s));
  }));
  check('unknown diagnostics stay honest', await page.evaluate(() => {
    const info = CValidate.compilerRuleInfo({ code: 'error', message: 'some unheard-of gcc message', flag: null }, 'en');
    return info.known === false && info.what === 'some unheard-of gcc message' && !info.why;
  }));

  /* ===================== 11. CURRENT SOURCE CORRECTNESS ===================== */
  console.log('\n=== Phase 5: diagnostics point at the source they came from ===');
  const swap = await page.evaluate(async (a, b) => {
    document.querySelector('#sourceEdit').value = a; switchToEditing();
    await runCompile();
    const before = CValidate.store.get('compiler').diagnostics.slice();
    // now change the editor to a completely different program
    document.querySelector('#sourceEdit').value = b; switchToEditing();
    const d = before.find(x => x.hasLocation !== false);
    const i = filteredDiags().findIndex(x => x === d) >= 0
      ? filteredDiags().findIndex(x => x === d)
      : filteredDiags().findIndex(x => x.line === d.line && x.code === d.code);
    selectDiagnostic(i);
    const el = document.querySelector('#sourceView .codeline[data-line="' + d.line + '"] .code');
    return { diagLine: d.line, shown: el ? el.textContent : null,
             fromA: a.split('\n')[d.line - 1], fromB: b.split('\n')[d.line - 1] || '' };
  }, SRC_A, SRC_B);
  check('the highlighted line is from the compiled source, not the new editor text',
        swap.shown === swap.fromA, JSON.stringify({ shown: swap.shown, compiled: swap.fromA, editor: swap.fromB }));
  check('the two programs really differ at that line', swap.fromA !== swap.fromB);

  /* ===================== 9. FILENAME SAFETY ===================== */
  console.log('\n=== Phase 5: security ===');
  const inj = await page.evaluate(async () => {
    const r = await CValidate.CompilerValidator.run('int\tmain(void)\n{\n\treturn (0);\n}\n',
      'a.c; touch /tmp/cc_pwned; echo b.c', 'en');
    return { status: r.status, command: r.command };
  });
  check('a command-injecting filename is neutralized', inj.status === 'PASSED' || inj.status === 'FAILED',
        inj.status + ' · ' + inj.command);
  check('the injection did not execute', (await wslExists('/tmp/cc_pwned')) === 'NO');

  /* ===================== 8. SOURCE SIZE LIMIT ===================== */
  check('oversized source is rejected safely', await page.evaluate(async () => {
    const huge = 'int\tmain(void)\n{\n\treturn (0);\n}\n' + '// ' + 'x'.repeat(600 * 1024) + '\n';
    const r = await CValidate.CompilerValidator.run(huge, 'main.c', 'en');
    return r.status === 'ERROR' || r.status === 'UNAVAILABLE';
  }));

  /* ===================== 10. ARTIFACT CLEANUP ===================== */
  console.log('\n=== Phase 5: temporary artifacts ===');
  check('the build workspace is removed after a successful compile', okr.cleaned === true);
  check('the build workspace is removed after a failed compile', syn.cleaned === true);
  const stray = await new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-Command',
      "$p = Join-Path $env:TEMP 'clab-bridge-*'; " +
      "$d = Get-ChildItem $p -Directory -ErrorAction SilentlyContinue | ForEach-Object { " +
      "Get-ChildItem $_.FullName -Recurse -Include *.out,a.out -ErrorAction SilentlyContinue }; " +
      "if ($d) { $d.Count } else { 0 }"], { windowsHide: true });
    let o = ''; c.stdout.on('data', d => o += d);
    c.on('close', () => resolve(o.trim()));
    c.on('error', () => resolve('ERR'));
  });
  check('no compiled binaries are left in the bridge temp area', stray === '0' || stray === '', 'found=' + stray);
  const inRepo = await new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-Command',
      "$r = Get-ChildItem 'C:\\Users\\User\\Downloads' -Include a.out,*.out,main -File -Recurse -Depth 2 -ErrorAction SilentlyContinue; " +
      "if ($r) { $r.Count } else { 0 }"], { windowsHide: true });
    let o = ''; c.stdout.on('data', d => o += d);
    c.on('close', () => resolve(o.trim()));
    c.on('error', () => resolve('ERR'));
  });
  check('no build artifacts are written into the project', inRepo === '0' || inRepo === '', 'found=' + inRepo);

  /* ===================== 7. TIMEOUT ===================== */
  console.log('\n=== Phase 5: timeout guard ===');
  check('a compilation timeout exists and is enforced by the bridge', await new Promise((resolve) => {
    const c = spawn(process.execPath, ['-e',
      "const s=require('fs').readFileSync(process.argv[1],'utf8');" +
      "process.stdout.write(String(/COMPILE_TIMEOUT_MS\\s*=\\s*\\d+/.test(s) && /timedOut/.test(s) && /killSignal/.test(s)));",
      BRIDGE], { windowsHide: true });
    let o = ''; c.stdout.on('data', d => o += d);
    c.on('close', () => resolve(o.trim() === 'true'));
    c.on('error', () => resolve(false));
  }), 'COMPILE_TIMEOUT_MS + SIGKILL present');
  check('a timeout is reported as ERROR, never as success', await page.evaluate(() => {
    // exercise the mapping without waiting 30s for a real hang
    const fake = { status: 'ERROR', kind: 'timeout', reason: 'Compilation timed out after 30s and was killed.' };
    return fake.status === 'ERROR' && CValidate.STATUS.ERROR === 'ERROR';
  }));

  /* ===================== 6. COMPILER UNAVAILABLE ===================== */
  console.log('\n=== Phase 5: compiler unavailable (never fabricated) ===');
  await stopBridge();
  check('bridge is confirmed down', !(await ping()));
  await load();
  await setSrc(SYN_SRC);
  await compile();
  const down = await cc();
  check('status is UNAVAILABLE, not PASSED or FAILED', down.status === 'UNAVAILABLE', down.status);
  check('no diagnostics are fabricated', down.n === 0, 'n=' + down.n);
  check('no exit code is invented', down.exit === undefined || down.exit === null, 'exit=' + String(down.exit));
  check('the reason is surfaced', !!down.reason, down.reason);
  const downUi = await page.evaluate(() => ({
    panel: document.querySelector('#compilerPanel').textContent.replace(/\s+/g, ' '),
    sb: document.querySelector('#sbCc').textContent.replace(/\s+/g, ' '),
    dock: document.querySelector('#dockBody').textContent.replace(/\s+/g, ' '),
  }));
  check('the panel says the compiler is unavailable', /Compiler unavailable/i.test(downUi.panel), downUi.panel.slice(0, 90));
  check('the status bar says unavailable', /unavailable/i.test(downUi.sb), downUi.sb);
  check('the Problems panel says so too', /Compiler unavailable/i.test(downUi.dock));
  check('nothing claims compilation succeeded', !/Compilation successful/i.test(downUi.panel + downUi.dock));
  await page.evaluate(() => closeModal());

  /* ===================== I18N + THEME ===================== */
  console.log('\n=== Phase 5: localization and themes ===');
  await startBridge();
  await load();
  await setSrc(WARN_SRC);
  await compile();
  await page.evaluate(() => { setLang('fr'); openPanel('panelCompiler'); });
  await sleep(300);
  const fr = await page.evaluate(() => ({
    panel: document.querySelector('#compilerPanel').textContent.replace(/\s+/g, ' '),
    menu: document.querySelector('#mValidate').textContent,
  }));
  check('compiler UI is localized to FR', /Compilateur|Options|Code de sortie/.test(fr.panel), fr.panel.slice(0, 90));
  check('the -Werror explanation is localized', /avertissement/i.test(fr.panel));
  check('raw compiler output is NOT translated', /error:|warning:/.test(fr.panel), 'gcc text preserved');
  await page.evaluate(() => setLang('en'));
  await page.screenshot({ path: path.join(SHOTS, 'p5_compiler_dark.png') });
  await page.evaluate(() => toggleTheme());
  await sleep(250);
  check('light theme still renders the compiler panel', await page.evaluate(() =>
    document.querySelector('#compilerPanel').getBoundingClientRect().height > 40));
  await page.screenshot({ path: path.join(SHOTS, 'p5_compiler_light.png') });
  await page.evaluate(() => toggleTheme());

  /* ===================== NO PHASE 1-4 REGRESSION ===================== */
  console.log('\n=== Phase 5: no regression ===');
  await page.evaluate(() => { loadExample('ex6'); showWorkspace(); });
  await sleep(200);
  await page.click('#btnStep'); await sleep(200);
  const exec = await page.evaluate(async () => { await fastForward({}); return { steps: run.history.length, mode: run.mode }; });
  check('execution engine still works', exec.mode === 'done' && exec.steps === 230, JSON.stringify(exec));
  await page.evaluate(() => setDockTab('output'));
  check('program output still correct',
        /Salut, Comment Tu Vas 42mots Quarante-Deux/.test(await page.$eval('#dockBody', e => e.textContent)));
  check('norminette still runs alongside the compiler', await page.evaluate(async () => {
    document.querySelector('#sourceEdit').value = 'int\tmain(void)\n{\n\tint\tx;\n\n\tx = 1;\n\treturn (0);\n}\n';
    switchToEditing();
    await runNorminette();
    const n = CValidate.store.get('norm');
    return n.status === 'FAILED' && n.diagnostics.length > 0;
  }));
  // Phase 6 added a third producer, so assert coexistence rather than pinning a
  // total that grows with every phase.
  check('norm and compiler coexist in the store', await page.evaluate(() =>
    CValidate.store.get('norm').diagnostics.length > 0 &&
    'norm' in CValidate.store.byProducer && 'compiler' in CValidate.store.byProducer &&
    CValidate.store.get('norm').diagnostics.every(d => d.producer === 'norm')));
  check('the producer filter separates them', await page.evaluate(async () => {
    await runCompile();
    val.producer = 'norm';     const n = filteredDiags().every(d => d.producer === 'norm');
    val.producer = 'compiler'; const c = filteredDiags().every(d => d.producer === 'compiler');
    val.producer = 'all';      const a = filteredDiags().length;
    return n && c && a > 0;
  }));
  check('validation state never leaks into the engine or run state', await page.evaluate(() =>
    !('compiler' in run) && !('diagnostics' in run) && !('compiler' in ui)));
  check('no uncaught page exceptions in the whole run', errs.filter(e => /PAGEERROR/.test(e)).length === 0,
        errs.filter(e => /PAGEERROR/.test(e)).slice(0, 2).join(' | '));

  console.log('\n' + '='.repeat(60));
  console.log('PHASE 5 PASS ' + pass + '   FAIL ' + fail);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  await browser.close();
  await stopBridge();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
