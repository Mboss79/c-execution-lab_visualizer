# C Execution Lab — test suite

These suites test **the shipped `../index.html`**, not a copy. `load-engine.js`
extracts the engine from between the `ENGINE START` / `ENGINE END` markers inside
the HTML, so the engine under test is always exactly the one the page runs. If
those markers are ever removed, the suite fails loudly rather than testing stale code.

## Running

```
npm test              # all ten suites (741 checks)
npm run test:engine   # engine + Foundation Gate + artifact integrity (66, no browser)
npm run test:ui       # real Chrome, drives the actual UI (44)
npm run test:qa       # QA against the installed file (51)
npm run test:phase3   # Phase 3 exit gate: shell, layout, debugger UX (115)
npm run test:phase4   # Phase 4 Norminette Lab: real norminette end to end (71)
npm run test:phase5   # Phase 5 Compiler Lab: real cc -Wall -Wextra -Werror (77)
npm run test:phase6   # Phase 6 Test Lab: real executable, stdin/stdout/exit (95)
npm run test:phase7   # Phase 7 Trace Analyzer: real instrumented run, replay (78)
npm run test:phase8   # Phase 8 3D visualization: scene vs. engine state (98)
npm run test:final    # Final: execution emphasis, camera, workspace UX (46)
node shots.js         # visual QA screenshots into screenshots/
```

`phase4.test.js` starts and stops `../c-lab-bridge/server.js` itself, so both the
working path and the bridge-down path are exercised for real. It needs WSL with
norminette installed; on this machine that is Ubuntu-24.04 + norminette 3.3.59.

The browser suites need Chrome at
`C:\Program Files\Google\Chrome\Application\chrome.exe`
(edit the `CHROME` constant at the top of `ui.test.js` / `qa.test.js` to change it).
`puppeteer-core` is already installed here.

## What each suite covers

### `regression.test.js` — 66 checks

**Part A — the 13 original examples.** These are the baseline. Expected outputs were
recorded from the *original* engine before any changes, so a regression here means
behaviour that used to work no longer does.

**Part B — the Foundation Gate**, one group per spec item:

| Group | Proves |
|---|---|
| unified evaluation | `printf("%d", f(3))` runs `f`; `printf("%d", i++)` performs the side effect exactly once; no synchronous `evalExpr` exists |
| type / size model | `char 1 · short 2 · int 4 · long 8 · pointer 8`; an `int` occupies 4 consecutive real bytes; array stride; alignment |
| pointer scaling | `int* p+1` advances 4, `char* p+1` advances 1, `p++` scales, and the calculation is exposed to the UI |
| integer model | wraparound, truncation, unsigned, and the dec/hex/binary/signed/unsigned representation |
| globals | declaration, zero-init before `main`, visibility from functions, correct region |
| block scope | shadowing with distinct addresses, restoration on block exit, no per-iteration leak |
| stack teardown | use-after-return trapped and explained; dangling return warned at `call-exit`; storage reclaimed |
| parser | `for`, `for` with declaration, `break`, `continue` (incl. `for` update still running), `do/while`, nested loops |
| uninitialized reads | trapped for scalars and array elements |
| other traps | null-deref, double-free, invalid-free, heap out-of-bounds |
| history | time travel reproduces earlier state exactly; memory deltas are bounded, not O(all memory) per step |
| single source of truth | variable value, decoded memory value and raw bytes agree; engine resolves pointer targets |

### `ui.test.js` — 44 checks
Loads the page in Chrome and drives the real controls: runs the flagship example
end to end, verifies the byte-accurate memory panel (`int x = 258` → `02 01 00 00`),
the pointer-arithmetic calculation, the overflow explanation, the use-after-return
report, all 13 examples through the UI, time travel, breakpoints, all four memory
views, theme toggle, the memory-model modal, and no horizontal scroll at 720px.
Screenshots land in `screenshots/`.

### `qa.test.js` — 51 checks
Runs against the installed file. Covers malformed input (empty source, garbage,
unclosed brace, unterminated string, missing semicolon, unknown function,
unsupported `printf` conversion, divide-by-zero, redeclaration, wrong argument
count), runaway-loop and infinite-recursion guards, performance and time-travel
cost, every new language feature end to end, the edit→run→reset→switch workflow,
breakpoint halting, and cross-panel agreement.

## Adding a regression test

When a bug is found, add a check that fails before the fix and passes after:

```js
gate('short description of the bug', () => {
  const r = run('int main(void){ /* minimal repro */ return(0); }');
  return { ok: r.ok && r.output === 'expected\n', detail: JSON.stringify(r.output) };
});
```

`run()` is `runToCompletion` — the same entry point the page uses. There is no
separate test-only execution path.

### `phase3.test.js` — 115 checks

The Phase 3 exit gate. Covers the IDE shell (titlebar, toolbar, rail, panes,
dock, statusbar, dashboard), the **resizable split** (drag, feedback, clamping,
persistence across reload, keyboard, reset, ARIA), **three-level scrolling** and
unreachable-content detection, the **debugger toolbar** (First/Prev/Step/Run/
Pause/Reset), **breakpoints** (gutter marker, run-to-breakpoint, announcement),
**performance** (fast run, virtualized timeline, time-travel and scroll cost),
**timeline UX** (current marker, click-to-travel, the seven filters, nav buttons,
and that filtering never mutates execution state), **source ↔ execution**
linking, the **panel system** and information hierarchy, **inspection vs
execution** (clicking a frame must not advance the program), the data panels
(scoped variables, array cells, byte inspector, four memory views, RAM region
focus, pointer chain), **watch**, **output vs debug separation**, the **command
palette** and keyboard map, **both themes**, **responsive** behaviour at
1280×720 / 1366×768 / 1440×900 / 1920×1080 and at 80/100/125/150% zoom plus the
stacked narrow layout, **accessibility** (accessible names, roles,
focus-visible), and a full re-run of all 13 examples through the new shell.

### `phase4.test.js` — 70 checks

The Phase 4 exit gate: the **Norminette Lab**.

**Architecture separation** — the engine exports nothing validation-related, the
validation layer exports nothing engine-related, and validation never leaks into
execution or UI state. The normalized diagnostic schema, all six status states,
and a validator registry ready for a Phase 5 compiler validator.

**Rule normalization** — known rules carry educational metadata; unknown future
rule identifiers degrade gracefully and still show norminette's own message;
metadata is localized; and no explanation hands over a finished solution.

**Real norminette 3.3.59, end to end** — detection, a bad file producing real
rule identifiers with line/column/category, the Problems panel grouped by
category with severity filters and a count badge, gutter marks, click-to-jump
with the highlighted line matching the diagnostic, the rule panel with
What / Why / Common mistake / Better strategy plus a column caret, and a clean
file passing — with PASSED explicitly not presented as "the code is correct".

**UNAVAILABLE path**, verified with the bridge stopped: status is UNAVAILABLE,
zero diagnostics are invented, and the workspace says so plainly.

**Process safety** — oversized source rejected, a command-injecting filename
neutralized, and a filesystem check confirming the injection did not execute.

**No regression** — execution, program output, timeline virtualization and the
memory panel are re-checked in the same page after validation has run.

### Part 0 of `regression.test.js` — artifact integrity

A `perl -pi` edit containing a wide character once re-encoded the whole shell and
turned every toolbar glyph into mojibake. Part 0 checks the shipped file is valid
UTF-8, contains no double-encoded sequences, and still has its UI glyphs.

### `phase5.test.js` — 77 checks

The Phase 5 exit gate: the **Real Compiler Lab**. Starts and stops the bridge
itself so the "compiler unavailable" path is exercised for real.

**Architecture** — the compiler is a validator inside `CValidate` beside `norm`,
sharing the DiagnosticStore. `CEngine` is proven untouched by *behaviour*
(its Phase 2 parser still accepts and rejects the same programs) rather than by
name matching — `CEngine.compile` is the C-subset parser and predates this phase.
Flags are asserted fixed at `-Wall -Wextra -Werror`, no UI can disable them, and
the bridge is probed for an arbitrary-command endpoint (404).

**Real cc 13.3.0** — valid C gives exit 0 and a produced binary; a missing
semicolon gives exit 1 with the diagnostic parsed to line 5 column 14, severity,
category `COMPILATION`, producer `compiler`, and the original gcc line kept in
`raw`; stderr is preserved verbatim and never leaks into stdout.

**-Wall / -Werror** — an unused variable and an unused parameter each fail the
build, the `[-Werror=...]` suffix is detected as a promoted warning, and the UI
explains that a warning stopped the build.

**Navigation** — clicking a compiler error jumps to its line, opens the
explanation, shows the compiler's own message verbatim, and gives
What / Why / Common cause / How to think about it without handing over corrected
code. Unknown diagnostics stay honest.

**Source correctness** — compile source A, switch the editor to a different
program B, click a diagnostic: the highlighted line must still be A's text.

**Security & hygiene** — command-injecting filename neutralized (with a
filesystem check that it did not execute), oversized source rejected, build
workspace removed after success and failure, no binaries left in temp or in the
project, and a compile timeout enforced with SIGKILL.

**Unavailable** — with the bridge down: status UNAVAILABLE, no fabricated
diagnostics, no invented exit code, and nothing claiming success.

**No regression** — the engine, program output, norminette and the producer
filter are all re-checked in the same page.

### `phase6.test.js` — 95 checks

The Phase 6 exit gate: the **local Test / Moulinette-style Lab**. Starts and
stops the bridge itself so the unavailable path is exercised for real.

**Architecture** — `tests` is a validator inside the existing `CValidate`
alongside `norm` and `compiler`, sharing the DiagnosticStore. `CEngine` is
proven untouched by behaviour. There is no second compiler system: the runner
reuses the Phase 5 command. Demo suites must be labelled `DEMO` and carry an
`exercise` slot for a later phase.

**Comparison engine** — `exact` is byte-strict, `trim` forgives trailing
whitespace and blank lines, `lines` ignores trailing blanks, case is never
forgiven, and the first difference is located to line and column with both
differing lines reported.

**Real execution** — stdin is really delivered (basic, empty and multi-line),
durations and exit codes come from the process, a wrong-case run FAILs with a
readable diff, an endless loop is TIMEOUT and is actually killed, a null
dereference is CRASHED with signal 11. Neither TIMEOUT nor CRASHED reports an
exit code, because 124 is `timeout`'s and 128+N is a signal.

**Compile failure** — nothing is executed, every case is `COMPILE_FAILED`, and
the compiler diagnostics flow into the existing Problems panel and still
navigate to the source.

**Cleanup** — workspace and executable removed after passing, crashing, timing
out and failing to build; no `.out`/status files linger in temp; no artifacts in
the project.

**Security** — no arbitrary-command endpoint (`/run`, `/exec`, `/shell`, `/sh`),
a command-injecting filename neutralized with a filesystem check that it did not
execute, oversized source, too many cases and oversized stdin all rejected, and
the page never sends a shell string to the bridge.

**UI + i18n** — dock tab enabled with a failure badge, X/Y summary, status bar
ratio, case selection opening the detail panel with input/expected/actual/
stderr/mode, DEMO-fail cases labelled, and full EN/FR including demo-suite prose.

### `phase7.test.js` — 78 checks

The Phase 7 exit gate: the **Trace Analyzer**. A trace is produced by
instrumenting the learner program through the engine parser, compiling the
instrumented copy with the same real `cc -Wall -Wextra -Werror`, running it, and
replaying the events it wrote. Every assertion below is about a real run.

**Architecture** — `CTrace` is a module beside the validators, not inside the
engine; it reuses `CEngine.parseC` rather than adding a second parser; it adds no
second memory system; and the *existing* debugger controls (First/Prev/Step/Run/
To end/Reset) drive the trace, proven by stepping the trace while the engine
history stays put.

**Instrumentation** — the generated program is a different text that carries only
`__clab_*` helpers, the learner source is preserved byte-for-byte in the editor
and in the snapshot the view uses, preprocessor directives are carried over, and
regenerated expressions keep explicit precedence (checked by running
`a + b * c` and `r - a * b + c` and comparing the observed values with C).

**Events** — nine typed kinds, strictly increasing sequence numbers, real source
lines, a while loop yielding N true checks then one false with iterations
numbered 1..N, a call raising the observed depth and its return lowering it,
a return value that was observed rather than inferred, an inner condition that
appears only after the outer one is true, and a PROGRAM_END exit code equal to
the wait status the OS actually reported.

**Honesty** — a variable appears only after an assignment has been observed;
replay is a pure function of the event list, not of navigation order; a
side-effecting lvalue (`a[i++] = 5`) is logged as unknown instead of re-read;
and the UI renders unknown as unknown.

**Failure paths** — build failure is COMPILE_FAILED with zero events and reuses
the Phase 5 compiler diagnostics; `-Werror` still stops a trace (the gate is not
weakened to make tracing work); a construct the instrumenter cannot handle is
UNSUPPORTED, not faked; a crash keeps the events flushed before it and invents no
PROGRAM_END; a runaway program is TIMEOUT with no exit code; and every one of
those paths still removes its workspace and executable.

**Security** — the bridge action list is still a fixed six-entry allowlist with no
`/run`, `/exec` or `/shell`; script text stays constant with arguments passed
positionally; traversal filenames and traversal trace-file names never reach the
workspace path; oversized source and stdin are refused and the bridge survives.

**UI + i18n** — the event list is virtualized, clicking a row moves both the trace
and the highlighted source line, the panel substitutes observed values into the
condition and states the branch taken, the existing variable-row component is
reused, the Program output tab shows the real executable stdout, editing the
source leaves trace mode so a stale trace cannot be navigated, and panel, event
list and explanations are genuinely translated EN/FR.

### `phase8.test.js` — 98 checks

The Phase 8 exit gate: the **3D execution visualization**. The 3D view is a
view, so almost every check cross-examines the scene against the state the
debugger is showing at the same moment, or proves the view refuses to invent
something it was not given.

**Architecture** — `CViz3D` exposes no evaluator, parser, memory model or
stepper; the engine gained no 3D API; the scene is built from `state.frames` /
`state.globals`; nothing 3D exists in the DOM until the view is opened.

**Synchronization** — the scene line equals `step().line` equals the highlighted
source line; Step, Prev, First, To end, Reset, Play/Pause and timeline travel all
move the scene with the debugger; opening or closing the view never changes the
execution position.

**Data** — every value and address drawn is compared byte-for-byte with the
engine state; a pointer arrow lands on the object holding the address the ENGINE
resolved; array cells are contiguous and one `elemSize` apart; `p++` moves the
arrow from element 0 to element 1 because the engine says so, not because the
view did arithmetic.

**Stack** — frame count always equals `state.frames.length`, a call puts the new
frame above its caller, exactly one frame is marked current and it is the engine
top frame, and a return removes it.

**Conditions and loops** — the TRUE/FALSE badge is the value the engine computed
for that expression (checked on every conditional step of a run), the colour
follows the semantic language, and the loop ends on the step whose condition is
false.

**Memory and errors** — a heap block shows the engine size and address, a freed
block is faded with a bad arrow, byte chips match `state` bytes, a real runtime
error shows the engine message verbatim with a localized kind label, and no
error banner ever appears when the engine did not raise one.

**Honesty** — uninitialized variables render as unknown, a trace-driven scene
marks addresses and sizes unknown because a trace never observed them, an empty
model yields an empty scene, and unsupported constructs are announced.

**Camera, animation, fallback, cleanup** — orbit/pan/zoom/reset/fit/focus all
verified through the applied CSS transform; the speed control changes only
`--viz-anim` and never the history; nodes are pooled and reused between steps;
the flat 2D fallback still draws values, arrows and the caption; disposal removes
every node, edge and the camera DOM; editing the source leaves no stale scene.

**Explanations** — all 21 required concepts exist, complete in EN and FR at all
three detail levels, with genuinely different text per level, popovers that carry
what / what-to-look-at / analogy, follow the current detail level, never cover
their own anchor, stay on screen, close on Escape, and never claim behaviour the
engine does not model.

**Integration and security** — View menu, rail button, palette and the V key all
reach the same toggle; switching views keeps execution state; the 3D layer adds
no fetch/XHR/WebSocket/bridge call; the bridge action list is still the same
fixed six-entry allowlist.
### `phase9.test.js` — 46 checks

The final gate. Its theme is the difference between *the view looks right* and
*the view is telling the truth*, so nearly every assertion cross-checks the
highlight against the addresses the ENGINE recorded touching.

**Engine access journal** — `readValue` / `writeValue` now record the exact
address they touched, and the step carries them as `step.accessed`. Verified:
every recorded address lies inside a real block, display reads (`peekValue`, the
panel renderers) never pollute the journal, and the journal survives time travel
because it is recorded rather than recomputed.

**Current execution object** — walking `while (str[i] != 0)` the resolver names
`str[0] … str[5]` in order, each address equal to the last read the engine
reported; a write makes the written object primary at the `memDiff` address;
exactly one node is ever PRIMARY; other storage touched in the same step is
SECONDARY; the active cell carries a CURRENT marker; and a step with nothing
addressable says so instead of pointing at something plausible.

**Value transitions** — the crossed-out previous value is exactly
`memDiff.beforeText`, and no previous value is shown when the engine reported
none.

**Pointers** — `*p = 88` makes the TARGET cell primary and the pointer
secondary, and the arrow still lands on the engine-resolved address.

**Stack** — three nested frames stack vertically, newest highest, all sharing one
x; exactly one is current and it is the engine top frame; returning removes them.

**Errors** — an out-of-bounds write is reported only because the engine raised
it, the banner carries the engine message plus a localized kind, and the banner
never covers a node of the scene it describes.

**Workspace** — panel headers in a scrolling pane are sticky; no content is
painted over the visible part of any header at any scroll position; there are no
nested scroll containers; the dock splitter exists, drags, clamps at both ends,
is keyboard operable and persists across a reload.

**Help** — the jargon panels carry an info button that opens the same explanation
system at the current detail level, does not collapse the panel it sits in, and
is translated.

**Honesty** — the resolver never returns an address the engine did not touch, a
trace-driven model (which observes no addresses) resolves only a frame, and
`locate()` refuses an address belonging to nothing drawn.

### Test changes made in the final phase

Four Phase 8 camera assertions were **moved forward, not deleted**, because the
camera contract itself changed: free rotation is now forbidden by design, and
execution must not move the camera. `[48]`–`[51]` now assert pan / zoom / reset,
that the orientation is a constant no caller or gesture can change, that Fit
really fits (measured against the painted rectangles, including after every
resize in the spec's sequence), and that execution never moves the camera. That
is three checks more than they replaced, and all of them harder.

One QA assertion was made **more precise**, not weaker: `qa.test.js` treated any
console message as a crash, including `ERR_CONNECTION_REFUSED` from probing the
deliberately-absent local bridge. It now filters network noise the way every
other suite in this project already did. This was also the cause of the
intermittent failure reported at the end of Phase 7.
