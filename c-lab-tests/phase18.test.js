'use strict';
/* Phase 7 — functions, libraries, system calls.

   Behavioural throughout. The walkthrough must be the engine's own timeline, so
   every frame, parameter value and return value the UI prints is compared
   against the execution snapshot for the same step. A view that animated a
   plausible-looking call would fail these. */
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
const ADD = ['int\tadd(int a, int b)', '{', '\tint\tresult;', '', '\tresult = a + b;', '\treturn (result);', '}', '',
             'int\tmain(void)', '{', '\tint\tx;', '', '\tx = add(2, 3);', '\treturn (0);', '}'].join('\n');
const NEST = ['int\tsquare(int x)', '{', '\treturn (x * x);', '}', '',
              'int\tdouble_square(int x)', '{', '\treturn (2 * square(x));', '}', '',
              'int\tmain(void)', '{', '\tint\tr;', '', '\tr = double_square(3);', '\treturn (0);', '}'].join('\n');
const FACT = ['int\tfactorial(int n)', '{', '\tif (n <= 1)', '\t\treturn (1);', '\treturn (n * factorial(n - 1));', '}', '',
              'int\tmain(void)', '{', '\tint\tr;', '', '\tr = factorial(3);', '\treturn (0);', '}'].join('\n');
const WRITE = ['int\tmain(void)', '{', '\tchar\t*s;', '', '\ts = "ABC";', '\twrite(1, s, 3);', '\treturn (0);', '}'].join('\n');

const timeline = (src) => {
  const r = E.runToCompletion(src);
  const out = [];
  for (let i = 0; i < r.history.length; i++) out.push({ i, s: r.history.steps[i], st: r.history.stateAt(i) });
  return { r, out };
};
const frameNames = (st) => st.frames.map(f => f.name);
const varsOf = (st, fn) => {
  const f = st.frames.find(x => x.name === fn);
  return f ? f.vars.map(v => v.name + '=' + (v.uninitialized ? '?' : v.value)) : null;
};

(async () => {
  console.log('=== Phase 7 · part 1: the call, as the engine runs it ===');
  const A = timeline(ADD);
  check('the program runs', A.r.ok, A.r.ok ? '' : A.r.message);

  const beforeCall = A.out.filter(x => x.s.phase === 'decl' && x.st.frames.length === 1);
  check('before the call there is only main’s frame',
        beforeCall.length > 0 && frameNames(beforeCall[0].st).join(',') === 'main',
        frameNames(beforeCall[0].st).join(','));

  const bind = A.out.find(x => x.s.phase === 'call-bind');
  check('the callee’s frame exists once the call is entered',
        bind && frameNames(bind.st).join(',') === 'main,add', bind ? frameNames(bind.st).join(',') : 'none');
  check('the parameters hold the ACTUAL argument values 2 and 3',
        varsOf(bind.st, 'add').join(' ') === 'a=2 b=3', varsOf(bind.st, 'add').join(' '));
  check('main’s local is still uninitialized while add runs',
        varsOf(bind.st, 'main').join('') === 'x=?', varsOf(bind.st, 'main').join(''));

  const localStep = A.out.find(x => x.s.phase === 'decl' && x.st.frames.length === 2);
  check('the callee’s local is created inside the callee’s frame',
        varsOf(localStep.st, 'add').indexOf('result=?') >= 0, varsOf(localStep.st, 'add').join(' '));

  const computed = A.out.find(x => x.s.phase === 'assign' && x.st.frames.length === 2);
  check('the local receives a + b = 5 from the engine',
        varsOf(computed.st, 'add').indexOf('result=5') >= 0, varsOf(computed.st, 'add').join(' '));

  const ret = A.out.find(x => x.s.phase === 'call-return');
  check('the return value the engine produced is 5', String(ret.s.returnValue) === '5', String(ret.s.returnValue));

  const exit = A.out.find(x => x.s.phase === 'call-exit');
  check('after the return the callee’s frame is gone',
        frameNames(exit.st).join(',') === 'main', frameNames(exit.st).join(','));
  check('the destroyed frame is named in the step detail',
        exit.s.detail && exit.s.detail.poppedFrame === 'add', JSON.stringify(exit.s.detail));

  const last = A.out[A.out.length - 1];
  const gotX = A.out.slice().reverse().find(x => varsOf(x.st, 'main') && varsOf(x.st, 'main').indexOf('x=5') >= 0);
  check('the caller receives the value: x = 5', !!gotX, gotX ? varsOf(gotX.st, 'main').join(' ') : 'never');
  check('at program end no frame survives', frameNames(last.st).length === 0);

  console.log('\n=== Phase 7 · part 2: nesting and recursion ===');
  const N = timeline(NEST);
  const deepestN = N.out.reduce((a, x) => (x.s.callStack || []).length > (a.s.callStack || []).length ? x : a, N.out[0]);
  check('main → double_square → square produces three levels',
        deepestN.s.callStack.join(' > ') === 'main > double_square > square',
        deepestN.s.callStack.join(' > '));
  const seq = N.out.filter(x => /^call-(enter|exit)$/.test(x.s.phase)).map(x => x.s.phase[5] + ':' + x.s.callStack.join('>'));
  check('frames are created and destroyed in the right order',
        seq.join(' | ').indexOf('e:main>double_square | e:main>double_square>square') === 0,
        seq.join(' | '));

  const F = timeline(FACT);
  check('recursion runs at all', F.r.ok, F.r.ok ? '' : F.r.message);
  const deepestF = F.out.reduce((a, x) => x.st.frames.length > a.st.frames.length ? x : a, F.out[0]);
  check('recursion creates one frame per call of the SAME function',
        frameNames(deepestF.st).join(',') === 'main,factorial,factorial,factorial',
        frameNames(deepestF.st).join(','));
  const ns = deepestF.st.frames.filter(f => f.name === 'factorial')
    .map(f => f.vars.find(v => v.name === 'n')).map(v => v.value);
  check('each recursive frame has its own n: 3, 2, 1', ns.join(',') === '3,2,1', ns.join(','));
  const rFinal = F.out.slice().reverse().find(x => varsOf(x.st, 'main') && varsOf(x.st, 'main').indexOf('r=6') >= 0);
  check('factorial(3) returns 6 into the caller', !!rFinal, rFinal ? 'r=6' : 'not found');

  console.log('\n=== Phase 7 · part 3: memory — .text and the stack ===');
  const g = bind.st.graph;
  const text = g.nodes.filter(n => n.section === 'text').map(n => n.label).sort();
  check('every function has an entry point in .text',
        text.join(',') === 'add(),main()', text.join(','));
  const stack = g.nodes.filter(n => n.section === 'stack').map(n => n.label + '@' + n.frameName).sort();
  check('parameters and locals live on the stack, owned by their frame',
        stack.indexOf('a@add') >= 0 && stack.indexOf('b@add') >= 0 && stack.indexOf('x@main') >= 0,
        stack.join(' '));
  check('a destroyed frame’s locals leave the live graph',
        !exit.st.graph.nodes.some(n => n.frameName === 'add' && n.section === 'stack'),
        exit.st.graph.nodes.filter(n => n.section === 'stack').map(n => n.label).join(','));

  console.log('\n=== Phase 7 · part 4: write() as a system call ===');
  const W = timeline(WRITE);
  const w = W.out.find(x => x.s.detail && x.s.detail.buffer !== undefined);
  check('the write call is recorded with its arguments', !!w);
  check('fd is 1 and names stdout', w.s.detail.fd === 1 && w.s.detail.stream === 'stdout',
        w.s.detail.fd + ' / ' + w.s.detail.stream);
  check('count is 3', w.s.detail.length === 3, String(w.s.detail.length));
  const lit = w.st.graph.nodes.find(n => n.section === 'rodata');
  check('the buffer address is a REAL object address, not a placeholder',
        !!lit && w.s.detail.buffer === lit.address,
        '0x' + w.s.detail.buffer.toString(16) + ' vs literal at 0x' + (lit ? lit.address.toString(16) : '?'));
  check('the buffer is reported as living in .rodata', w.s.detail.bufferSection === 'rodata',
        String(w.s.detail.bufferSection));
  check('the bytes written are A, B, C at consecutive addresses',
        w.s.detail.bytes.map(b => b.value).join(',') === '65,66,67' &&
        w.s.detail.bytes[1].address === w.s.detail.bytes[0].address + 1,
        w.s.detail.bytes.map(b => b.value).join(','));
  check('the program really produced ABC on its output', W.r.output === 'ABC', JSON.stringify(W.r.output));

  console.log('\n=== Phase 7 · part 5: the views show the engine’s values ===');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 1100 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);

  // the lab must be open before its tab strip exists in the DOM
  await page.evaluate(() => { showLab(); renderLab(); });
  await sleep(350);
  const tabIds7 = await page.evaluate(() =>
    [...document.querySelectorAll('.vl-tab')].map(e => e.dataset.labtab));
  const want7 = ['ascii','convert','bits','arith','compare','types','functions','syscalls'];
  check('the new sections are tabs in the EXISTING lab, not a second shell',
        JSON.stringify(tabIds7.slice(0, want7.length)) === JSON.stringify(want7) &&
        (await page.evaluate(() => document.querySelectorAll('.vl-tabs').length)) === 1,
        tabIds7.join(','));

  await page.evaluate(() => { showLab(); lab.tab = 'functions'; lab.fnProg = 'add'; renderLab(); });
  await sleep(400);

  // walk the whole run and compare the UI against the snapshot at every step
  const walk = await page.evaluate(() => {
    const run = fnRun('add');
    const out = [];
    for (let i = 0; i < run.steps.length; i++) {
      lab.fnStep = i; renderLab();
      const ui = [...document.querySelectorAll('.fn-frame')].map(f => ({
        name: f.querySelector('.fn-frame-h b').textContent.trim().replace('()', ''),
        vars: [...f.querySelectorAll('.fn-var')].map(v =>
          v.querySelector('.fn-var-n').textContent.trim() + '=' + v.querySelector('.fn-var-v').textContent.trim()),
      }));
      const eng = run.steps[i].state.frames.slice().reverse().map(f => ({
        name: f.name,
        vars: f.vars.map(v => v.name + '=' + (v.uninitialized ? '?' : v.valueText)),
      }));
      out.push({ i, ui, eng, match: JSON.stringify(ui) === JSON.stringify(eng) });
    }
    return out;
  });
  const mismatched = walk.filter(x => !x.match);
  check('at EVERY step the frames drawn are the engine’s frames',
        mismatched.length === 0,
        mismatched.length ? 'step ' + (mismatched[0].i + 1) + ': ui ' + JSON.stringify(mismatched[0].ui) +
          ' vs engine ' + JSON.stringify(mismatched[0].eng) : walk.length + ' steps compared');

  check('the callee frame is absent before the call and present after',
        walk[1].ui.length === 1 && walk[3].ui.length === 2 &&
        walk[3].ui[0].name === 'add', JSON.stringify(walk[3].ui.map(f => f.name)));
  check('the parameter values shown are 2 and 3',
        walk[3].ui[0].vars.join(' ') === 'a=2 b=3', walk[3].ui[0].vars.join(' '));
  check('the frame disappears from the view when the engine destroys it',
        walk[7].ui.length === 1 && walk[7].ui[0].name === 'main',
        JSON.stringify(walk[7].ui.map(f => f.name)));
  check('the caller is shown receiving x = 5',
        walk.some(x => x.ui.some(f => f.name === 'main' && f.vars.indexOf('x=5') >= 0)));

  const stackUI = await page.evaluate(() => {
    lab.fnProg = 'recursion'; lab.fnStep = 0; renderLab();
    const run = fnRun('recursion');
    let bi = 0, best = 0;
    for (let i = 0; i < run.steps.length; i++)
      if (run.steps[i].state.frames.length > best) { best = run.steps[i].state.frames.length; bi = i; }
    lab.fnStep = bi; renderLab();
    return {
      frames: [...document.querySelectorAll('.fn-frame')].map(f =>
        f.querySelector('.fn-frame-h b').textContent.trim() + ':' +
        [...f.querySelectorAll('.fn-var')].map(v => v.querySelector('.fn-var-v').textContent.trim()).join(',')),
      callstack: [...document.querySelectorAll('.fn-cs-row')].length,
      tops: [...document.querySelectorAll('.fn-frame.top')].length,
    };
  });
  check('the call-stack panel shows one entry per live call',
        stackUI.frames.length === 4 && stackUI.callstack >= 4, JSON.stringify(stackUI.frames));
  check('exactly one frame is marked as running', stackUI.tops === 1, String(stackUI.tops));
  check('the recursive frames show their own n values',
        stackUI.frames.join(' ').indexOf('factorial():1') >= 0 &&
        stackUI.frames.join(' ').indexOf('factorial():3') >= 0, JSON.stringify(stackUI.frames));

  // the syscall view, against the engine
  await page.evaluate(() => { lab.tab = 'syscalls'; renderLab(); });
  await sleep(400);
  const sys = await page.evaluate(() => ({
    args: [...document.querySelectorAll('.fn-arg')].map(e => ({
      k: e.querySelector('.fn-arg-k').textContent.trim(),
      v: e.querySelector('b').textContent.trim(),
      w: e.querySelector('.fn-arg-w').textContent.trim(),
    })),
    bytes: [...document.querySelectorAll('.fn-byte')].map(e => ({
      v: e.querySelector('.fn-byte-v').textContent.trim(),
      c: e.querySelector('.fn-byte-c').textContent.trim(),
    })),
    hasKernel: !!document.querySelector('.fn-kernel'),
    stdout: document.querySelector('.fn-stdout') ? document.querySelector('.fn-stdout').textContent.trim() : '',
    engBuffer: (() => { const w2 = fnRun('write').steps.find(x => x.step.detail && x.step.detail.buffer !== undefined);
                        return w2 ? '0x' + w2.step.detail.buffer.toString(16) : null; })(),
  }));
  check('the syscall view shows fd, buffer and count as three real arguments',
        sys.args.length === 3 && sys.args[0].k === 'fd' && sys.args[0].v === '1' &&
        sys.args[2].k === 'count' && sys.args[2].v === '3', JSON.stringify(sys.args));
  check('the buffer shown is the engine’s buffer address, not a placeholder',
        sys.args[1].v === sys.engBuffer, sys.args[1].v + ' vs ' + sys.engBuffer);
  check('it names the section the buffer really lives in',
        /rodata/.test(sys.args[1].w), sys.args[1].w);
  check('the bytes shown are 41/42/43 reading A, B, C',
        sys.bytes.map(x => x.v).join(',') === '41,42,43' &&
        sys.bytes.map(x => x.c).join('') === 'ABC', JSON.stringify(sys.bytes));
  check('the kernel boundary and the resulting stdout are both drawn',
        sys.hasKernel && /ABC/.test(sys.stdout), sys.stdout);

  console.log('\n=== Phase 7 · part 6: the honesty contract ===');
  // The honesty statements are spread across BOTH new tabs, so collect the
  // rendered text of each rather than whichever one happened to be mounted.
  const text2 = await page.evaluate(() => {
    let all = '';
    for (const t of ['functions', 'syscalls']) { lab.tab = t; renderLab();
      all += document.querySelector('#labRoot').textContent + '\n'; }
    lab.tab = 'syscalls'; renderLab();
    return all;
  });
  const must = [
    ['#include does not link a library', /does <?b?>?not<?\/?b?>? link the library|does not.{0,10}link the library/i],
    ['a header is declarations, a library is implementation', /interface[\s\S]{0,400}implementation/i],
    ['printf and malloc are not system calls', /printf[\s\S]{0,200}is a library function[\s\S]{0,200}system call/i],
    ['file descriptors are POSIX, not ISO C', /Unix\/POSIX conventions|not ISO C/i],
    ['kernel space is not a program section', /Kernel space is not another section/i],
    ['machine instructions are not modelled', /does not compile to machine instructions|not model|nothing here models instructions/i],
    ['calling conventions are ABI-dependent', /ABI and the compiler|decided\s*by the ABI/i],
  ];
  for (const [label, re] of must) check('states that ' + label, re.test(text2));

  check('write is labelled a system call and strlen a library function',
        await page.evaluate(() => {
          lab.fnRef = 'write'; renderLab();
          const a = document.querySelector('.fn-kind').textContent.trim();
          lab.fnRef = 'strlen'; renderLab();
          const c = document.querySelector('.fn-kind').textContent.trim();
          return a + '|' + c;
        }) === 'system call|library function');
  check('no Piscine function list is invented before the subjects arrive',
        await page.evaluate(() => /No Piscine function list or restriction is claimed/i
          .test(document.querySelector('#labRoot').textContent)));

  console.log('\n=== Phase 7 · part 7: nothing from fad8fd0 regressed ===');
  const clickRail = async (id) => {
    const r = await page.evaluate((x) => { const e = document.querySelector('#' + x);
      const bb = e.getBoundingClientRect();
      return { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2) }; }, id);
    await page.mouse.click(r.x, r.y);
    await sleep(320);
  };
  await page.evaluate(() => { showLab(); lab.tab = 'functions'; renderLab(); });
  await sleep(300);
  await clickRail('railHome');
  check('the rail still works from the Functions tab',
        (await page.evaluate(() => ui.view)) === 'dashboard', await page.evaluate(() => ui.view));
  await clickRail('railLab');
  await page.evaluate(() => { lab.tab = 'ascii'; renderLab(); });
  await sleep(300);
  const align = await page.evaluate(() => {
    const t = document.querySelector('.vl-table');
    const h = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
    return Math.max(...[...h.children].map((c, i) =>
      Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left)));
  });
  check('ASCII table columns are still aligned', align <= 1, 'drift ' + Math.round(align * 100) / 100 + 'px');

  check('no page errors anywhere in Phase 7', errs.length === 0, errs.join(' | '));
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { lab.tab = 'functions'; lab.fnProg = 'add'; lab.fnStep = 3; renderLab(); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p18_functions.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 7  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
