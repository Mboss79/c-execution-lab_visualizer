'use strict';
/* BUG-FIX suite — two regressions found after Phase 6.

   BUG 1: full-view overlays covered the rail, so the global navigation was
   unreachable while the Value Lab (ASCII table) was open. These checks drive
   navigation with REAL MOUSE CLICKS on the rail rather than by calling
   showDashboard() directly — calling the function was exactly what the earlier
   suites did, which is why they passed while the UI was unusable.

   BUG 2: an unscoped .vl-row{display:flex} took the lab's table rows out of
   table layout, so <thead> and <tbody> measured themselves independently. These
   checks compare the real bounding boxes of corresponding header and body
   cells, which is the only kind of assertion that could have caught it. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}

// Every table currently reachable in the app, with how to get to it.
const TABLES = [
  { name: 'ASCII table', cols: 6,
    open: () => { showLab(); lab.tab = 'ascii'; renderLab(); }, sel: '.vl-table' },
  { name: 'type limits table', cols: 7,
    open: () => { showLab(); lab.tab = 'types'; renderLab(); }, sel: '.tl-table' },
];

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });

  const boot = async () => {
    await page.goto(FILE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(800);
  };
  await boot();

  /* ---------------- BUG 1: navigation ---------------- */
  console.log('=== BUG 1 · the rail must stay reachable from every view ===');

  // Click a rail button the way a user does: at its centre, through whatever is
  // painted on top of it.
  const clickRail = async (id) => {
    const r = await page.evaluate((x) => {
      const e = document.querySelector('#' + x);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    }, id);
    if (!r) return false;
    await page.mouse.click(r.x, r.y);
    await sleep(350);
    return true;
  };
  const view = () => page.evaluate(() => ui.view);
  const railReachable = () => page.evaluate(() => {
    const out = {};
    for (const id of ['railHome', 'railWork', 'railLab']) {
      const e = document.querySelector('#' + id);
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
      out[id] = !!(top && (top === e || e.contains(top)));
    }
    return out;
  });

  for (const [label, go] of [['workspace', 'railWork'], ['dashboard', 'railHome'], ['lab', 'railLab']]) {
    await clickRail(go);
    const reach = await railReachable();
    check('from the ' + label + ', every rail button is hit-testable',
          reach.railHome && reach.railWork && reach.railLab,
          JSON.stringify(reach));
  }

  // The exact journeys the report asked for.
  await clickRail('railHome');
  check('1-2. Dashboard then ASCII table',
        (await clickRail('railLab'), await view()) === 'lab', await view());
  check('3. ASCII table then back to Dashboard',
        (await clickRail('railHome'), await view()) === 'dashboard', await view());
  check('4. the ASCII table opens again after leaving it',
        (await clickRail('railLab'), await view()) === 'lab', await view());
  check('5. another section is reachable from the ASCII table',
        (await clickRail('railWork'), await view()) === 'workspace', await view());
  check('6-7. back to the ASCII table, then Home',
        (await clickRail('railLab'), await view()) === 'lab' &&
        (await clickRail('railHome'), await view()) === 'dashboard', await view());

  // Types tab -> dashboard, the third journey in the report
  await clickRail('railLab');
  await page.evaluate(() => { lab.tab = 'types'; renderLab(); });
  await sleep(300);
  await clickRail('railHome');
  check('ASCII table then Types then Dashboard', (await view()) === 'dashboard', await view());

  // the overlay must cover the work area but NOT the rail or the header
  await clickRail('railLab');
  const geom = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return { lab: g('#labRoot'), rail: g('.rail'), header: g('.titlebar'), workarea: g('.workarea') };
  });
  check('the lab overlay is the size of the work area, not the viewport',
        geom.lab.x === geom.workarea.x && geom.lab.y === geom.workarea.y &&
        geom.lab.w === geom.workarea.w && geom.lab.h === geom.workarea.h,
        JSON.stringify(geom.lab) + ' vs workarea ' + JSON.stringify(geom.workarea));
  check('the overlay starts to the right of the rail',
        geom.lab.x >= geom.rail.x + geom.rail.w, 'lab.x=' + geom.lab.x + ' rail ends ' + (geom.rail.x + geom.rail.w));
  check('the overlay starts below the application header',
        geom.lab.y >= geom.header.y + geom.header.h, 'lab.y=' + geom.lab.y);

  // the dashboard had the same defect and must be fixed too
  await clickRail('railHome');
  const dashCovers = await page.evaluate(() => {
    const e = document.querySelector('#railLab');
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
    return !!(top && (top === e || e.contains(top)));
  });
  check('the dashboard no longer covers the rail either', dashCovers);

  // resize while the lab is open
  await clickRail('railLab');
  for (const [w, h] of [[1100, 800], [860, 700], [1500, 950]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(300);
  }
  const afterResize = await railReachable();
  check('the rail is still reachable after resizing with the lab open',
        afterResize.railHome && afterResize.railWork, JSON.stringify(afterResize));
  check('the lab survives a resize and is still the current view',
        (await view()) === 'lab' &&
        await page.evaluate(() => document.querySelectorAll('.vl-tab').length > 0));

  // refresh: this app does not persist the current view, so a reload must land
  // on a working default rather than a broken state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
  const afterReload = await page.evaluate(() => ({
    view: ui.view,
    labHidden: getComputedStyle(document.querySelector('#labRoot')).display === 'none',
    railThere: !!document.querySelector('#railLab'),
  }));
  check('reloading lands on a working view with the rail intact',
        afterReload.labHidden && afterReload.railThere &&
        (afterReload.view === 'workspace' || afterReload.view === 'dashboard'),
        JSON.stringify(afterReload));
  check('and the lab can be opened again after a reload',
        (await clickRail('railLab'), await view()) === 'lab');

  /* ---------------- BUG 2: table column geometry ---------------- */
  console.log('\n=== BUG 2 · header and body must share one column geometry ===');

  const tableGeom = async (sel) => page.evaluate((s) => {
    const t = document.querySelector(s);
    if (!t) return { missing: true };
    const head = t.querySelector('thead tr');
    const body = t.querySelector('tbody tr');
    if (!head || !body) return { noHead: !head, noBody: !body };
    const box = (c) => { const r = c.getBoundingClientRect(); return { l: r.left, w: r.width }; };
    const hs = [...head.children].map(box), bs = [...body.children].map(box);
    const cs = (e) => getComputedStyle(e).display;
    return {
      headCols: hs.length, bodyCols: bs.length,
      leftDrift: hs.map((v, i) => (bs[i] ? Math.abs(v.l - bs[i].l) : 999)),
      widthDrift: hs.map((v, i) => (bs[i] ? Math.abs(v.w - bs[i].w) : 999)),
      headRowDisplay: cs(head), bodyRowDisplay: cs(body),
      headCellDisplay: cs(head.children[0]), bodyCellDisplay: cs(body.children[0]),
      tableDisplay: cs(t), rows: t.querySelectorAll('tbody tr').length,
    };
  }, sel);

  for (const t of TABLES) {
    await page.evaluate(t.open);
    await sleep(350);
    const g = await tableGeom(t.sel);
    check(t.name + ': has a real <thead> and <tbody>', !g.missing && !g.noHead && !g.noBody,
          JSON.stringify(g.missing || g.noHead || g.noBody || 'ok'));
    check(t.name + ': header and body have the same number of columns',
          g.headCols === t.cols && g.bodyCols === t.cols,
          g.headCols + ' vs ' + g.bodyCols + ' (expected ' + t.cols + ')');
    check(t.name + ': every header cell is left-aligned with its body cell',
          Math.max(...g.leftDrift) <= 1,
          'max drift ' + Math.round(Math.max(...g.leftDrift) * 100) / 100 + 'px');
    check(t.name + ': every header cell is the same width as its body cell',
          Math.max(...g.widthDrift) <= 1,
          'max width drift ' + Math.round(Math.max(...g.widthDrift) * 100) / 100 + 'px');
    check(t.name + ': header and body use the SAME layout mechanism',
          g.tableDisplay === 'table' &&
          g.headRowDisplay === 'table-row' && g.bodyRowDisplay === 'table-row' &&
          g.headCellDisplay === 'table-cell' && g.bodyCellDisplay === 'table-cell',
          g.tableDisplay + ' / rows ' + g.headRowDisplay + '|' + g.bodyRowDisplay +
          ' / cells ' + g.headCellDisplay + '|' + g.bodyCellDisplay);
  }

  // The exact collision that caused the bug must not come back.
  await page.evaluate(() => { showLab(); lab.tab = 'ascii'; renderLab(); });
  await sleep(300);
  check('the 3D-viz legend styling no longer leaks onto lab table rows',
        await page.evaluate(() => {
          const r = document.querySelector('.vl-table tbody tr.vl-row');
          return !!r && getComputedStyle(r).display === 'table-row';
        }));
  check('the lab page header is stacked, not flexed by the legend rule',
        await page.evaluate(() => {
          const h = document.querySelector('.vl .vl-head');
          return !!h && getComputedStyle(h).display !== 'flex';
        }));
  check('the legend itself still renders as rows inside the visualization',
        fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8')
          .indexOf('.viz-legend .vl-row{display:flex') >= 0);

  // alignment must survive every viewport and the longest values in the app
  console.log('\n--- alignment across viewports, with 20-digit values ---');
  const bad = [];
  for (const [w, h] of [[1600, 1000], [1280, 800], [1024, 800], [860, 700], [700, 900]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(220);
    for (const t of TABLES) {
      await page.evaluate((o) => { showLab(); lab.tab = o; lab.limitTypeId = 'ulong'; renderLab(); },
                          t.sel === '.tl-table' ? 'types' : 'ascii');
      await sleep(300);
      const g = await tableGeom(t.sel);
      const d = Math.max(...g.leftDrift);
      if (d > 1) bad.push(w + 'x' + h + ' ' + t.name + ' drift ' + Math.round(d) + 'px');
    }
  }
  check('column alignment holds at every viewport, including unsigned long',
        bad.length === 0, bad.length ? bad.join(' | ') : '5 viewports x 2 tables');

  // when the table must scroll horizontally, the header scrolls with it
  await page.setViewport({ width: 700, height: 900 });
  await page.evaluate(() => { showLab(); lab.tab = 'types'; lab.limitTypeId = 'ulong'; renderLab(); });
  await sleep(350);
  const scrollTogether = await page.evaluate(() => {
    const wrap = document.querySelector('.vl-table-wrap');
    const t = wrap.querySelector('table');
    const head = t.querySelector('thead tr'), body = t.querySelector('tbody tr');
    if (wrap.scrollWidth <= wrap.clientWidth) return { needed: false };
    wrap.scrollLeft = 150;
    const d = Math.max(...[...head.children].map((c, i) =>
      Math.abs(c.getBoundingClientRect().left - body.children[i].getBoundingClientRect().left)));
    const moved = wrap.scrollLeft > 0;
    wrap.scrollLeft = 0;
    return { needed: true, moved, drift: d };
  });
  check('a horizontally scrolling table keeps its header locked to its body',
        !scrollTogether.needed || (scrollTogether.moved && scrollTogether.drift <= 1),
        JSON.stringify(scrollTogether));

  await page.setViewport({ width: 1500, height: 950 });
  check('no page errors across the whole bug-fix session', errs.length === 0, errs.join(' | '));

  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  await page.evaluate(() => { showLab(); lab.tab = 'ascii'; renderLab(); });
  await sleep(350);
  await page.screenshot({ path: path.join(SHOTS, 'p17_fixed.png') });
  await b.close();

  console.log('\n----------------------------------------------------------------');
  console.log('BUGFIX  pass ' + pass + '  fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
