'use strict';
// Visual QA shots for the Phase 8 3D view: dark/light, EN/FR, 2D fallback,
// the ⓘ popover, the heap/lifetime scene and a runtime error.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HEAP = ['#include <stdlib.h>', '', 'int\tmain(void)', '{', '\tint\t*p;', '',
  '\tp = malloc(sizeof(int) * 3);', '\tp[0] = 7;', '\tfree(p);', '\treturn (0);', '}', ''].join('\n');
const UAR = ['int\t*ft_bad(void)', '{', '\tint\tlocal;', '', '\tlocal = 5;', '\treturn (&local);', '}', '',
  'int\tmain(void)', '{', '\tint\t*p;', '', '\tp = ft_bad();', '\treturn (*p);', '}', ''].join('\n');

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(650);
  await page.evaluate(() => showWorkspace());

  const setSrc = (s) => page.evaluate((src) => {
    document.querySelector('#sourceEdit').value = src; switchToEditing();
  }, s);
  const shot = async (n) => { await sleep(320); await page.screenshot({ path: path.join(SHOTS, n) }); console.log('  ' + n); };

  // 1. array + loop, dark EN
  await page.evaluate(() => { viz.demoId = 'v-arr'; loadVizDemo(); openViz(); });
  await page.evaluate(() => fastForward({}));
  await sleep(400);
  await page.evaluate(() => goTo(Math.floor(run.history.length * 0.7)));
  await shot('p8_qa_array_dark_en.png');

  // 2. the ⓘ popover, checked for overlap
  await page.evaluate(() => {
    const b = document.querySelector('#vizHud .info-btn[data-info="array"]') ||
              document.querySelector('#vizHud .info-btn');
    b.click();
  });
  await shot('p8_qa_info_popover.png');
  console.log('  popover overlap:', await page.evaluate(() => {
    const p = document.querySelector('.info-pop').getBoundingClientRect();
    const b = document.querySelector('#vizHud .info-btn').getBoundingClientRect();
    return !(p.right < b.left || p.left > b.right || p.bottom < b.top || p.top > b.bottom);
  }));
  await page.evaluate(() => closeInfoPop());

  // 3. heap + freed block, light FR
  await setSrc(HEAP);
  await page.evaluate(() => fastForward({}));
  await sleep(400);
  await page.evaluate(() => { goTo(run.history.length - 2); ui.lang = 'fr'; applyI18n(); ui.theme = 'light'; applyTheme(); });
  await shot('p8_qa_heap_light_fr.png');

  // 4. runtime error, light FR
  await setSrc(UAR);
  await page.evaluate(() => fastForward({}));
  await sleep(500);
  await shot('p8_qa_error_light_fr.png');

  // 5. 2D fallback, dark EN
  await page.evaluate(() => { ui.lang = 'en'; applyI18n(); ui.theme = 'dark'; applyTheme();
                              viz.demoId = 'v-ptrarr'; loadVizDemo(); });
  await page.evaluate(() => fastForward({}));
  await sleep(400);
  await page.evaluate(() => { goTo(run.history.length - 2); viz.flat = true; disposeViz(); vizEnsureStage(); renderViz(); viz.stage.frameAll(); });
  await shot('p8_qa_fallback_2d.png');
  await page.evaluate(() => { viz.flat = false; disposeViz(); vizEnsureStage(); renderViz(); });

  // 6. narrow / responsive
  await page.setViewport({ width: 900, height: 820 });
  await sleep(400);
  await page.evaluate(() => { if (viz.stage) viz.stage.frameAll(); });
  await shot('p8_qa_narrow.png');

  console.log('errors:', errs.filter(e => !/ERR_CONNECTION|Failed to load|net::/.test(e)).length ?
    errs.filter(e => !/ERR_CONNECTION|Failed to load|net::/.test(e)) : 'none');
  await browser.close();
})();
