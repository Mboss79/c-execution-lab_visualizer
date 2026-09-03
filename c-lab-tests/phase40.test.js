'use strict';
/* Phase 45 — argc / argv: the pointer graph, and the workspace argument editor.
 *
 * Two things were wrong and are asserted here. The graph had 10 nodes and ONE
 * edge: argv reached its vector and stopped, so every argument string reported
 * referencedBy: []. And startExecution() passed a hardcoded {}, so the Run
 * button could only ever produce argc == 1 however the terminal behaved.
 *
 * The engine's argv SEMANTICS were already correct before this phase; those
 * checks are here as regression cover, not as new work.
 */
const path = require('path');
const puppeteer = require('puppeteer-core');
const { load } = require('./load-engine.js');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, inspected = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}
function counted(name, n, floor, detail) {
  inspected += n;
  check(name + ' (' + n + ' inspected)', n >= floor,
        n < floor ? 'VACUOUS: expected at least ' + floor : (detail || ''));
}

const E = load();
const H = 'void\tput(char *s)\n{\n\tint\ti;\n\n\ti = 0;\n\twhile (s[i])\n\t{\n\t\twrite(1, &s[i], 1);\n\t\ti++;\n\t}\n}\n\n' +
          'void\tnbr(int n)\n{\n\tchar\tc;\n\n\tif (n >= 10)\n\t\tnbr(n / 10);\n\tc = 48 + n % 10;\n\twrite(1, &c, 1);\n}\n\n';
function run(src, args, argv0) {
  const o = {};
  if (args) o.args = args;
  if (argv0) o.argv0 = argv0;
  try { return E.runToCompletion(src, o); } catch (e) { return { ok: false, message: 'THREW ' + e.message }; }
}
const outOf = r => (r.ok ? r.output : 'FAIL:' + r.message);
/* stdout only — r.output merges the two streams */
function stdoutOf(r) {
  let s = '';
  for (const st of r.history.steps)
    if (st.detail && st.detail.stream === 'stdout' && st.detail.bytes)
      for (const b of st.detail.bytes) s += String.fromCharCode(b.value);
  return s;
}

console.log('\n=== part 1: argc, for every argument count ===');
const ARGC = H + 'int\tmain(int argc, char **argv)\n{\n\tif (argv[0])\n\t\tnbr(argc);\n\twrite(1, "\\n", 1);\n\treturn (0);\n}\n';
const COUNTS = [[[], '1\n'], [['hello'], '2\n'], [['hello', 'world'], '3\n'],
                [['a', 'b', 'c', 'd', 'e'], '6\n'], [['hello world'], '2\n'], [[''], '2\n']];
let cn = 0;
for (const [args, want] of COUNTS) {
  cn++;
  check('[' + (pass + fail + 1) + '] argc for ' + JSON.stringify(args),
    outOf(run(ARGC, args)) === want, JSON.stringify(outOf(run(ARGC, args))));
}
inspected += cn;

console.log('\n=== part 2: the NULL sentinel and the last real argument ===');
const NUL = H + 'int\tmain(int argc, char **argv)\n{\n\tif (argv[argc] == 0)\n\t\tput("NULL");\n\telse\n\t\tput("NOT-NULL");\n' +
  '\twrite(1, " ", 1);\n\tput(argv[argc - 1]);\n\twrite(1, "\\n", 1);\n\treturn (0);\n}\n';
check('[' + (pass + fail + 1) + '] argv[argc] is NULL and argv[argc-1] is the last argument',
  outOf(run(NUL, ['x', 'last'])) === 'NULL last\n', JSON.stringify(outOf(run(NUL, ['x', 'last']))));
check('[' + (pass + fail + 1) + '] with no arguments argv[1] is NULL and argv[0] is the program',
  outOf(run(NUL, [])) === 'NULL ./a.out\n', JSON.stringify(outOf(run(NUL, []))));
inspected += 2;

console.log('\n=== part 3: argv[0], default and configured ===');
const A0 = H + 'int\tmain(int argc, char **argv)\n{\n\tif (argc)\n\t\tput(argv[0]);\n\twrite(1, "\\n", 1);\n\treturn (0);\n}\n';
check('[' + (pass + fail + 1) + '] argv[0] defaults to ./a.out', outOf(run(A0, ['x'])) === './a.out\n');
check('[' + (pass + fail + 1) + '] argv[0] is configurable', outOf(run(A0, ['x'], './myprog')) === './myprog\n');
inspected += 2;

console.log('\n=== part 4: argv[i][j] and the terminator ===');
const IJ = H + 'int\tmain(int argc, char **argv)\n{\n\tint\ti;\n\n\tif (argc < 2)\n\t\treturn (0);\n\ti = 0;\n' +
  '\twhile (argv[1][i])\n\t{\n\t\twrite(1, &argv[1][i], 1);\n\t\ti++;\n\t}\n' +
  '\twrite(1, "|", 1);\n\tnbr(i);\n\tif (argv[1][i] == 0)\n\t\tput("|NUL");\n\twrite(1, "\\n", 1);\n\treturn (0);\n}\n';
check('[' + (pass + fail + 1) + '] argv[1][i] walks the string and stops at the terminator',
  outOf(run(IJ, ['hello'])) === 'hello|5|NUL\n', JSON.stringify(outOf(run(IJ, ['hello']))));
const PICK = H + 'int\tmain(int argc, char **argv)\n{\n\tif (argc > 1)\n\t\twrite(1, &argv[1][6], 1);\n\twrite(1, "\\n", 1);\n\treturn (0);\n}\n';
check('[' + (pass + fail + 1) + '] argv[1][6] of "hello world hello cat" is the w',
  outOf(run(PICK, ['hello world hello cat'])) === 'w\n',
  JSON.stringify(outOf(run(PICK, ['hello world hello cat']))));
check('[' + (pass + fail + 1) + '] an empty argument is one argument whose first byte is the terminator',
  outOf(run(IJ, [''])) === '|0|NUL\n', JSON.stringify(outOf(run(IJ, ['']))));
inspected += 3;

console.log('\n=== part 5: a value with spaces stays ONE argument ===');
const SHOW = H + 'int\tmain(int argc, char **argv)\n{\n\tint\ti;\n\n\ti = 1;\n\tnbr(argc);\n\twrite(1, ":", 1);\n' +
  '\twhile (i < argc)\n\t{\n\t\tput(argv[i]);\n\t\twrite(1, "|", 1);\n\t\ti++;\n\t}\n\twrite(1, "\\n", 1);\n\treturn (0);\n}\n';
check('[' + (pass + fail + 1) + '] ["hello","world"] is two arguments',
  outOf(run(SHOW, ['hello', 'world'])) === '3:hello|world|\n');
check('[' + (pass + fail + 1) + '] ["hello world"] is ONE argument',
  outOf(run(SHOW, ['hello world'])) === '2:hello world|\n');
check('[' + (pass + fail + 1) + '] repeated identical arguments are distinct entries',
  outOf(run(SHOW, ['hello', 'hello'])) === '3:hello|hello|\n');
inspected += 3;

console.log('\n=== part 6: startup binds argc/argv BEFORE the first statement ===');
const DECL = 'int\tmain(int argc, char **argv)\n{\n\tint\ti;\n\n\ti = argc;\n\tif (argv[0])\n\t\ti = 1;\n\treturn (0);\n}\n';
const r6 = run(DECL, ['hello']);
const phases = r6.history.steps.map(s => s.phase);
const bindAt = phases.indexOf('bind-param');
const declAt = phases.indexOf('decl');
check('[' + (pass + fail + 1) + '] there is a bind-param startup step', bindAt >= 0, phases.slice(0, 4).join(','));
check('[' + (pass + fail + 1) + '] it happens before the first declaration', bindAt >= 0 && bindAt < declAt,
  'bind=' + bindAt + ' decl=' + declAt);
const d6 = r6.history.steps[bindAt].detail.argv;
check('[' + (pass + fail + 1) + '] the startup step carries argc, the vector and every string',
  d6.argc === 2 && typeof d6.vector === 'number' && d6.strings.length === 2 && typeof d6.nullAt === 'number',
  JSON.stringify({ argc: d6.argc, strings: d6.strings.length }));
/* argc and argv must be initialised at that point; a later local must not be */
const stAfterDecl = r6.history.stateAt(declAt);
const vAt = n => stAfterDecl.vars.find(v => v.name === n);
check('[' + (pass + fail + 1) + '] argc and argv are initialised while i is not',
  vAt('argc') && !vAt('argc').uninitialized && vAt('argv') && !vAt('argv').uninitialized &&
  vAt('i') && vAt('i').uninitialized,
  'argc=' + (vAt('argc') || {}).uninitialized + ' argv=' + (vAt('argv') || {}).uninitialized +
  ' i=' + (vAt('i') || {}).uninitialized);
inspected += 4;

console.log('\n=== part 7: types are the real C types ===');
const st7 = (() => { const r = run(DECL, ['hello', 'world']);
  for (let i = r.history.length - 1; i >= 0; i--) { const s = r.history.stateAt(i);
    if (s.frames.length && s.vars.length) return s; } return null; })();
const t7 = n => (st7.vars.find(v => v.name === n) || {}).typeName;
check('[' + (pass + fail + 1) + '] argc is int', t7('argc') === 'int', String(t7('argc')));
check('[' + (pass + fail + 1) + '] argv is char **, not an integer or a bare address',
  t7('argv') === 'char **', String(t7('argv')));
inspected += 2;

console.log('\n=== part 8: THE FIX — the pointer graph reaches the strings ===');
const g8 = st7.graph;
const argvNode = g8.nodes.find(n => n.varName === 'argv');
const arrNode = g8.nodes.find(n => /argv array/.test(String(n.label)));
const strNodes = g8.nodes.filter(n => /^argv\[\d+\] "/.test(String(n.label)));
counted('[' + (pass + fail + 1) + '] graph edges', g8.edges.length, 5);
check('[' + (pass + fail + 1) + '] argv points at the vector',
  !!argvNode && !!arrNode && g8.edges.some(e => e.from === argvNode.id && e.to === arrNode.id && e.kind === 'points-to'));
const cellEdges = g8.edges.filter(e => e.from === (arrNode || {}).id);
check('[' + (pass + fail + 1) + '] the vector has one edge per cell, including the sentinel',
  cellEdges.length === 4, cellEdges.length + ' cells');
check('[' + (pass + fail + 1) + '] each cell points at its own string',
  strNodes.length === 3 && strNodes.every(s => cellEdges.some(e => e.to === s.id && e.kind === 'points-to')),
  strNodes.map(s => s.label).join(' | '));
check('[' + (pass + fail + 1) + '] the last cell is a NULL edge, not a missing one',
  cellEdges.filter(e => e.kind === 'null').length === 1);
check('[' + (pass + fail + 1) + '] the cell edges are named argv[0], argv[1], argv[2], argv[3]',
  cellEdges.map(e => e.name).join(',') === 'argv[0],argv[1],argv[2],argv[3]',
  cellEdges.map(e => e.name).join(','));
check('[' + (pass + fail + 1) + '] each cell edge records its index and slot address',
  cellEdges.every((e, i) => e.cellIndex === i && typeof e.cellAddress === 'number'));
check('[' + (pass + fail + 1) + '] every string knows what points AT it (referencedBy)',
  strNodes.every(s => s.referencedBy && s.referencedBy.length === 1),
  JSON.stringify(strNodes.map(s => (s.referencedBy || []).length)));
const chain = g8.chains[argvNode.blockId];
check('[' + (pass + fail + 1) + '] the chain from argv reaches a string object',
  !!chain && chain.length >= 5 && chain[chain.length - 1].kind === 'object' &&
  /^argv\[\d+\] "/.test(String(chain[chain.length - 1].label)),
  chain ? chain.length + ' hops, ends at ' + chain[chain.length - 1].label : 'no chain');
inspected += 8;

console.log('\n=== part 9: it is a general rule, not an argv special case ===');
const TAB = H + 'int\tmain(void)\n{\n\tchar\t*tab[3];\n\n\ttab[0] = "ab";\n\ttab[1] = "cd";\n\ttab[2] = 0;\n' +
  '\tput(tab[0]);\n\treturn (0);\n}\n';
const r9 = run(TAB, []);
let st9 = null;
for (let i = r9.history.length - 1; i >= 0 && !st9; i--) {
  const s = r9.history.stateAt(i);
  if (s.frames.length && s.vars.some(v => v.name === 'tab')) st9 = s;
}
check('[' + (pass + fail + 1) + '] a student-written char *tab[3] gets cell edges too',
  !!st9 && (() => {
    const t = st9.graph.nodes.find(n => n.varName === 'tab');
    return !!t && st9.graph.edges.filter(e => e.from === t.id).length === 3;
  })(),
  st9 ? String(st9.graph.edges.filter(e => e.from === (st9.graph.nodes.find(n => n.varName === 'tab') || {}).id).length) : 'no state');
inspected += 1;

console.log('\n=== part 10: programs without argv are untouched ===');
const PLAIN = H + 'int\tmain(void)\n{\n\tput("plain");\n\twrite(1, "\\n", 1);\n\treturn (0);\n}\n';
const r10 = run(PLAIN, ['ignored']);
check('[' + (pass + fail + 1) + '] a main(void) still runs and ignores arguments',
  outOf(r10) === 'plain\n', JSON.stringify(outOf(r10)));
check('[' + (pass + fail + 1) + '] and produces no bind-param startup step',
  r10.history.steps.map(s => s.phase).indexOf('bind-param') < 0);
inspected += 2;

(async () => {
  console.log('\n=== part 11: the workspace argument editor, in a real browser ===');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--allow-file-access-from-files', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  const ARGVSRC = 'int\tmain(int argc, char **argv)\n{\n\tint\ti;\n\n\ti = 1;\n\twhile (i < argc)\n\t{\n' +
    '\t\tint\tj;\n\n\t\tj = 0;\n\t\twhile (argv[i][j])\n\t\t{\n\t\t\twrite(1, &argv[i][j], 1);\n\t\t\tj++;\n\t\t}\n' +
    '\t\twrite(1, "\\n", 1);\n\t\ti++;\n\t}\n\treturn (0);\n}\n';

  const vis = await page.evaluate((src) => {
    localStorage.removeItem('cexlab.ui.v3');
    ui.args = []; ui.argv0 = './a.out';
    $('#sourceEdit').value = src;
    scheduleSourceRepaint();
    return { shown: !$('#argvBar').hidden, rows: document.querySelectorAll('#argvBar .ab-row').length };
  }, ARGVSRC);
  check('[' + (pass + fail + 1) + '] the strip appears for a main that takes argv',
    vis.shown && vis.rows === 1, JSON.stringify(vis));

  const hid = await page.evaluate(() => {
    $('#sourceEdit').value = 'int\tmain(void)\n{\n\treturn (0);\n}\n';
    scheduleSourceRepaint();
    return $('#argvBar').hidden;
  });
  check('[' + (pass + fail + 1) + '] and is hidden for a main that does not', hid === true);

  const added = await page.evaluate((src) => {
    $('#sourceEdit').value = src; scheduleSourceRepaint();
    $('#argvAdd').click(); $('#argvAdd').click();
    const ins = [...document.querySelectorAll('#argvBar [data-argvi]')];
    ins[0].value = 'hello world';
    ins[0].dispatchEvent(new Event('input', { bubbles: true }));
    ins[1].value = '42';
    ins[1].dispatchEvent(new Event('input', { bubbles: true }));
    return { args: ui.args.slice(), argc: document.querySelector('#argvBar .ab-argc b').textContent,
             nul: document.querySelector('#argvBar .ab-null').textContent };
  }, ARGVSRC);
  check('[' + (pass + fail + 1) + '] adding rows records the arguments verbatim',
    JSON.stringify(added.args) === JSON.stringify(['hello world', '42']), JSON.stringify(added.args));
  check('[' + (pass + fail + 1) + '] argc shown is 3 and argv[3] is announced as NULL',
    added.argc === '3' && /argv\[3\] = NULL/.test(added.nul), added.argc + ' / ' + added.nul);

  const ran = await page.evaluate(() => {
    startExecution();
  const drive = () => {
    /* doStep() returns undefined, so drive until the index stops advancing. */
    let last = -1, guard = 0;
    while (run.index !== last && guard++ < 4000) { last = run.index; doStep(); }
    for (let i = 0; i < run.history.length; i++) {
      const v = run.history.stateAt(i).vars.find(x => x.name === 'argc');
      if (v && v.valueText) return v.valueText;
    }
    return null;
  };
    return { opts: JSON.parse(JSON.stringify(run.opts || {})), argcSeen: drive() };
  });
  check('[' + (pass + fail + 1) + '] Run passes those arguments to the engine',
    JSON.stringify(ran.opts.args) === JSON.stringify(['hello world', '42']), JSON.stringify(ran.opts));
  check('[' + (pass + fail + 1) + '] and the engine binds argc = 3',
    String(ran.argcSeen) === '3', String(ran.argcSeen));

  const persisted = await page.evaluate(() => { saveUI(); return localStorage.getItem('cexlab.ui.v3'); });
  const back = await (async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1400);
    return page.evaluate(() => ({ args: ui.args, argv0: ui.argv0 }));
  })();
  check('[' + (pass + fail + 1) + '] the arguments survive a reload',
    JSON.stringify(back.args) === JSON.stringify(['hello world', '42']), JSON.stringify(back.args));
  check('[' + (pass + fail + 1) + '] they are stored in the existing UI key',
    /"args":\["hello world","42"\]/.test(persisted || ''));

  console.log('\n=== part 12: workspace and terminal produce the SAME argv ===');
  const same = await page.evaluate((src) => {
    ui.args = ['hello', 'world']; ui.argv0 = './a.out';
    $('#sourceEdit').value = src; scheduleSourceRepaint();
    startExecution();
  const drive = () => {
    /* doStep() returns undefined, so drive until the index stops advancing. */
    let last = -1, guard = 0;
    while (run.index !== last && guard++ < 4000) { last = run.index; doStep(); }
    for (let i = 0; i < run.history.length; i++) {
      const v = run.history.stateAt(i).vars.find(x => x.name === 'argc');
      if (v && v.valueText) return v.valueText;
    }
    return null;
  };
    const wsOpts = JSON.parse(JSON.stringify(run.opts || {}));
    const wsArgc = drive();
    /* the terminal path: the same launch(), given the same two arguments */
    launch(src, { args: ['hello', 'world'], argv0: './a.out' });
    const tmArgc = drive();
    return { wsOpts, wsArgc, tmArgc };
  }, ARGVSRC);
  check('[' + (pass + fail + 1) + '] both routes bind the same argc',
    same.wsArgc === same.tmArgc && same.wsArgc === '3',
    'workspace=' + same.wsArgc + ' terminal=' + same.tmArgc);
  check('[' + (pass + fail + 1) + '] the workspace uses the same opts shape the terminal passes',
    JSON.stringify(same.wsOpts.args) === JSON.stringify(['hello', 'world']), JSON.stringify(same.wsOpts));

  check('[' + (pass + fail + 1) + '] no page or console errors', errors.length === 0,
    errors.slice(0, 2).join(' | '));
  inspected += 11;

  console.log('\n' + '-'.repeat(64));
  console.log('TOTAL ITEMS INSPECTED: ' + inspected);
  console.log('PHASE 45  pass ' + pass + '  fail ' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
