'use strict';
// PHASE 6 EXIT GATE — Real Test / Moulinette-style Lab.
// Compiles with the Phase 5 command and executes the REAL binary through the
// existing bridge. Starts/stops the bridge itself so the unavailable path is
// exercised honestly.
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
const BAD_BUILD = ['int\tmain(void)', '{', '\treturn (0)', '}', ''].join('\n');

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
  const runTests = async () => {
    await page.evaluate(() => runTests());
    await waitFor(() => page.evaluate(() => !tst.busy), 200000, 250);
    await sleep(350);
  };
  const useSuite = async (id) => {
    await page.evaluate((sid) => { tst.suiteId = sid; loadSuiteProgram(); }, id);
    await sleep(200);
  };
  const ts = () => page.evaluate(() => {
    const e = CValidate.store.get('tests'), m = e.meta || {};
    return { status: e.status, summary: m.summary, compileFailed: !!m.compileFailed,
             cleaned: m.cleaned, exeRemoved: m.executableRemoved, reason: m.reason,
             cases: (m.cases || []).map(c => ({ id: c.id, name: c.name, status: c.status,
               exitCode: c.exitCode, durationMs: c.durationMs, signal: c.signal,
               stdout: c.stdout, stderr: c.stderr, stdin: c.stdin,
               expected: c.expectedStdout, compare: c.compare,
               failed: (c.failed || []).map(f => f.what), help: c.help ? c.help.kind : null })) };
  });

  /* ===================== ARCHITECTURE ===================== */
  console.log('=== Phase 6: architecture ===');
  await startBridge();
  await load();
  check('page loads with no console errors',
        errs.filter(e => !/ERR_CONNECTION|Failed to load/.test(e)).length === 0, errs.slice(0, 3).join(' | '));
  check('CEngine remains untouched', await page.evaluate(() => {
    const bad = CEngine.compile('int main(void){return(0;}'), good = CEngine.compile('int main(void){return(0);}');
    return bad.ok === false && good.ok === true &&
      Object.keys(CEngine).every(k => !/test|moulinette|runner|validator/i.test(k));
  }));
  check('tests is a validator inside the existing CValidate', await page.evaluate(() =>
    'tests' in CValidate.validators && typeof CValidate.validators.tests.run === 'function' &&
    'norm' in CValidate.validators && 'compiler' in CValidate.validators));
  check('the shared DiagnosticStore carries the tests producer', await page.evaluate(() =>
    'tests' in CValidate.store.byProducer));
  check('all six result statuses are defined', await page.evaluate(() =>
    ['PASS','FAIL','COMPILE_FAILED','TIMEOUT','CRASHED','ERROR'].every(s => s in CValidate.TEST_STATUS)));
  check('three comparison modes exist', await page.evaluate(() =>
    ['exact','trim','lines'].every(m => m in CValidate.COMPARE)));
  check('there is still no second compiler system', await page.evaluate(() =>
    CValidate.validators.tests.describe.indexOf('-Wall -Wextra -Werror') >= 0 &&
    JSON.stringify(CValidate.CC_FLAGS) === JSON.stringify(['-Wall','-Wextra','-Werror'])));
  check('demo suites are labelled DEMO, not official', await page.evaluate(() =>
    CValidate.DEMO_SUITES.length >= 3 && CValidate.DEMO_SUITES.every(s => s.demo === true && /^DEMO/.test(s.name))));
  check('suites carry an exercise slot for a later phase', await page.evaluate(() =>
    CValidate.DEMO_SUITES.every(s => 'exercise' in s)));

  /* ===================== COMPARISON ENGINE (pure) ===================== */
  console.log('\n=== Phase 6: comparison modes ===');
  const cmp = await page.evaluate(() => {
    const C = CValidate.compareOutput;
    return {
      exactStrict:  C('hi\n', 'hi \n', 'exact').equal,
      trimForgives: C('hi  \n', 'hi\n', 'trim').equal,
      trimTrailing: C('a\nb\n\n\n', 'a\nb\n', 'trim').equal,
      linesTrailing: C('a\nb\n\n', 'a\nb', 'lines').equal,
      caseMatters:  C('Hello world!\n', 'Hello World!\n', 'trim').equal,
      diff:         C('Hello world!\n', 'Hello World!\n', 'trim'),
      identical:    C('same\n', 'same\n', 'exact').equal,
    };
  });
  check('exact mode is byte-strict', cmp.exactStrict === false);
  check('trim mode forgives trailing whitespace', cmp.trimForgives === true);
  check('trim mode forgives trailing blank lines', cmp.trimTrailing === true);
  check('lines mode ignores trailing blank lines', cmp.linesTrailing === true);
  check('case differences are never forgiven', cmp.caseMatters === false);
  check('identical output compares equal', cmp.identical === true);
  check('the first difference is located precisely',
        cmp.diff.line === 1 && cmp.diff.column === 7, 'line ' + cmp.diff.line + ' col ' + cmp.diff.column);
  check('both differing lines are reported',
        cmp.diff.expectedLine === 'Hello World!' && cmp.diff.actualLine === 'Hello world!',
        JSON.stringify({ e: cmp.diff.expectedLine, a: cmp.diff.actualLine }));

  /* ===================== REAL EXECUTION: PASS ===================== */
  console.log('\n=== Phase 6: real execution — all cases pass ===');
  await useSuite('demo-echo');
  await runTests();
  const echo = await ts();
  check('suite status PASSED', echo.status === 'PASSED', echo.status);
  check('every case passed', echo.summary.passed === echo.summary.total && echo.summary.total === 3,
        echo.summary.passed + '/' + echo.summary.total);
  check('stdin was really delivered', echo.cases[0].stdout === 'hello\n', JSON.stringify(echo.cases[0].stdout));
  check('empty stdin is handled', echo.cases[1].status === 'PASS' && echo.cases[1].stdout === '');
  check('multi-line stdin echoes back', echo.cases[2].stdout === 'a\nb\nc\n', JSON.stringify(echo.cases[2].stdout));
  check('each case reports a real duration', echo.cases.every(c => c.durationMs >= 0 && c.durationMs < 20000),
        echo.cases.map(c => c.durationMs + 'ms').join(', '));
  check('exit codes are captured', echo.cases.every(c => c.exitCode === 0));

  /* ===================== FAIL WITH A READABLE DIFF ===================== */
  console.log('\n=== Phase 6: wrong output ===');
  await useSuite('demo-hello');
  await runTests();
  const hello = await ts();
  check('a correct case passes and a wrong-case one fails',
        hello.summary.passed === 1 && hello.summary.total === 2, hello.summary.passed + '/' + hello.summary.total);
  const wrong = hello.cases.find(c => c.status === 'FAIL');
  check('the failing case is FAIL (not CRASHED or TIMEOUT)', !!wrong, wrong && wrong.status);
  check('the program really ran and produced output', wrong && wrong.stdout === 'Hello World!\n',
        wrong && JSON.stringify(wrong.stdout));
  check('stdout is the failing check', wrong && wrong.failed.indexOf('stdout') >= 0, wrong && wrong.failed.join(','));
  check('the failure is explained as wrong output', wrong && wrong.help === 'WRONG_OUTPUT', wrong && wrong.help);
  const diffUi = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#dockBody .ts-row'));
    const f = rows.find(r => /FAIL/.test(r.textContent));
    f.click();
    return document.querySelector('#testPanel').textContent.replace(/\s+/g, ' ');
  });
  await sleep(200);
  check('the UI shows expected vs actual', /Expected/.test(diffUi) && /Actual/.test(diffUi), diffUi.slice(0, 110));
  check('the UI shows the first difference position', /First difference/.test(diffUi));
  check('the explanation says what to inspect', /What to inspect/.test(diffUi));
  check('no corrected code is handed over', await page.evaluate(() => {
    const H = CValidate.TEST_HELP;
    return Object.keys(H).every(k => !/here is the (correct|fixed|complete)/i.test(H[k].en.inspect || ''));
  }));

  /* ===================== TIMEOUT + CRASH ===================== */
  console.log('\n=== Phase 6: timeout and crash ===');
  await useSuite('demo-modes');
  await runTests();
  const modes = await ts();
  const ok  = modes.cases.find(c => c.id === 'm0');
  const to  = modes.cases.find(c => c.id === 'm1');
  const cr  = modes.cases.find(c => c.id === 'm2');
  check('the normal case still passes', ok && ok.status === 'PASS', ok && ok.status);
  check('an endless loop is TIMEOUT', to && to.status === 'TIMEOUT', to && to.status);
  check('the timed-out process was actually killed', to && to.durationMs >= 1500 && to.durationMs < 12000,
        to && (to.durationMs + 'ms'));
  check('a timeout reports no exit code (124 is timeout, not the program)',
        to && to.exitCode === null, to && String(to.exitCode));
  check('the timeout explanation covers loops and blocked reads', to && to.help === 'TIMEOUT', to && to.help);
  check('a null dereference is CRASHED', cr && cr.status === 'CRASHED', cr && cr.status);
  check('the signal is reported', cr && cr.signal === 11, cr && ('signal ' + cr.signal));
  check('a crash reports no exit code', cr && cr.exitCode === null, cr && String(cr.exitCode));
  check('the crash explanation is evidence-based', cr && cr.help === 'CRASHED', cr && cr.help);
  const crashUi = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#dockBody .ts-row'));
    rows.find(r => /CRASHED/.test(r.textContent)).click();
    return document.querySelector('#testPanel').textContent.replace(/\s+/g, ' ');
  });
  await sleep(150);
  check('the UI names the signal', /SIGSEGV/.test(crashUi), crashUi.slice(0, 90));

  /* ===================== COMPILE FAILURE ===================== */
  console.log('\n=== Phase 6: compilation failure blocks execution ===');
  await setSrc(BAD_BUILD);
  await runTests();
  const cf = await ts();
  check('suite reports the build failed', cf.compileFailed === true);
  check('no case was executed', cf.cases.every(c => c.status === 'COMPILE_FAILED'),
        cf.cases.map(c => c.status).join(','));
  check('nothing reports a duration', cf.cases.every(c => c.durationMs == null || c.durationMs === 0));
  check('the explanation says nothing ran', cf.cases[0] && cf.cases[0].help === 'COMPILE_FAILED');
  check('compiler diagnostics flow into the existing Problems system', await page.evaluate(() => {
    const c = CValidate.store.get('compiler');
    return c.status === 'FAILED' && c.diagnostics.length > 0 && c.diagnostics.every(d => d.producer === 'compiler');
  }), await page.evaluate(() => CValidate.store.get('compiler').diagnostics.map(d => d.code).join(',')));
  check('those diagnostics still navigate to the source', await page.evaluate(() => {
    setDockTab('problems');
    const row = document.querySelector('#dockBody .prob');
    if (!row) return false;
    row.click();
    const d = filteredDiags()[val.selected];
    const sel = document.querySelector('#sourceView .codeline.diagsel');
    return !!sel && +sel.dataset.line === d.line;
  }));
  await page.evaluate(() => setDockTab('tests'));

  /* ===================== CLEANUP ===================== */
  console.log('\n=== Phase 6: workspace and executable cleanup ===');
  check('the build workspace is removed after a passing run', echo.cleaned === true);
  check('the executable is removed after a passing run', echo.exeRemoved === true);
  check('cleanup also happens after crashes and timeouts', modes.cleaned === true && modes.exeRemoved === true);
  check('cleanup also happens after a failed build', cf.cleaned === true);
  const strayTmp = await new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-Command',
      "$d = Get-ChildItem (Join-Path $env:TEMP 'clab-bridge-*') -Directory -ErrorAction SilentlyContinue | " +
      "ForEach-Object { Get-ChildItem $_.FullName -Recurse -File -Include *.out,a.out,status -ErrorAction SilentlyContinue }; " +
      "if ($d) { $d.Count } else { 0 }"], { windowsHide: true });
    let o = ''; c.stdout.on('data', d => o += d);
    c.on('close', () => resolve(o.trim())); c.on('error', () => resolve('ERR'));
  });
  check('no executables or status files linger in the bridge temp area', strayTmp === '0' || strayTmp === '', 'found=' + strayTmp);
  const inRepo = await new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-Command',
      "$r = Get-ChildItem 'C:\\Users\\User\\Downloads' -Include a.out,*.out,main -File -Recurse -Depth 3 -ErrorAction SilentlyContinue; " +
      "if ($r) { $r.Count } else { 0 }"], { windowsHide: true });
    let o = ''; c.stdout.on('data', d => o += d);
    c.on('close', () => resolve(o.trim())); c.on('error', () => resolve('ERR'));
  });
  check('no build artifacts are written into the project', inRepo === '0' || inRepo === '', 'found=' + inRepo);

  /* ===================== SECURITY ===================== */
  console.log('\n=== Phase 6: security ===');
  check('no arbitrary-command endpoint exists', await page.evaluate(async () => {
    for (const u of ['/run?command=whoami', '/exec', '/shell', '/sh']) {
      const r = await fetch('http://127.0.0.1:4242' + u).catch(() => null);
      if (r && r.status !== 404) { const j = await r.json().catch(() => ({})); if (j.status !== 'ERROR') return false; }
    }
    return true;
  }));
  const inj = await page.evaluate(async () => {
    const suite = { tests: [{ id: 'i1', stdin: '', expectedStdout: 'x\n', compare: 'trim' }] };
    const r = await CValidate.TestValidator.run(
      '#include <stdio.h>\nint\tmain(void)\n{\n\tprintf("x\\n");\n\treturn (0);\n}\n',
      'a.c; touch /tmp/t6_pwned; echo b.c', suite, 'en');
    return { status: r.status, first: r.cases[0] && r.cases[0].status };
  });
  check('a command-injecting filename is neutralized', inj.status === 'PASSED' || inj.status === 'FAILED',
        inj.status + ' / ' + inj.first);
  check('the injection did not execute', (await wslExists('/tmp/t6_pwned')) === 'NO');
  check('oversized source is rejected', await page.evaluate(async () => {
    const huge = '#include <stdio.h>\nint\tmain(void)\n{\n\treturn (0);\n}\n' + '// ' + 'x'.repeat(600 * 1024);
    const r = await CValidate.TestValidator.run(huge, 'main.c', { tests: [{ id: 'a', stdin: '' }] }, 'en');
    return r.status === 'ERROR' || r.status === 'UNAVAILABLE';
  }));
  check('too many test cases are rejected', await page.evaluate(async () => {
    const many = { tests: new Array(90).fill(0).map((_, i) => ({ id: 'k' + i, stdin: '' })) };
    const r = await CValidate.TestValidator.run('int\tmain(void)\n{\n\treturn (0);\n}\n', 'main.c', many, 'en');
    return r.status === 'ERROR';
  }));
  check('oversized stdin is rejected', await page.evaluate(async () => {
    const s = { tests: [{ id: 'big', stdin: 'x'.repeat(300 * 1024) }] };
    const r = await CValidate.TestValidator.run('int\tmain(void)\n{\n\treturn (0);\n}\n', 'main.c', s, 'en');
    return r.status === 'ERROR';
  }));
  check('the bridge never receives a shell string from the page', await page.evaluate(async () => {
    // the page only ever sends structured JSON to /runtests
    const src = CValidate.TestValidator.run.toString();
    return /\/runtests/.test(src) && !/bash|sh -c|exec\(/.test(src);
  }));

  /* ===================== UI ===================== */
  console.log('\n=== Phase 6: UI integration ===');
  await useSuite('demo-modes');
  await runTests();
  check('the Tests dock tab is enabled', await page.evaluate(() =>
    !document.querySelector('.dock-tab[data-dock="tests"]').disabled));
  check('result rows are rendered', await page.$$eval('#dockBody .ts-row', e => e.length) === 3,
        String(await page.$$eval('#dockBody .ts-row', e => e.length)));
  check('an X/Y summary is shown', await page.evaluate(() =>
    /1\s*\/\s*3/.test(document.querySelector('#dockBody').textContent.replace(/\s+/g, ' '))));
  check('the dock tab carries a failure badge', await page.evaluate(() => {
    const b = document.querySelector('.dock-tab[data-dock="tests"] .dt-badge');
    return b && b.textContent === '2';
  }), await page.evaluate(() => (document.querySelector('.dock-tab[data-dock="tests"] .dt-badge') || {}).textContent));
  check('the status bar reports the ratio', /1\/3/.test(await page.$eval('#sbTests', e => e.textContent)),
        await page.$eval('#sbTests', e => e.textContent.replace(/\s+/g, ' ')));
  check('selecting a case opens the detail panel', await page.evaluate(() => {
    document.querySelectorAll('#dockBody .ts-row')[0].click();
    return !document.querySelector('#panelTest').classList.contains('collapsed') && tst.selected === 0;
  }));
  const detail = await page.$eval('#testPanel', e => e.textContent.replace(/\s+/g, ' '));
  check('the detail shows input, expected, actual, stderr and mode',
        /Input \(stdin\)/.test(detail) && /Expected/.test(detail) && /Actual/.test(detail) &&
        /stderr/.test(detail) && /comparison/.test(detail), detail.slice(0, 120));
  check('DEMO cases designed to fail are labelled as such', await page.evaluate(() =>
    document.querySelectorAll('#dockBody .ts-demo').length >= 2));
  check('the runner is not claimed to be the official Moulinette', await page.evaluate(() =>
    /not the official 42 Moulinette/i.test(document.querySelector('#dockBody').textContent)));
  check('Run Tests is in the Validate menu', await page.evaluate(() => {
    document.querySelector('#mValidate').click();
    const p = document.querySelector('#menuPop');
    const item = p ? Array.from(p.querySelectorAll('.menu-item')).find(i => /Run Tests|Lancer les tests/.test(i.textContent)) : null;
    const ok = !!item && item.getAttribute('aria-disabled') !== 'true';
    closeMenus();
    return ok;
  }));
  check('the command palette exposes the runner', await page.evaluate(() =>
    commands().some(c => c.n === 'Run Tests' && c.k === 'F2')));
  check('suite selection changes the case list', await page.evaluate(async () => {
    tst.suiteId = 'demo-echo'; renderValidation();
    const a = document.querySelector('#dockBody #tsSuite').value;
    return a === 'demo-echo';
  }));

  /* ===================== EN / FR ===================== */
  console.log('\n=== Phase 6: localization ===');
  await useSuite('demo-modes');
  await runTests();
  await page.evaluate(() => { document.querySelectorAll('#dockBody .ts-row')[1].click(); });
  await sleep(200);
  await page.evaluate(() => setLang('fr'));
  await sleep(300);
  const fr = await page.evaluate(() => ({
    dock: document.querySelector('#dockBody').textContent.replace(/\s+/g, ' '),
    panel: document.querySelector('#testPanel').textContent.replace(/\s+/g, ' '),
    tab: document.querySelector('.dock-tab[data-dock="tests"]').textContent.replace(/\s+/g, ' '),
  }));
  check('the Tests dock is localized', /Lancer les tests|réussis|Suite/.test(fr.dock), fr.dock.slice(0, 110));
  check('the detail panel is localized', /Entrée|Attendu|Obtenu|Que vérifier/.test(fr.panel), fr.panel.slice(0, 110));
  check('the explanation text is localized', /boucle|entrée|délai/i.test(fr.panel));
  // Regression: demo-suite prose (note / why) was authored English-only and
  // stayed English after switching to FR.
  check('demo suite prose is localized too', await page.evaluate(() =>
    CValidate.DEMO_SUITES.every(s => s.note && s.note.en && s.note.fr) &&
    CValidate.DEMO_SUITES.every(s => s.tests.every(t => !t.why || (t.why.en && t.why.fr)))));
  check('the FR suite note and case reason really render in French',
        /volontairement|Un programme|Montre|Lit l/i.test(fr.dock + fr.panel),
        (fr.dock + ' | ' + fr.panel).slice(0, 130));
  check('switching language refreshes immediately without re-running',
        await page.evaluate(() => (CValidate.store.get('tests').meta.cases || []).length === 3));
  await page.evaluate(() => setLang('en'));
  await sleep(250);
  check('switching back to EN restores English', /Run Tests|passed/.test(
        await page.$eval('#dockBody', e => e.textContent)));

  /* ===================== PANEL INTERACTION ===================== */
  console.log('\n=== Phase 6: panels interact correctly ===');
  check('Norminette, Compiler and Tests coexist', await page.evaluate(async () => {
    document.querySelector('#sourceEdit').value = '#include <stdio.h>\nint\tmain(void)\n{\n\tprintf("Hello World!\\n");\n\treturn (0);\n}\n';
    switchToEditing();
    await runNorminette();
    await runCompile();
    tst.suiteId = 'demo-hello';
    await runTests();
    const n = CValidate.store.get('norm'), c = CValidate.store.get('compiler'), t = CValidate.store.get('tests');
    return n.status !== 'NOT_RUN' && c.status !== 'NOT_RUN' && t.status !== 'NOT_RUN';
  }), await page.evaluate(() => ['norm','compiler','tests'].map(k => k + '=' + CValidate.store.get(k).status).join(' ')));
  check('the Problems panel still only shows norm + compiler', await page.evaluate(() => {
    setDockTab('problems');
    return filteredDiags().every(d => d.producer === 'norm' || d.producer === 'compiler');
  }));
  check('test results never leak into the diagnostic list', await page.evaluate(() =>
    CValidate.store.get('tests').diagnostics.length === 0));
  check('validation state stays out of engine and UI state', await page.evaluate(() =>
    !('tests' in run) && !('cases' in run) && !('tests' in ui)));

  /* ===================== UNAVAILABLE ===================== */
  console.log('\n=== Phase 6: runner unavailable (never fabricated) ===');
  await stopBridge();
  check('bridge is confirmed down', !(await ping()));
  await load();
  await useSuite('demo-echo');
  await runTests();
  const down = await ts();
  check('status is UNAVAILABLE, not PASSED', down.status === 'UNAVAILABLE', down.status);
  check('no case results are invented', down.cases.length === 0, 'cases=' + down.cases.length);
  check('the reason is surfaced', !!down.reason, down.reason);
  const downUi = await page.evaluate(() => ({
    dock: document.querySelector('#dockBody').textContent.replace(/\s+/g, ' '),
    sb: document.querySelector('#sbTests').textContent.replace(/\s+/g, ' '),
  }));
  check('the UI says the runner is unavailable', /unavailable/i.test(downUi.dock), downUi.dock.slice(0, 90));
  check('nothing claims tests passed', !/\bpassed\b/i.test(downUi.dock.replace(/not run/i, '')));
  await page.evaluate(() => closeModal());

  /* ===================== NO REGRESSION ===================== */
  console.log('\n=== Phase 6: no regression ===');
  await startBridge();
  await load();
  await page.evaluate(() => { loadExample('ex6'); showWorkspace(); });
  await sleep(200);
  await page.click('#btnStep'); await sleep(200);
  const exec = await page.evaluate(async () => { await fastForward({}); return { steps: run.history.length, mode: run.mode }; });
  check('the execution engine still works', exec.mode === 'done' && exec.steps === 230, JSON.stringify(exec));
  await page.evaluate(() => setDockTab('output'));
  check('program output still correct',
        /Salut, Comment Tu Vas 42mots Quarante-Deux/.test(await page.$eval('#dockBody', e => e.textContent)));
  check('no uncaught page exceptions', errs.filter(e => /PAGEERROR/.test(e)).length === 0,
        errs.filter(e => /PAGEERROR/.test(e)).slice(0, 2).join(' | '));

  await page.evaluate(async () => { tst.suiteId = 'demo-modes'; loadSuiteProgram(); });
  await sleep(200);
  await runTests();
  await page.evaluate(() => { document.querySelectorAll('#dockBody .ts-row')[1].click(); openPanel('panelTest'); });
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, 'p6_tests_dark.png') });
  await page.evaluate(() => toggleTheme());
  await sleep(250);
  check('light theme renders the test panels', await page.evaluate(() =>
    document.querySelector('#testPanel').getBoundingClientRect().height > 40));
  await page.screenshot({ path: path.join(SHOTS, 'p6_tests_light.png') });
  await page.evaluate(() => toggleTheme());

  console.log('\n' + '='.repeat(60));
  console.log('PHASE 6 PASS ' + pass + '   FAIL ' + fail);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  await browser.close();
  await stopBridge();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
