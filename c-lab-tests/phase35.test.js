'use strict';
/* Terminal -> execution -> visualization bridge.

   The claim under test is the workflow itself: paste a C program into the
   editor, compile it from the terminal with a chosen output name, run it with
   quoted arguments, get the program's real output, and then see that run's
   argc/argv and memory in the visualizers and step through it.

   Every expected value is computed in this file — the shell word-splitting, the
   expected stdout of the example program, argc, the argument strings and their
   bytes — and compared against what the page produces. Nothing is read out of a
   panel and compared to itself.

   The suite also checks the honesty labelling, because the compiler here is the
   lab's own engine and not the system's gcc, and the pages must say so.

   Writes nothing: no screenshots, no artifacts. */
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}

/* The program from the brief, verbatim. */
const PROG = [
  '#include <unistd.h>',
  '',
  'int\tmain(int argc, char **argv)',
  '{',
  '\tint\ti;',
  '',
  '\tif (argc != 2)',
  '\t{',
  '\t\twrite(1, "\\n", 1);',
  '\t\treturn (0);',
  '\t}',
  '\telse',
  '\t{',
  '\t\ti = 0;',
  '\t\twhile (argv[1][i] != \'\\0\')',
  '\t\t{',
  '\t\t\twrite(1, &argv[1][i], 1);',
  '\t\t\tif (argv[1][i + 1] != \'\\0\')',
  '\t\t\t\twrite(1, "   ", 3);',
  '\t\t\ti++;',
  '\t\t}',
  '\t\twrite(1, "\\n", 1);',
  '\t}',
  '\treturn (0);',
  '}',
  '',
].join('\n');

/* What the program must print, worked out here rather than observed. */
function expected(args) {
  if (args.length !== 1) return '\n';
  return args[0].split('').join('   ') + '\n';
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;
    errs.push('console: ' + m.text());
  });
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1100);

  /* Put the program in the editor and open the terminal, exactly as a learner
     would: paste, then type commands. */
  const boot = await page.evaluate((src) => {
    showWorkspace();
    const ed = document.querySelector('#sourceEdit');
    ed.value = src;
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof setDockTab === 'function') setDockTab('terminal');
    term.lines = [];
    return { editorLen: ed.value.length, tab: ui.dockTab };
  }, PROG);
  check('the program can be pasted into the editor', boot.editorLen === PROG.length,
        boot.editorLen + ' chars');
  check('and the terminal is a dock tab of the existing workspace', boot.tab === 'terminal', boot.tab);

  /* Run a terminal line and return everything printed by it. */
  const cmd = (line) => page.evaluate((l) => {
    const before = term.lines.length;
    termRun(l);
    if (typeof renderDock === 'function') renderDock();
    return term.lines.slice(before).map(x => ({ kind: x.kind, text: x.text }));
  }, line);
  const textOf = (out) => out.map(x => x.text).join('\n');

  /* ================= shell word splitting ============================= */
  console.log('\n== the terminal splits a command line the way a shell does ==');
  const splits = [
    ['./p', []],
    ['./p hello', ['hello']],
    ['./p hello world', ['hello', 'world']],
    ['./p "hello world"', ['hello world']],
    ['./p "hello world" 42 test', ['hello world', '42', 'test']],
    ["./p 'single quoted'", ['single quoted']],
    ['./p ""', []],
  ];
  for (const [line, want] of splits) {
    const got = await page.evaluate(l => termParse(l).slice(1), line);
    check('  ' + line + '  ->  ' + JSON.stringify(want),
          JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  }

  /* ================= gcc, flags and -o ================================ */
  console.log('\n== gcc file.c -o name ==');
  let out = await cmd('gcc interval_spaces.c -o interval_spaces');
  let t = textOf(out);
  check('gcc is a command', !/is not available/.test(t), t.split('\n')[0]);
  check('it compiles and names the executable',
        /Compilation successful\./.test(t) && /Generated simulated executable: interval_spaces/.test(t),
        t.replace(/\n/g, ' | ').slice(0, 120));
  check('it says the compiler is the lab\'s own, not the system gcc',
        /not your system gcc/.test(t));
  check('and that a new .c name is bound to the editor buffer',
        /bound to the editor buffer/.test(t));

  out = await cmd('gcc -Wall -Wextra -Werror interval_spaces.c -o interval_spaces');
  t = textOf(out);
  check('the standard warning flags are accepted',
        /flags accepted: -Wall -Wextra -Werror/.test(t) && /Compilation successful/.test(t));
  check('and the page states that no diagnostic is suppressed',
        /suppresses none of them/.test(t));

  out = await cmd('gcc -Wbogus interval_spaces.c');
  t = textOf(out);
  check('an unknown flag is a real diagnostic, not silently ignored',
        /unrecognized command line option '-Wbogus'/.test(t), t.split('\n')[0]);

  out = await cmd('gcc interval_spaces.c -o');
  check('a missing -o argument is diagnosed',
        /argument to '-o' is missing/.test(textOf(out)));

  out = await cmd('gcc notes.txt');
  check('a non-.c input is refused', /file format not recognized/.test(textOf(out)));

  /* ================= running it ======================================= */
  console.log('\n== ./interval_spaces "Hello World" ==');
  await cmd('gcc interval_spaces.c -o interval_spaces');
  out = await cmd('./interval_spaces "Hello World"');
  t = textOf(out);
  const engOut = await page.evaluate(() => run.history.stateAt(run.history.length - 1).output || '');
  const stdout = out.filter(x => x.kind === 'stdout').map(x => x.text).join('');
  check('the program runs and produces its real output',
        engOut === expected(['Hello World']),
        JSON.stringify(engOut) + ' vs ' + JSON.stringify(expected(['Hello World'])));
  /* termEcho pushes one terminal line per newline, so the joined lines carry
     the text without its trailing newline. The engine's own output above is
     what proves the program printed correctly. */
  check('and the terminal shows it (termEcho prints one line per newline)',
        stdout === expected(['Hello World']).replace(/\n/g, ''), JSON.stringify(stdout));
  check('the terminal reports the argv it passed',
        /argc = 2/.test(t) && /argv\[0\] = "\.\/interval_spaces"/.test(t) &&
        /argv\[1\] = "Hello World"/.test(t), t.match(/argc = .*/) ? t.match(/argc = .*/)[0] : '');
  check('and records a step trace for the visualizers',
        /execution steps recorded/.test(t), (t.match(/\[\d+ execution steps recorded/) || [''])[0]);

  const engineArgv = await page.evaluate(() => {
    let live = run.history.length - 1;
    while (live > 0 && !run.history.stateAt(live).frames.length) live--;
    const st = run.history.stateAt(live);
    const f = st.frames[0] || { vars: [] };
    return {
      argc: (f.vars.find(v => v.name === 'argc') || {}).valueText,
      strs: (st.blocks || []).filter(x => /^argv\[\d+\] /.test(x.label)).map(x => x.label),
      steps: run.history.length,
    };
  });
  check('the engine really received argc = 2', engineArgv.argc === '2', String(engineArgv.argc));
  check('argv[0] is the name the program was invoked with',
        /argv\[0\] "\.\/interval_spaces"/.test(engineArgv.strs[0] || ''), engineArgv.strs[0]);
  check('argv[1] is the quoted argument, as one word',
        /argv\[1\] "Hello World"/.test(engineArgv.strs[1] || ''), engineArgv.strs[1]);
  check('and there is no argv[2] — the quotes held it together',
        engineArgv.strs.length === 2, engineArgv.strs.length + ' argument strings');

  /* ================= the other argument counts ======================== */
  console.log('\n== every argument count the brief asks for ==');
  for (const args of [[], ['hello'], ['hello', 'world'], ['hello world'], ['hello world', '42', 'test']]) {
    const line = './interval_spaces ' + args.map(a => /\s/.test(a) ? '"' + a + '"' : a).join(' ');
    out = await cmd(line.trim());
    const so = await page.evaluate(() => run.history.stateAt(run.history.length - 1).output || '');
    const info = await page.evaluate(() => {
      let live = run.history.length - 1;
      while (live > 0 && !run.history.stateAt(live).frames.length) live--;
      const st = run.history.stateAt(live);
      const f = st.frames[0] || { vars: [] };
      return { argc: +(f.vars.find(v => v.name === 'argc') || {}).valueText,
               n: (st.blocks || []).filter(x => /^argv\[\d+\] /.test(x.label)).length };
    });
    check('  ' + (line.trim() || './interval_spaces') + '  ->  argc ' + (args.length + 1),
          info.argc === args.length + 1 && info.n === args.length + 1,
          'argc ' + info.argc + ', ' + info.n + ' strings');
    check('    and prints what the program should print',
          so === expected(args), JSON.stringify(so));
  }

  /* ================= an executable that does not exist ================ */
  console.log('\n== errors ==');
  out = await cmd('./nope');
  check('an unknown executable is "No such file or directory"',
        /No such file or directory/.test(textOf(out)), textOf(out).split('\n')[0]);
  check('and the terminal says what the last compile did produce',
        /the last compile produced \.\/interval_spaces/.test(textOf(out)));

  const broken = PROG.replace('int\ti;', 'int\ti');       // drop a semicolon
  await page.evaluate((src) => {
    const ed = document.querySelector('#sourceEdit');
    ed.value = src; ed.dispatchEvent(new Event('input', { bubbles: true }));
  }, broken);
  out = await cmd('gcc interval_spaces.c -o interval_spaces');
  t = textOf(out);
  check('a compile error is reported with a file and a line',
        /interval_spaces\.c:\d+: error:/.test(t), t.split('\n').find(x => /error:/.test(x)) || t.slice(0, 80));
  out = await cmd('./interval_spaces');
  check('and nothing runs afterwards',
        /No such file or directory/.test(textOf(out)) || /out of date/.test(textOf(out)),
        textOf(out).split('\n')[0]);

  const crash = 'int\tmain(void)\n{\n\tchar\t*p;\n\n\tp = 0;\n\t*p = 65;\n\treturn (0);\n}\n';
  await page.evaluate((src) => {
    const ed = document.querySelector('#sourceEdit');
    ed.value = src; ed.dispatchEvent(new Event('input', { bubbles: true }));
  }, crash);
  await cmd('gcc crash.c -o crash');
  out = await cmd('./crash');
  t = textOf(out);
  check('a null dereference is reported as a runtime error',
        /Null pointer dereference/i.test(t), (t.match(/Null[^\n]*/) || [''])[0].slice(0, 70));
  check('and it is marked as where the run stopped', /the run stopped here/.test(t));

  /* ================= the argv view ==================================== */
  console.log('\n== the argc/argv panel ==');
  await page.evaluate((src) => {
    const ed = document.querySelector('#sourceEdit');
    ed.value = src; ed.dispatchEvent(new Event('input', { bubbles: true }));
  }, PROG);
  await cmd('gcc interval_spaces.c -o interval_spaces');
  await cmd('./interval_spaces "Hello World"');
  out = await cmd('argv');
  t = textOf(out);
  check('argv reports the count and the last valid index',
        /argc = 2\s+\(the count, so the last valid index is 1\)/.test(t),
        (t.match(/argc = [^\n]*/) || [''])[0]);
  check('it shows argv as a char ** holding an address',
        /argv\s+0x[0-9a-f]+\s+a char \*\* — it holds an address/.test(t));
  check('it lists a slot per argument plus the NULL sentinel',
        /argv\[0\]\s+slot 0x/.test(t) && /argv\[1\]\s+slot 0x/.test(t) &&
        /argv\[2\]\s+slot 0x[0-9a-f]+\s+→\s+NULL/.test(t));
  check('and separates the pointer from the pointee',
        /argv is a pointer to pointers/.test(t) &&
        /argv\[1\] is a pointer to the first character/.test(t));

  const wantBytes = 'Hello World'.split('').map((c, i) =>
    ({ i, hex: c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'), ch: c }))
    .concat([{ i: 11, hex: '00', ch: '\\0' }]);
  const byteLines = out.map(x => x.text).filter(x => /^ {2}\s*\d+\s+0x[0-9a-f]+/.test(x));
  check('the byte table has one row per character plus the terminator',
        byteLines.length === wantBytes.length, byteLines.length + ' rows, expected ' + wantBytes.length);
  const badByte = wantBytes.filter((w, k) => {
    const l = byteLines[k] || '';
    return !(new RegExp('^\\s*' + w.i + '\\s+0x[0-9a-f]+\\s+' + w.hex + '\\s').test(l));
  });
  check('every byte is shown with the right index and hex value',
        badByte.length === 0, badByte.slice(0, 3).map(x => x.i + ':' + x.hex).join(', ') || 'all 12');
  check('the terminator is shown as \\0', /\s00\s+\\0/.test(t));
  check('and the addresses are labelled as the simulator\'s own',
        /addresses are this simulator’s own/.test(t) && /not your machine/.test(t));

  out = await cmd('argv 0');
  check('argv <index> selects a different argument',
        /argv\[0\] byte by byte/.test(textOf(out)));

  /* ================= the visualizers see the same run ================= */
  console.log('\n== the run reaches the existing visualizers ==');
  await cmd('./interval_spaces "Hi"');
  const viz = await page.evaluate(() => {
    const out = {};
    const st = run.history.stateAt(run.index);
    out.blocks = (st.blocks || []).length;
    out.regions = [...new Set((st.blocks || []).map(b => b.region))].sort();
    out.edges = (st.graph && st.graph.edges || []).length;
    out.hasArgvArray = (st.blocks || []).some(b => b.label === 'argv array');
    return out;
  });
  check('the memory model holds the argv array and its strings',
        viz.hasArgvArray && viz.blocks >= 5, viz.blocks + ' blocks');
  check('across the regions the visualizers draw',
        viz.regions.indexOf('stack') >= 0 && viz.regions.indexOf('global') >= 0,
        viz.regions.join(','));
  for (const c of ['memory', 'pointers', 'stack', 'timeline', 'inspect']) {
    const o = await cmd(c);
    check('  the existing ' + c + ' view still works on this run',
          !/is not available|internal error/.test(textOf(o)), textOf(o).split('\n')[0].slice(0, 60));
  }

  /* ================= stepping and source-line highlighting ============ */
  console.log('\n== stepping through the run ==');
  const step = await page.evaluate(() => {
    const total = run.history.length;
    goTo(0);
    const first = { idx: run.index, line: run.history.steps[run.index].line };
    doStep(); doStep();
    const later = { idx: run.index, line: run.history.steps[run.index].line };
    doPrev();
    const back = { idx: run.index };
    restart();
    const reset = { idx: run.index, stopped: !!run.stopped };
    return { total, first, later, back, reset };
  });
  check('the run exposes a step trace', step.total > 10, step.total + ' steps');
  check('Step advances through it', step.later.idx === step.first.idx + 2,
        step.first.idx + ' -> ' + step.later.idx);
  check('Previous goes back', step.back.idx === step.later.idx - 1, String(step.back.idx));
  check('Reset returns to the start', step.reset.idx === 0, String(step.reset.idx));
  check('and every step names a source line',
        typeof step.first.line === 'number' && typeof step.later.line === 'number',
        step.first.line + ' / ' + step.later.line);

  const hl = await page.evaluate(() => {
    goTo(Math.floor(run.history.length / 2));
    const line = run.history.steps[run.index].line;
    render();
    const on = document.querySelectorAll('#sourceView .codeline.active');
    return { line, marked: on.length,
             text: on.length ? on[0].textContent.slice(0, 40) : null };
  });
  check('the current source line is highlighted while stepping',
        hl.marked >= 1, 'line ' + hl.line + ', ' + hl.marked + ' marked');

  /* ================= reruns with different arguments ================== */
  console.log('\n== rerunning with different arguments ==');
  const reruns = [];
  for (const a of ['abc', 'xy', 'Hello World']) {
    await cmd('./interval_spaces "' + a + '"');
    const so = await page.evaluate(() =>
      run.history.stateAt(run.history.length - 1).output || '');
    reruns.push({ a, so });
  }
  check('each rerun produces its own output, with no state carried over',
        reruns.every(r => r.so === expected([r.a])),
        reruns.map(r => JSON.stringify(r.so)).join(' '));

  /* ================= honesty ========================================== */
  console.log('\n== the terminal does not pretend ==');
  out = await cmd('help');
  t = textOf(out);
  check('help says this is not a real operating-system shell',
        /not a real operating-system shell/.test(t));
  check('and lists gcc and argv among its commands',
        /gcc/.test(t) && /argv/.test(t));
  const detail = await cmd('help gcc');
  check('help gcc states it is not the system gcc',
        /not your system’s gcc/.test(textOf(detail)));

  /* ================= regression ======================================= */
  console.log('\n== nothing else moved ==');
  const modules = await page.evaluate(() => learnModules().map(m => m.id).join(','));
  check('the four Learn modules are untouched', modules === 'C04,C05,MEM,C06', modules);
  const lessons = await page.evaluate(() => {
    const out = {};
    for (const m of ['C04', 'C05', 'MEM', 'C06']) {
      c4.mod = m; c4.page = 'overview'; showLearn();
      out[m] = c4Pages().length;
    }
    return out;
  });
  check('and their page counts are unchanged',
        lessons.C04 === 19 && lessons.C05 === 22 && lessons.MEM === 27 && lessons.C06 === 17,
        JSON.stringify(lessons));
  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log('\n----------------------------------------------------------------');
  console.log('Terminal execution bridge  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
