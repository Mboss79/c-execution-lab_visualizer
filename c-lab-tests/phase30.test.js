'use strict';
/* Stepping must not move the page the learner is reading.

   renderLearn() rebuilds the Learn view on every interaction. The lesson's two
   scroll containers, .c4-nav and .c4-main, used to be rebuilt with it, so both
   restarted at scrollTop 0 and every step threw the reader back to the top.

   The claim under test is narrow and behavioural: for every stepper action, at
   every reading position, the containers the learner did not touch hold their
   offset — while the step, the highlighted line and the panels still change.

   Two traps this suite is written to avoid:

   - A check that never reaches the state that triggers the bug passes against
     the bug. Every scroll assertion here first asserts it was scrolled away
     from the top, and every step assertion asserts the step actually moved.
   - puppeteer's page.click() calls scrollIntoViewIfNeeded, which would scroll
     the very container under test. Actions are dispatched in the page (a real
     click on a visible button, which is what a learner does) or, for the one
     genuine-input case, with the mouse at measured coordinates. */
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

/* the pages that actually carry a stepper, shallow to deepest */
const SCENARIOS = [
  { mod: 'C04', page: 'f:recursion', tab: 'subject', label: 'C04 1.5 recursion' },
  { mod: 'C04', page: 'ex:ex05',     tab: 'trace',   label: 'C04 ex05 trace' },
  { mod: 'C05', page: 'ex:ex08',     tab: 'trace',   label: 'C05 ex08 n-queens' },
];
const ACTIONS = ['next', 'next', 'prev', 'last', 'first', 'slider', 'reset'];

/* Everything the learner's reading position consists of, plus proof that the
   elements holding it are the same objects as before. */
const SNAP = () => {
  const main = document.querySelector('#learnRoot .c4-main');
  const nav = document.querySelector('#learnRoot .c4-nav');
  const rng = document.querySelector('#learnRoot [data-c4range]');
  const on = document.querySelector('#learnRoot .c4-cl.on');
  const a = document.activeElement;
  return {
    mainTop: main ? Math.round(main.scrollTop) : -1,
    mainMax: main ? Math.round(main.scrollHeight - main.clientHeight) : -1,
    navTop: nav ? Math.round(nav.scrollTop) : -1,
    navMax: nav ? Math.round(nav.scrollHeight - nav.clientHeight) : -1,
    winY: Math.round(window.scrollY),
    deTop: Math.round(document.documentElement.scrollTop),
    step: rng ? +rng.value : -1,
    max: rng ? +rng.max : -1,
    line: on ? on.textContent.trim().split(/\s+/)[0] : null,
    frames: document.querySelectorAll('#learnRoot .c4-frame').length,
    kept: !!(main && main.__probe) && !!(nav && nav.__probe),
    wraps: document.querySelectorAll('#learnRoot .c4-wrap').length,
    active: (a ? a.tagName : 'NONE') + (a && a.dataset && a.dataset.c4step ? '[' + a.dataset.c4step + ']' : '') +
            (a && a.dataset && a.dataset.c4range ? '[range]' : ''),
  };
};

const MARK = () => {
  const m = document.querySelector('#learnRoot .c4-main');
  const n = document.querySelector('#learnRoot .c4-nav');
  if (m) m.__probe = 1;
  if (n) n.__probe = 1;
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  // The optional c-lab-bridge (127.0.0.1:4242) supplies real gcc/norminette when
  // it is running. Its absence is the designed offline case, not a page fault.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;
    errs.push('console: ' + m.text());
  });
  await page.setViewport({ width: 1500, height: 900 });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1000);

  const open = async (s) => {
    await page.evaluate((sc) => {
      c4.mod = sc.mod; c4.page = sc.page; c4.tab = sc.tab; c4.step = null;
      showLearn();
    }, s);
    await sleep(350);
  };
  const act = async (a) => {
    if (a === 'slider') {
      await page.evaluate(() => {
        const r = document.querySelector('#learnRoot [data-c4range]');
        r.value = Math.max(0, Math.round(+r.max * 0.4));
        r.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } else {
      await page.evaluate(x => document.querySelector('#learnRoot [data-c4step="' + x + '"]').click(), a);
    }
    await sleep(120);
  };

  console.log('\n== the lesson scrollers survive the render ==');
  await open(SCENARIOS[0]);
  await page.evaluate(MARK);
  await act('next');
  let s = await page.evaluate(SNAP);
  check('.c4-main and .c4-nav are the same elements after a step', s.kept,
        'probe survived: ' + s.kept);
  check('and #learnRoot still holds exactly one shell', s.wraps === 1, s.wraps + ' .c4-wrap');
  await act('next'); await act('prev'); await act('last'); await act('first');
  s = await page.evaluate(SNAP);
  check('still one shell after six more renders', s.wraps === 1, s.wraps + ' .c4-wrap');
  check('and the scrollers are still the originals', s.kept);

  console.log('\n== the reading position holds, at every position, for every action ==');
  for (const sc of SCENARIOS) {
    await open(sc);
    const geom = await page.evaluate(SNAP);
    check(sc.label + ': the lesson is long enough to scroll', geom.mainMax > 60,
          'scrollable ' + geom.mainMax + 'px, ' + (geom.max + 1) + ' steps');

    for (const frac of [0.15, 0.5, 0.85]) {
      await open(sc);
      await page.evaluate(f => {
        const m = document.querySelector('#learnRoot .c4-main');
        const n = document.querySelector('#learnRoot .c4-nav');
        m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) * f);
        n.scrollTop = Math.round((n.scrollHeight - n.clientHeight) * f);
      }, frac);
      await sleep(140);

      const start = await page.evaluate(SNAP);
      const moves = [], stuck = [];
      for (const a of ACTIONS) {
        const before = await page.evaluate(SNAP);
        await act(a);
        const after = await page.evaluate(SNAP);
        if (after.mainTop !== before.mainTop) moves.push(a + ' main ' + before.mainTop + '->' + after.mainTop);
        if (after.navTop !== before.navTop) moves.push(a + ' nav ' + before.navTop + '->' + after.navTop);
        if (after.winY !== before.winY) moves.push(a + ' window ' + before.winY + '->' + after.winY);
        if (after.deTop !== before.deTop) moves.push(a + ' document ' + before.deTop + '->' + after.deTop);
        // the action must actually have done something, or the check is empty
        const boundary = (a === 'prev' && before.step === 0) || (a === 'last' && before.step === before.max) ||
                         (a === 'next' && before.step === before.max) || (a === 'first' && before.step === 0);
        if (!boundary && after.step === before.step) stuck.push(a + ' @' + before.step);
      }
      const at = Math.round(frac * 100) + '%';
      check(sc.label + ' @' + at + ': reached the state that triggers the bug',
            start.mainTop > 0 && start.navTop > 0,
            'main ' + start.mainTop + '/' + start.mainMax + ', nav ' + start.navTop + '/' + start.navMax);
      check(sc.label + ' @' + at + ': every action left the reading position alone',
            moves.length === 0, moves.join('; ') || 'seven actions, nothing moved');
      check(sc.label + ' @' + at + ': and every action actually changed the step',
            stuck.length === 0, stuck.length ? 'no-ops: ' + stuck.join(', ') : 'all effective');
    }

    // the visualizer must still be a visualizer
    await open(sc);
    const a0 = await page.evaluate(SNAP);
    await act('last');
    const a1 = await page.evaluate(SNAP);
    check(sc.label + ': the highlighted line still follows the step',
          a1.line !== null && a1.line !== a0.line, 'line ' + a0.line + ' -> ' + a1.line);
    // mid-run, not at the end: by the last step the program has returned and no
    // frame is alive, which is the engine telling the truth, not a broken panel
    await act('slider');
    const a2 = await page.evaluate(SNAP);
    check(sc.label + ': the call-stack / variable panels still render mid-run',
          a2.frames > 0, a2.frames + ' frames shown at step ' + a2.step);
  }

  console.log('\n== a real mouse click, with the control on screen ==');
  await open(SCENARIOS[0]);
  // scroll so the control is genuinely under the pointer AND the lesson is
  // genuinely scrolled: clicking a button that is off screen proves nothing
  await page.evaluate(() => {
    const m = document.querySelector('#learnRoot .c4-main');
    const r = document.querySelector('#learnRoot [data-c4step="next"]').getBoundingClientRect();
    m.scrollTop = Math.max(60, Math.round(m.scrollTop + r.top - 400));
  });
  await sleep(200);
  const box = await page.evaluate(() => {
    const r = document.querySelector('#learnRoot [data-c4step="next"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.top > 0 && r.bottom < window.innerHeight };
  });
  check('the next button is on screen for a genuine click', box.vis);
  const mb = await page.evaluate(SNAP);
  await page.mouse.click(box.x, box.y);
  await sleep(200);
  const ma = await page.evaluate(SNAP);
  check('a real click was scrolled away from the top first', mb.mainTop > 0, 'main at ' + mb.mainTop);
  check('a real click steps without moving the lesson',
        ma.mainTop === mb.mainTop && ma.step === mb.step + 1,
        'main ' + mb.mainTop + '->' + ma.mainTop + ', step ' + mb.step + '->' + ma.step);
  check('and focus lands on the button that was clicked, not on <body>',
        ma.active === 'BUTTON[next]', ma.active);

  console.log('\n== keyboard ==');
  await open(SCENARIOS[0]);
  await act('first');   // the default step sits near the end, where the ceiling hides the bug
  await page.evaluate(() => {
    document.querySelector('#learnRoot .c4-main').scrollTop = 300;
    document.querySelector('#learnRoot [data-c4range]').focus();
  });
  await sleep(150);
  const k0 = await page.evaluate(SNAP);
  const seq = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await sleep(160);
    seq.push(await page.evaluate(SNAP));
  }
  check('the slider was scrolled away from the top before the keys', k0.mainTop > 0, 'main at ' + k0.mainTop);
  check('arrow keys step the slider more than once',
        seq[0].step === k0.step + 1 && seq[1].step === k0.step + 2 && seq[2].step === k0.step + 3,
        [k0.step, seq[0].step, seq[1].step, seq[2].step].join(' -> '));
  check('focus stays on the slider across the re-renders',
        seq.every(x => x.active === 'INPUT[range]'), seq.map(x => x.active).join(','));
  check('and the lesson did not move while stepping by keyboard',
        seq.every(x => x.mainTop === k0.mainTop), k0.mainTop + ' -> ' + seq.map(x => x.mainTop).join(','));

  await open(SCENARIOS[0]);
  await page.evaluate(() => document.querySelector('#learnRoot [data-c4step="first"]').focus());
  const order = [];
  for (let i = 0; i < 5; i++) {
    order.push(await page.evaluate(() => {
      const a = document.activeElement;
      return (a.dataset && a.dataset.c4step) || (a.dataset && a.dataset.c4range ? 'range' : a.tagName);
    }));
    await page.keyboard.press('Tab');
    await sleep(80);
  }
  check('tab still reaches every stepper control in order',
        order.join(',') === 'first,prev,range,next,last', order.join(','));

  console.log('\n== navigation that should start at the top still does ==');
  await open(SCENARIOS[0]);
  await page.evaluate(() => { document.querySelector('#learnRoot .c4-main').scrollTop = 400; });
  await sleep(120);
  const g0 = await page.evaluate(SNAP);
  await page.evaluate(() => document.querySelector('#learnRoot [data-c4go="f:write"]').click());
  await sleep(300);
  const g1 = await page.evaluate(SNAP);
  check('the lesson was scrolled down before navigating', g0.mainTop > 0, 'main at ' + g0.mainTop);
  check('moving to another lesson still lands at the top', g1.mainTop === 0, 'main at ' + g1.mainTop);

  await page.evaluate(() => { document.querySelector('#learnRoot .c4-main').scrollTop = 400; });
  await sleep(120);
  const m0 = await page.evaluate(SNAP);
  await page.evaluate(() => document.querySelector('#learnRoot [data-c4mod="C05"]').click());
  await sleep(350);
  const m1 = await page.evaluate(SNAP);
  const modNow = await page.evaluate(() => c4.mod);
  check('the lesson was scrolled down before switching course', m0.mainTop > 0, 'main at ' + m0.mainTop);
  check('switching course still lands at the top', m1.mainTop === 0 && modNow === 'C05',
        'main at ' + m1.mainTop + ', module ' + modNow);

  console.log('\n== the standalone lab visualizer is unaffected ==');
  const labRes = [];
  for (const tab of ['functions', 'c03', 'ptr', 'argv', 'repro']) {
    await page.evaluate(t => openLabTab(t), tab);
    await sleep(400);
    const set = await page.evaluate(() => {
      const r = document.querySelector('#labRoot');
      r.scrollTop = Math.round((r.scrollHeight - r.clientHeight) * 0.5);
      return Math.round(r.scrollTop);
    });
    await page.evaluate(() => {
      const r = document.querySelector('#labRoot input[type=range]');
      r.value = Math.min(+r.max, +r.value + 1);
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(220);
    const after = await page.evaluate(() => ({
      top: Math.round(document.querySelector('#labRoot').scrollTop),
      max: Math.round(document.querySelector('#labRoot').scrollHeight - document.querySelector('#labRoot').clientHeight),
      win: Math.round(window.scrollY),
    }));
    // the only legitimate change is clamping when the new content is shorter
    const ok = after.win === 0 && (after.top === set || after.top === after.max);
    labRes.push(tab + ' ' + set + '->' + after.top + (ok ? '' : ' !!'));
    if (set === 0) labRes.push(tab + ' (not scrollable, vacuous)');
  }
  check('lab steppers hold their own scroll position too',
        labRes.every(x => x.indexOf('!!') < 0), labRes.join('; '));

  console.log('\n== nothing else moved ==');
  const overflow = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth, winW: window.innerWidth,
    bodyW: document.body.scrollWidth,
  }));
  check('the document has no horizontal overflow',
        overflow.docW <= overflow.winW + 1 && overflow.bodyW <= overflow.winW + 1,
        'doc ' + overflow.docW + ', body ' + overflow.bodyW + ', window ' + overflow.winW);
  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log('\n----------------------------------------------------------------');
  console.log('Stepper scroll stability  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
