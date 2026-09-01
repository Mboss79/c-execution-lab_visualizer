'use strict';
/* Phase 43 — practice modes that behave differently, and the code editor.
 *
 * The mode checks compare modes AGAINST EACH OTHER. Asserting that "blind has
 * no hints" alone would pass if every mode had no hints; asserting that guided
 * has them and blind does not, from the same rendered page, cannot.
 *
 * The editor checks press real keys through the browser rather than calling the
 * handler, because the thing being fixed is that the browser was moving focus.
 */
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, inspected = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
  else { fail++; console.log('  FAIL [' + (pass + fail) + '] ' + name + (detail ? '  -- ' + detail : '')); }
}
function counted(name, n, floor, detail) {
  inspected += n;
  check(name + ' (' + n + ' inspected)', n >= floor,
        n < floor ? 'VACUOUS: expected at least ' + floor : (detail || ''));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--allow-file-access-from-files', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|4242/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await sleep(1400);
  await page.click('#railExam');
  await sleep(400);

  console.log('\n=== part 1: the modes differ as configuration ===');
  const cfg = await page.evaluate(() => {
    const ids = Object.keys(MODE_CONFIG);
    const fields = ['hints','showPattern','showEdges','showDiff','chrome','prefer','pick'];
    let compared = 0;
    const identical = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      compared++;
      const a = MODE_CONFIG[ids[i]], b = MODE_CONFIG[ids[j]];
      const diff = fields.filter(f => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
      if (!diff.length) identical.push(ids[i] + '=' + ids[j]);
    }
    return { ids, compared, identical,
      bands: ids.map(i => i + ':' + (MODE_CONFIG[i].bands ? MODE_CONFIG[i].bands.join('') : 'all')),
      blurbs: ids.filter(i => (MODE_CONFIG[i].blurb || '').length > 40).length };
  });
  check('[1] all five modes exist', cfg.ids.length === 5, cfg.ids.join(','));
  counted('[2] mode pairs compared field by field', cfg.compared, 10);
  check('[3] no two modes are configured identically', cfg.identical.length === 0, cfg.identical.join(' '));
  check('[4] every mode explains itself', cfg.blurbs === 5, cfg.blurbs + '/5');
  check('[5] the difficulty pools differ per mode', new Set(cfg.bands.map(b => b.split(':')[1])).size >= 3,
    cfg.bands.join(' '));

  console.log('\n=== part 2: modes change what the page shows ===');
  /* Same exercise, five modes, rendered five times: the DOM must differ. */
  const rendered = await page.evaluate(() => {
    const x = EXAM_EXERCISES.find(q => q.edge_cases && q.edge_cases.length &&
      q.track === 'C00-C08' && q.studied_status === 'STUDIED');
    const out = {};
    for (const m of Object.keys(MODE_CONFIG)) {
      xs.mode = m; xs.ex = x.id; xs.hints = 0; xs.attempted = false; xs.showSolution = false;
      xs.result = null; xs.sim = null; renderExam();
      const root = document.querySelector('#examRoot');
      out[m] = {
        hintBtn: !!root.querySelector('[data-xact="hint"]'),
        hintBox: !!root.querySelector('.x-hints'),
        noHintNote: !!root.querySelector('.x-nohints'),
        edges: !!root.querySelector('.x-edges'),
        diff: !!root.querySelector('.x-diff'),
        srct: !!root.querySelector('.x-srct'),
        nextBtn: !!root.querySelector('[data-xact="nextmode"]'),
        chrome: root.querySelector('.x-main').className,
        tag: (root.querySelector('.x-modetag') || {}).textContent,
        chars: root.querySelector('.x-main').textContent.length,
      };
    }
    return { out, id: x.id };
  });
  const R = rendered.out;
  inspected += 5 * 9;
  check('[6] guided offers the hint ladder', R.guided.hintBtn && R.guided.hintBox);
  check('[7] blind offers no hint button and says why',
    !R.blind.hintBtn && !R.blind.hintBox && R.blind.noHintNote);
  check('[8] guided shows the edge-case list, blind does not',
    R.guided.edges && !R.blind.edges, 'guided=' + R.guided.edges + ' blind=' + R.blind.edges);
  check('[9] guided names the source type, challenge and validation do not',
    R.guided.srct && !R.challenge.srct && !R.validation.srct);
  check('[10] challenge and validation hide the difficulty axes, guided shows them',
    R.guided.diff && !R.challenge.diff && !R.validation.diff);
  check('[11] the three picking modes offer a next-exercise button, the other two do not',
    R.challenge.nextBtn && R.drill.nextBtn && R.validation.nextBtn &&
    !R.guided.nextBtn && !R.blind.nextBtn);
  check('[12] each mode names itself on the page',
    /Guided/.test(R.guided.tag) && /Validation/.test(R.validation.tag));
  const chromes = new Set(Object.values(R).map(r => r.chrome));
  check('[13] presentation differs between modes', chromes.size >= 4, [...chromes].join(' | '));
  const shapeOf = (r) => [r.hintBtn, r.hintBox, r.edges, r.diff, r.srct, r.nextBtn].join();
  const shapes = new Set(Object.values(R).map(shapeOf));
  check('[14] the five modes produce four distinct visibility shapes',
    shapes.size === 4, shapes.size + ' distinct');
  /* Challenge and Validation are the pair that coincide on visibility. They must
     still differ where the spec requires: presentation, and the difficulty pool. */
  const coincide = shapeOf(R.challenge) === shapeOf(R.validation);
  const elsewhere = await page.evaluate(() => ({
    bands: (MODE_CONFIG.challenge.bands || []).join('') !== (MODE_CONFIG.validation.bands || []).join(''),
    prefer: MODE_CONFIG.challenge.prefer !== MODE_CONFIG.validation.prefer,
  }));
  check('[14b] the pair sharing a visibility shape still differs in presentation and pool',
    coincide && R.challenge.chrome !== R.validation.chrome && elsewhere.bands && elsewhere.prefer,
    R.challenge.chrome + ' vs ' + R.validation.chrome);

  console.log('\n=== part 3: modes change what gets SELECTED ===');
  const sel = await page.evaluate(() => {
    const runs = {};
    for (const m of ['challenge', 'drill', 'validation']) {
      const picks = [];
      for (let i = 0; i < 25; i++) {
        xs.recent = [];
        const p = xPickForMode(m);
        if (p) picks.push(p);
      }
      runs[m] = {
        n: picks.length,
        bands: [...new Set(picks.map(p => p.band))].sort().join(''),
        allTrackA: picks.every(p => p.track === 'C00-C08'),
        allStudied: picks.every(p => p.studied_status === 'STUDIED'),
        avgComb: Math.round(picks.reduce((s, p) => s + p.difficulty.combination, 0) / picks.length * 100) / 100,
      };
    }
    /* recency: a just-seen exercise must not come straight back */
    const first = xPickForMode('challenge');
    xs.recent = [first.id];
    let repeats = 0;
    for (let i = 0; i < 30; i++) if (xPickForMode('challenge').id === first.id) repeats++;
    xs.recent = [];
    return { runs, repeats };
  });
  counted('[15] selections drawn per mode', sel.runs.challenge.n + sel.runs.drill.n + sel.runs.validation.n, 60);
  check('[16] drill draws only from the short bands', /^A?B?$/.test(sel.runs.drill.bands), sel.runs.drill.bands);
  check('[17] validation draws only from the hard bands', /^D?E?$/.test(sel.runs.validation.bands),
    sel.runs.validation.bands);
  check('[18] validation is genuinely harder than drill',
    sel.runs.validation.avgComb > sel.runs.drill.avgComb,
    'validation ' + sel.runs.validation.avgComb + ' vs drill ' + sel.runs.drill.avgComb);
  check('[19] challenge spans more than one band', sel.runs.challenge.bands.length >= 2, sel.runs.challenge.bands);
  check('[20] no mode ever selects something gated or off-track',
    ['challenge','drill','validation'].every(m => sel.runs[m].allTrackA && sel.runs[m].allStudied));
  check('[21] a recently seen exercise is not immediately repeated', sel.repeats === 0,
    sel.repeats + ' repeats in 30 draws');

  /* drill must follow the weak skill — a mutation test on real stored data */
  const drill = await page.evaluate(() => {
    localStorage.removeItem('cexlab.progress.v1');
    examProgress.data = null;
    const target = EXAM_EXERCISES.filter(x => x.skills.indexOf('NUMBER_CONSTRUCTION') >= 0 &&
      x.track === 'C00-C08' && x.studied_status === 'STUDIED');
    for (const x of target.slice(0, 3)) { examProgress.record(x, 'fail'); examProgress.record(x, 'fail'); }
    const weak = examWeakSkills().map(s => s.id);
    let hits = 0, n = 0;
    for (let i = 0; i < 20; i++) {
      xs.recent = [];
      const p = xPickForMode('drill');
      if (!p) continue;
      n++;
      if (p.skills.indexOf('NUMBER_CONSTRUCTION') >= 0) hits++;
    }
    localStorage.removeItem('cexlab.progress.v1'); examProgress.data = null;
    return { weak: weak.slice(0, 3), hits, n };
  });
  counted('[22] drill draws taken with a planted weakness', drill.n, 15);
  check('[23] drill targets the skill the learner is actually weakest at',
    drill.weak.indexOf('NUMBER_CONSTRUCTION') >= 0 && drill.hits === drill.n,
    drill.hits + '/' + drill.n + ' hit the weak skill; weak=' + drill.weak.join(','));

  /* entering a picking mode opens something; entering guided does not hijack */
  const enter = await page.evaluate(() => {
    xs.ex = null; xs.mode = 'guided'; xs.sim = null; renderExam();
    xEnterMode('challenge');
    const afterChallenge = xs.ex;
    xs.ex = null;
    xEnterMode('guided');
    const afterGuided = xs.ex;
    return { afterChallenge: !!afterChallenge, afterGuided: !!afterGuided };
  });
  check('[24] entering challenge opens an exercise immediately', enter.afterChallenge);
  check('[25] entering guided does not force one on you', !enter.afterGuided);

  console.log('\n=== part 4: Tab, by real key presses ===');
  await page.evaluate(() => {
    xs.mode = 'guided'; xs.sim = null;
    xs.ex = EXAM_EXERCISES.find(x => x.track === 'C00-C08' && x.studied_status === 'STUDIED').id;
    xs.src = {}; renderExam();
    const ta = document.querySelector('#xEditor');
    ta.value = 'int\tmain(void)\n{\nreturn (0);\n}\n';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.indexOf('return');
  });
  await page.keyboard.press('Tab');
  await sleep(120);
  const tab1 = await page.evaluate(() => ({
    v: document.querySelector('#xEditor').value,
    focused: document.activeElement === document.querySelector('#xEditor'),
    caret: document.querySelector('#xEditor').selectionStart,
  }));
  check('[26] Tab inserts an indent instead of moving focus',
    tab1.v.indexOf('\n\treturn (0);') >= 0 && tab1.focused,
    JSON.stringify(tab1.v.slice(0, 34)) + ' focused=' + tab1.focused);
  check('[27] the caret advances past the inserted indent', tab1.caret === tab1.v.indexOf('return'),
    'caret=' + tab1.caret);

  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await sleep(120);
  const tab2 = await page.evaluate(() => ({
    v: document.querySelector('#xEditor').value,
    focused: document.activeElement === document.querySelector('#xEditor'),
  }));
  check('[28] Shift+Tab removes the indent again',
    tab2.v.indexOf('\nreturn (0);') >= 0 && tab2.focused, JSON.stringify(tab2.v.slice(0, 34)));

  /* multi-line selection indents every line */
  await page.evaluate(() => {
    const ta = document.querySelector('#xEditor');
    ta.value = 'a;\nb;\nc;\n';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    ta.selectionStart = 0; ta.selectionEnd = ta.value.indexOf('c;') + 2;
  });
  await page.keyboard.press('Tab');
  await sleep(120);
  const block = await page.evaluate(() => document.querySelector('#xEditor').value);
  check('[29] Tab over a selection indents every line in it',
    block === '\ta;\n\tb;\n\tc;\n', JSON.stringify(block));
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await sleep(120);
  const unblock = await page.evaluate(() => document.querySelector('#xEditor').value);
  check('[30] Shift+Tab over a selection dedents every line', unblock === 'a;\nb;\nc;\n', JSON.stringify(unblock));

  /* Enter keeps indentation, and adds one level after a brace */
  await page.evaluate(() => {
    const ta = document.querySelector('#xEditor');
    ta.value = '\t\tint\ti;';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length;
  });
  await page.keyboard.press('Enter');
  await sleep(120);
  const ent = await page.evaluate(() => document.querySelector('#xEditor').value);
  check('[31] Enter carries the current indentation onto the new line',
    ent === '\t\tint\ti;\n\t\t', JSON.stringify(ent));
  await page.evaluate(() => {
    const ta = document.querySelector('#xEditor');
    ta.value = '\tif (x)\n\t{';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length;
  });
  await page.keyboard.press('Enter');
  await sleep(120);
  const ent2 = await page.evaluate(() => document.querySelector('#xEditor').value);
  check('[32] an opening brace adds one more level', ent2 === '\tif (x)\n\t{\n\t\t', JSON.stringify(ent2));

  /* Tab outside the editor must still move focus */
  const outside = await page.evaluate(() => {
    const b = document.querySelector('#examRoot .x-navb');
    b.focus();
    return document.activeElement === b;
  });
  await page.keyboard.press('Tab');
  await sleep(100);
  const moved = await page.evaluate(() => document.activeElement.className || document.activeElement.tagName);
  check('[33] Tab outside the editor still moves focus normally', outside && !/x-editor/.test(moved), moved);

  console.log('\n=== part 5: the highlight layer ===');
  const hl = await page.evaluate(() => {
    const SRC = '/* c */\n#include <unistd.h>\nint\tmain(int argc, char **argv)\n{\n' +
      '\tint\ti;\n\n\ti = 0;\n\twrite(1, "ab", 2);\n\treturn (0);   // done\n}\n';
    const ta = document.querySelector('#xEditor');
    ta.value = SRC;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const code = document.querySelector('#xEditor_hl');
    const html = code.innerHTML;
    const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
    const cls = (c) => code.querySelectorAll('.xh-' + c).length;
    const csTa = getComputedStyle(ta), csPre = getComputedStyle(code.parentNode);
    return {
      roundTrip: strip(html) === SRC + '\n',
      k: cls('k'), t: cls('t'), f: cls('f'), s: cls('s'), n: cls('n'), c: cls('c'), p: cls('p'), o: cls('o'),
      tabTa: csTa.tabSize, tabPre: csPre.tabSize,
      fontTa: csTa.fontFamily + '/' + csTa.fontSize + '/' + csTa.lineHeight,
      fontPre: csPre.fontFamily + '/' + csPre.fontSize + '/' + csPre.lineHeight,
      padTa: csTa.padding, padPre: csPre.padding,
      wsTa: csTa.whiteSpace, wsPre: csPre.whiteSpace,
      taColour: csTa.color, caret: csTa.caretColor,
      valueUnchanged: ta.value === SRC,
    };
  });
  const tokenCount = hl.k + hl.t + hl.f + hl.s + hl.n + hl.c + hl.p + hl.o;
  counted('[34] tokens highlighted', tokenCount, 20);
  check('[35] every token class the spec asked for is produced',
    hl.k > 0 && hl.t > 0 && hl.f > 0 && hl.s > 0 && hl.n > 0 && hl.c > 0 && hl.p > 0 && hl.o > 0,
    JSON.stringify({ kw: hl.k, ty: hl.t, fn: hl.f, str: hl.s, num: hl.n, com: hl.c, pre: hl.p, op: hl.o }));
  check('[36] the highlight layer reproduces the text exactly, character for character', hl.roundTrip);
  check('[37] highlighting does not touch the value', hl.valueUnchanged);
  check('[38] both layers agree on tab-size — the Phase 12a caret bug',
    hl.tabTa === hl.tabPre && hl.tabTa !== '8px' && hl.tabTa !== '8',
    'textarea=' + hl.tabTa + ' pre=' + hl.tabPre);
  check('[39] both layers agree on font, size and line-height', hl.fontTa === hl.fontPre,
    hl.fontTa + '  vs  ' + hl.fontPre);
  check('[40] both layers agree on padding and wrapping',
    hl.padTa === hl.padPre && hl.wsTa === hl.wsPre, hl.padTa + '/' + hl.wsTa);
  check('[41] the textarea text is transparent with a visible caret',
    /rgba\(0, 0, 0, 0\)|transparent/.test(hl.taColour) && !/rgba\(0, 0, 0, 0\)/.test(hl.caret),
    'color=' + hl.taColour + ' caret=' + hl.caret);

  /* it must update as you type, and on paste */
  const live = await page.evaluate(async () => {
    const ta = document.querySelector('#xEditor');
    ta.value = 'int'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    const a = document.querySelector('#xEditor_hl').innerHTML;
    ta.value = 'int x = 42;'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    const b = document.querySelector('#xEditor_hl').innerHTML;
    /* a paste arrives as an input event too */
    ta.value = 'char\t*s = "pasted";'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    const c = document.querySelector('#xEditor_hl');
    return { changed: a !== b, numberAfterTyping: /xh-n/.test(b),
      pastedString: c.querySelectorAll('.xh-s').length === 1 };
  });
  check('[42] the highlight updates as you type', live.changed && live.numberAfterTyping);
  check('[43] pasted code is highlighted', live.pastedString);

  /* scrolling stays in step */
  const scroll = await page.evaluate(() => {
    const ta = document.querySelector('#xEditor');
    ta.value = new Array(200).fill('\tint\ti;').join('\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.scrollTop = 420;
    ta.dispatchEvent(new Event('scroll'));
    const pre = document.querySelector('#xEditor_hl').parentNode;
    return { ta: ta.scrollTop, pre: pre.scrollTop };
  });
  check('[44] the highlight scrolls with the textarea', scroll.ta === scroll.pre,
    'textarea=' + scroll.ta + ' pre=' + scroll.pre);

  console.log('\n=== part 6: the code that runs is the code that was typed ===');
  const fidelity = await page.evaluate(() => {
    const SRC = 'int\tmain(void)\n{\n\t/* a comment with "quotes" and a \\\\ */\n\twrite(1, "a\\tb", 3);\n\treturn (0);\n}\n';
    const ta = document.querySelector('#xEditor');
    ta.value = SRC;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const read = xCodeOf('xEditor');
    const r = examExecute(read, []);
    return { same: read === SRC, len: read.length, kind: r.kind, out: r.stdout };
  });
  check('[45] the accessor returns exactly what was typed, byte for byte', fidelity.same,
    fidelity.len + ' chars');
  check('[46] and the engine runs that text', fidelity.kind === 'ok' && fidelity.out === 'a\tb',
    fidelity.kind + ' ' + JSON.stringify(fidelity.out));

  /* MUTATION: if the highlight layer were ever read instead of the textarea,
     this would catch it, because the two differ by markup. */
  const notLayer = await page.evaluate(() => {
    const ta = document.querySelector('#xEditor');
    ta.value = 'int\tmain(void)\n{\n\treturn (0);\n}\n';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const layer = document.querySelector('#xEditor_hl').innerHTML;
    return { layerHasMarkup: /<span/.test(layer), codeHasMarkup: /<span/.test(xCodeOf('xEditor')) };
  });
  check('[47] the value carries no markup from the highlight layer',
    notLayer.layerHasMarkup && !notLayer.codeHasMarkup);

  console.log('\n=== part 7: nothing else broke ===');
  const intact = await page.evaluate(() => {
    const out = {};
    xs.mode = 'guided'; xs.sim = null;
    const x = EXAM_EXERCISES.find(q => q.reference_solution && q.io.cases.length);
    xs.ex = x.id; xs.src = {}; renderExam();
    const ta = document.querySelector('#xEditor');
    ta.value = x.reference_solution;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#examRoot [data-xact="check"]').click();
    out.check = xs.result && xs.result.verdict;
    out.persisted = xs.src[x.id] === x.reference_solution;
    document.querySelector('#examRoot [data-xact="reset"]').click();
    out.reset = xs.src[x.id] === undefined;
    out.fnEditor = (function () { xs.page = 'functions'; xs.sub = 'implement'; xs.ex = null; renderExam();
      return !!document.querySelector('#xFnEditor') && !!document.querySelector('#xFnEditor_hl'); })();
    return out;
  });
  check('[48] run/check still works through the layered editor', intact.check === 'pass', intact.check);
  check('[49] the editor buffer is still persisted per exercise', intact.persisted);
  check('[50] reset still clears it', intact.reset);
  check('[51] the function-trainer editor is layered too', intact.fnEditor);

  check('[52] no page or console errors across the whole phase',
    errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + '-'.repeat(64));
  console.log('TOTAL ITEMS INSPECTED: ' + inspected);
  console.log('PHASE 43  pass ' + pass + '  fail ' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
