'use strict';
// FINAL QA - runs against the INSTALLED file, not the scratchpad copy.
const puppeteer = require('puppeteer-core');
const FILE = 'file:///C:/Users/User/Downloads/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; failures.push(name + ' :: ' + (detail || '')); console.log('  FAIL ' + name + '  -- ' + (detail || '')); }
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'], protocolTimeout: 240000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  // Network noise from probing the (deliberately absent) local bridge is not a
  // page error; only real JS failures count as a crash.
  const isPageError = (s) => !/ERR_CONNECTION|Failed to load resource|net::/.test(s);
  page.on('console', m => { if (m.type() === 'error' && isPageError(m.text())) errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => showWorkspace());

  const setSrc = (src) => page.evaluate((s) => { document.querySelector('#sourceEdit').value = s; switchToEditing(); }, src);
  const runAll = () => page.evaluate(() => {
    let g = 0;
    while (g++ < 60000) {
      if (!run.history || run.stopped) break;
      if (run.stepper.finished && run.index >= run.history.length - 1) break;
      doStep();
    }
    return { steps: run.history ? run.history.length : 0, stopped: run.stopped,
             finished: run.stepper ? run.stepper.finished : false };
  });
  const start = async () => { await page.click('#btnStep'); await new Promise(r => setTimeout(r, 120)); };
  const errText = () => page.$eval('#errorBox', e => e.textContent.replace(/\s+/g, ' ').trim());
  // The dock is tabbed now: make sure we are reading Program output, not Build.
  const outText = async () => {
    await page.evaluate(() => setDockTab('output'));
    return page.$eval('#dockBody', e => e.textContent);
  };

  console.log('=== QA: installed file loads ===');
  check('installed file loads clean', errs.length === 0, errs.slice(0, 2).join(' | '));
  check('engine present', await page.evaluate(() => typeof CEngine === 'object'));

  console.log('\n=== QA: malformed input is handled, not crashed ===');
  const bad = [
    ['empty source', ''],
    ['garbage', 'hello world this is not c'],
    ['unclosed brace', 'int main(void){int x;x=1;'],
    ['unterminated string', 'int main(void){printf("abc);return(0);}'],
    ['missing semicolon', 'int main(void){int x x=1;return(0);}'],
    ['unknown function', 'int main(void){foo();return(0);}'],
    ['unsupported printf conv', 'int main(void){printf("%f",1);return(0);}'],
    ['divide by zero', 'int main(void){int a;int b;a=1;b=0;a=a/b;return(0);}'],
    ['redeclare in same scope', 'int main(void){int x;int x;return(0);}'],
    ['wrong arg count', 'int f(int a){return(a);}\nint main(void){f();return(0);}'],
  ];
  for (const [name, src] of bad) {
    errs.length = 0;
    await setSrc(src);
    await start();
    await runAll();
    const e = await errText();
    const crashed = errs.length > 0;
    check('handles ' + name, !crashed && e.length > 0, crashed ? 'CONSOLE: ' + errs[0] : e.slice(0, 80));
  }

  console.log('\n=== QA: guards ===');
  // Guards are an engine concern - drive the generator directly so the test is
  // not measuring 200k DOM re-renders.
  const guard = (src) => page.evaluate((s) => {
    const r = CEngine.createRun(s, {});
    if (!r.ok) return { compileError: r.error.message };
    const t = performance.now();
    try {
      for (;;) { const n = r.stepper.gen.next(); if (n.done) break; }
    } catch (e) { return { stopped: true, message: e.message, steps: r.stepper.history.length, ms: performance.now() - t }; }
    return { stopped: false, steps: r.stepper.history.length, ms: performance.now() - t };
  }, src);

  const inf = await guard('int main(void){int i;i=0;while(i>=0){i++;}return(0);}');
  check('runaway loop is stopped by a guard', inf.stopped && /exceeded/.test(inf.message || ''),
        (inf.message || '').slice(0, 70) + ' | steps=' + inf.steps + ' in ' + Math.round(inf.ms) + 'ms');
  const rec = await guard('int f(int n){return(f(n+1));}\nint main(void){return(f(1));}');
  check('infinite recursion reports stack overflow', rec.stopped && /[Ss]tack overflow/.test(rec.message || ''),
        (rec.message || '').slice(0, 70));
  // and the guard surfaces through the normal UI path too
  await setSrc('int f(int n){return(f(n+1));}\nint main(void){return(f(1));}');
  await start(); await runAll();
  check('stack overflow shown in the error box', /[Ss]tack overflow/.test(await errText()), (await errText()).slice(0, 80));

  console.log('\n=== QA: performance ===');
  await setSrc('int main(void){int i;int s;i=0;s=0;while(i<2000){s=s+i;i++;}return(0);}');
  await start();
  const t0 = Date.now();
  const perf = await runAll();
  const ms = Date.now() - t0;
  check('2000-iteration loop completes', perf.finished && !perf.stopped, perf.steps + ' steps in ' + ms + 'ms');
  const scrub = await page.evaluate(() => {
    const t = performance.now();
    const h = run.history;
    for (const i of [0, Math.floor(h.length/2), h.length-1, 5, Math.floor(h.length*0.8), 1]) goTo(i);
    return performance.now() - t;
  });
  check('random-access time travel over 6000 steps is fast', scrub < 3000, scrub.toFixed(0) + 'ms for 6 random jumps');

  console.log('\n=== QA: new language features end to end ===');
  const feats = [
    ['for loop', 'int main(void){int s;s=0;for(int i=0;i<5;i++){s=s+i;}printf("%d\\n",s);return(0);}', '10\n'],
    ['break', 'int main(void){int i;i=0;while(1){i++;if(i==4)break;}printf("%d\\n",i);return(0);}', '4\n'],
    ['continue', 'int main(void){int s;s=0;for(int i=0;i<5;i++){if(i==2)continue;s=s+i;}printf("%d\\n",s);return(0);}', '8\n'],
    ['do/while', 'int main(void){int i;i=9;do{i++;}while(i<3);printf("%d\\n",i);return(0);}', '10\n'],
    ['globals', 'int g = 3;\nint bump(void){g=g+1;return(g);}\nint main(void){bump();bump();printf("%d\\n",g);return(0);}', '5\n'],
    ['block scope', 'int main(void){int x;x=1;{int x;x=9;printf("%d ",x);}printf("%d\\n",x);return(0);}', '9 1\n'],
    ['sizeof', 'int main(void){printf("%d %d %d\\n",sizeof(char),sizeof(int),sizeof(long));return(0);}', '1 4 8\n'],
    ['printf width', 'int main(void){printf("[%5d][%-5d]\\n",42,42);return(0);}', '[   42][42   ]\n'],
    ['ternary', 'int main(void){int a;a=5;printf("%d\\n",a>3?1:0);return(0);}', '1\n'],
    ['bitwise', 'int main(void){printf("%d %d %d\\n",6&3,6|3,1<<4);return(0);}', '2 7 16\n'],
    ['nested call in printf', 'int sq(int n){return(n*n);}\nint main(void){printf("%d\\n",sq(sq(2)));return(0);}', '16\n'],
    ['postfix in printf', 'int main(void){int i;i=5;printf("%d %d\\n",i++,i);return(0);}', '5 6\n'],
  ];
  for (const [name, src, expect] of feats) {
    errs.length = 0;
    await setSrc(src); await start();
    const r = await runAll();
    const o = (await outText()).replace(/^\$ \.\/a\.out\n/, '');
    check(name, r.finished && !r.stopped && o === expect && errs.length === 0,
          JSON.stringify(o) + (errs.length ? ' CONSOLE:' + errs[0] : '') + ((await errText()) ? ' ERR:' + (await errText()).slice(0,50) : ''));
  }

  console.log('\n=== QA: workflow ===');
  // edit -> run -> edit -> run cycle
  await setSrc('int main(void){int a;a=1;return(0);}'); await start(); await runAll();
  await setSrc('int main(void){int b;b=2;return(0);}'); await start(); const cyc = await runAll();
  check('edit then re-run works', cyc.finished && !cyc.stopped, JSON.stringify(cyc));

  // reset
  await page.click('#btnReset'); await new Promise(r => setTimeout(r, 150));
  check('reset returns to step 1', await page.evaluate(() => run.index) === 0,
        'histIndex=' + await page.evaluate(() => run.index));

  // switching example mid-run clears state
  await page.evaluate((kk) => loadExample(kk), 'ex8'); await new Promise(r => setTimeout(r, 120));
  check('switching example resets to editing', await page.evaluate(() => run.editing) === true);

  // breakpoint + Run stops there
  await page.evaluate((kk) => loadExample(kk), 'ex3'); await new Promise(r => setTimeout(r, 100));
  await start();
  await page.evaluate(() => toggleBreakpoint(7));
  // Phase 11 merged the playback slider and the animation-speed select into one
  // control, so "make Run fast" is now setAnimSpeed(5). Setup only — every
  // assertion below is unchanged.
  await page.evaluate(() => setAnimSpeed(5));
  await page.click('#btnRun');
  await new Promise(r => setTimeout(r, 1800));
  const bpStop = await page.evaluate(() => ({ playing: run.playing, line: run.history.steps[run.index].line }));
  check('Run halts at a breakpoint', bpStop.playing === false && bpStop.line === 7, JSON.stringify(bpStop));
  await page.evaluate(() => pausePlay());

  console.log('\n=== QA: cross-panel agreement (single source of truth) ===');
  // The Pointers panel is deliberately hidden in Beginner view, so switch first.
  await page.evaluate(() => document.querySelector('#levelSeg').querySelectorAll('button')[1].click());
  await setSrc('int main(void){int x;char c;int *p;x=258;c=65;p=&x;return(0);}');
  await start(); await runAll();
  const agree = await page.evaluate(() => {
    // land on the last step where locals are still live
    let idx = -1;
    for (let i = run.history.length - 1; i >= 0; i--) {
      const st = run.history.stateAt(i);
      if (st && st.vars.some(v => v.name === 'x')) { idx = i; break; }
    }
    goTo(idx);
    const st = run.history.stateAt(idx);
    const engineX = st.vars.find(v => v.name === 'x');
    const varsTxt = document.querySelector('#varsPanel').textContent.replace(/\s+/g, ' ');
    const memObj = Array.from(document.querySelectorAll('#memPanel .mem-obj'))
      .find(o => o.querySelector('.mo-name').textContent === 'x');
    const memVal = memObj.querySelector('.mo-value').textContent.trim();
    let fromBytes = 0;
    const bs = Array.from(memObj.querySelectorAll('.bv')).map(b => +b.dataset.val);
    for (let k = bs.length - 1; k >= 0; k--) fromBytes = fromBytes * 256 + bs[k];
    const frameTxt = document.querySelector('#stackPanel').textContent;
    const ptrTxt = document.querySelector('#ptrPanel').textContent.replace(/\s+/g, ' ');
    return { engine: engineX.value, addr: engineX.address,
             varsHasValue: varsTxt.indexOf('258') >= 0,
             memValHasValue: memVal.indexOf('258') >= 0,
             fromBytes: String(fromBytes),
             ptrResolves: ptrTxt.indexOf('258') >= 0,
             memAddr: memObj.querySelector('.mo-addr').textContent };
  });
  check('engine value == variables panel', agree.engine === '258' && agree.varsHasValue, JSON.stringify(agree.engine));
  check('engine value == memory panel decoded value', agree.memValHasValue);
  check('engine value == raw bytes recomposed', agree.fromBytes === '258', agree.fromBytes);
  check('engine value == pointer panel target', agree.ptrResolves);
  check('addresses agree between panels',
        agree.memAddr.indexOf('0x' + agree.addr.toString(16)) >= 0, agree.memAddr);

  console.log('\n=== QA: all 13 examples on the installed file ===');
  const keys = await page.evaluate(() => EXAMPLE_ORDER);
  const traps = { exBug1: 'Out-of-bounds', exBug2: 'Use-after-free' };
  for (const k of keys) {
    errs.length = 0;
    await page.evaluate((kk) => loadExample(kk), k); await new Promise(r => setTimeout(r, 70));
    const ni = await page.evaluate((kk) => !!EXAMPLES[kk].needsInput, k);
    await start();
    if (ni) { await page.click('#inOk'); await new Promise(r => setTimeout(r, 120)); }
    const r = await runAll();
    const e = await errText();
    const ok = traps[k] ? new RegExp(traps[k], 'i').test(e)
                        : (r.finished && !r.stopped && e === '' && errs.length === 0);
    check(k, ok, traps[k] ? e.slice(0, 50) : 'steps=' + r.steps + (e ? ' ERR:' + e.slice(0, 50) : '') + (errs.length ? ' C:' + errs[0] : ''));
  }

  console.log('\n' + '='.repeat(60));
  console.log('QA PASS ' + pass + '   FAIL ' + fail);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
