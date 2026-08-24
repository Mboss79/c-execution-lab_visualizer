'use strict';
/* Loads the engine and the example set OUT OF THE SHIPPED index.html.
   Tests therefore always run against the real artifact - there is no second
   copy of the engine that can silently drift from what the page executes. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.resolve(__dirname, '..', 'index.html');

function extract(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark);
  if (a < 0 || b < 0) throw new Error('Could not find ' + what + ' in index.html (markers missing).');
  return src.slice(a + startMark.length, b);
}

function load() {
  const html = fs.readFileSync(HTML, 'utf8');

  const engineSrc = extract(html, '/* ==== ENGINE START ==== */', '/* ==== ENGINE END ==== */', 'the engine');
  // EXAMPLES sits between the opening <script> and the engine marker.
  const scriptStart = html.indexOf('<script>');
  const engineStart = html.indexOf('/* ==== ENGINE START ==== */');
  const examplesSrc = html.slice(scriptStart + '<script>'.length, engineStart);

  const sandbox = { module: { exports: {} }, console };
  sandbox.window = undefined;
  vm.createContext(sandbox);
  vm.runInContext(examplesSrc + '\n' + engineSrc +
    '\n;module.exports.EXAMPLES = EXAMPLES; module.exports.EXAMPLE_ORDER = EXAMPLE_ORDER;',
    sandbox, { filename: 'index.html:engine' });

  const E = sandbox.module.exports;
  if (!E.runToCompletion) throw new Error('Engine loaded but runToCompletion is missing.');
  return E;
}

module.exports = { load, HTML };
