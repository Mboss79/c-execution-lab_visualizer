'use strict';
/* ============================================================================
   C EXECUTION LAB — LOCAL VALIDATION BRIDGE

   The lab runs as a file:// page and therefore cannot start processes. This
   tiny local server is the ONLY component allowed to execute external tools.
   It exists so the lab can run the REAL norminette (and, in Phase 5, the real
   `cc`) instead of pretending to validate anything.

   Security posture (Phase 4 spec §16):
     - binds 127.0.0.1 only
     - a fixed allowlist of actions; no arbitrary command execution
     - execFile with an argument ARRAY — never a shell string
     - the filename reaches the shell as positional "$1", never interpolated
     - source is written to a private temp dir with a generated name
     - hard timeout + output cap; the child is killed on overrun
     - stdout, stderr and exit code are all captured and reported verbatim
   ========================================================================== */

const http = require('http');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLAB_PORT || 4242);
const HOST = '127.0.0.1';
const TIMEOUT_MS = 20000;
const COMPILE_TIMEOUT_MS = 30000;
const MAX_BUFFER = 4 * 1024 * 1024;
const MAX_SOURCE = 512 * 1024;
const PROTOCOL = 4;

// The Piscine profile. These three are fixed: the lab never offers a way to
// turn them off, because "it compiles without -Werror" is not the standard the
// student is graded against.
const CC_FLAGS = ['-Wall', '-Wextra', '-Werror'];

// Sweep workspaces left behind by a bridge that was killed hard (SIGKILL skips
// the exit handler). Only ever called AFTER we have successfully bound the
// port — otherwise a second instance that fails to start would delete the
// running bridge's workspace out from under it.
function sweepStaleWorkdirs(keep) {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!/^clab-bridge-/.test(name)) continue;
      const full = path.join(os.tmpdir(), name);
      if (full === keep) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); removed++; } catch (e) { /* in use */ }
    }
  } catch (e) {}
  return removed;
}

const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clab-bridge-'));
function cleanup() { try { fs.rmSync(WORKDIR, { recursive: true, force: true }); } catch (e) {} }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

/* --------------------------- helpers --------------------------- */

// Windows path -> WSL path. C:\a\b  ->  /mnt/c/a/b
function toWslPath(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}

// Only a bare .c/.h basename is ever accepted as a filename.
function safeBasename(name, fallback) {
  const base = String(name || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,64}\.(c|h)$/.test(base)) return fallback;
  if (base.includes('..')) return fallback;
  return base;
}

// wsl.exe emits UTF-16-ish NULs into pipes; strip them before anything parses.
const NUL = String.fromCharCode(0);
function stripNul(s) { return String(s || '').split(NUL).join(''); }

function run(file, args, opts) {
  return new Promise((resolve) => {
    const child = execFile(file, args, {
      timeout: (opts && opts.timeout) || TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      killSignal: 'SIGKILL',
    }, (err, stdout, stderr) => {
      const timedOut = !!(err && (err.killed || err.signal));
      resolve({
        ok: !err,
        timedOut,
        missing: !!(err && (err.code === 'ENOENT' || err.errno === -4058)),
        code: err && typeof err.code === 'number' ? err.code : (err ? (timedOut ? -1 : 1) : 0),
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? String(err.message) : null,
      });
    });
    child.on('error', () => {});
  });
}

// norminette lives on the user's PATH inside a WSL login shell, so we need
// `bash -lc`. The script text is a FIXED constant and the file arrives as $1,
// which keeps this free of shell injection.
function wslRun(script, argv, timeout) {
  return run('wsl.exe', ['-e', 'bash', '-lc', script, 'clab'].concat(argv), { timeout });
}

// norminette prints a locale banner before its JSON, so take the first {...}.
function extractJson(text) {
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(text.slice(i, j + 1)); } catch (e) { return null; }
}

/* --------------------------- actions --------------------------- */

const NORM_SCRIPT = 'exec norminette -f json --no-colors -- "$1"';
const NORM_VERSION_SCRIPT = 'exec norminette --version';

// cd into the workspace so the compiler reports a bare "main.c:5:9" rather than
// a long temp path. The script text is a constant; only "$1"/"$2" vary.
const CC_SCRIPT = 'cd "$(dirname "$1")" && exec cc -Wall -Wextra -Werror "$(basename "$1")" -o "$2"';
const CC_VERSION_SCRIPT = 'exec cc --version';

const TOOLS = {
  norminette: {
    versionScript: NORM_VERSION_SCRIPT,
    match: /norminette\s+([0-9][0-9.]*)/i,
    missingMsg: 'norminette is not installed in WSL.',
  },
  cc: {
    versionScript: CC_VERSION_SCRIPT,
    match: /\b([0-9]+\.[0-9]+\.[0-9]+)\b/,
    missingMsg: 'No C compiler (cc) is installed in WSL.',
  },
};

async function actionDetect(body) {
  const toolName = (body && body.tool) === 'cc' ? 'cc' : 'norminette';
  const spec = TOOLS[toolName];
  const v = await wslRun(spec.versionScript, [], 25000);
  if (v.missing) {
    return { status: 'NOT_AVAILABLE', reason: 'wsl.exe was not found on this machine.', detail: v.error };
  }
  const text = (v.stdout + '\n' + v.stderr).replace(/\u0000/g, '');
  const m = spec.match.exec(text);
  if (v.ok && m) {
    const banner = text.split('\n').map(s => s.trim()).filter(Boolean)
      .find(s => !/setting locale/i.test(s)) || '';
    return { status: 'AVAILABLE', tool: toolName, version: m[1], via: 'wsl',
             banner: banner.slice(0, 200), raw: text.trim().slice(0, 400) };
  }
  if (/command not found|No such file/i.test(text)) {
    return { status: 'NOT_AVAILABLE', tool: toolName, reason: spec.missingMsg, detail: text.trim().slice(0, 400) };
  }
  return { status: 'ERROR', tool: toolName, reason: 'Could not determine the ' + toolName + ' version.',
           detail: text.trim().slice(0, 400) };
}

async function actionNorminette(body) {
  const source = typeof body.source === 'string' ? body.source : '';
  if (source.length > MAX_SOURCE) {
    return { status: 'ERROR', reason: 'Source is too large to validate (limit ' + MAX_SOURCE + ' bytes).' };
  }
  const filename = safeBasename(body.filename, 'main.c');
  const dir = fs.mkdtempSync(path.join(WORKDIR, 'run-'));
  const winPath = path.join(dir, filename);
  fs.writeFileSync(winPath, source, 'utf8');

  const r = await wslRun(NORM_SCRIPT, [toWslPath(winPath)], TIMEOUT_MS);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}

  if (r.missing) return { status: 'NOT_AVAILABLE', reason: 'wsl.exe was not found on this machine.' };
  if (r.timedOut) return { status: 'ERROR', reason: 'norminette timed out after ' + (TIMEOUT_MS / 1000) + 's.', stderr: r.stderr };

  const clean = (r.stdout || '').replace(/\u0000/g, '');
  const parsed = extractJson(clean);
  if (!parsed) {
    const all = (clean + '\n' + r.stderr).trim();
    if (/command not found/i.test(all)) {
      return { status: 'NOT_AVAILABLE', reason: 'norminette is not installed in WSL.', detail: all.slice(0, 400) };
    }
    return { status: 'ERROR', reason: 'norminette produced output that could not be parsed as JSON.',
             exitCode: r.code, stdout: clean.slice(0, 2000), stderr: r.stderr.slice(0, 2000) };
  }
  return {
    status: 'OK',
    exitCode: r.code,
    filename,
    report: parsed,
    stderr: r.stderr.replace(/\u0000/g, '').trim().slice(0, 2000),
  };
}

// Real compilation. The source goes into a private temp workspace, cc runs
// there, and the whole workspace — including any produced binary — is removed
// afterwards. Nothing is ever written into the student's project.
async function actionCompile(body) {
  const source = typeof body.source === 'string' ? body.source : '';
  if (source.length > MAX_SOURCE) {
    return { status: 'ERROR', reason: 'Source is too large to compile (limit ' + MAX_SOURCE + ' bytes).' };
  }
  const filename = safeBasename(body.filename, 'main.c');
  const dir = fs.mkdtempSync(path.join(WORKDIR, 'cc-'));
  const winSrc = path.join(dir, filename);
  const outName = filename.replace(/\.[ch]$/, '') + '.out';
  const winOut = path.join(dir, outName);
  fs.writeFileSync(winSrc, source, 'utf8');

  const t0 = Date.now();
  const r = await wslRun(CC_SCRIPT, [toWslPath(winSrc), toWslPath(winOut)], COMPILE_TIMEOUT_MS);
  const ms = Date.now() - t0;

  let produced = false, artifacts = [];
  try { produced = fs.existsSync(winOut); artifacts = fs.readdirSync(dir); } catch (e) {}
  let cleaned = false;
  try { fs.rmSync(dir, { recursive: true, force: true }); cleaned = !fs.existsSync(dir); } catch (e) {}

  if (r.missing) return { status: 'NOT_AVAILABLE', reason: 'wsl.exe was not found on this machine.' };
  if (r.timedOut) {
    return { status: 'ERROR', kind: 'timeout', filename, cleaned, durationMs: ms,
             reason: 'Compilation timed out after ' + (COMPILE_TIMEOUT_MS / 1000) + 's and was killed.',
             stderr: stripNul(r.stderr).slice(0, 4000) };
  }
  const stderr = stripNul(r.stderr);
  const stdout = stripNul(r.stdout);
  if (/command not found/i.test(stderr)) {
    return { status: 'NOT_AVAILABLE', reason: TOOLS.cc.missingMsg, detail: stderr.slice(0, 400) };
  }
  return {
    status: 'OK',
    filename,
    exitCode: r.code,
    stdout: stdout.slice(0, 200000),
    stderr: stderr.slice(0, 200000),
    command: 'cc ' + CC_FLAGS.join(' ') + ' ' + filename + ' -o ' + outName,
    flags: CC_FLAGS,
    produced, artifacts, cleaned, durationMs: ms,
  };
}

/* ------------------------- test execution (Phase 6) -------------------------
   Compiles once with the Phase 5 command, then runs the produced executable
   once per test case with that case's stdin. The bridge only EXECUTES and
   reports; comparing output against expectations is the lab's job.

   Controlled local execution — not a security sandbox. See README. */

// $1 exe, $2 timeout seconds, $3 status file. Fixed text; only positionals vary.
// The wait status is written to a file because wsl.exe collapses 137/139 to
// 9/11, which a program could legitimately return.
const RUN_SCRIPT = 'timeout -k 1 "$2" "$1"; printf "%s" "$?" > "$3"';

const MAX_TESTS      = 60;
const MAX_STDIN      = 256 * 1024;
const MAX_CAPTURE    = 256 * 1024;
const MAX_CASE_MS    = 15000;
const DEFAULT_CASE_MS = 5000;
const TOTAL_RUN_MS   = 120000;

// Phase 7 traces need the program's cwd to BE the workspace, because the
// instrumented build writes its trace file relative to cwd. Phase 6 keeps the
// original script unchanged.
const RUN_IN_WORKDIR_SCRIPT = 'cd "$(dirname "$1")" && timeout -k 1 "$2" "$1"; printf "%s" "$?" > "$3"';

function runOneCase(exeWsl, statusWsl, statusWin, seconds, input, hardMs, script) {
  return new Promise((resolve) => {
    try { fs.unlinkSync(statusWin); } catch (e) {}
    const t0 = Date.now();
    let child;
    try {
      child = spawn('wsl.exe', ['-e', 'bash', '-lc', script || RUN_SCRIPT, 'clab', exeWsl, String(seconds), statusWsl],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ error: 'spawn failed: ' + e.message });
    }
    let so = '', se = '', truncated = false, hardKilled = false;
    const hard = setTimeout(() => { hardKilled = true; try { child.kill('SIGKILL'); } catch (e) {} }, hardMs);
    child.stdout.on('data', (d) => {
      if (so.length < MAX_CAPTURE) so += d; else truncated = true;
    });
    child.stderr.on('data', (d) => {
      if (se.length < MAX_CAPTURE) se += d; else truncated = true;
    });
    child.on('error', () => { clearTimeout(hard); resolve({ error: 'process error' }); });
    child.on('close', () => {
      clearTimeout(hard);
      let wait = null;
      try { wait = parseInt(fs.readFileSync(statusWin, 'utf8').trim(), 10); } catch (e) {}
      if (!Number.isFinite(wait)) wait = null;
      resolve({
        wait, hardKilled, truncated,
        durationMs: Date.now() - t0,
        stdout: stripNul(so).slice(0, MAX_CAPTURE),
        stderr: stripNul(se).slice(0, MAX_CAPTURE),
      });
    });
    try { if (input) child.stdin.write(input); } catch (e) {}
    try { child.stdin.end(); } catch (e) {}
  });
}

async function actionRunTests(body) {
  const source = typeof body.source === 'string' ? body.source : '';
  if (source.length > MAX_SOURCE) {
    return { status: 'ERROR', reason: 'Source is too large to build (limit ' + MAX_SOURCE + ' bytes).' };
  }
  let tests = Array.isArray(body.tests) ? body.tests : [];
  if (tests.length > MAX_TESTS) {
    return { status: 'ERROR', reason: 'Too many test cases (limit ' + MAX_TESTS + ').' };
  }
  for (const t of tests) {
    if (typeof t.stdin === 'string' && t.stdin.length > MAX_STDIN) {
      return { status: 'ERROR', reason: 'A test supplies more than ' + MAX_STDIN + ' bytes of stdin.' };
    }
  }

  const filename = safeBasename(body.filename, 'main.c');
  const dir = fs.mkdtempSync(path.join(WORKDIR, 'test-'));
  const winSrc = path.join(dir, filename);
  const outName = filename.replace(/\.[ch]$/, '') + '.out';
  const winOut = path.join(dir, outName);
  const winStatus = path.join(dir, 'status');
  fs.writeFileSync(winSrc, source, 'utf8');

  const finish = (payload) => {
    let artifacts = [];
    try { artifacts = fs.readdirSync(dir); } catch (e) {}
    let cleaned = false;
    try { fs.rmSync(dir, { recursive: true, force: true }); cleaned = !fs.existsSync(dir); } catch (e) {}
    return Object.assign({ artifactsBeforeCleanup: artifacts, cleaned, executableRemoved: !fs.existsSync(winOut) }, payload);
  };

  // 1. compile — identical command to Phase 5
  const c = await wslRun(CC_SCRIPT, [toWslPath(winSrc), toWslPath(winOut)], COMPILE_TIMEOUT_MS);
  if (c.missing) { finish({}); return { status: 'NOT_AVAILABLE', reason: 'wsl.exe was not found on this machine.' }; }
  const ccStderr = stripNul(c.stderr);
  if (/command not found/i.test(ccStderr)) { finish({}); return { status: 'NOT_AVAILABLE', reason: TOOLS.cc.missingMsg }; }
  const compiled = fs.existsSync(winOut);
  const compile = {
    exitCode: c.timedOut ? null : c.code,
    stdout: stripNul(c.stdout).slice(0, 200000),
    stderr: ccStderr.slice(0, 200000),
    command: 'cc ' + CC_FLAGS.join(' ') + ' ' + filename + ' -o ' + outName,
    flags: CC_FLAGS,
    produced: compiled,
    timedOut: !!c.timedOut,
  };
  if (!compiled || compile.exitCode !== 0) {
    return finish({ status: 'OK', compileFailed: true, filename, compile, results: [] });
  }

  // 2. run each case against the REAL executable
  const results = [];
  const deadline = Date.now() + TOTAL_RUN_MS;
  for (const t of tests) {
    if (Date.now() > deadline) {
      results.push({ id: t.id, skipped: true, reason: 'Total run budget exceeded.' });
      continue;
    }
    const ms = Math.min(Math.max(Number(t.timeoutMs) || DEFAULT_CASE_MS, 200), MAX_CASE_MS);
    const secs = Math.max(1, Math.ceil(ms / 1000));
    const r = await runOneCase(toWslPath(winOut), toWslPath(winStatus), winStatus,
                               secs, typeof t.stdin === 'string' ? t.stdin : '', ms + 8000);
    results.push(Object.assign({ id: t.id, timeoutMs: ms }, r));
  }
  return finish({ status: 'OK', filename, compile, results });
}

/* --------------------------- trace (Phase 7) ---------------------------
   Compiles the LEARNER'S OWN source first, so the compile gate is exactly the
   Phase 5 one. Only if that succeeds is the separately generated instrumented
   copy built and run; its trace file is read back and the workspace removed.
   The learner's source is never modified. */
const MAX_TRACE_BYTES = 8 * 1024 * 1024;

async function actionTrace(body) {
  const source = typeof body.source === 'string' ? body.source : '';
  const instrumented = typeof body.instrumented === 'string' ? body.instrumented : '';
  if (source.length > MAX_SOURCE || instrumented.length > MAX_SOURCE * 4) {
    return { status: 'ERROR', reason: 'Source is too large to trace (limit ' + MAX_SOURCE + ' bytes).' };
  }
  if (!instrumented) return { status: 'ERROR', reason: 'No instrumented source was supplied.' };
  const stdin = typeof body.stdin === 'string' ? body.stdin : '';
  if (stdin.length > MAX_STDIN) {
    return { status: 'ERROR', reason: 'stdin exceeds ' + MAX_STDIN + ' bytes.' };
  }
  const traceFile = safeBasename(body.traceFile, '__clab_trace.log') === body.traceFile
    ? body.traceFile : '__clab_trace.log';

  const filename = safeBasename(body.filename, 'main.c');
  const dir = fs.mkdtempSync(path.join(WORKDIR, 'trace-'));
  const winSrc  = path.join(dir, filename);
  const outName = filename.replace(/\.[ch]$/, '') + '.out';
  const winOut  = path.join(dir, outName);
  const instName = '__clab_instrumented.c';
  const winInst = path.join(dir, instName);
  const winInstOut = path.join(dir, '__clab_instrumented.out');
  const winStatus = path.join(dir, 'status');
  const winTrace = path.join(dir, traceFile);
  fs.writeFileSync(winSrc, source, 'utf8');

  const finish = (payload) => {
    let artifacts = [];
    try { artifacts = fs.readdirSync(dir); } catch (e) {}
    let cleaned = false;
    try { fs.rmSync(dir, { recursive: true, force: true }); cleaned = !fs.existsSync(dir); } catch (e) {}
    return Object.assign({
      artifactsBeforeCleanup: artifacts, cleaned,
      executableRemoved: !fs.existsSync(winOut) && !fs.existsSync(winInstOut),
    }, payload);
  };

  // 1. the learner's own source, with the unchanged Phase 5 command
  const c = await wslRun(CC_SCRIPT, [toWslPath(winSrc), toWslPath(winOut)], COMPILE_TIMEOUT_MS);
  if (c.missing) { finish({}); return { status: 'NOT_AVAILABLE', reason: 'wsl.exe was not found on this machine.' }; }
  const ccErr = stripNul(c.stderr);
  if (/command not found/i.test(ccErr)) { finish({}); return { status: 'NOT_AVAILABLE', reason: TOOLS.cc.missingMsg }; }
  const compile = {
    exitCode: c.timedOut ? null : c.code,
    stdout: stripNul(c.stdout).slice(0, 200000),
    stderr: ccErr.slice(0, 200000),
    command: 'cc ' + CC_FLAGS.join(' ') + ' ' + filename + ' -o ' + outName,
    flags: CC_FLAGS, produced: fs.existsSync(winOut), timedOut: !!c.timedOut,
  };
  if (!compile.produced || compile.exitCode !== 0) {
    return finish({ status: 'OK', compileFailed: true, filename, compile });
  }

  // 2. the generated instrumented copy
  fs.writeFileSync(winInst, instrumented, 'utf8');
  const ic = await wslRun(CC_SCRIPT, [toWslPath(winInst), toWslPath(winInstOut)], COMPILE_TIMEOUT_MS);
  const instErr = stripNul(ic.stderr);
  if (!fs.existsSync(winInstOut) || (!ic.timedOut && ic.code !== 0)) {
    return finish({
      status: 'OK', instrumentFailed: true, filename, compile,
      instrumentCompile: { exitCode: ic.timedOut ? null : ic.code, stderr: instErr.slice(0, 20000) },
    });
  }

  // 3. run the instrumented build under the Phase 6 execution contract
  const ms = Math.min(Math.max(Number(body.timeoutMs) || DEFAULT_CASE_MS, 200), MAX_CASE_MS);
  const secs = Math.max(1, Math.ceil(ms / 1000));
  const r = await runOneCase(toWslPath(winInstOut), toWslPath(winStatus), winStatus,
                             secs, stdin, ms + 8000, RUN_IN_WORKDIR_SCRIPT);

  let trace = '', traceBytes = 0;
  try {
    const st = fs.statSync(winTrace);
    traceBytes = st.size;
    trace = fs.readFileSync(winTrace, 'utf8').slice(0, MAX_TRACE_BYTES);
  } catch (e) {}

  return finish({
    status: 'OK', filename, compile,
    run: {
      wait: r ? r.wait : null,
      stdout: r ? r.stdout : '', stderr: r ? r.stderr : '',
      durationMs: r ? r.durationMs : null,
      hardKilled: r ? !!r.hardKilled : false,
      truncated: r ? !!r.truncated : false,
      timeoutMs: ms,
    },
    trace, traceBytes, traceTruncated: traceBytes > MAX_TRACE_BYTES,
  });
}

const ACTIONS = {
  '/health':     async () => ({ status: 'OK', bridge: 'c-execution-lab', protocol: PROTOCOL,
                                pid: process.pid, tools: Object.keys(TOOLS) }),
  '/detect':     actionDetect,
  '/norminette': actionNorminette,
  '/compile':    actionCompile,
  '/runtests':   actionRunTests,
  '/trace':      actionTrace,
};

/* --------------------------- server --------------------------- */

const server = http.createServer((req, res) => {
  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send(204, {});

  const url = (req.url || '').split('?')[0];
  const action = ACTIONS[url];
  if (!action) return send(404, { status: 'ERROR', reason: 'Unknown action ' + url });

  let raw = '';
  let tooBig = false;
  req.on('data', (c) => {
    raw += c;
    if (raw.length > MAX_SOURCE + 4096) { tooBig = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (tooBig) return send(413, { status: 'ERROR', reason: 'Request too large.' });
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch (e) { return send(400, { status: 'ERROR', reason: 'Malformed JSON body.' }); } }
    try {
      send(200, await action(body));
    } catch (e) {
      send(500, { status: 'ERROR', reason: 'Bridge failure: ' + (e && e.message) });
    }
  });
});

server.listen(PORT, HOST, () => {
  const SWEPT = sweepStaleWorkdirs(WORKDIR);
  console.log('C Execution Lab validation bridge');
  console.log('  listening on http://' + HOST + ':' + PORT);
  console.log('  workdir     ' + WORKDIR + (SWEPT ? '  (swept ' + SWEPT + ' stale)' : ''));
  console.log('  actions     ' + Object.keys(ACTIONS).join(', '));
  console.log('');
  console.log('Leave this running, then use Validate > Run Norminette in the lab.');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('Port ' + PORT + ' is already in use — a bridge may already be running.');
  else console.error(e);
  process.exit(1);
});
