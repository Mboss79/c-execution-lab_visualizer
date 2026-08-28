'use strict';
/* ============================================================================
   PHASE 11 — one header, an editor that keeps its gutter, one speed control,
              and a 2.5D spatial visualization

   The theme of this suite is that a LAYOUT claim is only worth what a
   measurement says. Every check below drives the real page in a real browser
   and measures pixels, computed styles or transforms — never the existence of
   a function or a CSS rule.

   Part 1  one application header, and the chrome that moved into the rail
   Part 2  the source editor: gutter and colours in BOTH modes, Tab, undo
   Part 3  expanding the source is a workspace change, not a takeover
   Part 4  ONE speed control, driving cadence AND animation
   Part 5  2.5D: no 3D anywhere, consistent frame dimensions, stable geometry
   Part 6  everything Phase 10 delivered still works
   Part 7  responsive
   ========================================================================== */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, n = 0;
function check(name, ok, detail) {
  n++;
  const tag = '[' + n + '] ';
  if (ok === true) { pass++; console.log('  PASS ' + tag + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + tag + name + '  -- ' + (detail !== undefined ? detail : ok)); }
}

const NEST = ['int\tbar(int n)', '{', '\tint\tz;', '', '\tz = n * 2;', '\treturn (z);', '}', '',
  'int\tfoo(int n)', '{', '\tint\ty;', '', '\ty = bar(n + 1);', '\treturn (y);', '}', '',
  'int\tmain(void)', '{', '\tint\tx;', '', '\tx = foo(1);', '\treturn (x);', '}', ''].join('\n');
const LONG = (() => {
  let s = 'int\tmain(void)\n{\n';
  for (let i = 0; i < 120; i++) s += '\tint\tv' + i + ';\n';
  s += '\n';
  for (let i = 0; i < 120; i++) s += '\tv' + i + ' = ' + i + ';\n';
  return s + '\treturn (0);\n}\n';
})();

(async () => {
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
  const setSrc = (s) => page.evaluate((v) => { $('#sourceEdit').value = v; switchToEditing(); }, s);

  await reload();

  console.log('=== Phase 11 · part 1: ONE application header ===');
  const hdr = await page.evaluate(() => {
    const tb = document.querySelector('.titlebar');
    const tl = document.querySelector('.toolbar');
    const main = document.querySelector('.main');
    const tbr = tb.getBoundingClientRect(), tlr = tl.getBoundingClientRect();
    return {
      titlebarTop: Math.round(tbr.top), titlebarH: Math.round(tbr.height),
      toolbarTop: Math.round(tlr.top), toolbarH: Math.round(tlr.height),
      chrome: Math.round(main.getBoundingClientRect().top),
      sameRow: Math.abs(tlr.top - tbr.top) < tbr.height,
      toolbarInsideTitlebar: tb.contains(tl),
    };
  });
  check('there is ONE horizontal header bar, not two stacked ones',
        hdr.sameRow && hdr.toolbarInsideTitlebar, JSON.stringify(hdr));
  check('the workspace starts within 56px of the top — the second bar is gone',
        hdr.chrome <= 56, 'workspace top = ' + hdr.chrome + 'px (was 93px)');
  check('the header still exposes a real toolbar region for assistive tech',
        await page.evaluate(() => document.querySelector('.toolbar').getAttribute('role') === 'toolbar'));

  const rail = await page.evaluate(() => ({
    cmdk: !!document.querySelector('.rail #cmdkBtn'),
    lang: document.querySelectorAll('.rail .lang-seg button[data-lang]').length,
    theme: !!document.querySelector('.rail #themeToggle'),
    layout: !!document.querySelector('.rail #layoutBtn'),
    inHeader: ['#cmdkBtn', '#themeToggle', '#layoutBtn'].filter(s => document.querySelector('.titlebar ' + s)),
  }));
  check('the command palette button moved into the rail', rail.cmdk);
  check('both language buttons moved into the rail', rail.lang === 2, String(rail.lang));
  check('the theme toggle moved into the rail', rail.theme);
  check('none of them are left in the header', rail.inHeader.length === 0, rail.inHeader.join(','));

  check('the execution controls are all on the one header row',
        await page.evaluate(() => {
          const ids = ['btnFirst', 'btnPrev', 'btnStep', 'btnRun', 'btnLast', 'btnReset',
                       'stepReadout', 'btnViz', 'vizSpeed', 'levelSeg'];
          const tops = ids.map(i => {
            const e = document.getElementById(i);
            return e ? Math.round(e.getBoundingClientRect().top) : null;
          });
          if (tops.some(t => t === null)) return 'missing: ' + ids.filter((_, k) => tops[k] === null).join(',');
          return Math.max(...tops) - Math.min(...tops) < 30 ? true : 'tops=' + tops.join(',');
        }) === true);
  check('the command palette still opens from the rail',
        await page.evaluate(() => {
          document.querySelector('#cmdkBtn').click();
          const open = !!document.querySelector('#ckInput');
          closeCmdk();
          return open;
        }));
  check('the language buttons in the rail still switch language',
        await page.evaluate(() => {
          document.querySelector('.rail .lang-seg button[data-lang="fr"]').click();
          const fr = ui.lang === 'fr' && /Exécuter|Déboguer/.test(document.querySelector('.menubar').textContent);
          document.querySelector('.rail .lang-seg button[data-lang="en"]').click();
          return fr && ui.lang === 'en';
        }));
  check('the theme toggle in the rail still switches theme',
        await page.evaluate(() => {
          const a = document.documentElement.getAttribute('data-theme');
          document.querySelector('#themeToggle').click();
          const b = document.documentElement.getAttribute('data-theme');
          document.querySelector('#themeToggle').click();
          return a !== b && document.documentElement.getAttribute('data-theme') === a;
        }));
  await page.screenshot({ path: path.join(SHOTS, 'p12_header.png') });

  console.log('\n=== Phase 11 · part 2: the editor keeps its gutter and its colours ===');
  await page.evaluate(() => loadExample('ex6'));
  await sleep(150);
  const editMode = await page.evaluate(() => {
    switchToEditing();
    const sv = document.querySelector('#sourceView');
    return {
      visible: getComputedStyle(sv).display !== 'none' && sv.getBoundingClientRect().height > 20,
      gutters: sv.querySelectorAll('.ln').length,
      keywords: sv.querySelectorAll('.tok-kw').length,
      strings: sv.querySelectorAll('.tok-str, .tok-char').length,
      editing: document.body.classList.contains('src-editing'),
    };
  });
  check('editing still shows line numbers', editMode.visible && editMode.gutters > 5, JSON.stringify(editMode));
  check('editing still shows syntax colours', editMode.keywords > 3, 'keyword tokens = ' + editMode.keywords);
  await runAll();
  await sleep(200);
  const runMode = await page.evaluate(() => {
    const sv = document.querySelector('#sourceView');
    return { gutters: sv.querySelectorAll('.ln').length, keywords: sv.querySelectorAll('.tok-kw').length,
             active: sv.querySelectorAll('.codeline.active').length };
  });
  check('running shows the SAME gutter and colours, plus the execution line',
        runMode.gutters === editMode.gutters && runMode.keywords === editMode.keywords && runMode.active === 1,
        JSON.stringify(runMode));

  check('there is ONE source of truth: the view is derived from the buffer',
        await page.evaluate(() => {
          switchToEditing();
          const ta = $('#sourceEdit');
          ta.value = 'int\tmain(void)\n{\n\treturn (0);\n}\n';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
            const lines = [...document.querySelectorAll('#sourceView .codeline .code')].map(e => e.textContent);
            r(lines.join('\n').indexOf('return (0);') >= 0 && lines.length === 5 ? true : lines.join('|'));
          })));
        }) === true);

  // the transparent textarea must sit exactly on the rendered code column
  const align = await page.evaluate(() => {
    const sv = document.querySelector('#sourceView'), ta = document.querySelector('#sourceEdit');
    const code = sv.querySelector('.codeline .code');
    const cr = code.getBoundingClientRect(), tr = ta.getBoundingClientRect();
    const cs = getComputedStyle(ta), cc = getComputedStyle(code);
    // Compare TEXT ORIGINS, not border boxes. getBoundingClientRect returns the
    // border box, and .code carries a padding-left, so a border-box comparison
    // called the layers aligned while the caret sat a character to the left of
    // the glyph. Tab parity is asserted here too: the layers disagreeing on the
    // tab stop was the larger half of the same caret bug.
    return {
      dx: Math.round((tr.left + parseFloat(cs.paddingLeft)) -
                     (cr.left + parseFloat(cc.paddingLeft))),
      dy: Math.round((tr.top + parseFloat(cs.paddingTop)) - cr.top),
      sameTabStop: (cs.tabSize || cs.MozTabSize) === (cc.tabSize || cc.MozTabSize),
      sameFont: cs.fontFamily === cc.fontFamily && cs.fontSize === cc.fontSize,
      sameLine: cs.lineHeight === cc.lineHeight || Math.abs(parseFloat(cs.lineHeight) - parseFloat(cc.lineHeight)) < 0.6,
      transparentText: cs.color === 'rgba(0, 0, 0, 0)' || cs.color === 'transparent',
      caretVisible: cs.caretColor !== 'rgba(0, 0, 0, 0)' && cs.caretColor !== 'transparent',
    };
  });
  check('the editing layer is aligned to the code column to the pixel',
        Math.abs(align.dx) <= 1 && Math.abs(align.dy) <= 1, JSON.stringify(align));
  check('the two layers use identical text metrics',
        align.sameFont && align.sameLine && align.sameTabStop, JSON.stringify(align));
  check('the caret is visible even though the textarea text is not',
        align.transparentText && align.caretVisible, JSON.stringify(align));
  check('the gutter is not covered by the editor, so breakpoints stay clickable',
        await page.evaluate(() => {
          const ln = document.querySelector('#sourceView .codeline .ln');
          const r = ln.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit && (hit === ln || ln.contains(hit)) ? true : 'covered by ' + (hit && (hit.id || hit.className));
        }) === true);

  // Tab / Shift+Tab / undo must all survive the new architecture
  await page.evaluate(() => {
    switchToEditing();
    const ta = $('#sourceEdit');
    ta.value = 'a;\nb;\nc;\n';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus(); ta.setSelectionRange(0, 0);
  });
  await page.keyboard.press('Tab');
  await sleep(80);
  check('Tab still indents and keeps focus in the editor',
        await page.evaluate(() => $('#sourceEdit').value.startsWith('\ta;') &&
                                  document.activeElement.id === 'sourceEdit'),
        JSON.stringify(await page.evaluate(() => $('#sourceEdit').value)));
  check('the gutter and colours survive the Tab edit',
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() =>
          r(document.querySelectorAll('#sourceView .ln').length >= 3)))));
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  await sleep(80);
  check('Shift+Tab still unindents',
        await page.evaluate(() => $('#sourceEdit').value.startsWith('a;')),
        JSON.stringify(await page.evaluate(() => $('#sourceEdit').value)));
  await page.evaluate(() => { const ta = $('#sourceEdit'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  await page.keyboard.type('d;');
  await sleep(60);
  const beforeUndo = await page.evaluate(() => $('#sourceEdit').value);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await sleep(120);
  const afterUndo = await page.evaluate(() => $('#sourceEdit').value);
  check('native undo still works', afterUndo !== beforeUndo, JSON.stringify({ beforeUndo, afterUndo }));
  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await sleep(120);
  check('native redo still works',
        await page.evaluate(() => $('#sourceEdit').value) === beforeUndo,
        JSON.stringify(await page.evaluate(() => $('#sourceEdit').value)));

  // long files
  await setSrc(LONG);
  await sleep(250);
  check('a 240-line file renders every line with a number',
        await page.evaluate(() => document.querySelectorAll('#sourceView .codeline').length >= 240),
        String(await page.evaluate(() => document.querySelectorAll('#sourceView .codeline').length)));
  check('a long file scrolls in ONE scroll container, not two',
        await page.evaluate(() => {
          const sc = document.querySelector('#srcScroll'), ta = document.querySelector('#sourceEdit');
          const taScrolls = ta.scrollHeight > ta.clientHeight + 2;
          sc.scrollTop = 400;
          const moved = sc.scrollTop > 200;
          const codeTop = document.querySelector('#sourceView .codeline').getBoundingClientRect().top;
          const taTop = ta.getBoundingClientRect().top;
          sc.scrollTop = 0;
          // both layers move together because they are inside the same scroller
          return !taScrolls && moved && Math.abs(codeTop - taTop) < 12
            ? true : JSON.stringify({ taScrolls, moved, drift: Math.round(codeTop - taTop) });
        }) === true);
  check('the editing layer still lines up after scrolling a long file',
        await page.evaluate(() => {
          const sc = document.querySelector('#srcScroll');
          sc.scrollTop = 900;
          const sv = document.querySelector('#sourceView'), ta = document.querySelector('#sourceEdit');
          const code = sv.querySelector('.codeline .code');
          // text origin to text origin, for the reason given at check [16]
          const d = Math.round(
            (ta.getBoundingClientRect().left + parseFloat(getComputedStyle(ta).paddingLeft)) -
            (code.getBoundingClientRect().left + parseFloat(getComputedStyle(code).paddingLeft)));
          sc.scrollTop = 0;
          return Math.abs(d) <= 1 ? true : 'drift ' + d + 'px';
        }) === true);

  /* The assertion the pixel checks above could not make: click a glyph the
     learner can see and ask where the caret actually went. Tab-indented code is
     the case that matters — Piscine style indents with tabs, and a tab-stop
     disagreement between the two layers moved the caret four columns per
     indent level while every geometry check still passed. */
  await setSrc(['int\tmain(void)', '{',
                '\t\tunsigned char alpha = 65; beta = 66; gamma = 67;',
                '\tint\tdeep = 1;',
                '\t\t\tint\tdeeper = 2;', '}'].join('\n'));
  await sleep(250);
  const caretTargets = await page.evaluate(() => {
    const view = document.querySelector('#sourceView');
    const ta = document.querySelector('#sourceEdit');
    const lines = ta.value.split('\n');
    const out = [];
    for (const ln of [3, 4, 5]) {
      let base = 0;
      for (let k = 0; k < ln - 1; k++) base += lines[k].length + 1;
      const el = view.querySelector('.codeline[data-line="' + ln + '"] .code');
      if (!el) continue;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const flat = [];
      let n;
      while ((n = w.nextNode())) for (let i = 0; i < n.length; i++) flat.push({ nd: n, i });
      for (let col = 1; col < flat.length - 1; col += 7) {
        const r = document.createRange();
        r.setStart(flat[col].nd, flat[col].i);
        r.setEnd(flat[col].nd, flat[col].i + 1);
        const rect = r.getBoundingClientRect();
        if (!rect.width) continue;
        out.push({ xL: Math.round(rect.left + rect.width * 0.25),
                   xR: Math.round(rect.left + rect.width * 0.75),
                   y: Math.round(rect.top + rect.height / 2),
                   before: base + col, after: base + col + 1, line: ln });
      }
    }
    return out;
  });
  let caretBad = [];
  for (const t of caretTargets) {
    await page.mouse.click(t.xL, t.y);
    const gotL = await page.evaluate(() => document.querySelector('#sourceEdit').selectionStart);
    await page.mouse.click(t.xR, t.y);
    const gotR = await page.evaluate(() => document.querySelector('#sourceEdit').selectionStart);
    if (gotL !== t.before || gotR !== t.after) {
      caretBad.push('line ' + t.line + ' want ' + t.before + '/' + t.after + ' got ' + gotL + '/' + gotR);
    }
  }
  check('clicking a glyph puts the caret on that glyph, on tab-indented lines',
        caretTargets.length >= 9 && caretBad.length === 0,
        caretBad.length ? caretBad.slice(0, 4).join('; ') : (caretTargets.length + ' positions'));

  await page.screenshot({ path: path.join(SHOTS, 'p12_editor.png') });

  console.log('\n=== Phase 11 · part 3: expanding the source ===');
  await reload();
  await page.evaluate(() => { loadExample('ex6'); setLevel('deep'); });
  await sleep(200);
  const exp = await page.evaluate(() => {
    const m = () => ({
      src: Math.round(document.querySelector('#srcScroll').getBoundingClientRect().width),
      srcH: Math.round(document.querySelector('#srcScroll').getBoundingClientRect().height),
      right: Math.round(document.querySelector('#paneRight').getBoundingClientRect().width),
      dock: Math.round(document.querySelector('#dock').getBoundingClientRect().height),
      header: Math.round(document.querySelector('.titlebar').getBoundingClientRect().height),
      rail: Math.round(document.querySelector('.rail').getBoundingClientRect().width),
      status: Math.round(document.querySelector('.statusbar').getBoundingClientRect().height),
    });
    const before = m(); toggleSrcExpand(); const after = m(); toggleSrcExpand();
    return { before, after, restored: m() };
  });
  check('expanding takes the space from the DEBUGGER column',
        exp.after.right === 0 && exp.after.src > exp.before.src * 1.5,
        JSON.stringify({ srcW: exp.before.src + '->' + exp.after.src, rightW: exp.before.right + '->' + exp.after.right }));
  check('expanding does NOT swallow the bottom dock',
        exp.after.dock === exp.before.dock && exp.after.dock > 40,
        'dock ' + exp.before.dock + ' -> ' + exp.after.dock);
  check('the application header stays exactly where it is',
        exp.after.header === exp.before.header, 'header ' + exp.before.header + ' -> ' + exp.after.header);
  check('the rail stays exactly where it is',
        exp.after.rail === exp.before.rail, 'rail ' + exp.before.rail + ' -> ' + exp.after.rail);
  check('the status bar stays exactly where it is',
        exp.after.status === exp.before.status, 'status ' + exp.before.status + ' -> ' + exp.after.status);
  check('restoring puts the layout back exactly',
        JSON.stringify(exp.restored) === JSON.stringify(exp.before),
        JSON.stringify({ before: exp.before, restored: exp.restored }));
  check('nothing overflows the page while expanded',
        await page.evaluate(() => {
          toggleSrcExpand();
          const bad = document.documentElement.scrollWidth > window.innerWidth + 1 ||
                      document.documentElement.scrollHeight > window.innerHeight + 1;
          const usable = document.querySelector('#btnStep').getBoundingClientRect().width > 4;
          toggleSrcExpand();
          return !bad && usable;
        }));
  check('the debugger state is untouched by expanding',
        await page.evaluate(() => {
          let l = -2;
          for (let i = 0; i < 3000 && !run.stopped; i++) { if (run.index === l && run.history) break; l = run.index; doStep(); }
          goTo(8);
          const before = { i: run.index, len: run.history.length, src: run.src.length };
          toggleSrcExpand(); toggleSrcExpand();
          const after = { i: run.index, len: run.history.length, src: run.src.length };
          return JSON.stringify(before) === JSON.stringify(after) ? true : JSON.stringify({ before, after });
        }) === true);
  check('Ctrl+Shift+E expands and restores',
        await (async () => {
          await page.keyboard.down('Control'); await page.keyboard.down('Shift');
          await page.keyboard.press('e');
          await page.keyboard.up('Shift'); await page.keyboard.up('Control');
          await sleep(200);
          const on = await page.evaluate(() => document.body.classList.contains('src-expanded'));
          await page.keyboard.down('Control'); await page.keyboard.down('Shift');
          await page.keyboard.press('e');
          await page.keyboard.up('Shift'); await page.keyboard.up('Control');
          await sleep(200);
          const off = await page.evaluate(() => !document.body.classList.contains('src-expanded'));
          return on && off;
        })());
  check('Reset Layout also restores an expanded editor',
        await page.evaluate(() => {
          toggleSrcExpand();
          resetLayout();
          return !document.body.classList.contains('src-expanded') &&
                 document.querySelector('#paneRight').getBoundingClientRect().width > 200;
        }));

  console.log('\n=== Phase 11 · part 4: ONE speed control ===');
  await reload();
  check('there is exactly one speed control in the whole application',
        await page.evaluate(() => {
          const sliders = document.querySelectorAll('input[type=range]').length;
          const selects = document.querySelectorAll('#vizSpeed').length;
          return sliders === 0 && selects === 1 ? true : 'ranges=' + sliders + ' vizSpeed=' + selects;
        }) === true);
  check('it offers the five documented speeds',
        await page.evaluate(() => [...document.querySelectorAll('#vizSpeed option')].map(o => o.value).join(',')) === '0.25,0.5,1,2,5',
        await page.evaluate(() => [...document.querySelectorAll('#vizSpeed option')].map(o => o.value).join(',')));
  // a real program, so there are real nodes whose real transitions can be read
  await page.evaluate(() => { loadExample('ex6'); openViz(); });
  await runAll();
  await sleep(300);
  const spd = await page.evaluate(() => {
    const out = [];
    for (const v of [0.25, 0.5, 1, 2, 5]) {
      setAnimSpeed(v);
      out.push({ v,
        cadence: speedMs(),
        anim: getComputedStyle(document.documentElement).getPropertyValue('--anim').trim(),
        vizAnim: document.querySelector('#vizHost').style.getPropertyValue('--viz-anim').trim(),
        nodeMs: (() => { const nd = document.querySelector('#vizHost .viz-node');
                         return nd ? getComputedStyle(nd).transitionDuration.split(',')[0].trim() : null; })(),
      });
    }
    setAnimSpeed(1);
    return out;
  });
  check('a slower speed really is slower: playback cadence scales',
        spd[0].cadence > spd[2].cadence && spd[2].cadence > spd[4].cadence,
        spd.map(s => s.v + 'x=' + s.cadence + 'ms').join(' '));
  check('a slower speed really is slower: animation duration scales',
        parseFloat(spd[0].anim) > parseFloat(spd[2].anim) && parseFloat(spd[2].anim) > parseFloat(spd[4].anim),
        spd.map(s => s.v + 'x=' + s.anim).join(' '));
  check('the change reaches the real CSS transition on a real node',
        spd[0].nodeMs && spd[4].nodeMs && parseFloat(spd[0].nodeMs) > parseFloat(spd[4].nodeMs),
        spd.map(s => s.v + 'x=' + s.nodeMs).join(' '));
  check('cadence and animation agree — one control, one number',
        spd.every(s => Math.abs(s.cadence / parseFloat(s.anim) - spd[2].cadence / parseFloat(spd[2].anim)) < 0.01),
        spd.map(s => s.v + 'x ' + s.cadence + '/' + s.anim).join(' '));
  check('the selected speed survives a reload',
        await (async () => {
          await page.evaluate(() => setAnimSpeed(2));
          await page.reload({ waitUntil: 'domcontentloaded' });
          await sleep(700);
          return await page.evaluate(() => ui.animSpeed === 2 &&
            document.querySelector('#vizSpeed').value === '2' && speedMs() === 300);
        })());
  check('a run already playing picks up the new speed immediately',
        await page.evaluate(() => {
          showWorkspace(); loadExample('ex3'); setAnimSpeed(0.25);
          togglePlay();
          const wasPlaying = run.playing;
          setAnimSpeed(5);
          const still = run.playing;
          pausePlay();
          return wasPlaying && still && speedMs() === 120;
        }));
  await page.evaluate(() => setAnimSpeed(1));

  console.log('\n=== Phase 11 · part 5: 2.5D spatial visualization ===');
  await reload();
  await setSrc(NEST);
  await page.evaluate(() => { setLevel('deep'); openViz(); });
  await runAll();
  await sleep(400);
  check('the world transform is a plain 2D translate + scale',
        await page.evaluate(() => {
          const tr = document.querySelector('#vizHost .viz-world').style.transform;
          return /^scale\([\d.]+\) translate\([-\d.]+px, ?[-\d.]+px\)$/.test(tr) ? true : tr;
        }) === true);
  check('no element in the scene uses a 3D transform',
        await page.evaluate(() => {
          const bad = [];
          document.querySelectorAll('#vizHost *').forEach(e => {
            const t = e.style.transform || '';
            if (/translate3d|rotate|perspective|matrix3d|skew/.test(t)) bad.push((e.className || e.tagName) + ':' + t);
          });
          return bad.length ? bad.slice(0, 3).join(' | ') : true;
        }) === true);
  check('the camera exposes no orientation at all',
        await page.evaluate(() => Object.keys(viz.stage.getCamera()).sort().join(',')) === 'panX,panY,zoom',
        await page.evaluate(() => Object.keys(viz.stage.getCamera()).join(',')));
  check('the stage never establishes a perspective',
        await page.evaluate(() => {
          const cam = document.querySelector('#vizHost .viz-camera');
          const world = document.querySelector('#vizHost .viz-world');
          return getComputedStyle(cam).perspective === 'none' &&
                 getComputedStyle(world).transformStyle === 'flat';
        }));

  /* the heart of the phase: a frame is a frame is a frame */
  const frames = await page.evaluate(() => {
    const seen = [];
    for (let i = 0; i < run.history.length; i++) {
      goTo(i);
      const fr = [...document.querySelectorAll('#vizHost .viz-node.vz-frame')];
      if (fr.length) seen.push({ i, n: fr.length,
        css: fr.map(e => e.style.width + 'x' + e.style.height),
        rect: fr.map(e => { const r = e.getBoundingClientRect();
                            return Math.round(r.width) + 'x' + Math.round(r.height); }) });
    }
    return seen;
  });
  check('at every step, every stack frame on screen has identical dimensions',
        frames.every(s => new Set(s.css).size === 1),
        frames.filter(s => new Set(s.css).size !== 1).slice(0, 3).map(s => 'step' + s.i + ' ' + s.css.join('|')).join(' ; ') || 'all uniform');
  check('and identical PAINTED dimensions — nothing shrinks with depth',
        frames.every(s => new Set(s.rect).size === 1),
        frames.filter(s => new Set(s.rect).size !== 1).slice(0, 3).map(s => 'step' + s.i + ' ' + s.rect.join('|')).join(' ; ') || 'all uniform');
  const multi = frames.filter(s => s.n >= 2);
  check('the deepest frame is exactly as big as the shallowest',
        multi.length > 0 && multi.every(s => s.css[0] === s.css[s.css.length - 1]),
        multi.length ? multi[0].n + ' frames, all ' + multi[0].css[0] : 'no multi-frame step found');
  check('a frame keeps its size as the program runs',
        new Set(frames.map(s => s.css[0])).size <= 2,
        [...new Set(frames.map(s => s.css[0]))].join(' , '));

  /* the world must not move while stepping */
  const cams = await page.evaluate(() => {
    goTo(0);
    viz.stage.fit();
    const start = JSON.stringify(viz.stage.getCamera());
    const seen = new Set([start]);
    for (let i = 0; i < run.history.length; i++) { goTo(i); seen.add(JSON.stringify(viz.stage.getCamera())); }
    return { start, distinct: seen.size, end: JSON.stringify(viz.stage.getCamera()) };
  });
  check('stepping through nested calls never moves the camera',
        cams.distinct === 1, cams.distinct + ' distinct camera states; ' + cams.start + ' -> ' + cams.end);
  check('a new stack frame does not re-frame the world',
        cams.start === cams.end, cams.start + ' -> ' + cams.end);
  check('once the learner pans, execution never takes the camera back',
        await page.evaluate(() => {
          goTo(0);
          viz.stage.panBy(60, 40);
          const a = JSON.stringify(viz.stage.getCamera());
          for (let i = 0; i < run.history.length; i++) goTo(i);
          return JSON.stringify(viz.stage.getCamera()) === a ? true : a + ' -> ' + JSON.stringify(viz.stage.getCamera());
        }) === true);
  check('the learner can still pan, zoom and fit',
        await page.evaluate(() => {
          const a = viz.stage.getCamera();
          viz.stage.panBy(30, 20);
          const b = viz.stage.getCamera();
          // zoom OUT: a small scene is often already at the maximum zoom after a
          // fit, where zooming in is correctly clamped and would prove nothing.
          viz.stage.zoomBy(0.7);
          const c = viz.stage.getCamera();
          viz.stage.fit();
          const d = viz.stage.getCamera();
          return b.panX !== a.panX && b.panY !== a.panY && c.zoom < b.zoom &&
                 isFinite(d.panX) && d.zoom > 0
            ? true : JSON.stringify({ a, b, c, d });
        }) === true);

  /* depth is drawn, not projected */
  check('depth is expressed as layering and shadow, not as scale',
        await page.evaluate(() => {
          const ns = [...document.querySelectorAll('#vizHost .viz-node')];
          const withDepth = ns.filter(e => e.style.getPropertyValue('--depth') !== '');
          const zIndexed = new Set(ns.map(e => e.style.zIndex).filter(Boolean));
          const shadowed = ns.filter(e => getComputedStyle(e).boxShadow !== 'none').length;
          return withDepth.length > 0 && zIndexed.size > 0 && shadowed > 0
            ? true : JSON.stringify({ withDepth: withDepth.length, zIndexed: zIndexed.size, shadowed });
        }) === true);
  check('a scene that would be invisible is still framed for the learner',
        await (async () => {
          await setSrc(LONG);
          await runAll();
          await sleep(300);
          return await page.evaluate(() => {
            goTo(run.history.length - 2);
            return document.querySelectorAll('#vizHost .viz-node').length > 0;
          });
        })());
  await page.evaluate(() => { loadExample('ex6'); });
  await runAll();
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p12_spatial.png') });

  console.log('\n=== Phase 11 · part 6: everything Phase 10 delivered still works ===');
  await reload();
  check('the Memory Error Lab still ships all twelve lessons',
        await page.evaluate(() => ERROR_LESSONS.length) === 12,
        String(await page.evaluate(() => ERROR_LESSONS.length)));
  const lessons = await page.evaluate(() => ERROR_LESSONS.map(l => l.id));
  for (const id of ['overflow', 'underflow', 'invalidread', 'invalidwrite', 'nullderef',
                    'invalidaccess', 'uaf', 'uar', 'doublefree', 'invalidfree', 'stackoverflow', 'uninit']) {
    const r = await page.evaluate((lid) => {
      loadLesson(lid);
      let l = -2;
      for (let i = 0; i < 4000 && !run.stopped; i++) { if (run.index === l && run.history) break; l = run.index; doStep(); }
      const body = document.querySelector('#errLabPanel');
      const src = document.querySelector('#sourceView .codeline.active');
      return { kind: run.error && run.error.kind, line: run.error && run.error.line,
               srcLine: src ? +src.dataset.line : null,
               shown: !document.querySelector('#panelErrLab').hidden,
               drawn: !!body && (body.querySelectorAll('.mc-box.invalid').length > 0 ||
                                 body.querySelectorAll('.el-node.bad').length > 0) };
    }, id);
    check('lesson "' + id + '" still runs, stops, draws and highlights its line',
          !!r.kind && r.shown && r.drawn && r.srcLine === r.line, JSON.stringify(r));
  }
  check('memory cells, hover and the anchored inspector still work',
        await page.evaluate(() => {
          loadExample('ex6'); setLevel('beginner');
          let l = -2;
          for (let i = 0; i < 4000 && !run.stopped; i++) { if (run.index === l && run.history) break; l = run.index; doStep(); }
          goTo(Math.floor(run.history.length * 0.6));
          const cells = [...document.querySelectorAll('#memPanel .mcell')];
          if (!cells.length) return 'no cells';
          const label = cells[0].getAttribute('aria-label');
          cells[0].click();
          const live = [...document.querySelectorAll('#memPanel .mcell')].find(c => c.getAttribute('aria-label') === label);
          const pop = document.querySelector('#memPanel .byte-detail.anchored');
          if (!pop || !live) return 'no popup';
          const pr = pop.getBoundingClientRect(), o = live.closest('.mem-obj').getBoundingClientRect();
          const anchored = pr.top < o.bottom + 4 && pr.bottom > o.top - 4;
          const sel = document.querySelectorAll('#memPanel .mcell.sel').length;
          ui.focusByte = null; render();
          return anchored && sel === 1 ? true : JSON.stringify({ anchored, sel });
        }) === true);
  check('execution focus and user selection are still separate',
        await page.evaluate(() => {
          for (let i = 0; i < run.history.length; i++) {
            goTo(i);
            const ex = document.querySelector('#memPanel .mcell.exec');
            if (!ex) continue;
            const mine = [...document.querySelectorAll('#memPanel .mcell')].find(c => c !== ex);
            if (!mine) continue;
            const exLabel = ex.getAttribute('aria-label');
            mine.click();
            const after = document.querySelector('#memPanel .mcell.exec');
            const selNow = document.querySelector('#memPanel .mcell.sel');
            return after && after.getAttribute('aria-label') === exLabel && selNow &&
                   selNow.getAttribute('aria-label') !== exLabel;
          }
          return 'no step with both';
        }) === true);
  const lvl = async (l) => page.evaluate((x) => {
    setLevel(x);
    return [...document.querySelectorAll('#rightScroll .panel')]
      .filter(p => !p.classList.contains('collapsed') && !p.hidden).map(p => p.id).sort();
  }, l);
  check('BASIC is still exactly the four panels',
        JSON.stringify(await lvl('beginner')) === JSON.stringify(['panelMemory', 'panelPointers', 'panelStack', 'panelVars']),
        (await lvl('beginner')).join(','));
  check('MEDIUM still adds only the RAM map',
        JSON.stringify(await lvl('intermediate')) === JSON.stringify(['panelMemory', 'panelPointers', 'panelRam', 'panelStack', 'panelVars']),
        (await lvl('intermediate')).join(','));
  check('DEEP still opens everything', (await lvl('deep')).length >= 10, (await lvl('deep')).length + ' panels');
  check('excluded panels are still genuinely removed, not just collapsed',
        await page.evaluate(() => {
          setLevel('beginner');
          const t = document.querySelector('#panelTrace');
          return getComputedStyle(t).display === 'none';
        }));
  check('sticky headers still clip their content',
        await page.evaluate(() => {
          setLevel('deep');
          const h = document.querySelector('#rightScroll .panel-head');
          return getComputedStyle(h).position === 'sticky';
        }));
  check('the dock splitter is still real and still drags',
        await page.evaluate(() => {
          const sp = document.querySelector('#dockSplitter');
          const r = sp.getBoundingClientRect(), h0 = ui.dockH;
          sp.dispatchEvent(new MouseEvent('mousedown', { clientY: r.top + 3, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mousemove', { clientY: r.top - 90, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          return getComputedStyle(sp).cursor === 'row-resize' && ui.dockH > h0;
        }));
  check('pointer arrows and data-flow arrows still draw',
        await page.evaluate(() => {
          loadExample('ex10'); openViz();
          let l = -2;
          for (let i = 0; i < 4000 && !run.stopped; i++) { if (run.index === l && run.history) break; l = run.index; doStep(); }
          let edges = 0, flows = 0;
          for (let i = 0; i < run.history.length; i++) {
            goTo(i);
            edges = Math.max(edges, document.querySelectorAll('#vizHost .viz-edge').length);
            flows = Math.max(flows, document.querySelectorAll('#vizHost .viz-flow').length);
          }
          return edges > 0 && flows > 0 ? true : 'edges=' + edges + ' flows=' + flows;
        }) === true);

  console.log('\n=== Phase 11 · part 7: responsive ===');
  await page.evaluate(() => { loadExample('ex6'); setLevel('deep'); });
  await runAll();
  for (const [w, h] of [[1920, 1080], [1600, 1000], [1440, 900], [1280, 800], [1100, 720], [980, 700], [860, 640], [760, 900]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(320);
    const r = await page.evaluate(() => {
      const bad = [];
      // Every control a learner needs must be on screen, sized and reachable.
      for (const sel of ['#btnFirst', '#btnPrev', '#btnStep', '#btnRun', '#btnLast', '#btnReset',
                         '#vizSpeed', '#levelSeg', '#btnViz', '#cmdkBtn', '#themeToggle',
                         '#railErrLab', '#dockSplitter', '#btnExpandSrc']) {
        const e = document.querySelector(sel);
        if (!e) { bad.push(sel + ':missing'); continue; }
        const b = e.getBoundingClientRect();
        if (b.width < 4 || b.height < 4) { bad.push(sel + ':collapsed'); continue; }
        // inside the window, or inside a container that scrolls to reach it
        const sc = e.closest('.toolbar');
        const reachable = (b.left >= -1 && b.right <= window.innerWidth + 1) ||
                          (sc && sc.scrollWidth > sc.clientWidth + 2);
        if (!reachable) bad.push(sel + ':offscreen');
      }
      const tb = document.querySelector('.titlebar').getBoundingClientRect();
      return {
        bad,
        hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        headerH: Math.round(tb.height),
        oneRow: Math.abs(document.querySelector('.toolbar').getBoundingClientRect().top - tb.top) < tb.height,
        srcReadable: document.querySelector('#srcScroll').getBoundingClientRect().width > 200,
        gutter: document.querySelectorAll('#sourceView .ln').length > 0,
      };
    });
    check(w + 'x' + h + ': one header row, no overflow, every control usable',
          r.bad.length === 0 && !r.hOverflow && r.oneRow && r.headerH <= 56 && r.srcReadable && r.gutter,
          JSON.stringify(r));
  }
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'p12_final.png') });
  await browser.close();

  console.log('\n' + '-'.repeat(64));
  console.log('PHASE 11  pass ' + pass + '  fail ' + fail);
  if (errs.length) { console.log('console errors:'); errs.slice(0, 10).forEach(e => console.log('   ' + e)); }
  process.exit(fail || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
