'use strict';
/* Phase 10 — pointers and dereferencing.

   The claim under test: this lab evaluates nothing. Every address, value,
   arrow, chain and stride it draws is compared here against the engine's own
   snapshot for the same step, and the ft_putstr walkthrough is verified step by
   step against the real run. A lab that animated a convincing story would fail. */
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
const lastLive = (src, name) => {
  const r = E.runToCompletion(src);
  if (!r.history) return null;
  for (let i = r.history.length - 1; i >= 0; i--) {
    const st = r.history.stateAt(i);
    const n = st.graph.nodes.find(x => x.label === name);
    if (n && !n.uninitialized) return { st, r, n, i };
  }
  return null;
};

(async () => {
  console.log('=== part 1: the engine really does all of this ===');
  const basic = lastLive("int main(void){ char c; char *p; c=65; p=&c; return 0; }", 'p');
  check('&c produces c\u2019s own address, and p stores it',
        basic && basic.st.graph.edges[0].address ===
                 basic.st.graph.nodes.find(n => n.label === 'c').address,
        basic ? '0x' + basic.st.graph.edges[0].address.toString(16) : 'no run');
  const wr = lastLive("int main(void){ int x; int *p; x=42; p=&x; *p=100; return 0; }", 'x');
  check('*p = 100 changes x, not p',
        wr && wr.n.valueText === '100' &&
        wr.st.graph.edges[0].address === wr.n.address, wr ? wr.n.valueText : '');
  const pp = lastLive("int main(void){ int x; int *p; int **pp; x=42; p=&x; pp=&p; return 0; }", 'pp');
  const chain2 = pp.st.graph.chains[pp.n.blockId].filter(h => h.kind === 'object').map(h => h.label);
  check('pp -> p -> x is one chain from the engine',
        JSON.stringify(chain2) === JSON.stringify(['pp', 'p', 'x']), chain2.join(' -> '));
  const ppp = lastLive("int main(void){ int x; int *p; int **pp; int ***ppp; x=42; p=&x; pp=&p; ppp=&pp; return 0; }", 'ppp');
  const chain3 = ppp.st.graph.chains[ppp.n.blockId].filter(h => h.kind === 'object');
  check('three levels resolve all the way to 42',
        chain3.map(h => h.label).join('->') === 'ppp->pp->p->x' &&
        chain3[chain3.length - 1].valueText === '42', chain3.map(h => h.label).join('->'));
  const deref3 = E.runToCompletion("int main(void){ int x; int *p; int **pp; int ***ppp; int r; x=42; p=&x; pp=&p; ppp=&pp; r=***ppp; return 0; }");
  check('***ppp executes and yields 42', deref3.ok);

  console.log('\n=== part 2: precedence comes from the real parser ===');
  const astOf = (expr) => {
    const prog = 'int main(void){ char s[4]="ABC"; char *p; char r; p=s; r=0; ' + expr + '; return 0; }';
    const fn = E.parseC(prog).find(d => d.kind === 'FuncDef');
    const st = fn.body.body.filter(s => s.kind === 'ExprStmt');
    return st[st.length - 1].expr;
  };
  const a1 = astOf('(*p)++'), a2 = astOf('*p++');
  check('(*p)++ parses as Update(Deref(p)) — the object is incremented',
        a1.kind === 'Update' && a1.arg.kind === 'Deref', a1.kind + '(' + a1.arg.kind + ')');
  check('*p++ parses as Deref(Update(p)) — the POINTER is incremented',
        a2.kind === 'Deref' && a2.arg.kind === 'Update', a2.kind + '(' + a2.arg.kind + ')');
  const runExpr = (expr) => {
    const prog = 'int main(void){ char s[4]="ABC"; char *p; char r; p=s; r=0; ' +
      (/^\*/.test(expr) ? 'r = ' + expr : expr) + '; return 0; }';
    const r = E.runToCompletion(prog);
    for (let i = r.history.length - 1; i >= 0; i--) {
      const st = r.history.stateAt(i);
      const p = st.vars.find(v => v.name === 'p'), s = st.vars.find(v => v.name === 's');
      if (p && !p.uninitialized) return { p: p.valueText, s: s ? s.valueText : null };
    }
    return null;
  };
  const e1 = runExpr('(*p)++'), e2 = runExpr('*p++');
  check('(*p)++ leaves p alone and changes the array to "BBC"',
        e1.s === '"BBC"', e1.s + ' p=' + e1.p);
  check('*p++ moves p and leaves the array "ABC"',
        e2.s === '"ABC"' && e2.p !== e1.p, e2.s + ' p=' + e2.p);

  console.log('\n=== part 3: the ft_putstr walkthrough, against the real run ===');
  const FT = 'void\tputstr_advance(char **str)\n{\n\twhile (**str != 0)\n\t{\n\t\twrite(1, *str, 1);\n\t\t(*str)++;\n\t}\n}\n\n' +
             'int\tmain(void)\n{\n\tchar\t*text;\n\n\ttext = "ABC";\n\tputstr_advance(&text);\n\treturn (0);\n}\n';
  const ftr = E.runToCompletion(FT);
  check('it runs and prints ABC', ftr.ok && ftr.output === 'ABC', JSON.stringify(ftr.output));
  const seen = [];
  for (let i = 0; i < ftr.history.length; i++) {
    const st = ftr.history.stateAt(i);
    let t = null;
    for (const f of st.frames) for (const v of f.vars) if (v.name === 'text') t = v;
    if (t && !t.uninitialized && (!seen.length || seen[seen.length - 1].v !== t.valueText))
      seen.push({ v: t.valueText, out: st.output || '' });
  }
  check('text advances through four distinct addresses',
        seen.length === 4, seen.map(s => s.v).join(' -> '));
  check('each advance follows one more character being written',
        seen[0].out === '' && seen[1].out === 'A' && seen[2].out === 'AB' && seen[3].out === 'ABC',
        seen.map(s => JSON.stringify(s.out)).join(' '));
  check('the addresses are consecutive bytes in .rodata',
        parseInt(seen[1].v, 16) === parseInt(seen[0].v, 16) + 1 &&
        parseInt(seen[3].v, 16) === parseInt(seen[0].v, 16) + 3, seen.map(s => s.v).join(' '));
  const mid = (() => {
    for (let i = ftr.history.length - 1; i >= 0; i--) {
      const st = ftr.history.stateAt(i);
      if (st.frames.length === 2) return st;
    }
    return null;
  })();
  const strEdge = mid.graph.edges.find(e => e.name === 'str');
  const textEdge = mid.graph.edges.find(e => e.name === 'text');
  check('str points at text, and text points into the literal',
        strEdge && textEdge &&
        mid.graph.nodes.find(n => n.id === strEdge.to).label === 'text' &&
        mid.graph.nodes.find(n => n.id === textEdge.to).section === 'rodata',
        'str->' + mid.graph.nodes.find(n => n.id === strEdge.to).label);
  const strChain = mid.graph.chains[mid.graph.nodes.find(n => n.label === 'str').blockId]
    .filter(h => h.kind === 'object').map(h => h.label);
  check('str -> text -> "ABC" is one chain',
        strChain.length === 3 && strChain[0] === 'str' && strChain[1] === 'text', strChain.join(' -> '));

  console.log('\n=== part 4: read-only memory is now enforced (engine change) ===');
  const roWrite = E.runToCompletion('int main(void){ char *p; p="AB"; *p=88; return 0; }');
  check('writing through a pointer to a literal is refused',
        !roWrite.ok && roWrite.kind === 'readonly-write', roWrite.kind + ': ' + (roWrite.message || '').slice(0, 60));
  const arrWrite = E.runToCompletion('int main(void){ char s[4]="ABC"; s[0]=88; return 0; }');
  check('writing to an array initialised from a literal still works', arrWrite.ok);
  const roRead = E.runToCompletion('int main(void){ char *p; char c; p="AB"; c=*p; return 0; }');
  check('reading a literal still works', roRead.ok);
  check('the new kind has a human label',
        E.MEM_SAFETY_LABELS['readonly-write'] === 'Write to read-only memory');
  const html = fs.readFileSync(HTML, 'utf8');
  check('the void * divergence is disclosed in SIMPLIFICATIONS',
        /Dereferencing a void \* is rejected by real C compilers/.test(html));

  console.log('\n=== part 5: the lab evaluates nothing ===');
  const pl = html.slice(html.indexOf('==== PTRLAB START ===='), html.indexOf('==== PTRLAB END ===='));
  check('the module ships between its markers', pl.length > 4000, pl.length + ' bytes');
  check('it runs the engine and reads the Phase 4 graph',
        /CEngine\.runToCompletion\(/.test(pl) && /\.graph/.test(pl) &&
        /chains\[/.test(pl) && /arithmetic\[/.test(pl));
  check('it uses the real parser for precedence', /CEngine\.parseC\(/.test(pl));
  check('it computes no addresses or strides of its own',
        !/\+\s*sizeof|address\s*\+\s*\d|0x[0-9a-f]{4,}/i.test(pl.replace(/hexA\([^)]*\)/g, '')));
  check('no eval or Function constructor', !/\beval\s*\(/.test(pl) && !/new Function/.test(pl));

  console.log('\n=== part 6: the UI shows the engine\u2019s numbers ===');
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
  const setEx = async (id, mode) => {
    await page.evaluate((e, m) => {
      showLab(); lab.tab = 'ptr'; lab.ptrEx = e; lab.ptrStep = null;
      if (m) lab.ptrMode = m; renderLab();
    }, id, mode || null);
    await sleep(330);
  };

  // the tab strip only exists once the lab has been rendered
  await page.evaluate(() => { showLab(); renderLab(); });
  await sleep(320);
  check('the lab is a tab in the ONE existing strip',
        (await page.evaluate(() => [...document.querySelectorAll('.vl-tab')].map(e => e.dataset.labtab)))
          .indexOf('ptr') >= 0 &&
        (await page.evaluate(() => document.querySelectorAll('.vl-tabs').length)) === 1);

  await setEx('basic');
  const b1 = await page.evaluate(() => {
    const c = ptrCur(); const g = c.cur.state.graph;
    const boxes = [...document.querySelectorAll('.pl-box')].map(x => ({
      n: x.querySelector('b').textContent.trim(),
      vals: [...x.querySelectorAll('.pl-v')].map(v => v.textContent.trim()) }));
    return { boxes, eng: g.nodes.filter(n => n.section !== 'text').map(n => ({
      n: n.label, addr: '0x' + n.address.toString(16), val: n.uninitialized ? '?' : n.valueText })) };
  });
  check('it opens on a step where the objects are alive, not the empty end',
        b1.boxes.length >= 2, b1.boxes.map(x => x.n).join(','));
  check('every box shows the engine\u2019s address and value',
        b1.boxes.every((x, i) => x.vals[0] === b1.eng[i].addr && x.vals[1] === b1.eng[i].val),
        JSON.stringify(b1.boxes.map(x => x.n + ':' + x.vals.join('/'))));
  const tri = await page.evaluate(() =>
    [...document.querySelectorAll('.pl-tri')].map(t => ({
      k: t.querySelector('.pl-tri-k').textContent.trim(), v: t.querySelector('b').textContent.trim() })));
  const engP = b1.eng.find(x => x.n === 'p'), engC = b1.eng.find(x => x.n === 'c');
  check('&p, p and *p are shown as three DIFFERENT things',
        tri.length === 3 && tri[0].v === engP.addr && tri[1].v === engP.val && tri[2].v === 'c' &&
        tri[0].v !== tri[1].v, tri.map(t => t.v).join(' | '));
  check('and the address of p is not the address of c', engP.addr !== engC.addr);

  await setEx('ptr3');
  const ladder = await page.evaluate(() =>
    [...document.querySelectorAll('.pl-rung')].map(r => ({
      e: r.querySelector('.pl-rung-e').textContent.trim(),
      v: r.querySelector('.pl-rung-v').textContent.trim(),
      invalid: r.classList.contains('invalid') })));
  check('the ladder walks &ppp, ppp, *ppp, **ppp, ***ppp',
        ladder.map(r => r.e).join(' ') === '&ppp ppp *ppp **ppp ***ppp ****ppp',
        ladder.map(r => r.e).join(' '));
  check('each * removes exactly one level, ending at x = 42',
        ladder[2].v === 'pp' && ladder[3].v === 'p' && /^x\s+=\s+42$/.test(ladder[4].v),
        ladder.map(r => r.v).join(' | '));
  check('one dereference too many is marked invalid, not given a value',
        ladder[5].invalid && /not valid/.test(ladder[5].v));

  console.log('\n=== part 7: the guided ft_putstr walkthrough in the UI ===');
  await setEx('putstr');
  const walk = await page.evaluate(() => {
    const run = ptrRun();
    const out = [];
    for (let i = 0; i < run.steps.length; i++) {
      lab.ptrStep = i; renderLab();
      const st = run.steps[i].state;
      let t = null;
      for (const f of st.frames) for (const v of f.vars) if (v.name === 'text') t = v;
      const box = [...document.querySelectorAll('.pl-box')]
        .find(x => x.querySelector('b').textContent.trim() === 'text');
      const ui = box ? box.querySelectorAll('.pl-v')[1].textContent.trim() : null;
      out.push({ i, eng: t && !t.uninitialized ? t.valueText : null, ui,
                 out: st.output || '',
                 line: run.steps[i].step.line,
                 srcOn: (() => { const s = document.querySelector('.pl-srcline.on');
                   return s ? parseInt(s.textContent.trim(), 10) : null; })() });
    }
    return out;
  });
  const compared = walk.filter(w => w.eng !== null && w.ui !== null);
  check('at EVERY step the displayed pointer is the engine\u2019s pointer',
        compared.length > 5 && compared.every(w => w.ui === w.eng),
        compared.length + ' steps compared');
  check('the highlighted source line follows the engine\u2019s current line',
        walk.every(w => w.srcOn === null || w.srcOn === w.line));
  const uiSeen = [];
  for (const w of compared) if (!uiSeen.length || uiSeen[uiSeen.length - 1].v !== w.ui)
    uiSeen.push({ v: w.ui, out: w.out });
  check('the UI shows text advancing A -> B -> C -> \\0 with output growing',
        uiSeen.length === 4 &&
        uiSeen[1].out === 'A' && uiSeen[2].out === 'AB' && uiSeen[3].out === 'ABC',
        uiSeen.map(u => u.v + '/' + JSON.stringify(u.out)).join('  '));
  check('str never changes while text does',
        await page.evaluate(() => {
          const run = ptrRun(); const vals = new Set();
          for (let i = 0; i < run.steps.length; i++) {
            const st = run.steps[i].state;
            for (const f of st.frames) for (const v of f.vars)
              if (v.name === 'str' && !v.uninitialized) vals.add(v.valueText);
          }
          return vals.size === 1;
        }));

  console.log('\n=== part 8: arithmetic stride comes from the type ===');
  await setEx('chars', 'intermediate');
  const ac = await page.evaluate(() => ({
    head: document.querySelector('.pl-arith-h').textContent.replace(/\s+/g, ' ').trim(),
    steps: [...document.querySelectorAll('.pl-astep')].map(a => a.querySelector('.pl-astep-a').textContent.trim()),
    eng: (() => { const c = ptrCur(); const g = c.cur.state.graph;
      const n = g.nodes.find(x => x.label === 'p');
      return g.arithmetic[n.blockId].steps.map(s => s.text); })(),
  }));
  check('char * strides by 1 and matches the graph\u2019s own addresses',
        /sizeof\(char\) = 1 byte/.test(ac.head) && JSON.stringify(ac.steps) === JSON.stringify(ac.eng),
        ac.steps.join(' '));
  await setEx('ptr2', 'intermediate');
  const ai = await page.evaluate(() =>
    document.querySelector('.pl-arith-h').textContent.replace(/\s+/g, ' ').trim());
  check('a pointer-to-pointer strides by the pointer size, not by 1',
        new RegExp('= ' + E.ARCH.sizes.pointer + ' bytes').test(ai), ai);

  console.log('\n=== part 9: precedence, states and literals in the UI ===');
  const precs = {};
  for (const e of ['(*p)++', '*p++', '++(*p)', '*++p']) {
    precs[e] = await page.evaluate((x) => {
      lab.ptrPrec = x; lab.ptrMode = 'intermediate'; renderLab();
      return {
        ast: [...document.querySelectorAll('.pl-ast-n')].map(n => n.textContent.trim()).join(' > '),
        run: document.querySelector('.pl-prec-run').textContent.replace(/\s+/g, ' ').trim(),
      };
    }, e);
  }
  check('(*p)++ shows Update over Deref and mutates the array',
        /^Update \+\+ \(postfix\) > Deref/.test(precs['(*p)++'].ast) &&
        /s is still "BBC"/.test(precs['(*p)++'].run), precs['(*p)++'].ast);
  check('*p++ shows Deref over Update and moves the pointer instead',
        /^Deref > Update/.test(precs['*p++'].ast) && /s is still "ABC"/.test(precs['*p++'].run),
        precs['*p++'].ast);
  check('the four expressions do NOT all behave the same',
        new Set(Object.keys(precs).map(k => precs[k].run)).size >= 3);

  const states = {};
  for (const s of ['valid', 'null', 'uninit', 'dangling', 'readonly']) {
    states[s] = await page.evaluate((x) => {
      lab.ptrState = x; renderLab();
      const blk = [...document.querySelectorAll('.pl-block')].find(b2 => /Pointer states/i.test(b2.textContent));
      const el = blk.querySelector('.pl-state-r');
      return { bad: el.className.indexOf('bad') >= 0, text: el.textContent.replace(/\s+/g, ' ').trim() };
    }, s);
  }
  check('a valid pointer runs to completion', !states.valid.bad);
  check('NULL, uninitialized, dangling and read-only each stop with their OWN error',
        states.null.bad && states.uninit.bad && states.dangling.bad && states.readonly.bad &&
        /Null pointer/.test(states.null.text) && /uninitialized/i.test(states.uninit.text) &&
        /Use-after-free/i.test(states.dangling.text) && /read-only/i.test(states.readonly.text),
        [states.null, states.uninit, states.dangling, states.readonly]
          .map(s => s.text.slice(0, 22)).join(' | '));
  const lit = await page.evaluate(() =>
    [...document.querySelectorAll('.pl-half')].map(h => ({
      title: h.querySelector('.pl-half-h').textContent.trim(),
      vals: [...h.querySelectorAll('.pl-v')].map(v => v.textContent.trim()),
      res: h.querySelector('.pl-state-r').className.indexOf('bad') >= 0 ? 'refused' : 'allowed' })));
  check('the literal is in .rodata and not writable; the array is writable',
        lit[0].vals[0] === '.rodata' && lit[0].vals[2] === 'no' && lit[0].res === 'refused' &&
        lit[1].vals[2] === 'yes' && lit[1].res === 'allowed',
        JSON.stringify(lit.map(l => l.vals[0] + '/' + l.res)));

  console.log('\n=== part 10: modes, explain, accessibility ===');
  const modes = {};
  for (const m of ['beginner', 'intermediate', 'expert']) {
    modes[m] = await page.evaluate((x) => {
      lab.ptrMode = x; lab.ptrEx = 'chars'; lab.ptrStep = null; renderLab();
      return { blocks: document.querySelectorAll('.pl-block').length,
               ast: !!document.querySelector('.pl-ast'),
               sizes: document.querySelector('.pl-box-g').textContent.indexOf('align') >= 0,
               ptrVal: (() => { const c = ptrCur(); const g = c.cur.state.graph;
                 const n = g.nodes.find(y => y.label === 'p'); return n ? n.valueText : null; })() };
    }, m);
  }
  check('more detail appears as the mode rises',
        modes.beginner.blocks < modes.intermediate.blocks &&
        modes.intermediate.blocks <= modes.expert.blocks,
        [modes.beginner.blocks, modes.intermediate.blocks, modes.expert.blocks].join(' < '));
  check('only expert shows sizes and alignment',
        !modes.beginner.sizes && modes.expert.sizes);
  check('the underlying execution is identical in every mode',
        modes.beginner.ptrVal === modes.expert.ptrVal && modes.beginner.ptrVal !== null,
        modes.beginner.ptrVal);
  await setEx('ptr3');
  await page.evaluate(() => { lab.ptrExplain = true; renderLab(); });
  await sleep(300);
  const explain = await page.evaluate(() => ({
    items: [...document.querySelectorAll('.pl-explain li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()),
    addr: (() => { const c = ptrCur(); const g = c.cur.state.graph;
      const n = g.nodes.find(x => x.label === 'ppp'); return '0x' + n.address.toString(16); })(),
  }));
  check('"explain" walks the chain using this program\u2019s real values',
        explain.items.length >= 4 && explain.items[0].indexOf(explain.addr) >= 0 &&
        explain.items[explain.items.length - 1].indexOf('42') >= 0,
        explain.items.length + ' steps');
  check('boxes are keyboard reachable',
        await page.evaluate(() => [...document.querySelectorAll('.pl-box')]
          .every(x => x.getAttribute('role') === 'button' && x.getAttribute('tabindex') === '0')));
  check('the mode selector is a labelled group',
        await page.evaluate(() => document.querySelector('.pl-modes').getAttribute('role') === 'group' &&
          !!document.querySelector('.pl-modes').getAttribute('aria-label')));

  console.log('\n=== part 11: responsive, and nothing earlier regressed ===');
  const bad = [];
  for (const [w, h] of [[1600, 1000], [1280, 800], [1024, 800], [860, 700], [700, 900]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(250);
    const g = await page.evaluate(() => {
      const rail = document.querySelector('.rail').getBoundingClientRect();
      const lr = document.querySelector('#labRoot').getBoundingClientRect();
      return { overflow: document.body.scrollWidth > document.body.clientWidth,
               coversRail: lr.left < rail.right - 1,
               boxes: document.querySelectorAll('.pl-box').length };
    });
    if (g.overflow || g.coversRail || g.boxes === 0) bad.push(w + 'x' + h + ' ' + JSON.stringify(g));
  }
  check('usable at every viewport and never covering the rail', bad.length === 0, bad.join(' | '));
  await page.setViewport({ width: 1500, height: 1000 });
  await sleep(250);

  const clickRail = async (id) => {
    const r = await page.evaluate((x) => { const e = document.querySelector('#' + x);
      const bb = e.getBoundingClientRect();
      return { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2) }; }, id);
    await page.mouse.click(r.x, r.y); await sleep(320);
  };
  await clickRail('railHome');
  check('the rail still navigates from the pointer tab',
        (await page.evaluate(() => ui.view)) === 'dashboard');
  await clickRail('railLab');
  await page.evaluate(() => { lab.tab = 'ascii'; renderLab(); });
  await sleep(300);
  check('ASCII table alignment still holds',
        (await page.evaluate(() => {
          const t = document.querySelector('.vl-table');
          const h = t.querySelector('thead tr'), bd = t.querySelector('tbody tr');
          return Math.max(...[...h.children].map((c, i) =>
            Math.abs(c.getBoundingClientRect().left - bd.children[i].getBoundingClientRect().left)));
        })) <= 1);
  await page.evaluate(() => { lab.tab = 'c03'; renderLab(); });
  await sleep(300);
  check('the C03 project still renders six functions',
        (await page.evaluate(() => document.querySelectorAll('.c3-table tbody tr').length)) === 6);
  await page.evaluate(() => { lab.tab = 'repr'; renderLab(); });
  await sleep(300);
  check('the Data Representation tab still works',
        (await page.evaluate(() => document.querySelectorAll('.rp-step').length)) >= 5);
  await clickRail('railWork');
  await page.evaluate(() => setDockTab('terminal'));
  await sleep(300);
  check('the terminal still works', await page.evaluate(() => !!document.querySelector('#termInput')));
  check('no page errors across the whole phase', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { showLab(); lab.tab = 'ptr'; lab.ptrEx = 'putstr';
    lab.ptrMode = 'beginner'; lab.ptrStep = 8; renderLab(); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p22_ptr.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 10  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
