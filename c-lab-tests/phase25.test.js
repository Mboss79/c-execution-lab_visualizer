'use strict';
/* HOME / DASHBOARD — the entry point.

   The claim under test: Home is the way into the whole product, every
   destination it offers is real, and it introduced no second navigation
   system. The assertions are semantic (DOM + app state), not pixel
   coordinates, except where the phase asks for geometry — overflow and
   clipping, which are genuinely layout facts.

   The defects the visual probe caught are each pinned below:
     - sections opened as <section> and closed as </div>, nesting them
     - dashboard cards reused data-dock, which the dock tab bar owns
     - boot overwrote the position it had just restored from storage
     - the rail's flexible gap split the destinations and buried Labs */
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
  console.log('\n== structure: one navigation system, scoped CSS ==');

  check('the home stylesheet is present',
        SHIPPED.indexOf('==== HOMECSS START ====') > 0 && SHIPPED.indexOf('==== HOMECSS END ====') > 0);
  const css = SHIPPED.slice(SHIPPED.indexOf('==== HOMECSS START ===='), SHIPPED.indexOf('==== HOMECSS END ===='));
  const bare = ('/*' + css).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = bare.split('\n').filter(l => l.indexOf('{') >= 0);
  check('it contains rules to inspect', rules.length > 8, rules.length + ' rules');
  const unscoped = rules.filter(l => !/^\s*(\.dash\b|@media)/.test(l));
  check('every home rule is scoped under .dash', unscoped.length === 0, unscoped.slice(0, 3).join(' | '));
  // The historical disaster: an unscoped rule reaching another component.
  for (const banned of ['.vl-row', '.vl-tab', '.row{', '.card{', '.container'])
    check('home CSS does not define the global selector ' + banned, bare.indexOf(banned) < 0);

  // No second router / shell / editor introduced.
  check('still exactly one renderDashboard', (SHIPPED.match(/function renderDashboard\(/g) || []).length === 1);
  check('still exactly one showDashboard', (SHIPPED.match(/function showDashboard\(/g) || []).length === 1);
  check('still exactly one showLab', (SHIPPED.match(/function showLab\(/g) || []).length === 1);
  check('still exactly one LAB_TABS', (SHIPPED.match(/const LAB_TABS =/g) || []).length === 1);
  check('no router library was added', !/history\.pushState|hashchange|new Router/.test(SHIPPED));
  check('the dashboard uses no eval or dynamic code',
        !/eval\(|new Function\(/.test(SHIPPED.slice(SHIPPED.indexOf('function renderDashboard('),
                                                    SHIPPED.indexOf('function dashSec('))));

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

  console.log('\n== Home is the landing view and says what this is ==');

  check('the app lands on the dashboard', await page.evaluate(() => ui.view) === 'dashboard');
  check('the dashboard is actually visible', await page.evaluate(() =>
    getComputedStyle(document.querySelector('#dashRoot')).display) === 'block');
  const hero = await page.evaluate(() => {
    const h1 = document.querySelector('#dashRoot h1');
    const p = h1 ? h1.parentElement.parentElement.querySelector('p') : null;
    return { title: h1 ? h1.textContent.trim() : null, blurb: p ? p.textContent.trim() : '' };
  });
  check('the product name is the page\'s only h1', hero.title === 'C Execution Lab' &&
        await page.evaluate(() => document.querySelectorAll('#dashRoot h1').length) === 1);
  check('a one-paragraph answer to "what is this" is present',
        hero.blurb.length > 80 && /C/.test(hero.blurb), hero.blurb.slice(0, 70) + '...');
  check('the browser tab is named for the product', await page.evaluate(() => document.title) === 'C Execution Lab');

  // Regression: <section> opened, </div> closed — the browser nested them.
  const sections = await page.evaluate(() => [...document.querySelectorAll('.dash-sec')].map(s => ({
    name: s.querySelector('h2').textContent.trim(),
    nested: s.querySelectorAll('.dash-sec').length,
    cards: s.querySelectorAll('.dcard').length,
    rows: s.querySelectorAll('.ex-row').length,
  })));
  check('no dashboard section is nested inside another',
        sections.every(s => s.nested === 0), JSON.stringify(sections.map(s => s.name + ':' + s.nested)));
  check('Home is a dashboard of capabilities: Labs, Tools, About',
        sections.map(s => s.name).join(',') === 'Labs,Tools,About',
        sections.map(s => s.name).join(','));
  check('and it lists no exercise files at all',
        sections.every(x => x.rows === 0), JSON.stringify(sections.map(x => x.name + ':' + x.rows)));

  console.log('\n== heading hierarchy and labels ==');
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('#dashRoot h1,#dashRoot h2,#dashRoot h3')].map(h => h.tagName));
  check('headings start at h1 and never skip a level', (() => {
    let prev = 0;
    for (const t of heads) { const n = +t[1]; if (prev && n > prev + 1) return false; prev = n; }
    return heads[0] === 'H1';
  })(), heads.join(' '));
  const unlabelled = await page.evaluate(() =>
    [...document.querySelectorAll('#dashRoot button')].filter(x =>
      !(x.textContent || '').trim() && !x.getAttribute('aria-label')).length);
  check('every dashboard control has a text or aria label', unlabelled === 0, String(unlabelled));

  console.log('\n== no dead buttons: every destination is real ==');
  const buttons = await page.evaluate(() => [...document.querySelectorAll('#dashRoot button')].map(x => ({
    text: (x.querySelector('.dc-title') || x.querySelector('.er-d') || x).textContent.trim().slice(0, 34),
    disabled: x.disabled,
    routed: !!(x.dataset.open || x.dataset.lab || x.dataset.dpanel || x.dataset.ddock || x.id),
  })));
  check('the dashboard has a real set of controls', buttons.length > 20, buttons.length + ' buttons');
  check('not one of them is disabled', buttons.every(x => !x.disabled),
        buttons.filter(x => x.disabled).map(x => x.text).join(' | '));
  check('every one of them routes somewhere', buttons.every(x => x.routed),
        buttons.filter(x => !x.routed).map(x => x.text).join(' | '));
  // Every exercise/lab/panel target must actually exist.
  const targets = await page.evaluate(() => {
    const bad = [];
    for (const x of document.querySelectorAll('#dashRoot [data-open]'))
      if (!EXAMPLES[x.dataset.open]) bad.push('example ' + x.dataset.open);
    for (const x of document.querySelectorAll('#dashRoot [data-lab]'))
      if (!LAB_TABS.some(t => t.id === x.dataset.lab)) bad.push('lab ' + x.dataset.lab);
    for (const x of document.querySelectorAll('#dashRoot [data-dpanel]'))
      if (!document.getElementById(x.dataset.dpanel)) bad.push('panel ' + x.dataset.dpanel);
    for (const x of document.querySelectorAll('#dashRoot [data-ddock]'))
      if (!document.querySelector('.dock-tab[data-dock="' + x.dataset.ddock + '"]')) bad.push('dock ' + x.dataset.ddock);
    return bad;
  });
  check('every target named by a card exists in the app', targets.length === 0, targets.join(' | '));

  // Regression: the dashboard reused data-dock, which the dock tab bar owns.
  const collide = await page.evaluate(() => ({
    dashUsesDock: document.querySelectorAll('#dashRoot [data-dock]').length,
    dockBar: document.querySelectorAll('.dock-tab[data-dock]').length,
  }));
  check('dashboard cards do not reuse the dock bar\'s data-dock attribute',
        collide.dashUsesDock === 0 && collide.dockBar > 0, JSON.stringify(collide));

  console.log('\n== the Labs are discoverable from Home ==');
  const labs = await page.evaluate(() => {
    const onHome = [...document.querySelectorAll('#dashRoot [data-lab]')].map(x => x.dataset.lab);
    return { onHome, all: LAB_TABS.map(t => t.id), labels: LAB_TABS.map(t => t.label) };
  });
  check('EVERY lab tab has a card on Home — the audit\'s main gap',
        labs.all.every(id => labs.onHome.indexOf(id) >= 0),
        'missing: ' + labs.all.filter(id => labs.onHome.indexOf(id) < 0).join(','));
  check('and Home invents no lab that does not exist',
        labs.onHome.every(id => labs.all.indexOf(id) >= 0));
  const labText = await page.evaluate(() => document.querySelector('#dashRoot').textContent);
  for (const l of ['ASCII', 'Pointers & Dereferencing', 'argc / argv', 'Function Reproduction'])
    check('Home names the "' + l + '" lab', labText.indexOf(l) >= 0);
  check('the lab cards carry their LAB_TABS label, not a second copy',
        await page.evaluate(() => [...document.querySelectorAll('#dashRoot [data-lab]')].every(x => {
          const t = LAB_TABS.find(y => y.id === x.dataset.lab);
          return t && x.querySelector('.dc-title').textContent === t.label;
        })));

  console.log('\n== every action really navigates ==');
  const act = async (sel, label, want) => {
    await home();
    const found = await page.evaluate((s) => {
      const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
    await sleep(360);
    const after = await page.evaluate(() => ({
      view: ui.view, tab: (typeof lab === 'object' ? lab.tab : null),
      dash: getComputedStyle(document.querySelector('#dashRoot')).display }));
    check(label + ' navigates', found && after.view === want.view &&
          (!want.tab || after.tab === want.tab) && after.dash === 'none',
          JSON.stringify(after));
  };
  await act('#dashStart', 'Open the Workspace', { view: 'workspace' });
  await act('#dashLabs', 'Explore the Labs', { view: 'lab' });
  await act('#dashRoot [data-lab="repro"]', 'a Labs card', { view: 'lab', tab: 'repro' });
  await act('#dashRoot [data-lab="ascii"]', 'another Labs card', { view: 'lab', tab: 'ascii' });
  await act('#dashRoot [data-dpanel="panelMemory"]', 'a Tools panel card', { view: 'workspace' });
  await act('#dashRoot [data-ddock="terminal"]', 'a Tools dock card', { view: 'workspace' });
  // Home no longer lists exercises; that routing is asserted in phase26 against
  // the header menu and the explorer catalog, which are what own it now.
  // The dock card must actually select that dock tab, not merely open the workspace.
  check('the Terminal card selects the terminal dock tab',
        await page.evaluate(() => ui.dockTab) === 'terminal',
        await page.evaluate(() => ui.dockTab));

  console.log('\n== the state Continue used is still there for its real owners ==');

  // Continue was removed from Home, but the two persisted values were never
  // Continue-only: labTab is read by the Project menu's Labs entry and
  // exampleKey by boot's reopen-last-file. Both must keep working.
  await page.evaluate(() => { loadExample('c03_strcmp'); openLabTab('ptr'); });
  await sleep(300);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cexlab.ui.v3') || '{}'));
  check('the last example is still persisted', stored.exampleKey === 'c03_strcmp', String(stored.exampleKey));
  check('the last lab tab is still persisted', stored.labTab === 'ptr', String(stored.labTab));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(900);
  check('boot still reopens the file the learner last had open',
        await page.evaluate(() => ui.exampleKey) === 'c03_strcmp',
        await page.evaluate(() => ui.exampleKey));
  check('the Project menu still resumes the last lab',
        await page.evaluate(() => { document.querySelector('#mProject').click();
          const hit = [...document.querySelectorAll('#menuPop .menu-item')]
            .find(x => /^⌗?\s*Labs/.test(x.textContent.trim()));
          if (!hit) return 'no Labs entry'; hit.click();
          return ui.view + ':' + lab.tab; }) === 'lab:ptr');

  console.log('\n== branding, restrained ==');
  await home();
  const brand = await page.evaluate(() => {
    const h1 = document.querySelector('#dashRoot h1');
    const sg = document.querySelector('.dash-sign');
    return { sign: sg ? sg.textContent.replace(/\s+/g, ' ').trim() : null,
             signSize: sg ? Math.max(...[...sg.children].map(c => parseFloat(getComputedStyle(c).fontSize))) : 0,
             titleSize: parseFloat(getComputedStyle(h1).fontSize) };
  });
  check('the author signature is present', /mbousebe/.test(brand.sign || '') && /Mboss/.test(brand.sign || ''),
        brand.sign);
  check('but never more prominent than the product',
        brand.signSize < brand.titleSize / 1.5, brand.signSize + 'px vs ' + brand.titleSize + 'px');

  console.log('\n== the rail: destinations grouped, nothing buried ==');
  const rail = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.rail-btn')].filter(x => !x.classList.contains('rail-sm'));
    return { ids: btns.map(x => x.id) };
  });
  check('the navigation buttons are one continuous run in order',
        rail.ids.join(',') === 'railHome,railWork,railLab,railLearn,railExplorer,railErrLab,rail3d,railDock,railHelp',
        rail.ids.join(','));
  check('the Labs button is a top-level destination, not buried in the utilities',
        rail.ids.indexOf('railLab') === 2, rail.ids.join(','));
  check('the rail button that opens the labs names the whole area',
        await page.evaluate(() => document.querySelector('#railLab').title),
        await page.evaluate(() => document.querySelector('#railLab').title));
  check('it no longer calls itself the Value & Representation Lab',
        !/Value & Representation/.test(await page.evaluate(() => document.querySelector('#railLab').title)));
  check('the rail has no flexible gap splitting it any more',
        await page.evaluate(() => document.querySelectorAll('.rail-sp').length) === 0);
  check('there is still exactly one rail', await page.evaluate(() =>
    document.querySelectorAll('.rail').length) === 1);

  console.log('\n== responsive: no overflow, nothing clipped ==');
  for (const w of [1500, 1280, 1024, 820, 600, 420, 360]) {
    await page.setViewport({ width: w, height: 900 });
    await home();
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const clipped = [...document.querySelectorAll('#dashRoot *')]
        .filter(e => e.getBoundingClientRect().right > de.clientWidth + 1).length;
      return { over: de.scrollWidth > de.clientWidth + 1, sw: de.scrollWidth, cw: de.clientWidth,
               clipped, rail: document.querySelector('.rail').getBoundingClientRect().width > 0,
               h1: !!document.querySelector('#dashRoot h1'),
               labs: document.querySelectorAll('#dashRoot [data-lab]').length };
    });
    check('at ' + w + 'px: no horizontal overflow, nothing clipped, navigation intact',
          !r.over && r.clipped === 0 && r.rail && r.h1 && r.labs === 13,
          JSON.stringify(r));
  }
  await page.setViewport({ width: 1500, height: 1000 });

  console.log('\n== keyboard and focus ==');
  await home();
  const kb = await page.evaluate(() => {
    const first = document.querySelector('#dashStart');
    first.focus();
    return { focusable: document.activeElement === first,
             visible: first.matches(':focus-visible'),
             outline: getComputedStyle(first, ':focus-visible').outlineWidth };
  });
  check('a dashboard action can take keyboard focus', kb.focusable);
  check('and shows a visible focus ring', kb.visible, JSON.stringify(kb));
  const reachable = await page.evaluate(() => {
    const all = [...document.querySelectorAll('#dashRoot button')];
    return all.filter(x => x.tabIndex >= 0 && !x.disabled).length === all.length;
  });
  check('every dashboard control is in the tab order', reachable);
  check('no dashboard information is carried by colour alone — every card has text',
        await page.evaluate(() => [...document.querySelectorAll('#dashRoot .dcard')]
          .every(c => (c.querySelector('.dc-title') || {}).textContent)));

  console.log('\n== nothing else regressed ==');
  await home();
  await page.click('#dashRoot [data-lab="repro"]');
  await sleep(450);
  const repro = await page.evaluate(() => {
    const run = reproRun();
    return { tab: lab.tab, ok: run.ok, steps: run.ok ? run.steps.length : 0,
      line: ((document.querySelector('.rl-srcline.on') || {}).textContent || '').trim(),
      frames: document.querySelectorAll('.rl-frame').length,
      bytes: document.querySelectorAll('.rl-cell2').length };
  });
  check('Function Reproduction still runs ft_strcpy after arriving from Home',
        repro.tab === 'repro' && repro.ok && repro.steps === 30, JSON.stringify(repro));
  check('its frames and memory bytes still render', repro.frames === 2 && repro.bytes > 0,
        'frames=' + repro.frames + ' bytes=' + repro.bytes);
  const retOk = await page.evaluate(() => {
    const r = reproRun();
    for (let i = 0; i < r.steps.length; i++)
      if (r.steps[i].step.phase === 'call-return') { lab.rpStep = i; renderLab(); break; }
    const e = document.querySelector('.rl-ret');
    return e ? e.textContent.replace(/\s+/g, ' ') : null;
  });
  check('its return visualization still works', retOk && /dest/.test(retOk) && /char\[8\]/.test(retOk),
        (retOk || '').slice(0, 70));
  await page.click('.vl-btn[data-rpstep="next"]');
  await sleep(200);
  check('its stepper still advances', await page.evaluate(() => lab.rpStep) === 26,
        String(await page.evaluate(() => lab.rpStep)));

  const tabsBad = [];
  for (const t of ['ascii', 'convert', 'bits', 'arith', 'compare', 'types', 'functions',
                   'syscalls', 'c03', 'repr', 'ptr', 'argv', 'repro']) {
    await page.evaluate((x) => openLabTab(x), t);
    await sleep(90);
    const n = await page.evaluate(() => document.querySelector('#labRoot').textContent.length);
    if (n < 300) tabsBad.push(t + ':' + n);
  }
  check('all 13 lab tabs still render', tabsBad.length === 0, tabsBad.join(' '));

  await page.evaluate(() => openLabTab('ascii'));
  await sleep(300);
  const align = await page.evaluate(() => {
    const th = [...document.querySelectorAll('.vl-table thead th')];
    const row = document.querySelector('.vl-table tbody tr.vl-row');
    if (!th.length || !row) return { err: 'selectors missing' };
    const cells = [...row.children];
    return { drift: Math.max(...th.map((h, i) =>
      Math.abs(h.getBoundingClientRect().left - cells[i].getBoundingClientRect().left))), cols: th.length };
  });
  check('no home CSS leaked into the lab tables',
        !align.err && align.drift < 1, align.err || (align.cols + ' cols, ' + align.drift.toFixed(2) + 'px'));

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

  check('the browser reported no page or console errors', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => showDashboard());
  await sleep(320);
  await page.screenshot({ path: path.join(SHOTS, 'p25_home.png'), fullPage: true });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('HOME  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
