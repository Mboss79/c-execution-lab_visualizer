'use strict';
/* Phase 11 — argc, argv and command-line arguments.

   The claim under test: there is ONE execution model. The arguments are built
   by the engine at start-up, the program reads them through ordinary C, and the
   lab and the terminal both reach them through the same launch(). Every number
   the UI shows is compared against the engine's snapshot for the same step. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { load, HTML } = require('./load-engine.js');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}
const E = load();
const runArgs = (src, args) => E.runToCompletion(src, { args, argv0: './a.out' });
const valsOf = (r, names) => {
  if (!r.history) return null;
  for (let i = r.history.length - 1; i >= 0; i--) {
    const st = r.history.stateAt(i);
    if (!st.vars.length) continue;
    const out = {};
    let all = true;
    for (const n of names) {
      const v = st.vars.find(x => x.name === n);
      if (!v || v.uninitialized) { all = false; break; }
      out[n] = v.valueText;
    }
    if (all) return out;
  }
  return null;
};

(async () => {
  console.log('=== part 1: argc ===');
  const AC = 'int main(int argc, char **argv){ int n; n = argc; return 0; }';
  for (const [args, want] of [[[], '1'], [['hello'], '2'], [['hello', 'world'], '3'], [['A', 'B', 'C'], '4']]) {
    const v = valsOf(runArgs(AC, args), ['n']);
    check('./a.out ' + (args.join(' ') || '(no arguments)') + ' gives argc = ' + want,
          v && v.n === want, v ? v.n : 'not bound');
  }

  console.log('\n=== part 2: argv indexing and the NULL sentinel ===');
  const IDX = 'int main(int argc, char **argv){ char *a; char *b; char *z; a=argv[0]; b=argv[1]; z=argv[argc]; return 0; }';
  const idx = valsOf(runArgs(IDX, ['hello']), ['a', 'b', 'z']);
  check('argv[0] and argv[1] are distinct real addresses',
        idx && /^0x/.test(idx.a) && /^0x/.test(idx.b) && idx.a !== idx.b, JSON.stringify(idx));
  check('argv[argc] is NULL', idx && idx.z === 'NULL', idx ? idx.z : '');
  const CH = 'int main(int argc, char **argv){ char c; char d; c=argv[1][0]; d=argv[1][4]; return 0; }';
  const ch = valsOf(runArgs(CH, ['hello']), ['c', 'd']);
  check('argv[i][j] reaches the right characters of "hello"',
        ch && /'h'/.test(ch.c) && /'o'/.test(ch.d), JSON.stringify(ch));
  const EQ = 'int main(int argc, char **argv){ char *s; char c; s=*(argv+1); c=**(argv+1); return 0; }';
  const eq = valsOf(runArgs(EQ, ['hello']), ['s', 'c']);
  check('*(argv+1) equals argv[1], and **(argv+1) equals argv[1][0]',
        eq && eq.s === idx.b && /'h'/.test(eq.c), JSON.stringify(eq));
  const LOOP = 'int main(int argc, char **argv){ int n; n=0; while (argv[n] != NULL) n++; return 0; }';
  for (const [args, want] of [[[], '1'], [['x'], '2'], [['x', 'y'], '3']]) {
    const v = valsOf(runArgs(LOOP, args), ['n']);
    check('the NULL sentinel stops a loop after ' + want + ' element(s)', v && v.n === want, v ? v.n : '');
  }

  console.log('\n=== part 3: pointer arithmetic and the graph ===');
  const PA = 'int main(int argc, char **argv){ char **p; char **q; p=argv; q=argv+1; return 0; }';
  const pa = valsOf(runArgs(PA, ['a', 'b']), ['p', 'q']);
  check('argv + 1 advances by sizeof(char *), not by one byte',
        parseInt(pa.q, 16) - parseInt(pa.p, 16) === E.ARCH.sizes.pointer,
        'delta ' + (parseInt(pa.q, 16) - parseInt(pa.p, 16)) + ', pointer size ' + E.ARCH.sizes.pointer);
  const g = (() => {
    const r = runArgs(IDX, ['hello']);
    for (let i = r.history.length - 1; i >= 0; i--) {
      const st = r.history.stateAt(i);
      if (st.graph.edges.some(e => e.name === 'argv')) return st.graph;
    }
    return null;
  })();
  check('the EXISTING pointer graph carries argv', !!g);
  const argvEdge = g.edges.find(e => e.name === 'argv');
  const vec = g.nodes.find(n => n.id === argvEdge.to);
  check('argv points at the array of char *',
        vec && vec.label === 'argv array' && /char \*\[/.test(vec.typeName), vec ? vec.typeName : '');
  const strs = g.nodes.filter(n => /^argv\[\d+\]/.test(n.label));
  check('each argument string is its own object in memory',
        strs.length === 2 && strs.every(n => n.section === 'data'),
        strs.map(n => n.label + '@' + n.sectionLabel).join(' '));
  check('the graph reports a NULL edge for the sentinel variable',
        g.edges.some(e => e.name === 'z' && e.kind === 'null'));
  const chain = g.chains[g.nodes.find(n => n.label === 'argv').blockId]
    .filter(h => h.kind === 'object').map(h => h.label);
  check('argv -> argv array is a chain in the existing graph',
        chain[0] === 'argv' && chain[1] === 'argv array', chain.join(' -> '));
  check('a string object knows which variable points at it',
        strs.some(n => (n.referencedBy || []).length > 0),
        JSON.stringify(strs.map(n => n.label + ':' + (n.referencedBy || []).map(r => r.name).join(','))));

  console.log('\n=== part 4: the bytes are real ===');
  const rb = runArgs(IDX, ['hello']);
  let strNode = null;
  for (let i = rb.history.length - 1; i >= 0 && !strNode; i--) {
    const n = rb.history.stateAt(i).graph.nodes.find(x => x.label.indexOf('argv[1]') === 0);
    if (n) strNode = n;
  }
  check('"hello" is stored as 68 65 6C 6C 6F 00',
        strNode && strNode.bytes.map(b => Number(b.value).toString(16).toUpperCase().padStart(2, '0')).join(' ')
          === '68 65 6C 6C 6F 00',
        strNode ? strNode.bytes.map(b => Number(b.value)).join(',') : 'no node');
  check('the string block is NUL-terminated and sized accordingly',
        strNode.size === 6 && Number(strNode.bytes[5].value) === 0);

  console.log('\n=== part 5: write() takes argv[1] like any buffer ===');
  const W = 'int main(int argc, char **argv){ write(1, argv[1], 5); return 0; }';
  const rw = runArgs(W, ['hello']);
  check('write(1, argv[1], 5) prints hello', rw.ok && rw.output === 'hello', JSON.stringify(rw.output));
  const wd = (() => {
    for (let i = rw.history.length - 1; i >= 0; i--) {
      const s = rw.history.steps[i];
      if (s.detail && s.detail.buffer !== undefined) return s.detail;
    }
    return null;
  })();
  check('the buffer write() received is the argv[1] object\u2019s own address',
        wd && wd.buffer === strNode.address, '0x' + (wd ? wd.buffer.toString(16) : '?'));

  console.log('\n=== part 6: invalid access is not given a fake result ===');
  const OOB = 'int main(int argc, char **argv){ char c; c = argv[1][0]; return 0; }';
  const oob = runArgs(OOB, []);
  check('reading argv[1] when argc == 1 stops honestly',
        !oob.ok && oob.kind === 'null-deref', oob.kind + ': ' + (oob.message || '').slice(0, 60));
  const GUARD = 'int main(int argc, char **argv){ if (argc > 1) write(1, argv[1], 5); return 0; }';
  check('the guarded version runs clean with no arguments',
        runArgs(GUARD, []).ok && runArgs(GUARD, []).output === '');
  check('and prints when an argument is supplied',
        runArgs(GUARD, ['hello']).output === 'hello');

  console.log('\n=== part 7: nothing else changed ===');
  check('main(void) still runs and ignores arguments',
        runArgs('int main(void){ int x; x=1; return 0; }', ['a', 'b']).ok);
  check('the inputString parameter path still works',
        E.runToCompletion('int f(char *s){ return s[0]; } int main(void){ return 0; }',
                          { inputString: 'hi' }).ok);
  const html = fs.readFileSync(HTML, 'utf8');
  for (const [what, re] of [
    ['argv[0] spelling is a convention', /argv\[0\] is spelled/],
    ['the storage placement is a convention', /writable static storage in this simulator/],
    ['process start-up is not modelled', /Process start-up is not modelled/]]) {
    check('SIMPLIFICATIONS states that ' + what, re.test(html));
  }

  console.log('\n=== part 8: the lab shows the engine\u2019s own numbers ===');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1150 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  const setEx = async (id, args) => {
    await page.evaluate((e, a) => {
      showLab(); lab.tab = 'argv'; lab.avEx = e; lab.avArgs = a; lab.avStep = null; lab.avIndex = null; renderLab();
    }, id, args || null);
    await sleep(330);
  };
  await setEx('count');
  check('the lab is a tab in the ONE existing strip',
        (await page.evaluate(() => [...document.querySelectorAll('.vl-tab')].map(e => e.dataset.labtab)))
          .indexOf('argv') >= 0 &&
        (await page.evaluate(() => document.querySelectorAll('.vl-tabs').length)) === 1);

  const shown = await page.evaluate(() => {
    const c = argvCur(); const st = c.cur.state;
    const ui = {
      vars: [...document.querySelectorAll('.av-var')].map(v => ({
        k: v.querySelector('.av-k').textContent.trim(), v: v.querySelector('b').textContent.trim() })),
      slots: [...document.querySelectorAll('.av-slot')].map(s => ({
        i: s.querySelector('.av-slot-i').textContent.trim(),
        at: s.querySelector('.av-slot-a').textContent.trim(),
        v: s.querySelector('.av-slot-v').textContent.trim() })),
    };
    const g2 = st.graph;
    const vecN = g2.nodes.find(n => n.label === 'argv array');
    const psz = CEngine.ARCH.sizes.pointer;
    return { ui,
      engArgc: st.vars.find(v => v.name === 'argc').valueText,
      engArgv: st.vars.find(v => v.name === 'argv').valueText,
      engSlotAddrs: Array.from({ length: vecN.size / psz }, (_, i) =>
        '0x' + (vecN.address + i * psz).toString(16)),
      engStrings: g2.nodes.filter(n => /^argv\[\d+\]/.test(n.label))
        .sort((a, b2) => a.address - b2.address).map(n => '0x' + n.address.toString(16)) };
  });
  check('argc and argv shown are the engine\u2019s values',
        shown.ui.vars[0].v === shown.engArgc && shown.ui.vars[1].v === shown.engArgv,
        JSON.stringify(shown.ui.vars));
  check('every array slot is drawn at the engine\u2019s own address',
        JSON.stringify(shown.ui.slots.map(s => s.at)) === JSON.stringify(shown.engSlotAddrs),
        shown.ui.slots.map(s => s.at).join(' '));
  check('each slot points at the engine\u2019s string address',
        shown.engStrings.every((a, i) => shown.ui.slots[i].v.indexOf(a) === 0),
        shown.ui.slots.map(s => s.v).join(' | '));
  check('the last slot is drawn as NULL, not as a value',
        shown.ui.slots[shown.ui.slots.length - 1].v === 'NULL' &&
        shown.ui.slots.length === Number(shown.engArgc) + 1,
        shown.ui.slots.length + ' slots for argc ' + shown.engArgc);

  console.log('\n=== part 9: the ladder and the builder ===');
  await setEx('index');
  await page.evaluate(() => { lab.avIndex = 1; renderLab(); });
  await sleep(300);
  const lad = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.av-rung')].map(r => ({
      e: r.querySelector('.av-rung-e').textContent.trim(),
      t: r.querySelector('.av-rung-t').textContent.trim(),
      v: r.querySelector('.av-rung-v').textContent.trim() })),
    bytes: [...document.querySelectorAll('.av-byte')].map(x =>
      x.querySelector('.av-byte-v').textContent.trim() + '/' + x.querySelector('.av-byte-c').textContent.trim()),
  }));
  check('the ladder shows argv, argv+1, argv[1], argv[1][0] with their types',
        lad.rows.map(r => r.e).join(' ') === 'argv argv + 1 argv[1] argv[1][0]' &&
        lad.rows[0].t === 'char **' && lad.rows[2].t === 'char *' && lad.rows[3].t === 'char',
        lad.rows.map(r => r.e + ':' + r.t).join(' '));
  check('the ladder\u2019s character is the real first byte',
        /'h'/.test(lad.rows[3].v), lad.rows[3].v);
  check('the byte strip is the real string, NUL included',
        lad.bytes.join(' ') === '68/h 65/e 6C/l 6C/l 6F/o 00/NUL', lad.bytes.join(' '));

  const built = await page.evaluate(() => {
    lab.avEx = 'count'; lab.avArgs = ['hello', 'world']; lab.avStep = null; renderLab();
    const before = argvCur().cur.state.vars.find(v => v.name === 'argc').valueText;
    document.querySelector('#avNew').value = 'again';
    document.querySelector('#avAdd').click();
    const after = argvCur().cur.state.vars.find(v => v.name === 'argc').valueText;
    return { before, after,
             slots: [...document.querySelectorAll('.av-slot')].length,
             args: lab.avArgs.slice() };
  });
  check('adding an argument re-runs the program and argc really changes',
        built.before === '3' && built.after === '4' && built.slots === 5,
        built.before + ' -> ' + built.after + ', ' + built.slots + ' slots');

  console.log('\n=== part 10: the timeline ===');
  await setEx('index', ['hello']);
  const walk = await page.evaluate(() => {
    const run = argvRun();
    const out = [];
    for (let i = 0; i < run.steps.length; i++) {
      lab.avStep = i; renderLab();
      const st = run.steps[i].state;
      const a = st.vars.find(v => v.name === 'argc');
      const uiVars = [...document.querySelectorAll('.av-var')];
      const uiArgc = uiVars.length ? uiVars[0].querySelector('b').textContent.trim() : null;
      const on = document.querySelector('.av-srcline.on');
      out.push({ i, eng: a && !a.uninitialized ? a.valueText : null, ui: uiArgc,
                 line: run.steps[i].step.line,
                 srcOn: on ? parseInt(on.textContent.trim(), 10) : null });
    }
    return out;
  });
  const cmp = walk.filter(w => w.eng !== null && w.ui !== null && w.ui !== '?');
  check('at every step the UI\u2019s argc is history.stateAt(step)\u2019s argc',
        cmp.length > 2 && cmp.every(w => w.ui === w.eng), cmp.length + ' steps compared');
  check('the highlighted source line follows the engine\u2019s line',
        walk.every(w => w.srcOn === null || w.srcOn === w.line));
  check('argv is not bound before the binding step, and is after',
        walk[0].ui === null || walk[0].ui === '?' , 'first step shows ' + walk[0].ui);

  console.log('\n=== part 11: the terminal is the same execution path ===');
  await page.evaluate(() => { showWorkspace(); setDockTab('terminal'); });
  await sleep(350);
  const type = async (cmd) => {
    await page.click('#termInput');
    await page.type('#termInput', cmd, { delay: 1 });
    await page.keyboard.press('Enter');
    await sleep(240);
  };
  await page.evaluate(() => {
    switchToEditing();
    document.querySelector('#sourceEdit').value =
      'int\tmain(int argc, char **argv)\n{\n\twrite(1, argv[2], 3);\n\treturn (0);\n}\n';
  });
  const file = await page.evaluate(() => fileNameFor(ui.exampleKey));
  await type('cc ' + file);
  await type('./a.out one two');
  const t1 = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.tm-line')].slice(-8).map(l => ({ k: l.className, t: l.textContent }));
    let argc = null, argv1 = null;
    for (let i = run.history.length - 1; i >= 0; i--) {
      const st = run.history.stateAt(i);
      const a = st.vars.find(v => v.name === 'argc');
      if (a && !a.uninitialized) { argc = a.valueText; break; }
    }
    return { lines, argc, src: run.src };
  });
  check('the terminal really passed 2 arguments (argc = 3)', t1.argc === '3', String(t1.argc));
  check('the program printed argv[2]',
        t1.lines.some(l => /tm-stdout/.test(l.k) && l.t === 'two'),
        JSON.stringify(t1.lines.filter(l => /stdout/.test(l.k)).map(l => l.t)));
  check('it ran the CURRENT editor buffer, not a stored example',
        t1.src.indexOf('argv[2], 3') >= 0);
  await type('./a.out "hello world"');
  const t2 = await page.evaluate(() => {
    for (let i = run.history.length - 1; i >= 0; i--) {
      const st = run.history.stateAt(i);
      const a = st.vars.find(v => v.name === 'argc');
      if (a && !a.uninitialized) {
        const g3 = st.graph.nodes.find(n => n.label.indexOf('argv[1]') === 0);
        let s = '';
        if (g3) for (const b2 of g3.bytes) { const v = Number(b2.value); if (!v) break; s += String.fromCharCode(v); }
        return { argc: a.valueText, arg1: s };
      }
    }
    return null;
  });
  check('a quoted argument stays one argument',
        t2 && t2.argc === '2' && t2.arg1 === 'hello world', JSON.stringify(t2));
  await type('./a.out');
  check('no arguments gives argc = 1',
        (await page.evaluate(() => {
          for (let i = run.history.length - 1; i >= 0; i--) {
            const a = run.history.stateAt(i).vars.find(v => v.name === 'argc');
            if (a && !a.uninitialized) return a.valueText;
          }
          return null;
        })) === '1');

  console.log('\n=== part 12: no second implementation ===');
  const av = html.slice(html.indexOf('==== ARGVLAB START ===='), html.indexOf('==== ARGVLAB END ===='));
  check('the lab ships between its markers', av.length > 4000, av.length + ' bytes');
  check('it runs the engine and reads the existing graph',
        /CEngine\.runToCompletion\(/.test(av) && /\.graph/.test(av));
  check('it builds no argv of its own — no pointer-size arithmetic on addresses',
        !/0x[0-9a-f]{5,}/i.test(av) && !/writeInt|setByte|allocArgv/.test(av));
  check('it reuses the existing ASCII table', /CEngine\.asciiInfo/.test(av));
  check('no eval or Function constructor', !/\beval\s*\(/.test(av) && !/new Function/.test(av));
  const term = html.slice(html.indexOf('==== TERM START ===='), html.indexOf('==== TERM END ===='));
  check('the terminal reaches the same launch(), not a second path',
        /launch\(term\.aout\.src, \{ args:/.test(term) && !/runToCompletion\(.*args/.test(term));

  console.log('\n=== part 13: modes, links, accessibility, regressions ===');
  await setEx('count');
  const modes = {};
  for (const m of ['beginner', 'intermediate', 'expert']) {
    modes[m] = await page.evaluate((x) => {
      lab.avMode = x; renderLab();
      return { blocks: document.querySelectorAll('.av-block').length,
               argc: argvCur().cur.state.vars.find(v => v.name === 'argc').valueText };
    }, m);
  }
  check('more detail appears as the mode rises',
        modes.beginner.blocks < modes.intermediate.blocks &&
        modes.intermediate.blocks < modes.expert.blocks,
        [modes.beginner.blocks, modes.intermediate.blocks, modes.expert.blocks].join(' < '));
  check('the execution is identical in every mode',
        modes.beginner.argc === modes.expert.argc, modes.beginner.argc);
  check('the concept check answers come from the type system',
        await page.evaluate(() => {
          lab.avMode = 'intermediate'; lab.avQuiz = { 0: true, 3: true }; renderLab();
          const a = [...document.querySelectorAll('.av-q-a')].map(x => x.textContent.trim());
          return a.indexOf('char **') >= 0 && a.indexOf('char') >= 0;
        }));
  check('argument controls are labelled and keyboard reachable',
        await page.evaluate(() => {
          const i = document.querySelector('#avNew');
          return !!i.getAttribute('aria-label') &&
                 document.querySelector('.av-modes').getAttribute('role') === 'group';
        }));
  const bad = [];
  for (const [w, h] of [[1600, 1000], [1280, 800], [1024, 800], [860, 700], [700, 900]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(240);
    const geo = await page.evaluate(() => {
      const rail = document.querySelector('.rail').getBoundingClientRect();
      const lr = document.querySelector('#labRoot').getBoundingClientRect();
      return { overflow: document.body.scrollWidth > document.body.clientWidth,
               coversRail: lr.left < rail.right - 1,
               slots: document.querySelectorAll('.av-slot').length };
    });
    if (geo.overflow || geo.coversRail || geo.slots === 0) bad.push(w + 'x' + h + ' ' + JSON.stringify(geo));
  }
  check('usable at every viewport, never covering the rail', bad.length === 0, bad.join(' | '));
  await page.setViewport({ width: 1500, height: 1000 });
  await sleep(240);
  const clickRail = async (id) => {
    const r = await page.evaluate((x) => { const e = document.querySelector('#' + x);
      const bb = e.getBoundingClientRect();
      return { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2) }; }, id);
    await page.mouse.click(r.x, r.y); await sleep(320);
  };
  await clickRail('railHome');
  check('the rail still navigates', (await page.evaluate(() => ui.view)) === 'dashboard');
  await clickRail('railLab');
  await page.evaluate(() => { lab.tab = 'ascii'; renderLab(); });
  await sleep(300);
  check('ASCII table alignment still holds',
        (await page.evaluate(() => {
          const t = document.querySelector('.vl-table');
          const h2 = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
          return Math.max(...[...h2.children].map((c, i) =>
            Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left)));
        })) <= 1);
  await page.evaluate(() => { lab.tab = 'ptr'; lab.ptrEx = 'putstr'; lab.ptrStep = null; renderLab(); });
  await sleep(320);
  check('the Phase 10 pointer lab still works',
        (await page.evaluate(() => document.querySelectorAll('.pl-box').length)) >= 2);
  await page.evaluate(() => { lab.tab = 'c03'; renderLab(); });
  await sleep(300);
  check('the C03 project still works',
        (await page.evaluate(() => document.querySelectorAll('.c3-table tbody tr').length)) === 6);
  check('no page errors across the whole phase', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { showLab(); lab.tab = 'argv'; lab.avEx = 'index';
    lab.avArgs = null; lab.avStep = null; lab.avMode = 'beginner'; renderLab(); });
  await sleep(320);
  await page.screenshot({ path: path.join(SHOTS, 'p23_argv.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 11  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
