'use strict';
// PHASE 4 EXIT GATE — Norminette Lab.
// Drives the shipped ../index.html in real Chrome against the real norminette
// running through the local bridge. The bridge is started and stopped here so
// the suite also exercises the "bridge is down" path honestly.
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

/* ---- fixtures ---- */
const BAD = ['#include <stdio.h>', 'int\tmain(void)', '{', '  int x;', '\tx = 1;',
  '\tfor (int i = 0; i < 3; i++) { printf("%d", i); }', '\treturn (0);', '}', ''].join('\n');

const GOOD = [
  '/* ************************************************************************** */',
  '/*                                                                            */',
  '/*                                                        :::      ::::::::   */',
  '/*   main.c                                             :+:      :+:    :+:   */',
  '/*                                                    +:+ +:+         +:+     */',
  '/*   By: student <student@student.42.fr>            +#+  +:+       +#+        */',
  '/*                                                +#+#+#+#+#+   +#+           */',
  '/*   Created: 2026/08/23 22:00:00 by student           #+#    #+#             */',
  '/*   Updated: 2026/08/23 22:00:00 by student          ###   ########.fr       */',
  '/*                                                                            */',
  '/* ************************************************************************** */',
  '',
  'int\tmain(void)',
  '{',
  '\treturn (0);',
  '}',
  ''].join('\n');

(async () => {
  let bridge = null;
  const startBridge = async () => {
    if (await ping()) return 'already';
    bridge = spawn(process.execPath, [BRIDGE], { stdio: 'ignore', windowsHide: true });
    const up = await waitFor(ping, 15000);
    return up ? 'started' : 'failed';
  };
  // Also stops a bridge this suite did not start, so the UNAVAILABLE path is
  // genuinely exercised rather than answered by a stray process.
  const stopBridge = async () => {
    if (bridge) { bridge.kill(); bridge = null; }
    if (await ping()) {
      await new Promise((resolve) => {
        const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
          "Get-NetTCPConnection -LocalPort 4242 -State Listen -ErrorAction SilentlyContinue | " +
          "Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"],
          { stdio: 'ignore', windowsHide: true });
        ps.on('close', resolve);
        ps.on('error', resolve);
      });
    }
    return waitFor(async () => !(await ping()), 10000);
  };

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
  const setSrc = (src) => page.evaluate((s) => { document.querySelector('#sourceEdit').value = s; switchToEditing(); }, src);
  const runNorm = async (maxMs) => {
    await page.evaluate(() => runNorminette());
    await waitFor(() => page.evaluate(() => !val.busy), maxMs || 60000, 300);
    await sleep(250);
  };
  const entry = () => page.evaluate(() => {
    const e = CValidate.store.get('norm');
    return { status: e.status, n: (e.diagnostics || []).length, meta: e.meta || null };
  });

  /* ================= ARCHITECTURE ================= */
  console.log('=== Phase 4: validation architecture ===');
  await load();
  check('page still loads with no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  check('CEngine is untouched and still present', await page.evaluate(() => typeof CEngine === 'object' && typeof CEngine.runToCompletion === 'function'));
  check('CValidate exists as a separate layer', await page.evaluate(() => typeof CValidate === 'object'));
  check('engine does not know about validation', await page.evaluate(() =>
    Object.keys(CEngine).every(k => !/norm|valid|lint|diagnostic/i.test(k))),
    await page.evaluate(() => Object.keys(CEngine).length + ' engine exports'));
  check('validation layer does not reach into the engine', await page.evaluate(() =>
    Object.keys(CValidate).every(k => !/engine|stepper|history|memory/i.test(k))));
  check('diagnostic schema is normalized', await page.evaluate(() => {
    const d = CValidate.makeDiagnostic({ line: 3, column: 5, code: 'X', message: 'm' });
    return ['sourceFile','line','column','endColumn','severity','code','rule','message','category','producer']
      .every(k => k in d);
  }));
  check('status model exposes all six states', await page.evaluate(() =>
    ['NOT_RUN','RUNNING','PASSED','FAILED','UNAVAILABLE','ERROR'].every(s => s in CValidate.STATUS)));
  check('validator registry is extensible for Phase 5', await page.evaluate(() =>
    typeof CValidate.validators === 'object' && 'norm' in CValidate.validators &&
    typeof CValidate.validators.norm.run === 'function' && typeof CValidate.validators.norm.detect === 'function'));
  check('all 11 norm categories are defined', await page.evaluate(() =>
    ['HEADER','FUNCTION','VARIABLE','NAMING','FORMATTING','INDENTATION','LINE_LENGTH',
     'FUNCTION_LENGTH','FORBIDDEN_CONSTRUCT','FILE_STRUCTURE','OTHER'].every(c => c in CValidate.CATEGORY)));

  /* ================= NORMALIZER (pure, no process) ================= */
  console.log('\n=== Phase 4: diagnostic normalization ===');
  const norm = await page.evaluate(() => {
    const report = { files: [{ path: '/tmp/main.c', status: 'Error', errors: [
      { name: 'TOO_MANY_LINES', text: 'Function has more than 25 lines', level: 'Error',
        highlights: [{ lineno: 18, column: 1, length: 4, hint: null }] },
      { name: 'SOME_FUTURE_RULE', text: 'Something new', level: 'Notice',
        highlights: [{ lineno: 3, column: 2, length: null, hint: null }] },
    ] }] };
    const d = CValidate.normalizeNorminette(report, 'main.c', 'en');
    return d;
  });
  check('normalizes a known rule', norm[1] && norm[1].code === 'TOO_MANY_LINES' &&
        norm[1].line === 18 && norm[1].category === 'FUNCTION_LENGTH' && norm[1].endColumn === 5,
        JSON.stringify(norm[1] && { c: norm[1].code, l: norm[1].line, cat: norm[1].category, ec: norm[1].endColumn }));
  check('sorts diagnostics by position', norm[0] && norm[0].line === 3);
  check('unknown rule identifiers degrade gracefully (spec §9)',
        norm[0] && norm[0].code === 'SOME_FUTURE_RULE' && norm[0].severity === 'notice' && !!norm[0].category,
        JSON.stringify(norm[0] && { c: norm[0].code, sev: norm[0].severity, cat: norm[0].category }));
  check('unknown rule still shows norminette\'s own message', await page.evaluate(() => {
    const i = CValidate.ruleInfo('SOME_FUTURE_RULE', 'en', 'Something new');
    return i.known === false && i.what === 'Something new';
  }));
  check('known rule carries educational metadata', await page.evaluate(() => {
    const i = CValidate.ruleInfo('TOO_MANY_LINES', 'en');
    return i.known && !!i.title && !!i.what && !!i.why && !!i.mistake && !!i.strategy;
  }));
  check('rule metadata is localized', await page.evaluate(() => {
    const en = CValidate.ruleInfo('FORBIDDEN_CS', 'en'), fr = CValidate.ruleInfo('FORBIDDEN_CS', 'fr');
    return en.title !== fr.title && fr.why && fr.strategy;
  }), await page.evaluate(() => CValidate.ruleInfo('FORBIDDEN_CS', 'fr').title));
  check('explanations guide instead of solving (spec §8)', await page.evaluate(() => {
    // no rule may hand over finished code
    return Object.keys(CValidate.NORM_RULES).every(k => {
      const s = CValidate.NORM_RULES[k].en.strategy || '';
      return !/here is the (complete|corrected|full)/i.test(s);
    });
  }));

  /* ================= UNAVAILABLE (bridge down) ================= */
  console.log('\n=== Phase 4: bridge down → UNAVAILABLE (never a fake pass) ===');
  await stopBridge();
  check('bridge is confirmed down', !(await ping()));
  await load();
  await setSrc(BAD);
  await runNorm(45000);
  const down = await entry();
  check('status is UNAVAILABLE, not PASSED', down.status === 'UNAVAILABLE', JSON.stringify(down.status));
  check('no diagnostics are invented', down.n === 0, 'n=' + down.n);
  check('the reason is shown to the user', !!(down.meta && down.meta.reason), down.meta && down.meta.reason);
  const downUi = await page.evaluate(() => ({
    dock: document.querySelector('#dockBody').textContent.replace(/\s+/g, ' '),
    sb: document.querySelector('#sbNorm').textContent.replace(/\s+/g, ' '),
  }));
  check('workspace says norminette is not available', /not available|not installed/i.test(downUi.dock), downUi.dock.slice(0, 90));
  check('status bar reflects it', /not installed/i.test(downUi.sb), downUi.sb);
  check('help modal explains how to enable it', await page.evaluate(() => {
    const m = document.querySelector('#modalRoot');
    return !!m && /bridge/i.test(m.textContent) && /node server\.js/.test(m.textContent);
  }));
  await page.evaluate(() => closeModal());

  /* ================= REAL NORMINETTE ================= */
  console.log('\n=== Phase 4: real norminette ===');
  const started = await startBridge();
  check('validation bridge starts', started !== 'failed', started);
  await load();
  const det = await page.evaluate(async () => await detectNorminette(true));
  check('detection reports the real tool', det && det.available === true && /^\d+\.\d+/.test(det.version || ''),
        JSON.stringify(det && { v: det.version, via: det.via }));
  check('it is norminette, not a built-in checker', det && det.tool === 'norminette', det && det.tool);

  await setSrc(BAD);
  await runNorm();
  const bad = await entry();
  check('bad file FAILS', bad.status === 'FAILED', bad.status);
  check('multiple real violations are reported', bad.n >= 8, bad.n + ' diagnostics');
  const codes = await page.evaluate(() => CValidate.store.get('norm').diagnostics.map(d => d.code));
  check('real norminette rule identifiers come through', codes.includes('INVALID_HEADER') && codes.includes('FORBIDDEN_CS'),
        codes.slice(0, 5).join(', '));
  check('every diagnostic has a line and a column', await page.evaluate(() =>
    CValidate.store.get('norm').diagnostics.every(d => d.line >= 1 && d.column >= 1)));
  check('every diagnostic is categorized', await page.evaluate(() =>
    CValidate.store.get('norm').diagnostics.every(d => d.category && d.category.length > 0)));

  /* ================= PROBLEMS PANEL ================= */
  console.log('\n=== Phase 4: problems panel ===');
  check('problems tab opened automatically', await page.evaluate(() => ui.dockTab) === 'problems');
  check('problem rows rendered', await page.$$eval('#dockBody .prob', e => e.length) >= 8,
        String(await page.$$eval('#dockBody .prob', e => e.length)));
  check('problems are grouped by category', await page.$$eval('#dockBody .prob-group', e => e.length) >= 2,
        String(await page.$$eval('#dockBody .prob-group', e => e.length)) + ' groups');
  check('dock tab shows a count badge', await page.evaluate(() => {
    const b = document.querySelector('.dock-tab[data-dock="problems"] .dt-badge');
    return b && b.textContent && +b.textContent > 0;
  }));
  const filt = await page.evaluate(() => {
    const out = {};
    for (const f of ['all', 'errors', 'warnings']) {
      val.probFilter = f; renderValidation();
      out[f] = document.querySelectorAll('#dockBody .prob').length;
    }
    val.probFilter = 'all'; renderValidation();
    return out;
  });
  check('severity filters work', filt.all >= filt.errors && filt.errors > 0, JSON.stringify(filt));
  check('filtering does not change stored diagnostics', (await entry()).n === bad.n);

  /* ================= SOURCE SYNCHRONIZATION ================= */
  console.log('\n=== Phase 4: source synchronization ===');
  // Assert the property directly: a render decorates every diagnostic line.
  const gutter = await page.evaluate(() => {
    renderSource(step() ? step().line : null);
    const diags = CValidate.store.get('norm').diagnostics || [];
    const lines = [...new Set(diags.map(d => d.line))].sort((a, b) => a - b);
    const marked = Array.from(document.querySelectorAll('#sourceView .codeline.diag')).map(e => +e.dataset.line);
    return { diagCount: diags.length, lines, marked, srcLines: currentSource().split('\n').length,
             editing: run.editing, viewShown: document.querySelector('#sourceView').style.display !== 'none' };
  });
  check('violation lines are marked in the gutter',
        gutter.marked.length >= 3 && gutter.lines.every(l => gutter.marked.includes(l)),
        gutter.marked.length + ' marked for lines [' + gutter.lines.join(',') + '] · ' + JSON.stringify({
          diags: gutter.diagCount, srcLines: gutter.srcLines, editing: gutter.editing }));
  const jump = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#dockBody .prob'));
    const target = rows.find(r => r.querySelector('.p-loc').textContent !== 'L1:1') || rows[0];
    const loc = target.querySelector('.p-loc').textContent;
    target.click();
    const d = CValidate.store.get('norm').diagnostics[val.selected];
    const sel = document.querySelector('#sourceView .codeline.diagsel');
    return { loc, selLine: sel ? +sel.dataset.line : null, diagLine: d ? d.line : null,
             rulePanel: document.querySelector('#rulePanel').textContent.replace(/\s+/g, ' ').slice(0, 120),
             ruleOpen: !document.querySelector('#panelRule').classList.contains('collapsed') };
  });
  check('clicking a problem highlights that source line', jump.selLine !== null, JSON.stringify(jump.loc + ' -> line ' + jump.selLine));
  check('the highlighted line matches the diagnostic', jump.selLine === jump.diagLine, jump.selLine + ' vs ' + jump.diagLine);
  check('the rule panel opens automatically', jump.ruleOpen);
  check('the rule panel explains the violation', /What happened/i.test(jump.rulePanel) || jump.rulePanel.length > 40, jump.rulePanel.slice(0, 80));
  const ruleTxt = await page.$eval('#rulePanel', e => e.textContent.replace(/\s+/g, ' '));
  check('explanation has What / Why / Common mistake / Better strategy',
        /What happened/.test(ruleTxt) && /Why the rule exists/.test(ruleTxt) &&
        /Common mistake/.test(ruleTxt) && /Better strategy/.test(ruleTxt));
  check('the offending source line is quoted with a column caret', await page.evaluate(() =>
    !!document.querySelector('#rulePanel .rule-src') && /\^/.test(document.querySelector('#rulePanel .rule-src').textContent)));
  // Regression: clicking a diagnostic used to switch to the rendered view of the
  // last EXECUTED program, so the highlighted line belonged to different text
  // than the one norminette validated.
  check('the highlighted line shows the text that was actually validated', await page.evaluate(() => {
    loadExample('exBug2'); showWorkspace();                 // give run.src a different program
    return true;
  }) && await (async () => {
    await sleep(150);
    await setSrc(BAD);
    await runNorm();
    return page.evaluate(() => {
      const d = CValidate.store.get('norm').diagnostics.find(x => x.line === 4) ||
                CValidate.store.get('norm').diagnostics[0];
      const i = CValidate.store.get('norm').diagnostics.indexOf(d);
      selectDiagnostic(i);
      const el = document.querySelector('#sourceView .codeline[data-line="' + d.line + '"] .code');
      const editorLine = document.querySelector('#sourceEdit').value.split('\n')[d.line - 1];
      return el && el.textContent === editorLine;
    });
  })(), 'rendered line must equal the editor line at the same number');

  check('next / previous walk the violations', await page.evaluate(() => {
    const a = val.selected; stepDiagnostic(1); const b = val.selected; stepDiagnostic(-1);
    return b !== a && val.selected === a;
  }));

  /* ================= PASSED ================= */
  console.log('\n=== Phase 4: clean file → PASSED ===');
  await setSrc(GOOD);
  await runNorm();
  const good = await entry();
  check('clean file PASSES', good.status === 'PASSED', good.status + ' n=' + good.n);
  check('no diagnostics remain', good.n === 0);
  check('gutter marks are cleared', await page.$$eval('#sourceView .codeline.diag', e => e.length) === 0);
  const passTxt = await page.$eval('#dockBody', e => e.textContent.replace(/\s+/g, ' '));
  check('PASSED is not presented as "code is correct" (spec §11)',
        /does not mean the program is correct/i.test(passTxt), passTxt.slice(0, 150));
  check('status bar shows passed', /passed/i.test(await page.$eval('#sbNorm', e => e.textContent)));

  /* ================= LOCALIZATION ================= */
  console.log('\n=== Phase 4: localization ===');
  await page.evaluate(() => setLang('fr'));
  await sleep(250);
  const fr = await page.evaluate(() => ({
    menu: document.querySelector('#mValidate').textContent,
    tab: document.querySelector('.dock-tab[data-dock="problems"]').textContent.replace(/\s+/g, ' ').trim(),
    dock: document.querySelector('#dockBody').textContent.replace(/\s+/g, ' '),
  }));
  check('Validate menu is localized', /Valider/.test(fr.menu), fr.menu);
  check('Problems tab is localized', /Probl/.test(fr.tab), fr.tab);
  // "violations" is spelled the same in both languages, so assert on strings
  // that only exist in the FR catalogue.
  check('validation messages are localized',
        /Lancer Norminette|non lancé|conforme|Norme respectée|n’a pas encore été lancée/i.test(fr.dock),
        fr.dock.slice(0, 110));
  await page.evaluate(() => setLang('en'));

  /* ================= INTEGRATION / NO REGRESSION ================= */
  console.log('\n=== Phase 4: integration ===');
  check('Validate menu opens', await page.evaluate(() => {
    document.querySelector('#mValidate').click();
    const p = document.querySelector('#menuPop');
    const ok = !!p && /Norminette/i.test(p.textContent);
    closeMenus();
    return ok;
  }));
  check('command palette exposes validation commands', await page.evaluate(() =>
    commands().filter(c => c.g === 'Validate').length >= 4));
  check('F7 runs norminette', await page.evaluate(() => {
    const cmds = commands().filter(c => c.k === 'F7');
    return cmds.length === 1 && /Norminette/i.test(cmds[0].n);
  }));
  // Phase 5 implemented the compiler, so this scope boundary moves forward to
  // the NEXT unbuilt phase rather than being deleted. The Compile entry must
  // now be live and still advertise the fixed Piscine flags.
  check('Compile is implemented and advertises the fixed flags', await page.evaluate(() => {
    document.querySelector('#mValidate').click();
    const p = document.querySelector('#menuPop');
    const item = p ? Array.from(p.querySelectorAll('.menu-item')).find(i => /-Wall -Wextra -Werror/.test(i.textContent)) : null;
    const ok = !!item && item.getAttribute('aria-disabled') !== 'true';
    closeMenus();
    return ok;
  }));
  // Phase 7 implemented the Trace Analyzer, so the boundary moves to Exam Mode.
  check('the next phase (Exam Mode) is declared but NOT implemented', await page.evaluate(() => {
    document.querySelector('#mLearn').click();
    const p = document.querySelector('#menuPop');
    const items = p ? Array.from(p.querySelectorAll('.menu-item')) : [];
    const exam = items.find(i => /Exam Mode/.test(i.textContent));
    const trace = items.find(i => /Trace Analyzer/.test(i.textContent));
    const ok = !!exam && exam.getAttribute('aria-disabled') === 'true' &&
               !!trace && trace.getAttribute('aria-disabled') !== 'true';
    closeMenus();
    return ok;
  }));
  check('the trace is a module beside the validators, and Exam Mode is still absent', await page.evaluate(() =>
    'tests' in CValidate.validators &&
    !('trace' in CValidate.validators) && !('exam' in CValidate.validators) &&
    typeof CTrace === 'object' && typeof CTrace.instrument === 'function'));

  // Phase 1-3 behaviour must be intact in the same page
  await page.evaluate(() => { loadExample('ex6'); showWorkspace(); });
  await sleep(200);
  await page.click('#btnStep'); await sleep(200);
  const exec = await page.evaluate(async () => { await fastForward({}); return { steps: run.history.length, mode: run.mode }; });
  check('execution still works after validation', exec.mode === 'done' && exec.steps === 230, JSON.stringify(exec));
  await page.evaluate(() => setDockTab('output'));
  check('program output still correct', /Salut, Comment Tu Vas 42mots Quarante-Deux/.test(await page.$eval('#dockBody', e => e.textContent)));
  check('timeline still virtualized', await page.$$eval('#tlRows .tl-item', e => e.length) < 80);
  check('memory panel still renders bytes', await page.evaluate(() => {
    goTo(80); openPanel('panelMemory'); render();
    return document.querySelectorAll('#memPanel .bv').length > 0;
  }));
  check('validation did not leak into execution state', await page.evaluate(() =>
    !('diagnostics' in run) && !('norm' in run) && !('diagnostics' in ui)));
  // Chrome logs a network error for the bridge probe while the bridge is
  // deliberately stopped. That is browser noise the app already handles, so it
  // is excluded here — uncaught page errors are not.
  const appErrs = errs.filter(e => !/ERR_CONNECTION_REFUSED|Failed to load resource/i.test(e));
  check('no application console errors across the whole run', appErrs.length === 0, appErrs.slice(0, 3).join(' | '));
  check('no uncaught page exceptions', errs.filter(e => /PAGEERROR/.test(e)).length === 0,
        errs.filter(e => /PAGEERROR/.test(e)).slice(0, 2).join(' | '));
  check('bridge-down fetch failures are caught by the app, not thrown',
        errs.some(e => /ERR_CONNECTION_REFUSED/.test(e)) && errs.filter(e => /PAGEERROR/.test(e)).length === 0,
        'network noise present, no exception escaped');

  /* ================= PROCESS FAILURE ================= */
  console.log('\n=== Phase 4: process failure handling ===');
  check('oversized source is rejected, not crashed', await page.evaluate(async () => {
    const huge = 'x'.repeat(600 * 1024);
    const r = await CValidate.NorminetteValidator.run(huge, 'main.c', 'en');
    return r.status === 'ERROR' || r.status === 'UNAVAILABLE';
  }));
  check('a filename cannot inject a command', await page.evaluate(async () => {
    const r = await CValidate.NorminetteValidator.run('int\tmain(void)\n{\n\treturn (0);\n}\n',
      'a.c; touch /tmp/pwned; echo b.c', 'en');
    return r.status === 'PASSED' || r.status === 'FAILED';   // ran safely, name ignored
  }));
  const pwned = await new Promise((resolve) => {
    const p = spawn('wsl.exe', ['-e', 'bash', '-lc', 'test -e /tmp/pwned && echo YES || echo NO'], { windowsHide: true });
    let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => resolve(o.replace(/\0/g, '').trim()));
  });
  check('injection did not execute', pwned === 'NO', 'marker=' + pwned);

  await page.evaluate(() => { setDockTab('problems'); });
  await setSrc(BAD); await runNorm();
  await page.evaluate(() => { const el = document.querySelector('#dockBody .prob'); if (el) el.click(); });
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, 'p4_norminette.png') });
  await page.evaluate(() => toggleTheme()); await sleep(250);
  await page.screenshot({ path: path.join(SHOTS, 'p4_norminette_light.png') });

  console.log('\n' + '='.repeat(60));
  console.log('PHASE 4 PASS ' + pass + '   FAIL ' + fail);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  await browser.close();
  await stopBridge();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
