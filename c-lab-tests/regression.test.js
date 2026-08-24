'use strict';
// Regression + Foundation Gate suite. Runs against engine2 (the new engine).
// Baseline expectations come from the ORIGINAL engine's measured behaviour.
const { load } = require('./load-engine.js');
const E = load();
const OLD = E;  // example sources also come from the shipped file

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; return true; }
  fail++; failures.push({ name, detail });
  return false;
}
function run(src, opts) { return E.runToCompletion(src, opts); }

// The FINAL step is after main's frame is destroyed - that is correct engine
// behaviour, so these helpers find the last step where the object is still live.
function stateWithVar(r, name) {
  for (let i = r.history.length - 1; i >= 0; i--) {
    const st = r.history.stateAt(i);
    if (!st) continue;
    if (st.vars.some(v => v.name === name) || st.globals.some(v => v.name === name)) return st;
  }
  return null;
}
function findVar(r, name) {
  const st = stateWithVar(r, name);
  if (!st) return null;
  return st.vars.find(v => v.name === name) || st.globals.find(v => v.name === name) || null;
}
function findObj(r, varName) {
  const st = stateWithVar(r, varName);
  if (!st) return null;
  return st.objects.find(o => o.varName === varName) || null;
}

/* ===================== PART 0: SHIPPED ARTIFACT INTEGRITY =====================
   A `perl -pi` edit containing a wide character once re-encoded the whole shell
   and turned every toolbar glyph into mojibake. Cheap to check, easy to miss. */
console.log('=== PART 0: artifact integrity ===');
{
  const fs = require('fs');
  const { HTML } = require('./load-engine.js');
  const buf = fs.readFileSync(HTML);
  const text = buf.toString('utf8');
  const moji = (text.match(/Ã[-¿]|Â[-¿]|â€/g) || []).length;
  const roundTrips = Buffer.from(text, 'utf8').equals(buf);
  const glyphs = ['⏮', '◀', '▶', '↻', '⏭', '☰', '✓', '▦', '⚠'];
  const missing = glyphs.filter(g => !text.includes(g));
  check('0/shipped file is valid UTF-8', roundTrips, 'byte round-trip');
  check('0/no double-encoded (mojibake) sequences', moji === 0, moji + ' suspicious sequences');
  check('0/UI glyphs intact', missing.length === 0, missing.length ? 'missing ' + missing.join(' ') : glyphs.join(' '));
  console.log((moji === 0 && roundTrips && !missing.length ? '  PASS ' : '  FAIL ') +
              'artifact integrity  -- utf8=' + roundTrips + ' mojibake=' + moji + ' missingGlyphs=' + missing.length);
}

/* ===================== PART A: THE 13 BASELINE EXAMPLES ===================== */
// Expectations recorded from the original engine before any changes.
const BASELINE = {
  ex6:  { ok:true,  output:'Salut, Comment Tu Vas 42mots Quarante-Deux\n' },
  ex8:  { ok:true,  output:'' },
  ex10: { ok:true,  output:'' },
  ex9:  { ok:true,  output:'Hi\n' },
  ex11: { ok:true,  output:'', input:'Bonjour 42' },
  ex1:  { ok:true,  output:'' },
  ex2:  { ok:true,  output:'' },
  ex3:  { ok:true,  output:'' },
  ex4:  { ok:true,  output:'' },
  ex5:  { ok:true,  output:'' },
  ex7:  { ok:true,  output:'' },
  exBug1:{ ok:false, kind:'out-of-bounds' },
  exBug2:{ ok:false, kind:'use-after-free' },
};

console.log('=== PART A: regression of the 13 original examples ===');
for (const key of OLD.EXAMPLE_ORDER) {
  const ex = OLD.EXAMPLES[key];
  const exp = BASELINE[key];
  const opts = ex.needsInput ? { inputString: ex.defaultInput } : {};
  const r = run(ex.src, opts);
  let ok = true, why = [];
  if (r.ok !== exp.ok) { ok = false; why.push('ok ' + r.ok + ' expected ' + exp.ok + (r.message ? ' :: ' + r.message : '')); }
  if (exp.ok && r.output !== exp.output) { ok = false; why.push('output ' + JSON.stringify(r.output) + ' expected ' + JSON.stringify(exp.output)); }
  if (!exp.ok && r.kind !== exp.kind) { ok = false; why.push('trap kind ' + r.kind + ' expected ' + exp.kind + ' :: ' + r.message); }
  check('A/' + key, ok, why.join(' | '));
  console.log((ok ? '  PASS ' : '  FAIL ') + key.padEnd(8) + ' steps=' + String(r.steps).padStart(4) +
              '  ' + (ok ? (exp.ok ? JSON.stringify(r.output) : r.kind) : why.join(' | ')));
}

/* ===================== PART B: FOUNDATION GATE ===================== */
console.log('\n=== PART B: foundation gate ===');
function gate(name, fn) {
  let ok = false, detail = '';
  try { const res = fn(); ok = res === true || (res && res.ok === true); detail = (res && res.detail) || ''; }
  catch (e) { ok = false; detail = 'threw: ' + e.message; }
  check('B/' + name, ok, detail);
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  -- ' + detail : ''));
}

// 1. UNIFIED EVALUATION
gate('unified: printf("%d", f(3)) executes f', () => {
  const r = run('int f(int n){return(n+1);}\nint main(void){printf("%d\\n", f(3));return(0);}');
  return { ok: r.ok && r.output === '4\n', detail: 'output=' + JSON.stringify(r.output) + ' err=' + (r.message||'') };
});
gate('unified: printf("%d", i++) side effect happens exactly once', () => {
  const r = run('int main(void){int i;i=0;printf("%d\\n", i++);printf("%d\\n", i);return(0);}');
  return { ok: r.ok && r.output === '0\n1\n', detail: 'output=' + JSON.stringify(r.output) + ' err=' + (r.message||'') };
});
gate('unified: nested calls inside builtin args', () => {
  const r = run('int f(int n){return(n*2);}\nint main(void){printf("%d\\n", f(f(3)));return(0);}');
  return { ok: r.ok && r.output === '12\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('unified: no synchronous evalExpr export exists', () =>
  ({ ok: E.evalExpr === undefined, detail: 'evalExpr=' + typeof E.evalExpr }));

// 2. TYPE / SIZE MODEL
gate('sizeof: char1 short2 int4 long8 ptr8', () => {
  const r = run('int main(void){printf("%d %d %d %d %d\\n", sizeof(char), sizeof(short), sizeof(int), sizeof(long), sizeof(int *));return(0);}');
  return { ok: r.output === '1 2 4 8 8\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('int occupies 4 real bytes at consecutive addresses', () => {
  const r = run('int main(void){int x;x=258;return(0);}');
  const o = findObj(r, 'x');
  if (!o) return { ok:false, detail:'no object for x' };
  const bytes = o.bytes.map(b => b.value);
  return { ok: o.size === 4 && bytes.length === 4 && bytes[0] === 2 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0,
           detail: 'size=' + o.size + ' bytes=[' + bytes.join(',') + '] (little-endian 258 = 02 01 00 00)' };
});
gate('array of int is stride 4, not stride 1', () => {
  const r = run('int main(void){int a[3];a[0]=1;a[1]=2;a[2]=3;return(0);}');
  const v = findVar(r, 'a');
  const addrs = v.elements.map(e => e.address);
  return { ok: v.size === 12 && addrs[1] - addrs[0] === 4 && addrs[2] - addrs[1] === 4,
           detail: 'size=' + v.size + ' addrs=' + addrs.map(a=>'0x'+a.toString(16)).join(',') };
});
gate('alignment: char then int -> int is 4-byte aligned', () => {
  const r = run('int main(void){char c;int x;c=65;x=1;return(0);}');
  const x = findVar(r, 'x');
  return { ok: x.address % 4 === 0, detail: 'x @ 0x' + x.address.toString(16) + ' align=' + x.align };
});

// 3. POINTER SCALING
gate('int* p+1 advances sizeof(int)=4', () => {
  const r = run('int main(void){int a[3];int *p;a[0]=1;p=a;p=p+1;return(0);}');
  const a = findVar(r, 'a'), p = findVar(r, 'p');
  return { ok: Number(p.value) - a.address === 4, detail: 'a=0x'+a.address.toString(16)+' p=0x'+Number(p.value).toString(16)+' delta='+(Number(p.value)-a.address) };
});
gate('char* p+1 advances 1', () => {
  const r = run('int main(void){char a[3];char *p;a[0]=65;p=a;p=p+1;return(0);}');
  const a = findVar(r, 'a'), p = findVar(r, 'p');
  return { ok: Number(p.value) - a.address === 1, detail: 'delta=' + (Number(p.value) - a.address) };
});
gate('pointer arithmetic exposes its calculation to the UI', () => {
  const r = run('int main(void){int a[3];int *p;a[0]=1;p=a;p=p+1;return(0);}');
  const step = r.history.steps.find(s => s.detail && s.detail.pointerMath);
  return { ok: !!step && step.detail.pointerMath.elemSize === 4 && /sizeof\(int\)=4/.test(step.detail.pointerMath.calculation),
           detail: step ? step.detail.pointerMath.calculation : 'no pointerMath detail found' };
});
gate('int* ++ advances 4', () => {
  const r = run('int main(void){int a[3];int *p;a[0]=1;p=a;p++;return(0);}');
  const a = findVar(r, 'a'), p = findVar(r, 'p');
  return { ok: Number(p.value) - a.address === 4, detail: 'delta=' + (Number(p.value) - a.address) };
});

// 4. INTEGER MODEL
gate('int overflow wraps: 2147483647+1 = -2147483648', () => {
  const r = run('int main(void){int a;a=2147483647;a=a+1;printf("%d\\n",a);return(0);}');
  return { ok: r.output === '-2147483648\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('char truncation: c=300 -> 44', () => {
  const r = run('int main(void){char c;c=300;printf("%d\\n",c);return(0);}');
  return { ok: r.output === '44\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('unsigned wrap: unsigned int u = -1 prints 4294967295', () => {
  const r = run('int main(void){unsigned int u;u=0;u=u-1;printf("%u\\n",u);return(0);}');
  return { ok: r.output === '4294967295\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('representation exposes dec/hex/binary/signed/unsigned', () => {
  const rep = E.representation(-2n, E.scalarT('int'));
  return { ok: rep.hex === '0xfffffffe' && rep.binary.length === 32 && rep.signed === '-2' && rep.unsigned === '4294967294',
           detail: JSON.stringify(rep) };
});
gate('overflow is reported as a teachable detail', () => {
  const r = run('int main(void){int a;a=2147483647;a=a+1;return(0);}');
  const s = r.history.steps.find(x => x.detail && x.detail.overflow);
  return { ok: !!s, detail: s ? JSON.stringify(s.detail.overflow) : 'no overflow detail' };
});

// 5. GLOBALS
gate('global variable declared and used', () => {
  const r = run('int g;\nint main(void){g=5;printf("%d\\n",g);return(0);}');
  return { ok: r.ok && r.output === '5\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('global is zero-initialized before main', () => {
  const r = run('int g;\nint main(void){printf("%d\\n",g);return(0);}');
  return { ok: r.ok && r.output === '0\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('global with initializer, visible from a function', () => {
  const r = run('int g = 7;\nint get(void){return(g);}\nint main(void){printf("%d\\n",get());return(0);}');
  return { ok: r.ok && r.output === '7\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('global lives in the global region, not the stack', () => {
  const r = run('int g = 7;\nint main(void){return(0);}');
  const st = stateWithVar(r, 'g');
  const g = st.globals.find(v => v.name === 'g');
  const blk = st.blocks.find(b => b.id === g.blockId);
  return { ok: blk.region === 'global' && g.value === '7',
           detail: 'region=' + blk.region + ' value=' + g.value + ' @0x' + g.address.toString(16) };
});

// 6. BLOCK SCOPE
gate('inner block shadows outer x, outer restored after', () => {
  const r = run('int main(void){int x;x=1;{int x;x=2;printf("%d\\n",x);}printf("%d\\n",x);return(0);}');
  return { ok: r.ok && r.output === '2\n1\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('shadowing uses two distinct addresses', () => {
  const r = run('int main(void){int x;x=1;{int x;x=2;printf("%d\\n",x);}return(0);}');
  // the step where the inner declaration happens reports what it shadows
  const declStep = r.history.steps.find(s => s.detail && s.detail.declaration && s.detail.declaration.shadows !== null);
  if (!declStep) return { ok:false, detail:'no shadowing declaration step emitted' };
  const st = r.history.stateAt(declStep.index);
  const xs = st.vars.filter(v => v.name === 'x');
  return { ok: xs.length === 2 && xs[0].address !== xs[1].address && xs.filter(v=>v.shadowed).length === 1,
           detail: 'found ' + xs.length + ' x: ' + xs.map(v=>'0x'+v.address.toString(16)+(v.shadowed?'(shadowed)':'(active)')).join(' ') };
});
gate('block-scoped variable is gone after the block ends', () => {
  const r = run('int main(void){{int t;t=1;}t=2;return(0);}');
  return { ok: !r.ok && /undeclared identifier/i.test(r.message||''), detail: r.message || 'no error raised' };
});
gate('loop body decl does not leak one block per iteration', () => {
  const r = run('int main(void){int i;i=0;while(i<20){int t;t=i;i++;}return(0);}');
  const st = r.history.stateAt(r.history.length - 1);
  const live = st.blocks.filter(b => b.state === 'live' && b.region === 'stack').length;
  return { ok: live <= 2, detail: 'live stack blocks at end = ' + live + ' (was 21 in the old engine)' };
});

// 7. STACK TEARDOWN + USE-AFTER-RETURN
gate('use-after-return is trapped', () => {
  const r = run('int *bad(void){int x;x=77;return(&x);}\nint main(void){int *p;int v;p=bad();v=*p;return(0);}');
  return { ok: !r.ok && r.kind === 'use-after-return', detail: (r.kind||'no trap') + ' :: ' + (r.message||'') };
});
gate('use-after-return message explains destroyed frame', () => {
  const r = run('int *bad(void){int x;x=77;return(&x);}\nint main(void){int *p;p=bad();return(*p);}');
  return { ok: /destroyed/i.test(r.message||'') && /bad/.test(r.message||''), detail: r.message || '' };
});
gate('call-exit warns when a dangling pointer is returned', () => {
  const r = run('int *bad(void){int x;x=77;return(&x);}\nint main(void){int *p;p=bad();return(0);}');
  const s = r.history.steps.find(x => x.detail && x.detail.danglingReturn);
  return { ok: !!s, detail: s ? s.description : 'no dangling warning emitted' };
});
gate('frame storage is reclaimed: 25 calls do not pile up live blocks', () => {
  const r = run('int f(int n){int a;int b;int c;a=n;b=n;c=n;return(n);}\nint main(void){int i;i=0;while(i<25){f(i);i++;}return(0);}');
  const st = r.history.stateAt(r.history.length - 1);
  const live = st.blocks.filter(b => b.state === 'live').length;
  return { ok: live <= 3, detail: 'live blocks = ' + live + ' (old engine: 101)' };
});
gate('valid pointer to caller local still works across a call', () => {
  const r = run('void set(int *p){*p=9;}\nint main(void){int x;x=0;set(&x);printf("%d\\n",x);return(0);}');
  return { ok: r.ok && r.output === '9\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});

// 8. PARSER: for / break / continue / do-while
gate('for loop', () => {
  const r = run('int main(void){int i;int s;s=0;for(i=0;i<5;i++){s=s+i;}printf("%d\\n",s);return(0);}');
  return { ok: r.ok && r.output === '10\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('for with declaration in init, scoped to the loop', () => {
  const r = run('int main(void){int s;s=0;for(int i=0;i<4;i++){s=s+i;}printf("%d\\n",s);return(0);}');
  return { ok: r.ok && r.output === '6\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('break exits the loop', () => {
  const r = run('int main(void){int i;i=0;while(1){i++;if(i==3)break;}printf("%d\\n",i);return(0);}');
  return { ok: r.ok && r.output === '3\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('continue skips to next iteration (while)', () => {
  const r = run('int main(void){int i;int s;i=0;s=0;while(i<5){i++;if(i==3)continue;s=s+i;}printf("%d\\n",s);return(0);}');
  return { ok: r.ok && r.output === '12\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('continue in for still runs the update expression', () => {
  const r = run('int main(void){int s;s=0;for(int i=0;i<5;i++){if(i==2)continue;s=s+i;}printf("%d\\n",s);return(0);}');
  return { ok: r.ok && r.output === '8\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('do/while runs body at least once', () => {
  const r = run('int main(void){int i;i=10;do{i++;}while(i<5);printf("%d\\n",i);return(0);}');
  return { ok: r.ok && r.output === '11\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('nested loops with break only exit the inner one', () => {
  const r = run('int main(void){int c;c=0;for(int i=0;i<3;i++){for(int j=0;j<3;j++){if(j==1)break;c++;}}printf("%d\\n",c);return(0);}');
  return { ok: r.ok && r.output === '3\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});

// 9. UNINITIALIZED READ
gate('reading an uninitialized int is trapped', () => {
  const r = run('int main(void){int a;int b;b=a+1;return(0);}');
  return { ok: !r.ok && r.kind === 'uninitialized-read', detail: (r.kind||'no trap') + ' :: ' + (r.message||'') };
});
gate('writing then reading is fine', () => {
  const r = run('int main(void){int a;a=1;printf("%d\\n",a+1);return(0);}');
  return { ok: r.ok && r.output === '2\n', detail: JSON.stringify(r.output) + ' ' + (r.message||'') };
});
gate('partially initialized array element read is trapped', () => {
  const r = run('int main(void){int a[3];a[0]=1;printf("%d\\n",a[2]);return(0);}');
  return { ok: !r.ok && r.kind === 'uninitialized-read', detail: (r.kind||'no trap') + ' :: ' + (r.message||'') };
});

// 10. OTHER SAFETY TRAPS STILL WORK
gate('null deref trapped', () => {
  const r = run('int main(void){int *p;p=NULL;return(*p);}');
  return { ok: !r.ok && r.kind === 'null-deref', detail: (r.kind||'none') + ' :: ' + (r.message||'') };
});
gate('double free trapped', () => {
  const r = run('int main(void){char *p;p=malloc(4);free(p);free(p);return(0);}');
  return { ok: !r.ok && r.kind === 'double-free', detail: (r.kind||'none') + ' :: ' + (r.message||'') };
});
gate('invalid free trapped', () => {
  const r = run('int main(void){int x;int *p;x=1;p=&x;free(p);return(0);}');
  return { ok: !r.ok && r.kind === 'invalid-free', detail: (r.kind||'none') + ' :: ' + (r.message||'') };
});
gate('heap out-of-bounds trapped', () => {
  const r = run('int main(void){char *p;p=malloc(4);p[9]=1;return(0);}');
  return { ok: !r.ok && r.kind === 'out-of-bounds', detail: (r.kind||'none') + ' :: ' + (r.message||'') };
});

// 11. HISTORY ARCHITECTURE
gate('history: time travel reproduces an earlier state exactly', () => {
  const r = run('int main(void){int i;i=0;while(i<10){i++;}return(0);}');
  const h = r.history;
  const mid = Math.floor(h.length / 2);
  const a = JSON.stringify(h.stateAt(mid).vars.map(v=>[v.name,v.value]));
  h.stateAt(h.length - 1);          // move forward
  h.stateAt(0);                     // jump backward
  const b = JSON.stringify(h.stateAt(mid).vars.map(v=>[v.name,v.value]));
  return { ok: a === b, detail: a + ' vs ' + b };
});
gate('history: memory delta is bounded, not O(all memory) per step', () => {
  const r = run('int main(void){char b[200];int i;i=0;while(i<200){b[i]=65;i++;}return(0);}');
  const h = r.history;
  const totalDeltaEntries = h.deltas.reduce((s,d) => s + d.mem.length, 0);
  const naive = h.length * 204;
  return { ok: totalDeltaEntries < naive / 10,
           detail: totalDeltaEntries + ' delta byte-entries vs ' + naive + ' for a full copy per step (' +
                   (naive/totalDeltaEntries).toFixed(1) + 'x smaller)' };
});
gate('trace: an output character maps back to the step that produced it', () => {
  const r = run('int main(void){printf("AB");printf("CD");return(0);}');
  const h = r.history;
  const i0 = h.stepForOutputIndex(0), i3 = h.stepForOutputIndex(3);
  return { ok: i0 >= 0 && i3 >= 0 && i0 !== i3 && h.steps[i3].line === 1,
           detail: "'A' from step " + i0 + ", 'D' from step " + i3 };
});

// 12. SINGLE SOURCE OF TRUTH
gate('variable panel value and memory bytes agree by construction', () => {
  const r = run('int main(void){int x;x=258;return(0);}');
  const v = findVar(r, 'x'), o = findObj(r, 'x');
  let fromBytes = 0n;
  for (let k = o.bytes.length - 1; k >= 0; k--) fromBytes = (fromBytes << 8n) | BigInt(o.bytes[k].value);
  return { ok: v.value === '258' && fromBytes === 258n && v.repr.hex === '0x00000102',
           detail: 'panel=' + v.value + ' bytes=' + fromBytes + ' hex=' + v.repr.hex };
});
gate('engine resolves pointer targets (UI never computes them)', () => {
  const r = run('int main(void){int x;int *p;x=42;p=&x;return(0);}');
  const p = findVar(r, 'p');
  return { ok: p.pointerTarget && p.pointerTarget.kind === 'live' && p.pointerTarget.valueText === '42',
           detail: JSON.stringify(p.pointerTarget) };
});
gate('pointer into freed block is reported as freed by the engine', () => {
  const r = run('int main(void){char *p;p=malloc(4);p[0]=65;free(p);return(0);}');
  const p = findVar(r, 'p');
  return { ok: p.pointerTarget && p.pointerTarget.kind === 'freed', detail: JSON.stringify(p.pointerTarget) };
});

/* ============================== SUMMARY ============================== */
console.log('\n' + '='.repeat(60));
console.log('PASS ' + pass + '   FAIL ' + fail);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  - ' + f.name + (f.detail ? '\n      ' + f.detail : ''));
}
process.exit(fail ? 1 : 0);
