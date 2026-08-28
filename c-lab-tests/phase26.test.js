'use strict';
/* PHASE 10 — Home / navigation cleanup and personal branding.

   Four claims:
     the rail is one continuous group with no large gap;
     Home is a dashboard, carrying no exercise catalog and no Continue;
     Exercises moved to the header and routes to the catalog that already
       existed, with the exercise data and routing untouched;
     the signature is a signature, and the quote's attributions are real.

   Removal is asserted at the SOURCE as well as in the DOM, because "not
   visible" and "not rendered" are different things and the phase asked for
   removal rather than hiding. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { load, HTML } = require('./load-engine.js');
const SHIPPED = fs.readFileSync(HTML, 'utf8');

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
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|favicon/.test(m.text())) errs.push(m.text());
  });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(900);
  const home = async () => { await page.evaluate(() => showDashboard()); await sleep(220); };

  /* ===================== 1. THE RAIL ===================== */
  console.log('\n== the rail is one continuous navigation group ==');

  const rail = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.rail-btn')].filter(x => !x.classList.contains('rail-sm'));
    const gaps = [];
    for (let i = 1; i < nav.length; i++)
      gaps.push({ id: nav[i].id,
        gap: Math.round(nav[i].getBoundingClientRect().top - nav[i - 1].getBoundingClientRect().bottom) });
    return { ids: nav.map(x => x.id), gaps,
             spacers: document.querySelectorAll('.rail-sp').length,
             rails: document.querySelectorAll('.rail').length,
             railGap: getComputedStyle(document.querySelector('.rail')).rowGap };
  });
  check('there is still exactly one rail', rail.rails === 1, String(rail.rails));
  check('every navigation button is still present, in order',
        rail.ids.join(',') === 'railHome,railWork,railLab,railLearn,railExplorer,railErrLab,rail3d,railDock,railHelp',
        rail.ids.join(','));
  // Regression: .rail-sp{flex:1} absorbed all spare height and split the rail.
  check('the flexible spacer that split the rail is gone from the markup',
        rail.spacers === 0 && SHIPPED.indexOf('class="rail-sp"') < 0, String(rail.spacers));
  check('the gap between navigation buttons is small and identical throughout',
        rail.gaps.every(g => g.gap === rail.gaps[0].gap) && rail.gaps[0].gap <= 8,
        JSON.stringify(rail.gaps));
  check('and it comes from the container gap, not per-icon margins',
        parseFloat(rail.railGap) === rail.gaps[0].gap, rail.railGap + ' vs ' + rail.gaps[0].gap + 'px');
  const margins = await page.evaluate(() =>
    [...document.querySelectorAll('.rail-btn')].filter(x => {
      const cs = getComputedStyle(x);
      return parseFloat(cs.marginTop) || parseFloat(cs.marginBottom);
    }).map(x => x.id));
  check('no rail button carries its own vertical margin', margins.length === 0, margins.join(','));

  // Handlers and destinations unchanged.
  for (const [id, want] of [['railHome', 'dashboard'], ['railWork', 'workspace'], ['railLab', 'lab']]) {
    await page.evaluate((x) => document.querySelector('#' + x).click(), id);
    await sleep(300);
    check(id + ' still navigates to ' + want,
          await page.evaluate(() => ui.view) === want, await page.evaluate(() => ui.view));
  }
  await page.evaluate(() => document.querySelector('#railExplorer').click());
  await sleep(300);
  check('railExplorer still opens the library',
        await page.evaluate(() => ui.libOpen) === true);

  /* ===================== 2. HOME IS A DASHBOARD ===================== */
  console.log('\n== Home carries no exercise catalog and no Continue ==');

  await home();
  const text = await page.evaluate(() => document.querySelector('#dashRoot').textContent);
  for (const s of ['Continue', 'Recent activity', 'No recent activity',
                   'ft_strcapitalize', 'ft_strupcase', 'ft_strcmp', 'Bug demo',
                   'variable.c', 'malloc_free.c'])
    check('Home does not render "' + s + '"', text.indexOf(s) < 0);
  check('Home has no section headed Exercises',
        await page.evaluate(() => [...document.querySelectorAll('#dashRoot h2')]
          .every(h => h.textContent.trim() !== 'Exercises')));
  check('Home renders no exercise rows at all',
        await page.evaluate(() => document.querySelectorAll('#dashRoot .ex-row').length) === 0);
  check('and no card that opens an exercise',
        await page.evaluate(() => document.querySelectorAll('#dashRoot [data-open]').length) === 0);

  // Removed, not hidden: the renderer must not emit them at all.
  const render = SHIPPED.slice(SHIPPED.indexOf('function renderDashboard('), SHIPPED.indexOf('function dashSec('));
  check('the renderer no longer builds a Continue section', render.indexOf("dashSec('Continue')") < 0);
  check('the renderer no longer builds an Exercises section', render.indexOf("dashSec('Exercises')") < 0);
  check('the renderer no longer loops GROUPS to list files', !/for \(const g of GROUPS\)/.test(render));
  check('nothing was merely hidden with CSS',
        !/dash-sec[^{]*\{[^}]*display:\s*none/.test(SHIPPED) &&
        !/\.dash-empty[^{]*\{[^}]*display:\s*none/.test(SHIPPED));
  check('Home does not name one specific exercise anywhere',
        !/ft_str|malloc_free|factorial/i.test(text));

  /* ===================== 3. EXERCISES MOVED, NOT DELETED ===================== */
  console.log('\n== Exercises is a header destination, backed by the same data ==');

  const menu = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-btn')].map(x => ({ id: x.id, label: x.textContent.trim() })));
  check('an Exercises item sits in the header menubar',
        menu.some(m => m.id === 'mExercises' && m.label === 'Exercises'),
        menu.map(m => m.label).join(' '));
  check('it sits directly beside Project',
        menu.findIndex(m => m.id === 'mExercises') === menu.findIndex(m => m.id === 'mProject') + 1,
        menu.map(m => m.label).join(' '));
  check('the header still has exactly one menubar',
        await page.evaluate(() => document.querySelectorAll('.menubar').length) === 1);

  const items = await page.evaluate(() => {
    document.body.click(); document.querySelector('#mExercises').click();
    const all = [...document.querySelectorAll('#menuPop .menu-item')];
    return { count: all.length,
             headers: all.filter(x => x.getAttribute('aria-disabled')).map(x => x.textContent.trim()),
             first: all[0].textContent.trim(),
             files: all.filter(x => !x.getAttribute('aria-disabled')).length };
  });
  check('the menu lists every exercise the app has',
        items.files - 1 === await page.evaluate(() => EXAMPLE_ORDER.length),
        (items.files - 1) + ' vs ' + await page.evaluate(() => EXAMPLE_ORDER.length));
  check('grouped under the same GROUPS headings, so C00-C07 will slot in',
        items.headers.length === await page.evaluate(() => GROUPS.length),
        items.headers.join(' | '));
  check('and its first entry opens the catalog that already existed',
        /catalog|library/i.test(items.first), items.first);

  const routed = await page.evaluate(() => {
    document.body.click(); document.querySelector('#mExercises').click();
    [...document.querySelectorAll('#menuPop .menu-item')][0].click();
    return { libOpen: ui.libOpen, libTab: ui.libTab, view: ui.view,
             rows: document.querySelectorAll('#explorer .tree-row').length };
  });
  await sleep(250);
  check('choosing it opens the explorer catalog, not a new one',
        routed.libOpen && routed.libTab === 'files' && routed.view === 'workspace',
        JSON.stringify(routed));
  check('the catalog still holds every exercise',
        routed.rows === await page.evaluate(() => EXAMPLE_ORDER.length),
        routed.rows + ' rows');

  const opened = await page.evaluate(() => {
    document.body.click(); document.querySelector('#mExercises').click();
    const hit = [...document.querySelectorAll('#menuPop .menu-item')]
      .find(x => x.textContent.indexOf('ft_strcmp.c') >= 0);
    if (!hit) return 'entry missing';
    hit.click();
    return ui.exampleKey + '|' + (document.querySelector('#sourceEdit').value.indexOf('ft_strcmp') >= 0);
  });
  await sleep(300);
  check('picking an exercise from the header actually loads it',
        opened === 'c03_strcmp|true', String(opened));

  // The data and its other consumers survive untouched.
  const data = await page.evaluate(() => ({
    examples: EXAMPLE_ORDER.length, groups: GROUPS.length,
    explorer: document.querySelectorAll('#explorer .tree-row').length,
    loadExample: typeof loadExample, fileNameFor: typeof fileNameFor,
    projectMenu: (() => { document.body.click(); document.querySelector('#mProject').click();
      const n = document.querySelectorAll('#menuPop .menu-item').length; closeMenus(); return n; })(),
  }));
  check('the exercise definitions are untouched',
        data.examples === 19 && data.groups === 7, JSON.stringify(data));
  check('the explorer tree still renders all of them', data.explorer === 19, String(data.explorer));
  check('loadExample and fileNameFor still exist',
        data.loadExample === 'function' && data.fileNameFor === 'function');
  check('the Project menu still works', data.projectMenu > 0, String(data.projectMenu));
  check('the exercise definitions are declared exactly once',
        (SHIPPED.match(/const GROUPS = \[/g) || []).length === 1 &&
        (SHIPPED.match(/const EXAMPLE_ORDER =/g) || []).length === 1);

  /* ===================== 4. SIGNATURE AND QUOTE ===================== */
  console.log('\n== a signature, not a disclaimer ==');

  await home();
  const sign = await page.evaluate(() => {
    const s = document.querySelector('.dash-sign');
    const h1 = document.querySelector('#dashRoot h1');
    if (!s) return null;
    return { user: s.querySelector('.ds-user').textContent.trim(),
             name: s.querySelector('.ds-name').textContent.trim(),
             all: s.textContent.replace(/\s+/g, ' ').trim(),
             size: Math.max(...[...s.children].map(c => parseFloat(getComputedStyle(c).fontSize))),
             titleSize: parseFloat(getComputedStyle(h1).fontSize) };
  });
  check('the signature exists', !!sign);
  check('it shows the username mbousebe', sign && sign.user === 'mbousebe', sign && sign.user);
  check('and the name Mboss', sign && sign.name === 'Mboss', sign && sign.name);
  check('it is nothing more than that', sign && sign.all.replace(/[\s|]/g, '') === 'mbousebeMboss',
        sign && sign.all);
  for (const gone of ['students', '1337', '42', 'Not affiliated', 'educational', 'official'])
    check('the signature no longer says "' + gone + '"', sign && sign.all.indexOf(gone) < 0);
  check('and it stays visually subtle', sign && sign.size < sign.titleSize / 1.5,
        sign && (sign.size + 'px vs ' + sign.titleSize + 'px'));
  check('the old colophon is gone from the source entirely',
        SHIPPED.indexOf('dash-colophon') < 0 && SHIPPED.indexOf('for 1337 / 42 students') < 0);

  console.log('\n== one short programming quote, correctly attributed ==');
  const quote = await page.evaluate(() => {
    const q = document.querySelector('.dash-quote');
    if (!q) return null;
    return { text: q.querySelector('blockquote').textContent.trim(),
             who: q.querySelector('figcaption').textContent.trim(),
             count: document.querySelectorAll('.dash-quote').length,
             size: parseFloat(getComputedStyle(q.querySelector('blockquote')).fontSize),
             set: DASH_QUOTES.length };
  });
  check('a quote is rendered', !!quote && quote.text.length > 20, quote && quote.text.slice(0, 50));
  check('exactly one, not a wall of them', quote && quote.count === 1, quote && String(quote.count));
  check('it carries an attribution', quote && quote.who.length > 3, quote && quote.who);
  check('the set is small and curated', quote && quote.set >= 3 && quote.set <= 8, quote && String(quote.set));
  check('the typography stays subtle', quote && quote.size <= 15, quote && quote.size + 'px');
  // Every quote in the set must be a real programming quote with a real source.
  const attribs = await page.evaluate(() => DASH_QUOTES.map(q => ({ t: q.text, w: q.who })));
  check('every quote names a person and the work it comes from',
        attribs.every(q => /,/.test(q.w) && q.w.split(',')[0].trim().split(' ').length >= 2),
        attribs.map(q => q.w).join(' | '));
  check('every quote is about programming, not generic motivation',
        attribs.every(q => /program|code|comput|data|algorithm|complexity|machine|C\b/i.test(q.t)));
  check('and each is short enough to stay quiet',
        attribs.every(q => q.t.length < 190), String(Math.max(...attribs.map(q => q.t.length))));
  // Deterministic rotation: same day, same quote; no timers.
  const rot = await page.evaluate(() => ({
    same: dashQuote(7).text === dashQuote(7).text && dashQuote(7).text === dashQuote(7 + 0).text,
    cycles: [0, 1, 2, 3, 4, 5].map(d => dashQuote(d).text),
    negative: dashQuote(-3).text.length > 0,
  }));
  check('the rotation is deterministic for a given day', rot.same);
  check('it cycles through the whole set', new Set(rot.cycles.slice(0, 5)).size === 5);
  check('and wraps safely at the ends', rot.negative && rot.cycles[5] === rot.cycles[0]);
  check('no timer drives it', !/setInterval\s*\([^)]*dashQuote|dashQuote[\s\S]{0,80}setInterval/.test(SHIPPED));

  /* ===================== 5. NOTHING ELSE BROKE ===================== */
  console.log('\n== the labs, the editor and the engine are untouched ==');

  const tabsBad = [];
  for (const t of ['ascii', 'convert', 'bits', 'arith', 'compare', 'types', 'functions',
                   'syscalls', 'c03', 'repr', 'ptr', 'argv', 'repro']) {
    await page.evaluate((x) => openLabTab(x), t);
    await sleep(90);
    const n = await page.evaluate(() => document.querySelector('#labRoot').textContent.length);
    if (n < 300) tabsBad.push(t + ':' + n);
  }
  check('all 13 lab tabs still render', tabsBad.length === 0, tabsBad.join(' '));
  check('every lab is still reachable from Home',
        (await home(), await page.evaluate(() => document.querySelectorAll('#dashRoot [data-lab]').length)) === 13);

  await page.evaluate(() => openLabTab('repro'));
  await sleep(400);
  const repro = await page.evaluate(() => {
    const r = reproRun();
    return { ok: r.ok, steps: r.ok ? r.steps.length : 0,
             frames: document.querySelectorAll('.rl-frame').length,
             bytes: document.querySelectorAll('.rl-cell2').length };
  });
  check('Function Reproduction still runs ft_strcpy',
        repro.ok && repro.steps === 30 && repro.frames === 2 && repro.bytes > 0, JSON.stringify(repro));

  await page.evaluate(() => openLabTab('ascii'));
  await sleep(300);
  const align = await page.evaluate(() => {
    const th = [...document.querySelectorAll('.vl-table thead th')];
    const row = document.querySelector('.vl-table tbody tr.vl-row');
    if (!th.length || !row) return { err: 'selectors missing' };
    const cells = [...row.children];
    return { drift: Math.max(...th.map((h, i) =>
      Math.abs(h.getBoundingClientRect().left - cells[i].getBoundingClientRect().left))) };
  });
  check('no CSS from this phase leaked into the lab tables',
        !align.err && align.drift < 1, align.err || align.drift.toFixed(2) + 'px');

  const caret = await page.evaluate(() => {
    showWorkspace(); switchToEditing();
    const ta = document.querySelector('#sourceEdit');
    const code = document.querySelector('#sourceView .codeline .code');
    if (!code) return { err: 'missing' };
    const cs = getComputedStyle(ta), cc = getComputedStyle(code);
    const tr = ta.getBoundingClientRect(), cr = code.getBoundingClientRect();
    return { dx: Math.round((tr.left + parseFloat(cs.paddingLeft)) - (cr.left + parseFloat(cc.paddingLeft))),
             dy: Math.round((tr.top + parseFloat(cs.paddingTop)) - cr.top),
             tab: cs.tabSize === cc.tabSize };
  });
  check('the editor caret alignment is untouched',
        !caret.err && Math.abs(caret.dx) <= 1 && Math.abs(caret.dy) <= 1 && caret.tab, JSON.stringify(caret));
  const exec = await page.evaluate(() => {
    loadExample('ex1'); doStep();
    return { controls: !!document.querySelector('#btnFirst'), step: run && run.history ? run.history.length : 0 };
  });
  check('the execution controls still work', exec.controls && exec.step > 0, JSON.stringify(exec));

  /* ===================== 6. RESPONSIVE ===================== */
  console.log('\n== responsive at every required width ==');
  for (const w of [360, 420, 600, 820, 1024, 1280, 1500]) {
    await page.setViewport({ width: w, height: 900 });
    await home();
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const clipped = [...document.querySelectorAll('#dashRoot *')]
        .filter(e => e.getBoundingClientRect().right > de.clientWidth + 1).length;
      const nav = [...document.querySelectorAll('.rail-btn')].filter(x => !x.classList.contains('rail-sm'));
      return { over: de.scrollWidth > de.clientWidth + 1, clipped,
               railHidden: nav.filter(x => x.getBoundingClientRect().width === 0).length,
               quote: !!document.querySelector('.dash-quote'),
               sign: !!document.querySelector('.dash-sign'),
               labs: document.querySelectorAll('#dashRoot [data-lab]').length };
    });
    check('at ' + w + 'px: no overflow, nothing clipped, rail and content intact',
          !r.over && r.clipped === 0 && r.railHidden === 0 && r.quote && r.sign && r.labs === 13,
          JSON.stringify(r));
  }
  await page.setViewport({ width: 1500, height: 1000 });

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await home();
  await sleep(320);
  await page.screenshot({ path: path.join(SHOTS, 'p26_home.png'), fullPage: true });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('PHASE 10 (home cleanup)  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
