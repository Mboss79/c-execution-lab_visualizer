'use strict';
// Visual QA capture: workspace, dashboard, deep level, narrow, light, palette.
const puppeteer = require('puppeteer-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'screenshots');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 180000 });
  const p = await b.newPage();
  await p.setViewport({ width: 1600, height: 1000 });
  await p.goto(FILE, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sleep(500);

  await p.screenshot({ path: path.join(OUT, 'qa_dashboard.png') });

  await p.evaluate(() => { showWorkspace(); loadExample('ex6'); showWorkspace(); });
  await sleep(200);
  await p.click('#btnStep'); await sleep(200);
  await p.evaluate(async () => { await fastForward({}); goTo(120); });
  await sleep(300);
  await p.screenshot({ path: path.join(OUT, 'qa_workspace_beginner.png') });

  await p.evaluate(() => { setLevel('deep'); goTo(120); });
  await sleep(350);
  await p.screenshot({ path: path.join(OUT, 'qa_workspace_deep.png') });

  // memory focus + byte inspector
  await p.evaluate(() => {
    setLevel('intermediate');
    ui.selectedVar = 'str'; openPanel('panelMemory'); render();
    const c = document.querySelector('#varsPanel .arr-cell');
    if (c) c.click();
  });
  await sleep(300);
  await p.evaluate(() => { const m = document.querySelector('#panelMemory'); document.querySelector('#rightScroll').scrollTop = m.offsetTop - 40; });
  await sleep(250);
  await p.screenshot({ path: path.join(OUT, 'qa_memory.png') });

  // command palette
  await p.evaluate(() => openCmdk());
  await sleep(250);
  await p.screenshot({ path: path.join(OUT, 'qa_palette.png') });
  await p.evaluate(() => closeCmdk());

  // error state
  await p.evaluate(() => { loadExample('exBug2'); showWorkspace(); });
  await sleep(200);
  await p.click('#btnStep'); await sleep(200);
  await p.evaluate(async () => { await fastForward({}); });
  await sleep(350);
  await p.screenshot({ path: path.join(OUT, 'qa_error.png') });

  
  // Phase 4: Norminette Lab
  const { spawn } = require('child_process');
  await p.evaluate(() => { showWorkspace(); });
  const BAD_SRC = [
    '#include <stdio.h>',
    'int\tmain(void)',
    '{',
    '  int x;',
    '\tx = 1;',
    '\tfor (int i = 0; i < 3; i++) { printf("%d", i); }',
    '\treturn (0);',
    '}',
    '',
  ].join('\n');
  await p.evaluate((src) => { document.querySelector('#sourceEdit').value = src; switchToEditing(); }, BAD_SRC);
  await p.evaluate(() => runNorminette());
  await new Promise(r => setTimeout(r, 12000));
  await p.evaluate(() => { const el = document.querySelector('#dockBody .prob'); if (el) el.click(); });
  await new Promise(r => setTimeout(r, 600));
  await p.screenshot({ path: path.join(OUT, 'qa_norminette.png') });

  await b.close();
  console.log('screenshots written to ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
