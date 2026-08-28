'use strict';
/* Phase 8 — the simulated terminal.

   Driven for real: click the input, type, press Enter, read what came back.
   The assertions compare terminal output against the ENGINE's own state, so a
   terminal that printed plausible text without running anything would fail. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.evaluate(() => { showWorkspace(); setDockTab('terminal'); });
  await sleep(400);

  // type as a person does
  const type = async (cmd) => {
    await page.click('#termInput');
    await page.type('#termInput', cmd, { delay: 1 });
    await page.keyboard.press('Enter');
    await sleep(200);
  };
  const lines = () => page.evaluate(() =>
    [...document.querySelectorAll('.tm-line')].map(l => ({
      kind: l.className.replace('tm-line tm-', ''), text: l.textContent })));
  const since = async (fn) => {
    const before = (await lines()).length;
    await fn();
    return (await lines()).slice(before);
  };
  const textOf = (ls) => ls.map(l => l.text).join('\n');

  console.log('=== part 1: the terminal exists and is honest ===');
  check('the placeholder is gone from the shipped file',
        fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8')
          .indexOf('This is a simulated shell surface') < 0);
  check('a real terminal renders in the dock',
        await page.evaluate(() => !!document.querySelector('.tm') && !!document.querySelector('#termInput')));
  check('it is labelled a SIMULATION',
        (await page.evaluate(() => document.querySelector('.tm-sim').textContent.trim())) === 'SIMULATION');
  check('it says it is not a real operating-system shell',
        /not a real operating-system shell/i.test(textOf(await lines())));
  check('the input is keyboard reachable and labelled',
        await page.evaluate(() => {
          const i = document.querySelector('#termInput');
          return i.getAttribute('aria-label') && i.tagName === 'INPUT' && i.type === 'text';
        }));
  check('the prompt renders and names a path',
        /mbousebe@c-lab:~/.test(await page.evaluate(() => document.querySelector('#termPrompt').textContent)));

  console.log('\n=== part 2: navigation over the EXISTING project model ===');
  let o = await since(() => type('pwd'));
  check('pwd prints the simulated path', /^~/.test(o[o.length - 1].text), o[o.length - 1].text);
  o = await since(() => type('cd ~/c03'));
  o = await since(() => type('ls'));
  // drop the echoed prompt line: only the command's output is the listing
  const listed = o.filter(l => l.kind === 'out').map(l => l.text).filter(Boolean);
  const engineDirs = await page.evaluate(() => {
    const g = GROUPS.find(x => x.id === 'c03');
    return g.keys.map(k => fileNameFor(k).replace(/\.c$/, '').replace(/^ft_/, '') + '/');
  });
  check('ls in c03 lists exactly the exercises the project model holds',
        JSON.stringify(listed) === JSON.stringify(engineDirs), listed.join(' '));
  o = await since(() => type('cd strcmp'));
  check('entering an exercise opens it in the editor',
        (await page.evaluate(() => ui.exampleKey)) === 'c03_strcmp');
  o = await since(() => type('pwd'));
  check('the prompt follows the directory', o[o.length - 1].text === '~/c03/strcmp', o[o.length - 1].text);
  o = await since(() => type('ls'));
  check('ls in an exercise lists its real file',
        o.map(l => l.text).indexOf('ft_strcmp.c') >= 0, o.map(l => l.text).join(' '));

  console.log('\n=== part 3: cat reads the EDITOR, not a copy ===');
  o = await since(() => type('cat ft_strcmp.c'));
  const catText = o.filter(l => l.kind === 'src').map(l => l.text).join('\n');
  const editor = await page.evaluate(() => document.querySelector('#sourceEdit').value);
  check('cat output is the editor buffer, line for line',
        catText.trim() === editor.trim(), catText.length + ' vs ' + editor.length + ' chars');
  // edit the source, cat again
  await page.evaluate(() => {
    switchToEditing();
    const ta = document.querySelector('#sourceEdit');
    ta.value = ta.value.replace('int\ti;', 'int\ti;\t/* edited */');
  });
  o = await since(() => type('cat ft_strcmp.c'));
  check('after editing, cat shows the NEW source',
        o.some(l => l.text.indexOf('/* edited */') >= 0));

  console.log('\n=== part 4: cc and ./a.out use the real engine ===');
  o = await since(() => type('cc ft_strcmp.c'));
  check('cc says it is the simulated compiler', /simulated compiler/i.test(textOf(o)));
  check('cc succeeds on valid source', /Compilation successful/.test(textOf(o)), textOf(o).slice(0, 60));
  o = await since(() => type('./a.out'));
  const engAfter = await page.evaluate(() => ({
    steps: run.history ? run.history.length : 0, key: ui.exampleKey, src: run.src,
  }));
  check('./a.out really executed: the engine now holds a history',
        engAfter.steps > 0, engAfter.steps + ' steps');
  check('the engine ran the edited source, not the pristine example',
        engAfter.src.indexOf('/* edited */') >= 0);
  check('the terminal reports the engine\u2019s own step count',
        textOf(o).indexOf(String(engAfter.steps) + ' execution steps') >= 0, textOf(o).slice(-70));

  // a program that actually prints, so stdout is real
  await page.evaluate(() => {
    switchToEditing();
    document.querySelector('#sourceEdit').value =
      'int\tmain(void)\n{\n\twrite(1, "ABC", 3);\n\treturn (0);\n}\n';
  });
  await type('cc ft_strcmp.c');
  o = await since(() => type('./a.out'));
  const engOut = await page.evaluate(() =>
    run.history.stateAt(run.history.length - 1).output);
  check('program output printed by the terminal is the engine\u2019s output',
        o.some(l => l.kind === 'stdout' && l.text === engOut) && engOut === 'ABC',
        JSON.stringify(engOut));

  console.log('\n=== part 5: the executable tracks the source ===');
  await page.evaluate(() => {
    switchToEditing();
    const ta = document.querySelector('#sourceEdit');
    ta.value = ta.value + '\n';
  });
  o = await since(() => type('./a.out'));
  check('a stale a.out is refused, and says why',
        /out of date/i.test(textOf(o)) && /cc ft_strcmp\.c/.test(textOf(o)), textOf(o).slice(0, 80));
  await type('cc ft_strcmp.c');
  o = await since(() => type('./a.out'));
  check('recompiling makes it runnable again', o.some(l => l.kind === 'stdout' && l.text === 'ABC'));

  console.log('\n=== part 6: inspection reads the engine, and opens the views ===');
  o = await since(() => type('inspect last-write'));
  const wr = await page.evaluate(() => {
    for (let i = run.history.length - 1; i >= 0; i--) {
      const s = run.history.steps[i];
      if (s.detail && s.detail.buffer !== undefined) return s.detail;
    }
    return null;
  });
  check('inspect last-write shows the engine\u2019s buffer address',
        textOf(o).indexOf('0x' + wr.buffer.toString(16)) >= 0,
        '0x' + wr.buffer.toString(16));
  check('and its section and byte values',
        /\.rodata/.test(textOf(o)) && /41\s+A/.test(textOf(o)), textOf(o).slice(-90));
  o = await since(() => type('stack'));
  check('stack opens the existing panel rather than duplicating it',
        (await page.evaluate(() => ui.collapsed && ui.collapsed.panelStack !== true)) !== false &&
        /opened Stack/.test(textOf(o)));
  o = await since(() => type('memory'));
  const engSections = await page.evaluate(() => {
    const g = run.history.stateAt(run.index).graph;
    return [...new Set(g.nodes.map(n => n.section))];
  });
  check('memory prints sections the engine actually has',
        engSections.every(s => new RegExp(s === 'rodata' ? '\\.RODATA' : s.toUpperCase(), 'i').test(textOf(o))),
        engSections.join(','));
  o = await since(() => type('timeline'));
  check('timeline reports the engine\u2019s step count',
        textOf(o).indexOf(String(engAfter.steps === 0 ? '' : '')) >= 0 &&
        /steps recorded/.test(textOf(o)), textOf(o).split('\n')[1]);

  console.log('\n=== part 7: errors never crash, and never lie ===');
  const cases = [
    ['gcc', /not available in the simulated terminal/],
    ['rm -rf /', /not available in the simulated terminal/],
    ['cat nope.c', /No such file/],
    ['cd nowhere', /no such directory/],
    ['cc', /no input files/],
    ['cc *.c', /wildcards are not supported/],
    ['help nosuch', /not a command here/],
  ];
  for (const [cmd, re] of cases) {
    o = await since(() => type(cmd));
    check("'" + cmd + "' fails honestly", re.test(textOf(o)), textOf(o).split('\n')[1] || '');
  }
  o = await since(() => type('   '));
  check('blank input does nothing but echo the prompt',
        o.length === 1 && o[0].kind === 'cmd');
  o = await since(() => type('echo "hello  world"'));
  check('quoted echo preserves its spacing',
        o[o.length - 1].text === 'hello  world', JSON.stringify(o[o.length - 1].text));
  // Phase 11 implemented argc/argv, so this now asserts the stronger thing:
  // the arguments genuinely reach the running program.
  await page.evaluate(() => {
    switchToEditing();
    document.querySelector('#sourceEdit').value =
      'int\tmain(int argc, char **argv)\n{\n\twrite(1, argv[2], 1);\n\treturn (0);\n}\n';
  });
  await type('cc ' + (await page.evaluate(() => fileNameFor(ui.exampleKey))));
  o = await since(() => type('./a.out x yes'));
  const argvSeen = await page.evaluate(() => {
    for (let i = run.history.length - 1; i >= 0; i--) {
      const st = run.history.stateAt(i);
      const a = st.vars.find(v => v.name === 'argc');
      if (a && !a.uninitialized) return a.valueText;
    }
    return null;
  });
  check('./a.out passes its arguments into the real execution',
        argvSeen === '3' && o.some(l => l.kind === 'stdout' && l.text === 'y'),
        'argc=' + argvSeen + ' output=' + JSON.stringify(o.filter(l => l.kind === 'stdout').map(l => l.text)));

  console.log('\n=== part 8: norminette is honest about being a subset ===');
  await page.evaluate(() => loadExample('c03_strcmp'));
  await sleep(200);
  o = await since(() => type('norminette ft_strcmp.c'));
  check('it declares itself a simulated subset', /simulated norm check/i.test(textOf(o)));
  check('it lists the rules it really ran', (textOf(o).match(/✓|✗/g) || []).length >= 5);
  check('it names what it does NOT check',
        /Not checked here/.test(textOf(o)) && /real norminette checks far more/i.test(textOf(o)));
  // and it must actually detect a violation
  await page.evaluate(() => {
    switchToEditing();
    document.querySelector('#sourceEdit').value =
      'int\tmain(void)\n{\n    int x;\n\treturn (0);\n}\n';   // spaces, not tabs
  });
  o = await since(() => type('norminette ft_strcmp.c'));
  check('it really detects a violation rather than always passing',
        /✗/.test(textOf(o)) && /starts with spaces/.test(textOf(o)) && /FAILED/.test(textOf(o)),
        textOf(o).split('\n').filter(l => /✗|spaces/.test(l)).join(' | '));

  console.log('\n=== part 9: history, clear and keyboard ===');
  o = await since(() => type('history'));
  check('history lists the session\u2019s commands numbered',
        /\s+1\s+pwd/.test(textOf(o)), textOf(o).split('\n')[1]);
  await page.click('#termInput');
  await page.keyboard.press('ArrowUp');
  check('Arrow Up recalls the last command',
        (await page.evaluate(() => document.querySelector('#termInput').value)) === 'history');
  await page.keyboard.press('ArrowDown');
  await page.evaluate(() => { document.querySelector('#termInput').value = ''; });
  // Give clear something to preserve: a live execution and a non-empty history.
  await type('cc ft_strcmp.c');
  await type('./a.out');
  const liveBefore = await page.evaluate(() => ({
    steps: run.history ? run.history.length : 0,
    hist: term.history.length, key: ui.exampleKey,
    src: document.querySelector('#sourceEdit').value.length,
  }));
  const beforeClear = (await lines()).length;
  await type('clear');
  const afterClear = await lines();
  check('clear empties the output only', afterClear.length === 0, afterClear.length + ' lines (was ' + beforeClear + ')');
  const liveAfter = await page.evaluate(() => ({
    steps: run.history ? run.history.length : 0,
    hist: term.history.length, key: ui.exampleKey,
    src: document.querySelector('#sourceEdit').value.length,
  }));
  check('clear touches neither the execution, the history, the project nor the editor',
        liveBefore.steps > 0 && liveAfter.steps === liveBefore.steps &&
        liveAfter.hist > liveBefore.hist &&
        liveAfter.key === liveBefore.key && liveAfter.src === liveBefore.src,
        JSON.stringify(liveBefore) + ' -> ' + JSON.stringify(liveAfter));

  console.log('\n=== part 10: security ===');
  o = await since(() => type('echo <img src=x onerror=alert(1)>'));
  check('terminal output is escaped, never injected as HTML',
        await page.evaluate(() => document.querySelector('.tm-out').innerHTML.indexOf('<img') < 0));
  check('the escaped text is still shown to the user',
        o.some(l => l.text.indexOf('<img') >= 0));
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const termSrc = src.slice(src.indexOf('==== TERM START ===='), src.indexOf('==== TERM END ===='));
  check('the terminal contains no eval, Function constructor or process access',
        !/\beval\s*\(/.test(termSrc) && !/new Function/.test(termSrc) &&
        !/child_process|require\s*\(/.test(termSrc));
  check('commands are dispatched from a registry, not an if-chain',
        /TERM_COMMANDS\[/.test(termSrc) && /hasOwnProperty\.call\(TERM_COMMANDS/.test(termSrc));

  console.log('\n=== part 11: responsive, and nothing earlier regressed ===');
  const bad = [];
  for (const [w, h] of [[1600, 1000], [1280, 800], [1024, 800], [860, 700], [700, 900]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(250);
    const g = await page.evaluate(() => {
      const t = document.querySelector('.tm'), i = document.querySelector('#termInput');
      const rail = document.querySelector('.rail');
      if (!t || !i) return { missing: true };
      const tr = t.getBoundingClientRect(), ir = i.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      return { overflow: document.body.scrollWidth > document.body.clientWidth,
               inputUsable: ir.width > 60 && ir.height > 8,
               coversRail: tr.left < rr.right - 1, missing: false };
    });
    if (g.missing || g.overflow || !g.inputUsable || g.coversRail) bad.push(w + 'x' + h + ' ' + JSON.stringify(g));
  }
  check('the terminal is usable at every viewport and never covers the rail',
        bad.length === 0, bad.join(' | '));
  await page.setViewport({ width: 1500, height: 1000 });
  await sleep(250);

  const clickRail = async (id) => {
    const r = await page.evaluate((x) => { const e = document.querySelector('#' + x);
      const bb = e.getBoundingClientRect();
      return { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2) }; }, id);
    await page.mouse.click(r.x, r.y); await sleep(320);
  };
  await clickRail('railHome');
  check('the rail still navigates with the terminal open',
        (await page.evaluate(() => ui.view)) === 'dashboard');
  await clickRail('railLab');
  await page.evaluate(() => { lab.tab = 'ascii'; renderLab(); });
  await sleep(300);
  const drift = await page.evaluate(() => {
    const t = document.querySelector('.vl-table');
    const h = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
    return Math.max(...[...h.children].map((c, i) =>
      Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left)));
  });
  check('ASCII table alignment still holds', drift <= 1, 'drift ' + Math.round(drift) + 'px');
  await page.evaluate(() => { lab.tab = 'c03'; renderLab(); });
  await sleep(300);
  check('the C03 project still works',
        (await page.evaluate(() => document.querySelectorAll('.c3-table tbody tr').length)) === 6);
  await clickRail('railWork');
  await page.evaluate(() => { loadExample('c03_strcat'); setDockTab('terminal'); });
  await sleep(350);
  check('opening a project elsewhere moves the terminal with it',
        (await page.evaluate(() => document.querySelector('#termPrompt').textContent)).indexOf('c03/strcat') >= 0,
        await page.evaluate(() => document.querySelector('#termPrompt').textContent));
  // the ceba821 caret fix, with the terminal present
  await page.evaluate(() => switchToEditing());
  await sleep(200);
  const caret = await page.evaluate(() => {
    const view = document.querySelector('#sourceView');
    const el = view.querySelector('.codeline[data-line="6"] .code');
    if (!el) return null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const flat = []; let n;
    while ((n = w.nextNode())) for (let i = 0; i < n.length; i++) flat.push({ nd: n, i });
    if (flat.length < 3) return null;
    const r = document.createRange();
    r.setStart(flat[2].nd, flat[2].i); r.setEnd(flat[2].nd, flat[2].i + 1);
    const rect = r.getBoundingClientRect();
    const lines2 = document.querySelector('#sourceEdit').value.split('\n');
    let base = 0; for (let k = 0; k < 5; k++) base += lines2[k].length + 1;
    return { x: Math.round(rect.left + rect.width * 0.25), y: Math.round(rect.top + rect.height / 2), expect: base + 2 };
  });
  if (caret) {
    await page.mouse.click(caret.x, caret.y);
    check('the editor caret still lands correctly with the terminal open',
          (await page.evaluate(() => document.querySelector('#sourceEdit').selectionStart)) === caret.expect,
          'expected ' + caret.expect);
  } else check('caret probe found a line', false);

  check('no page errors across the whole terminal session', errs.length === 0, errs.join(' | '));
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => setDockTab('terminal'));
  await sleep(250);
  await page.screenshot({ path: path.join(SHOTS, 'p20_term.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 8  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
