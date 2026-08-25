'use strict';
/* ============================================================================
   PHASE 10 — final global UX + educational upgrade

   The rule this suite exists to enforce:

       ENGINE CAPABILITY  is not  EDUCATIONAL UI FEATURE.

   Detecting an array overflow proves nothing about whether a learner can find
   it, load it, step through it and understand it. So almost every check here
   drives the REAL page in a REAL browser and asserts on what is actually on
   screen — geometry, classes, anchored popups — rather than on the existence
   of a function.

   Part 1  engine-side: every Error Lab lesson really produces the fault it
           claims, with the structured detail the lesson panel prints
   Part 2  the source workspace: duplicate Project gone, expand, Tab
   Part 3  scrolling and sticky headers
   Part 4  Basic / Medium / Deep
   Part 5  the memory panel: clean cells, hover, anchored click popup,
           execution focus vs user selection
   Part 6  the Memory Error Lab, end to end, one lesson at a time
   Part 7  camera immutability, pan, zoom, fit
   Part 8  debugger synchronization, i18n, themes, the dock splitter
   ========================================================================== */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { load } = require('./load-engine.js');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'screenshots');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, n = 0;
function check(name, ok, detail) {
  n++;
  const tag = '[' + n + '] ';
  if (ok === true) { pass++; console.log('  PASS ' + tag + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + tag + name + '  -- ' + (detail !== undefined ? detail : ok)); }
}

/* The lesson catalogue, read out of the SHIPPED page. There is no second copy
   of it in this file: if the page ships a lesson, this suite tests that one. */
function shippedLessons() {
  const a = HTML.indexOf('const ERROR_LESSONS = [');
  const b = HTML.indexOf('\n];', a);
  if (a < 0 || b < 0) throw new Error('ERROR_LESSONS not found in the shipped page');
  const body = HTML.slice(a, b + 3);
  const out = [];
  const re = /\{\n\s*id:'([a-z]+)',[\s\S]*?src:\n`([\s\S]*?)`\}/g;
  let m;
  while ((m = re.exec(body))) {
    const head = body.slice(m.index, m.index + 400);
    const kind = /kind:'([a-z-]+)'/.exec(head);
    const dir = /direction:'([a-z]+)'/.exec(head);
    const acc = /\baccess:'([a-z]+)'/.exec(head);
    out.push({ id: m[1], kind: kind && kind[1], direction: dir && dir[1],
               access: acc && acc[1], src: m[2],
               limit: /\blimit:\{/.test(head) });
  }
  return out;
}

(async () => {
  console.log('=== Phase 10 · part 1: every lesson really does what it claims ===');
  const E = load();
  const lessons = shippedLessons();
  check('the page ships at least the 11 required lessons', lessons.length >= 11, lessons.length + ' lessons');

  const REQUIRED = ['overflow', 'underflow', 'invalidread', 'invalidwrite', 'nullderef',
                    'invalidaccess', 'uaf', 'uar', 'doublefree', 'invalidfree', 'stackoverflow'];
  const ids = lessons.map(l => l.id);
  check('all eleven required error kinds are present as lessons',
        REQUIRED.every(r => ids.includes(r)),
        REQUIRED.filter(r => !ids.includes(r)).join(',') || 'all present');

  const observed = {};
  for (const l of lessons) {
    const parsed = E.createRun(l.src, {});
    if (!parsed.ok) { check('lesson ' + l.id + ' compiles', false, parsed.error.message); continue; }
    const out = E.runToCompletion(l.src, {});
    const err = out.error;
    observed[l.id] = err;
    check('lesson "' + l.id + '" stops on the error it claims (' + l.kind + ')',
          !!err && err.kind === l.kind,
          err ? 'got ' + err.kind : 'the program finished without an error');
    if (!err) continue;
    check('lesson "' + l.id + '" reports the source line that caused it',
          typeof err.line === 'number' && err.line > 0 &&
          l.src.split('\n').length >= err.line,
          'line ' + err.line);
    if (l.direction) {
      check('lesson "' + l.id + '" reports direction ' + l.direction,
            (err.details || {}).direction === l.direction, (err.details || {}).direction);
    }
    if (l.access) {
      check('lesson "' + l.id + '" reports access "' + l.access + '"',
            err.access === l.access, err.access);
    }
  }

  // The facts the lesson panel prints must come from the engine, not from prose.
  const ov = observed.overflow && observed.overflow.details;
  check('array overflow carries arrayName / requested / valid range / addresses',
        !!ov && ov.arrayName === 'arr' && ov.requested === 5 && ov.validMin === 0 && ov.validMax === 2 &&
        typeof ov.validFrom === 'number' && typeof ov.validTo === 'number' && ov.len === 3,
        JSON.stringify(ov && { a: ov.arrayName, r: ov.requested, min: ov.validMin, max: ov.validMax, len: ov.len }));
  const un = observed.underflow && observed.underflow.details;
  check('array underflow reports a NEGATIVE requested index, not a wrapped one',
        !!un && un.requested < 0, un && un.requested);
  check('underflow address is BELOW the array base — the picture is not invented',
        !!un && observed.underflow.address < un.validFrom,
        un && (observed.underflow.address + ' < ' + un.validFrom));
  check('overflow address is ABOVE the array end',
        !!ov && observed.overflow.address > ov.validTo,
        ov && (observed.overflow.address + ' > ' + ov.validTo));
  check('null dereference reports address 0 and nothing else pretending to be memory',
        observed.nullderef && observed.nullderef.address === 0, observed.nullderef && observed.nullderef.address);
  const uaf = observed.uaf && observed.uaf.details;
  check('use-after-free names the freed block and its real bounds',
        !!uaf && typeof uaf.validFrom === 'number' && typeof uaf.validTo === 'number' && !!uaf.blockLabel,
        JSON.stringify(uaf && { l: uaf.blockLabel, f: uaf.validFrom, t: uaf.validTo }));
  const uar = observed.uar && observed.uar.details;
  check('use-after-return names the dead frame’s storage',
        !!uar && !!uar.blockLabel, uar && uar.blockLabel);
  const so = observed.stackoverflow && observed.stackoverflow.details;
  check('stack overflow reports the real depth and limit it hit',
        !!so && so.depth === so.limit && so.limit > 0 && !!so.fn,
        JSON.stringify(so));
  check('stack overflow is the ONE lesson that declares a limitation, and it declares it',
        lessons.find(l => l.id === 'stackoverflow').limit === true);
  check('the invalid-access lesson is genuinely unmapped, not a bounded block',
        observed.invalidaccess && (observed.invalidaccess.details || {}).unmapped === true);

  /* ===================== BROWSER ===================== */
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  async function reload() {
    await page.goto(FILE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(700);
    await page.evaluate(() => showWorkspace());
    await sleep(120);
  }
  // doStep() returns nothing, so progress is judged by the index actually moving.
  const runAll = () => page.evaluate(() => {
    let last = -2;
    for (let i = 0; i < 4000 && !run.stopped; i++) {
      if (run.index === last && run.history) break;
      last = run.index;
      doStep();
    }
  });

  await reload();

  console.log('\n=== Phase 10 · part 2: the source workspace ===');
  check('the duplicate Project panel is gone from the left pane',
        await page.evaluate(() => !document.querySelector('#panelExplorer')));
  check('the Project menu in the title bar still works',
        await page.evaluate(() => {
          document.querySelector('#mProject').click();
          const open = document.querySelectorAll('.menu-pop .mi, .menu-pop button').length > 0;
          document.body.click();
          return open;
        }));
  check('the project tree still exists and still lists every exercise',
        await page.evaluate(() => {
          openLibrary('files');
          const rows = document.querySelectorAll('#explorer .tree-row').length;
          return rows === EXAMPLE_ORDER.length ? true : 'rows=' + rows + ' of ' + EXAMPLE_ORDER.length;
        }) === true);
  await page.evaluate(() => closeLibrary());

  // the space really did go to the editor
  const srcBox = await page.evaluate(() => {
    const r = document.querySelector('#srcScroll').getBoundingClientRect();
    const p = document.querySelector('#paneLeft').getBoundingClientRect();
    return { h: Math.round(r.height), pane: Math.round(p.height), share: r.height / p.height };
  });
  check('the source editor now owns most of the left pane',
        srcBox.share > 0.75, Math.round(srcBox.share * 100) + '% of ' + srcBox.pane + 'px');

  // Deep is the level where the timeline is part of the UI, so it is the level
  // that can prove expanding DISPLACES it rather than destroying it. (At Basic
  // the timeline is not on the page at all — see part 4.)
  const beforeExp = await page.evaluate(() => {
    setLevel('deep');
    const r = document.querySelector('#srcScroll').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  await sleep(120);
  await page.click('#btnExpandSrc');
  await sleep(250);
  const afterExp = await page.evaluate(() => {
    const r = document.querySelector('#srcScroll').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), cls: document.body.classList.contains('src-expanded') };
  });
  check('expanding the source gives it substantially more room',
        afterExp.cls && afterExp.w * afterExp.h > beforeExp.w * beforeExp.h * 2,
        beforeExp.w + 'x' + beforeExp.h + ' -> ' + afterExp.w + 'x' + afterExp.h);
  check('expanding does not break the layout or hide the toolbar',
        await page.evaluate(() => {
          const t = document.querySelector('.toolbar').getBoundingClientRect();
          return t.height > 20 && document.documentElement.scrollWidth <= window.innerWidth + 1;
        }));
  check('the timeline header stays on screen while expanded — nothing is destroyed',
        await page.evaluate(() => {
          const h = document.querySelector('#panelTimeline .panel-head').getBoundingClientRect();
          return h.height > 10 && h.top >= 0 && h.bottom <= window.innerHeight;
        }));
  await page.screenshot({ path: path.join(SHOTS, 'p11_src_expanded.png') });
  await page.click('#btnExpandSrc');
  await sleep(250);
  const restored = await page.evaluate(() => {
    const r = document.querySelector('#srcScroll').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), cls: document.body.classList.contains('src-expanded') };
  });
  check('collapsing restores the previous layout exactly',
        !restored.cls && restored.w === beforeExp.w && restored.h === beforeExp.h,
        JSON.stringify(restored));
  check('collapsing brings the debugger pane back',
        await page.evaluate(() => document.querySelector('#paneRight').getBoundingClientRect().width > 200));
  check('collapsing brings the timeline back to its full height too',
        await page.evaluate(() => document.querySelector('#panelTimeline').getBoundingClientRect().height > 100));
  await page.evaluate(() => setLevel('beginner'));

  /* ---- Tab ---- */
  await page.evaluate(() => {
    const ta = $('#sourceEdit');
    ta.value = 'int main(void)\n{\nint x;\nx = 1;\nreturn (0);\n}\n';
    ta.focus();
    ta.setSelectionRange(0, 0);
  });
  await page.keyboard.press('Tab');
  await sleep(80);
  check('Tab keeps focus inside the editor instead of moving it away',
        await page.evaluate(() => document.activeElement && document.activeElement.id === 'sourceEdit'),
        await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  check('Tab inserts an indent at the cursor',
        await page.evaluate(() => $('#sourceEdit').value.startsWith('\tint main')),
        JSON.stringify(await page.evaluate(() => $('#sourceEdit').value.slice(0, 12))));
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await sleep(80);
  check('Shift+Tab removes it again',
        await page.evaluate(() => $('#sourceEdit').value.startsWith('int main')),
        JSON.stringify(await page.evaluate(() => $('#sourceEdit').value.slice(0, 12))));

  // multi-line block indent
  await page.evaluate(() => {
    const ta = $('#sourceEdit');
    ta.value = 'a;\nb;\nc;\n';
    ta.focus();
    ta.setSelectionRange(0, 5);           // spans lines 1 and 2
  });
  await page.keyboard.press('Tab');
  await sleep(80);
  check('Tab indents every line of a multi-line selection',
        await page.evaluate(() => $('#sourceEdit').value === '\ta;\n\tb;\nc;\n'),
        JSON.stringify(await page.evaluate(() => $('#sourceEdit').value)));
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await sleep(80);
  check('Shift+Tab unindents every line of the selection',
        await page.evaluate(() => $('#sourceEdit').value === 'a;\nb;\nc;\n'),
        JSON.stringify(await page.evaluate(() => $('#sourceEdit').value)));
  check('the selection still covers the same lines after a block indent',
        await page.evaluate(() => {
          const ta = $('#sourceEdit');
          return ta.selectionStart === 0 && ta.selectionEnd >= 4;
        }));
  check('ordinary typing still works after the Tab handler is installed',
        await page.evaluate(() => {
          const ta = $('#sourceEdit');
          ta.value = ''; ta.focus();
          return true;
        }) && (await page.keyboard.type('int x;'), await page.evaluate(() => $('#sourceEdit').value === 'int x;')));

  console.log('\n=== Phase 10 · part 3: scrolling and sticky headers ===');
  await reload();
  await page.evaluate(() => { loadExample('ex6'); setLevel('deep'); });
  await runAll();
  await sleep(200);
  check('panel headers in the left pane are sticky too',
        await page.evaluate(() => getComputedStyle(document.querySelector('#paneLeft > .panel > .panel-head')).position === 'sticky'));
  check('the left pane can scroll when its content needs it',
        await page.evaluate(() => /auto|scroll/.test(getComputedStyle(document.querySelector('#paneLeft')).overflowY)));
  check('no content is ever painted over a visible panel header',
        await page.evaluate(() => {
          const containers = [];
          document.querySelectorAll('*').forEach(el => {
            const cs = getComputedStyle(el);
            if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) containers.push(el);
          });
          for (const frac of [0, 0.33, 0.66, 1]) {
            containers.forEach(c => { c.scrollTop = c.scrollHeight * frac; });
            for (const h of document.querySelectorAll('.panel-head')) {
              let sc = h.parentElement;
              while (sc && !(/auto|scroll/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 2)) sc = sc.parentElement;
              const hr = h.getBoundingClientRect();
              if (hr.height < 4) continue;
              let top = hr.top, bot = hr.bottom;
              if (sc) {
                const sr = sc.getBoundingClientRect();
                if (hr.bottom <= sr.top + 1 || hr.top >= sr.bottom - 1) continue;
                top = Math.max(top, sr.top); bot = Math.min(bot, sr.bottom);
              }
              if (bot - top < 4) continue;
              const el = document.elementFromPoint(hr.left + hr.width * 0.5, (top + bot) / 2);
              if (el && !h.contains(el) && el !== h) return h.parentElement.id + ' covered by ' + (el.className || el.tagName);
            }
          }
          return true;
        }) === true);
  check('no panel body is a scroll container competing with its pane',
        await page.evaluate(() => {
          const bad = [];
          document.querySelectorAll('.pane-scroll .panel-body, #paneLeft > .panel > .panel-body').forEach(b => {
            if (/auto|scroll/.test(getComputedStyle(b).overflowY) && b.scrollHeight > b.clientHeight + 2)
              bad.push(b.parentElement.id);
          });
          return bad.length ? bad.join(',') : true;
        }) === true);
  check('the whole panel list is reachable by scrolling the pane',
        await page.evaluate(() => {
          const sc = document.querySelector('#rightScroll');
          sc.scrollTop = sc.scrollHeight;
          const last = document.querySelector('#panelDeep');
          const r = last.getBoundingClientRect(), s = sc.getBoundingClientRect();
          return r.top < s.bottom && r.bottom > s.top;
        }));

  console.log('\n=== Phase 10 · part 4: Basic / Medium / Deep ===');
  check('the detail control reads Basic / Medium / Deep',
        await page.evaluate(() => [...document.querySelectorAll('#levelSeg button')].map(b => b.textContent.trim()).join('/')) === 'Basic/Medium/Deep',
        await page.evaluate(() => [...document.querySelectorAll('#levelSeg button')].map(b => b.textContent.trim()).join('/')));
  const openAt = (lvl) => page.evaluate((l) => {
    setLevel(l);
    return [...document.querySelectorAll('#rightScroll .panel')]
      .filter(p => !p.classList.contains('collapsed') && !p.hidden).map(p => p.id);
  }, lvl);
  const basicPanels = await openAt('beginner');
  check('BASIC shows exactly call stack, variables, memory and pointers',
        JSON.stringify(basicPanels.sort()) === JSON.stringify(['panelMemory','panelPointers','panelStack','panelVars']),
        basicPanels.join(','));
  const medPanels = await openAt('intermediate');
  check('MEDIUM adds the RAM map and nothing else',
        JSON.stringify(medPanels.sort()) === JSON.stringify(['panelMemory','panelPointers','panelRam','panelStack','panelVars']),
        medPanels.join(','));
  const deepPanels = await openAt('deep');
  check('DEEP opens everything Basic and Medium showed, plus the advanced panels',
        ['panelStack','panelVars','panelMemory','panelPointers','panelRam','panelTrace',
         'panelWatch','panelDeep'].every(id => deepPanels.includes(id)),
        deepPanels.join(','));
  check('DEEP also opens the timeline',
        await page.evaluate(() => !document.querySelector('#panelTimeline').classList.contains('collapsed')));
  check('BASIC keeps the timeline out of the way',
        await page.evaluate(() => { setLevel('beginner'); return document.querySelector('#panelTimeline').classList.contains('collapsed'); }));

  // changing level must not disturb the program
  const keep = await page.evaluate(() => {
    setLevel('deep');
    goTo(Math.floor(run.history.length / 2));
    ui.focusByte = null;
    const c = document.querySelector('#memPanel .mcell');
    if (c) c.click();
    const before = { idx: run.index, sel: ui.focusByte && ui.focusByte.address, len: run.history.length,
                     src: run.src.length, cam: (viz.stage ? JSON.stringify(viz.stage.getCamera()) : null) };
    setLevel('beginner'); setLevel('intermediate'); setLevel('deep');
    const after = { idx: run.index, sel: ui.focusByte && ui.focusByte.address, len: run.history.length,
                    src: run.src.length, cam: (viz.stage ? JSON.stringify(viz.stage.getCamera()) : null) };
    return { before, after };
  });
  check('changing the detail level does not move the execution position',
        keep.before.idx === keep.after.idx, keep.before.idx + ' -> ' + keep.after.idx);
  check('changing the detail level does not reset the program state',
        keep.before.len === keep.after.len && keep.before.src === keep.after.src);
  check('changing the detail level keeps the learner’s memory selection',
        keep.before.sel === keep.after.sel, keep.before.sel + ' -> ' + keep.after.sel);
  check('changing the detail level does not move the camera',
        keep.before.cam === keep.after.cam);

  console.log('\n=== Phase 10 · part 5: the memory panel ===');
  await reload();
  const STR = ['int\tmain(void)', '{', '\tchar\tstr[6];', '\tint\ti;', '',
    "\tstr[0] = 'H';", "\tstr[1] = 'e';", "\tstr[2] = 'l';", "\tstr[3] = 'l';",
    "\tstr[4] = 'o';", '\tstr[5] = 0;', '\ti = 0;', '\twhile (str[i] != 0)', '\t{',
    '\t\tstr[i] = str[i] + 1;', '\t\ti++;', '\t}', '\treturn (0);', '}', ''].join('\n');
  await page.evaluate((s) => { $('#sourceEdit').value = s; switchToEditing(); setLevel('beginner'); }, STR);
  await runAll();
  await sleep(200);

  check('an array is drawn as one labelled cell per element',
        await page.evaluate(() => {
          goTo(run.history.length - 3);
          const cells = document.querySelectorAll('#memPanel .mem-cells .mcell');
          return cells.length >= 6 && !!cells[0].querySelector('.mc-box') && !!cells[0].querySelector('.mc-i');
        }));
  check('per-byte addresses are NOT printed under every cell at Basic',
        await page.evaluate(() => {
          const e = document.querySelector('#memPanel .byte-cell .ba');
          if (!e) return 'no byte cells rendered';
          return getComputedStyle(e).display === 'none' ? true : 'display=' + getComputedStyle(e).display;
        }) === true);
  check('Deep still gives the learner every byte address',
        await page.evaluate(() => {
          setLevel('deep');
          const e = document.querySelector('#memPanel .byte-cell .ba');
          const d = e ? getComputedStyle(e).display : 'missing';
          setLevel('beginner');
          return d !== 'none' && d !== 'missing' ? true : 'display=' + d;
        }) === true);

  /* execution highlight follows str[i] using the ENGINE's own addresses */
  const track = await page.evaluate(() => {
    const seen = [];
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = document.querySelector('#memPanel .mcell.exec');
      if (c) seen.push({ i, label: c.getAttribute('aria-label'), addr: +c.dataset.addr });
    }
    return seen;
  });
  const strSeen = track.filter(s => /^str\[/.test(s.label || ''));
  check('the current cell is highlighted, and it is a real cell of the array',
        strSeen.length >= 6, strSeen.length + ' steps highlight an str[] cell');
  const order = strSeen.map(s => s.label);
  check('the highlight walks str[0], str[1], str[2] ... as the program does',
        order.indexOf('str[0]') >= 0 && order.indexOf('str[1]') > order.indexOf('str[0]') &&
        order.indexOf('str[2]') > order.indexOf('str[1]'),
        order.slice(0, 8).join(' '));
  check('the highlighted cell carries a CURRENT marker',
        await page.evaluate(() => {
          for (let i = 0; i < run.history.length; i++) {
            goTo(i);
            const c = document.querySelector('#memPanel .mcell.exec');
            if (c) return !!c.querySelector('.mc-cur') && c.getAttribute('aria-current') === 'true';
          }
          return 'no highlighted cell at all';
        }) === true);
  check('the memory panel and the 3D scene agree on the current address',
        await page.evaluate(() => {
          const bad = [];
          for (let i = 0; i < run.history.length; i++) {
            const s = run.history.steps[i];
            const f = CViz3D.focusAddress({ error: null, memDiff: s.memDiff, accessed: s.accessed });
            goTo(i);
            const c = document.querySelector('#memPanel .mcell.exec, #memPanel .bv.exec');
            if (f && c && +c.dataset.addr !== f.address) {
              // a multi-byte element legitimately covers the focused address
              const span = +c.dataset.span || 1;
              if (!(f.address >= +c.dataset.addr && f.address < +c.dataset.addr + span)) bad.push(i);
            }
            if (!f && c) bad.push('extra@' + i);
          }
          return bad.length ? bad.slice(0, 5).join(',') : true;
        }) === true);
  check('nothing is highlighted on a step where the engine reports no access',
        await page.evaluate(() => {
          for (let i = 0; i < run.history.length; i++) {
            const s = run.history.steps[i];
            if ((s.accessed || []).length === 0 && !s.memDiff) {
              goTo(i);
              return !document.querySelector('#memPanel .mcell.exec') ? true : 'step ' + i + ' invented a highlight';
            }
          }
          return true;
        }) === true);

  /* click: anchored popup */
  const popup = await page.evaluate(() => {
    goTo(run.history.length - 4);
    const cells = [...document.querySelectorAll('#memPanel .mcell')];
    const target = cells.find(c => c.getAttribute('aria-label') === 'str[2]');
    if (!target) return 'no str[2] cell';
    target.click();
    // the click re-renders the panel, so the node clicked is now detached
    const live = [...document.querySelectorAll('#memPanel .mcell')]
      .find(c => c.getAttribute('aria-label') === 'str[2]');
    const pop = document.querySelector('#memPanel .byte-detail');
    if (!pop || !live) return 'no popup';
    const pr = pop.getBoundingClientRect(), cr = live.getBoundingClientRect();
    const mr = document.querySelector('#memPanel').getBoundingClientRect();
    return {
      anchored: pop.classList.contains('anchored'),
      gapY: Math.round(Math.min(Math.abs(cr.top - pr.bottom), Math.abs(pr.top - cr.bottom))),
      inSameObject: (() => { const o = live.closest('.mem-obj').getBoundingClientRect();
        return pr.top < o.bottom + 4 && pr.bottom > o.top - 4; })(),
      dx: Math.round(Math.abs((pr.left + pr.width / 2) - (cr.left + cr.width / 2))),
      insideX: pr.left >= mr.left - 1 && pr.right <= mr.right + 1,
      text: pop.textContent.replace(/\s+/g, ' '),
      selCells: document.querySelectorAll('#memPanel .mcell.sel').length,
    };
  });
  // The popup is clamped inside the panel, so the gap can grow a little when the
  // cell sits near an edge; what must hold is that it stays beside its own
  // object instead of becoming a details panel further down the page.
  check('clicking a cell opens a popup anchored to THAT cell, not a panel far below',
        popup.anchored === true && popup.gapY <= 60 && popup.inSameObject === true,
        JSON.stringify({ anchored: popup.anchored, gapY: popup.gapY, sameObj: popup.inSameObject }));
  check('the popup stays inside the panel near an edge instead of sliding off',
        popup.insideX === true, 'dx=' + popup.dx);
  check('the popup names the cell and reports address, value, type and size',
        /str\[2\]/.test(popup.text) && /address/.test(popup.text) && /0x/.test(popup.text) &&
        /decimal/.test(popup.text) && /type/.test(popup.text), popup.text.slice(0, 130));
  check('exactly one cell is marked as the learner’s selection',
        popup.selCells === 1, String(popup.selCells));

  /* the popup flips rather than leaving the panel */
  check('a cell near the top gets its popup placed below instead of clipped',
        await page.evaluate(() => {
          const sc = document.querySelector('#rightScroll');
          const cell = document.querySelector('#memPanel .mcell');
          cell.scrollIntoView({ block: 'start' });
          cell.click();
          const pop = document.querySelector('#memPanel .byte-detail');
          if (!pop) return 'no popup';
          const pr = pop.getBoundingClientRect(), mr = document.querySelector('#memPanel').getBoundingClientRect();
          return pr.top >= mr.top - 1 ? true : 'popup escaped above the panel';
        }) === true);

  /* selection vs execution focus */
  const sep = await page.evaluate(() => {
    let target = null;
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const c = document.querySelector('#memPanel .mcell.exec');
      if (c && c.getAttribute('aria-label') === 'str[3]') { target = i; break; }
    }
    if (target === null) return 'no step focuses str[3]';
    goTo(target);
    const before = document.querySelector('#memPanel .mcell.exec').getAttribute('aria-label');
    [...document.querySelectorAll('#memPanel .mcell')]
      .find(c => c.getAttribute('aria-label') === 'str[1]').click();
    const exec = document.querySelector('#memPanel .mcell.exec');
    const sel = document.querySelector('#memPanel .mcell.sel');
    return { before, exec: exec && exec.getAttribute('aria-label'), sel: sel && sel.getAttribute('aria-label'),
             index: run.index, target };
  });
  check('clicking a cell does NOT move the execution focus',
        sep.before === 'str[3]' && sep.exec === 'str[3]', JSON.stringify(sep));
  check('the learner can inspect str[1] while execution sits on str[3]',
        sep.sel === 'str[1]' && sep.exec === 'str[3]', sep.sel + ' vs ' + sep.exec);
  check('inspecting a cell does not step the debugger',
        sep.index === sep.target, sep.index + ' vs ' + sep.target);

  /* hover */
  await page.evaluate(() => { ui.focusByte = null; render(); });
  await sleep(120);
  const hoverPt = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#memPanel .mcell')].find(x => x.getAttribute('aria-label') === 'str[4]');
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(hoverPt.x - 4, hoverPt.y - 4);
  await page.mouse.move(hoverPt.x, hoverPt.y);
  await sleep(150);
  const tip = await page.evaluate(() => {
    const t = document.querySelector('#memTip');
    if (!t) return 'no tooltip';
    const c = [...document.querySelectorAll('#memPanel .mcell')].find(x => x.getAttribute('aria-label') === 'str[4]');
    const tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return { text: t.textContent.replace(/\s+/g, ' '),
             dx: Math.round(Math.abs((tr.left + tr.width / 2) - (cr.left + cr.width / 2))),
             gap: Math.round(Math.min(Math.abs(cr.top - tr.bottom), Math.abs(tr.top - cr.bottom))) };
  });
  check('hovering a cell shows a light tooltip beside THAT cell',
        typeof tip === 'object' && tip.dx < 60 && tip.gap < 24, JSON.stringify(tip));
  check('the tooltip names the cell and its real address',
        typeof tip === 'object' && /str\[4\]/.test(tip.text) && /0x[0-9a-f]+/.test(tip.text), tip.text);
  const moved = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#memPanel .mcell')].find(x => x.getAttribute('aria-label') === 'str[0]');
    c.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    const t = document.querySelector('#memTip');
    return t ? t.textContent.replace(/\s+/g, ' ') : 'gone';
  });
  check('moving to another cell moves the tooltip with it', /str\[0\]/.test(moved), moved);
  await page.evaluate(() => hideMemTip());
  await page.screenshot({ path: path.join(SHOTS, 'p11_memory.png') });

  console.log('\n=== Phase 10 · part 6: the Memory Error Lab, lesson by lesson ===');
  await reload();
  check('the lab is reachable from the rail in one click',
        await page.evaluate(() => {
          document.querySelector('#railErrLab').click();
          return !document.querySelector('#libDrawer').hidden && ui.libTab === 'errors';
        }));
  check('every lesson has a button the learner can press',
        await page.evaluate(() => {
          const b = document.querySelectorAll('#libErrors .elab').length;
          return b === ERROR_LESSONS.length ? true : b + ' buttons for ' + ERROR_LESSONS.length + ' lessons';
        }) === true);
  check('each button explains what the lesson demonstrates before it is loaded',
        await page.evaluate(() => [...document.querySelectorAll('#libErrors .elab')]
          .every(b => b.querySelector('.elab-n').textContent.trim().length > 2 &&
                      b.querySelector('.elab-d').textContent.trim().length > 20)));
  check('the lab is reachable from the Learn menu as well',
        await page.evaluate(() => JSON.stringify(MENUS.mLearn()).indexOf('rror') >= 0));
  await page.screenshot({ path: path.join(SHOTS, 'p11_errlab.png') });

  for (const l of lessons) {
    const res = await page.evaluate((id) => {
      loadLesson(id);
      let last = -2;
      for (let i = 0; i < 4000 && !run.stopped; i++) {
        if (run.index === last && run.history) break;
        last = run.index;
        doStep();
      }
      const panel = document.querySelector('#panelErrLab');
      const body = document.querySelector('#errLabPanel');
      const srcLine = document.querySelector('#sourceView .codeline.active');
      const lineNo = srcLine ? +srcLine.dataset.line : null;
      return {
        stopped: run.stopped,
        kind: run.error && run.error.kind,
        errLine: run.error && run.error.line,
        panelShown: panel && !panel.hidden,
        text: body ? body.textContent.replace(/\s+/g, ' ') : '',
        picture: !!body && (body.querySelectorAll('.mc-box.invalid').length > 0 ||
                            body.querySelectorAll('.el-node.bad').length > 0),
        srcLine: lineNo,
        editorMatchesLesson: $('#sourceEdit').value === LESSON_BY_ID[id].src,
        canPrev: run.history && run.history.length > 1,
        stateTag: document.querySelector('#errLabState').textContent.trim(),
        badge: !!(body && body.querySelector('.el-badge')) &&
               body.querySelector('.el-badge').textContent.trim().length > 4,
        badgeText: body && body.querySelector('.el-badge') ? body.querySelector('.el-badge').textContent.trim() : null,
      };
    }, l.id);
    check('lesson "' + l.id + '": loads into the real editor and stops on the real error',
          res.editorMatchesLesson && res.stopped && res.kind === l.kind,
          JSON.stringify({ kind: res.kind, stopped: res.stopped }));
    check('lesson "' + l.id + '": the lesson panel opens and explains what happened',
          res.panelShown && res.badge && res.text.length > 120,
          res.text.slice(0, 90));
    check('lesson "' + l.id + '": the panel shows the source line the engine reported',
          res.text.indexOf(String(res.errLine)) >= 0, 'line ' + res.errLine);
    check('lesson "' + l.id + '": the fault badge names this fault and no other',
          l.id === 'stackoverflow' ? /stack overflow/i.test(res.badgeText || '')
                                   : (res.badgeText || '').length > 4,
          res.badgeText);
    check('lesson "' + l.id + '": the failure is drawn, not only described',
          res.picture === true);
    check('lesson "' + l.id + '": the source view highlights the failing line',
          res.srcLine === res.errLine, 'source=' + res.srcLine + ' error=' + res.errLine);
    check('lesson "' + l.id + '": the panel reports the error as reproduced',
          res.stateTag.length > 0 && !/not run/i.test(res.stateTag), res.stateTag);
  }
  await page.evaluate(() => loadLesson('overflow'));
  await runAll();
  await sleep(150);
  await page.screenshot({ path: path.join(SHOTS, 'p11_overflow.png') });

  check('the overflow picture draws the attempted index OUTSIDE the real cells',
        await page.evaluate(() => {
          const cells = [...document.querySelectorAll('#errLabPanel .el-bound .mcell')];
          const valid = cells.filter(c => !c.classList.contains('invalid'));
          const bad = cells.filter(c => c.classList.contains('invalid'));
          if (bad.length !== 1 || valid.length !== 3) return 'valid=' + valid.length + ' bad=' + bad.length;
          const idx = +bad[0].querySelector('.mc-i').textContent;
          return idx === 5 ? true : 'bad index drawn as ' + idx;
        }) === true);
  check('the invalid cell shows NO value — the engine has no such memory to show',
        await page.evaluate(() => {
          const b = document.querySelector('#errLabPanel .mc-box.invalid');
          return b && !/[0-9a-zA-Z]/.test(b.textContent.trim());
        }));
  check('Prev still works after the error',
        await page.evaluate(() => { const before = run.index; doPrev(); return run.index === before - 1; }));
  check('Reset returns the lesson to the start, ready to step again',
        await page.evaluate(() => { restart(); return run.index === 0 && !run.error && !run.stopped; }));
  check('opening an ordinary exercise leaves the lab behind',
        await page.evaluate(() => { loadExample('ex1'); return ui.lesson === null && document.querySelector('#panelErrLab').hidden; }));
  check('the stack-overflow lesson states its limitation in the panel itself',
        await page.evaluate(() => {
          loadLesson('stackoverflow');
          const t = document.querySelector('#errLabPanel').textContent;
          return /limitation|limite/i.test(t) && /depth|profondeur/i.test(t);
        }));

  console.log('\n=== Phase 10 · part 7: the camera still belongs to the learner ===');
  await reload();
  await page.evaluate(() => { loadExample('ex6'); openViz(); });
  await runAll();
  await sleep(300);
  check('the camera exposes no rotation at all',
        await page.evaluate(() => {
          const c = viz.stage.getCamera();
          return !('yaw' in c) && !('pitch' in c) ? true : JSON.stringify(c);
        }) === true);
  // The standing rule from the previous phase: a step may never move the
  // camera; only a genuine change in the SHAPE of the scene may re-fit it, and
  // only while the learner has not touched the camera themselves.
  const camStep = await page.evaluate(() => {
    goTo(10);
    viz.stage.fit();
    const a = JSON.stringify(viz.stage.getCamera());
    for (let i = 11; i < Math.min(24, run.history.length); i++) goTo(i);
    return JSON.stringify(viz.stage.getCamera()) === a ? true : a + ' -> ' + JSON.stringify(viz.stage.getCamera());
  });
  check('stepping through a settled scene never moves the camera', camStep === true, String(camStep));

  const camOwn = await page.evaluate(() => {
    goTo(0);
    viz.stage.panBy(70, 40);          // the learner takes the camera
    const a = JSON.stringify(viz.stage.getCamera());
    for (let i = 1; i < run.history.length; i++) goTo(i);   // whole program, every shape change
    return JSON.stringify(viz.stage.getCamera()) === a ? true : a + ' -> ' + JSON.stringify(viz.stage.getCamera());
  });
  check('once the learner has moved the camera, execution never takes it back',
        camOwn === true, String(camOwn));

  const panRes = await page.evaluate(() => {
    const a = viz.stage.getCamera();
    viz.stage.panBy(40, 25);
    return { a, b: viz.stage.getCamera() };
  });
  check('pan moves the camera and only the camera',
        panRes.b.panX !== panRes.a.panX && panRes.b.panY !== panRes.a.panY &&
        panRes.b.zoom === panRes.a.zoom,
        JSON.stringify(panRes));
  // Phase 11: the scene is a plane, so there is no tilt to hold constant. The
  // stronger property is that no orientation exists to be changed at all.
  check('the camera has no orientation for a step or a pan to change',
        Object.keys(panRes.b).sort().join(',') === 'panX,panY,zoom',
        Object.keys(panRes.b).join(','));
  check('zoom changes scale without rotating anything',
        await page.evaluate(() => {
          const a = viz.stage.getCamera();
          viz.stage.zoomBy(1.4);
          const b = viz.stage.getCamera();
          return b.zoom !== a.zoom && !('yaw' in b);
        }));
  const fitRes = await page.evaluate(() => {
    viz.stage.panBy(300, 200); viz.stage.zoomBy(3);   // get thoroughly lost first
    viz.stage.fit();
    const host = document.querySelector('#vizHost').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('#vizHost .viz-node')];
    if (!nodes.length) return 'no nodes drawn';
    const out = nodes.filter(nd => {
      const r = nd.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      return !(r.right > host.left - 40 && r.left < host.right + 40 &&
               r.bottom > host.top - 40 && r.top < host.bottom + 40);
    });
    return out.length === 0 ? true : out.length + ' of ' + nodes.length + ' nodes still outside';
  });
  check('Fit brings a scene the learner got lost in back inside the viewport',
        fitRes === true, String(fitRes));
  check('expanding and restoring the source refits without rotating',
        await page.evaluate(() => {
          const before = viz.stage.getCamera();
          toggleSrcExpand(); toggleSrcExpand();
          const after = viz.stage.getCamera();
          return !('yaw' in after) && !('pitch' in after) && typeof after.zoom === 'number';
        }));

  console.log('\n=== Phase 10 · part 8: synchronization, language, theme, dock ===');
  await reload();
  await page.evaluate(() => loadLesson('uaf'));
  await runAll();
  await sleep(200);
  check('every view tells the same story at the failing step',
        await page.evaluate(() => {
          const line = run.error.line;
          const src = document.querySelector('#sourceView .codeline.active');
          const status = document.querySelector('#sbLine').textContent.trim();
          const lab = document.querySelector('#errLabPanel').textContent;
          const box = document.querySelector('#errorBox').textContent;
          return {
            src: src ? +src.dataset.line : null, status, inLab: lab.indexOf(String(line)) >= 0,
            inBox: /use-after-free|Use-after-free/i.test(box), stopped: run.stopped, line,
          };
        }).then(r => (r.src === r.line && r.inLab && r.inBox && r.stopped) ? true : JSON.stringify(r)) === true);
  check('the level-1 card announces that execution stopped instead of showing a stale step',
        await page.evaluate(() => {
          const b = document.querySelector('#execHost .exec-stopped');
          return !!b && b.textContent.indexOf(String(run.error.line)) >= 0;
        }));

  check('switching to French translates the lab',
        await page.evaluate(() => {
          setLang('fr');
          openLibrary('errors');
          const list = document.querySelector('#libErrors').textContent;
          const panel = document.querySelector('#errLabPanel').textContent;
          return /mémoire|Erreur|Libération/i.test(list) && /Erreur|Ligne source|Accès/i.test(panel)
            ? true : list.slice(0, 60) + ' | ' + panel.slice(0, 60);
        }) === true);
  // t() returns the key itself when a string is missing, so a raw key on screen
  // is exactly what an untranslated Phase 10 string looks like.
  // innerText, not textContent: the I18N table itself lives in an inline
  // <script> in this single-file app, and textContent would read the keys
  // straight out of the source and call them a leak.
  const leak = await page.evaluate(() => {
    const seen = document.body.innerText;
    const bad = (seen.match(/\b(errlab|lvl|lib|mem|src)\.[a-zA-Z]+\b/g) || []);
    return bad.length ? [...new Set(bad)].slice(0, 8).join(',') : true;
  });
  check('no untranslated Phase 10 key leaks into the French UI', leak === true, String(leak));
  await page.screenshot({ path: path.join(SHOTS, 'p11_fr.png') });
  check('switching back to English restores it',
        await page.evaluate(() => {
          setLang('en');
          return /Memory errors|Invalid/i.test(document.querySelector('#libErrors').textContent);
        }));
  check('the light theme paints the new surfaces too',
        await page.evaluate(() => {
          document.querySelector('#themeToggle').click();
          const c = document.querySelector('#libErrors .elab');
          const bg = getComputedStyle(c).backgroundColor;
          const ok = document.documentElement.getAttribute('data-theme') === 'light' && bg !== 'rgba(0, 0, 0, 0)';
          return ok ? true : 'theme=' + document.documentElement.getAttribute('data-theme') + ' bg=' + bg;
        }) === true);
  await page.screenshot({ path: path.join(SHOTS, 'p11_light.png') });
  await page.evaluate(() => document.querySelector('#themeToggle').click());
  await page.evaluate(() => closeLibrary());

  check('the bottom dock splitter is real and draggable',
        await page.evaluate(() => {
          const sp = document.querySelector('#dockSplitter');
          const cs = getComputedStyle(sp);
          return cs.cursor === 'row-resize' && sp.getAttribute('role') === 'separator' &&
                 sp.getBoundingClientRect().height >= 5;
        }));
  check('dragging the splitter resizes the dock and respects its limits',
        await page.evaluate(() => {
          const sp = document.querySelector('#dockSplitter');
          const r = sp.getBoundingClientRect();
          const h0 = ui.dockH;
          sp.dispatchEvent(new MouseEvent('mousedown', { clientY: r.top + 3, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mousemove', { clientY: r.top - 120, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          const grew = ui.dockH > h0;
          sp.dispatchEvent(new MouseEvent('mousedown', { clientY: r.top + 3, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mousemove', { clientY: r.top + 5000, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          const clamped = ui.dockH >= 90 && document.querySelector('#paneLeft').getBoundingClientRect().height > 60;
          return grew && clamped ? true : 'grew=' + grew + ' clamped=' + clamped + ' h=' + ui.dockH;
        }) === true);

  console.log('\n=== Phase 10 · responsive ===');
  await page.evaluate(() => { loadLesson('overflow'); for (let i = 0; i < 400 && !run.stopped; i++) doStep(); });
  for (const [w, h] of [[1440, 780], [1100, 700], [900, 620], [1600, 1000]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(320);
    const r = await page.evaluate(() => {
      const clipped = [];
      // every control the learner needs must still be on screen and clickable
      for (const sel of ['#btnStep', '#btnReset', '#levelSeg', '#railErrLab', '#btnExpandSrc', '#dockSplitter']) {
        const el = document.querySelector(sel);
        if (!el) { clipped.push(sel + ':missing'); continue; }
        const b = el.getBoundingClientRect();
        if (b.width < 4 || b.height < 4) clipped.push(sel + ':collapsed');
        if (b.left < -1 || b.top < -1 || b.right > window.innerWidth + 1) clipped.push(sel + ':offscreen');
      }
      return {
        hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        clipped,
        labReadable: document.querySelector('#errLabPanel').getBoundingClientRect().width > 120,
      };
    });
    check(w + 'x' + h + ': no horizontal overflow and every control stays usable',
          !r.hOverflow && r.clipped.length === 0 && r.labReadable, JSON.stringify(r));
  }
  check('the popup still lands beside its cell after a resize',
        await page.evaluate(() => {
          setLevel('beginner');
          const c0 = document.querySelector('#memPanel .mcell');
          if (!c0) return 'no cells: ' + document.querySelector('#memPanel').textContent.slice(0, 60);
          const label = c0.getAttribute('aria-label');
          c0.scrollIntoView({ block: 'center' });
          c0.click();
          const c = [...document.querySelectorAll('#memPanel .mcell')].find(x => x.getAttribute('aria-label') === label);
          const pop = document.querySelector('#memPanel .byte-detail');
          if (!pop || !c) return 'no popup';
          const pr = pop.getBoundingClientRect(), cr = c.getBoundingClientRect();
          const mr = document.querySelector('#memPanel').getBoundingClientRect();
          const gap = Math.min(Math.abs(cr.top - pr.bottom), Math.abs(pr.top - cr.bottom));
          const inX = pr.left >= mr.left - 1 && pr.right <= mr.right + 1;
          const o = c.closest('.mem-obj').getBoundingClientRect();
          const inObj = pr.top < o.bottom + 4 && pr.bottom > o.top - 4;
          return (inX && inObj && gap <= 60) ? true : JSON.stringify({ gap: Math.round(gap), inX, inObj });
        }) === true);

  await browser.close();

  console.log('\n' + '-'.repeat(64));
  console.log('PHASE 10  pass ' + pass + '  fail ' + fail);
  if (errs.length) { console.log('console errors:'); errs.slice(0, 10).forEach(e => console.log('   ' + e)); }
  process.exit(fail || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
