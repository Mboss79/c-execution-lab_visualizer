# C Execution Lab

A single-file, browser-based environment for learning how a C program actually
executes: step through it, watch memory change, and see the execution as a
readable 3D diagram.

**Live demo:** https://mboss79.github.io/c-execution-lab_visualizer/

---

## What it does

| | |
|---|---|
| **Debugger** | Step / Prev / Run / To end / Reset, breakpoints, and a virtualized timeline you can travel through. Going back does not re-run anything: history is recorded. |
| **Memory model** | An educational simulated 64-bit model (LP64-like, little-endian). Byte-level view, real addresses, alignment, pointer arithmetic scaled by pointee size. |
| **Spatial view (2.5D)** | Variables, arrays, pointers, stack frames and heap blocks as a stable, readable diagram on a flat plane. Depth is DRAWN — layered offsets, shadow, elevation — never projected, so a rectangle is the same size wherever it sits and every stack frame matches every other one. Pan, zoom and fit; no camera to orbit, and execution never re-frames the view. |
| **One header** | Brand, menus and the whole execution toolbar on a single 46px row. The command palette, language and theme live in the left rail. |
| **One speed control** | 0.25x / 0.5x / 1x / 2x / 5x, driving BOTH the Run cadence and every animation duration. |
| **Editor** | Line numbers and syntax colours in edit mode as well as run mode — one buffer, one derived view. Tab / Shift+Tab indent, native undo/redo, breakpoint gutter clickable while editing. |
| **Memory Error Lab** | Twelve ready-made broken programs — array overflow and underflow, invalid read and write, NULL dereference, invalid access, use-after-free, use-after-return, double free, invalid free, stack overflow, uninitialised read. Pick one, press Step, and watch it fail in the ordinary debugger with the ordinary visualization. |
| **Memory errors** | Every fault above reports the address, the access kind, the attempted index, the valid range and the failing line — all from the engine. The attempted access is drawn OUTSIDE the object, with no value in it, because there is no such storage. |
| **Detail levels** | **Basic** (call stack, variables, memory, pointers), **Medium** (+ RAM map), **Deep** (everything: timeline, trace, watch, conceptual CPU view). Switching level changes only what is shown — never the execution position, the program state or the camera. |
| **Memory view** | Arrays are drawn as one labelled cell per element. Hover a cell for a tooltip beside it; click it for an inspector anchored to that cell. The cell the program is working on right now is highlighted separately from the cell you selected — they are different questions. |
| **Norminette Lab** | Runs the real `norminette` when a local bridge is available. |
| **Compiler Lab** | Runs the real `cc -Wall -Wextra -Werror`. Those flags are fixed. |
| **Test Lab** | Compiles and runs the real binary against DEMO test suites. Not the official 42 Moulinette. |
| **Trace Analyzer** | Instruments a copy of your program, compiles it with the real compiler, runs it, and replays what the real executable reported — including the actual addresses it touched. |
| **Languages / themes** | Full EN + FR, dark + light. |

Everything shown comes from real execution. When something cannot be observed,
the interface says **unknown** rather than guessing.

---

## Running it

The app is a single HTML file with no build step and no dependencies:

```bash
# just open it
start index.html          # Windows
open  index.html          # macOS
xdg-open index.html       # Linux
```

That gives you the editor, the debugger, the memory views and the 3D
visualization — everything that runs in the simulated engine.

### Optional: the local tools bridge

Norminette, the real compiler, the test runner and the Trace Analyzer need to
run real processes, which a page loaded from `file://` cannot do. A small local
bridge does it:

```bash
node c-lab-bridge/server.js
```

It listens on `127.0.0.1:4242` only, exposes a fixed six-action allowlist, never
interpolates a shell string, applies timeouts and output caps, and deletes its
workspace and executables after every run. Without it the app still works — the
tool panels simply report `UNAVAILABLE` instead of pretending to pass.

Requires `norminette` and `cc` on the path (on Windows these are used through
WSL).

---

## Tests

```bash
cd c-lab-tests
npm install          # puppeteer-core only
npm test             # all 13 suites
```

| Suite | Checks | What it covers |
|---|---|---|
| `regression.test.js` | 66 | engine, foundation gate, artifact integrity |
| `ui.test.js` | 44 | the real UI in a real browser |
| `qa.test.js` | 51 | the shipped file, error handling, guards |
| `phase3.test.js` | 115 | IDE shell, layout, debugger UX |
| `phase4.test.js` | 71 | Norminette Lab |
| `phase5.test.js` | 77 | Compiler Lab |
| `phase6.test.js` | 95 | Test Lab |
| `phase7.test.js` | 78 | Trace Analyzer |
| `phase8.test.js` | 99 | 3D visualization |
| `phase9.test.js` | 46 | execution emphasis, camera, workspace |
| `phase10.test.js` | 46 | operand flow, memory errors, scale |
| `phase11.test.js` | 206 | workspace UX, detail levels, memory popups, the Error Lab |
| `phase12.test.js` | 89 | one header, the editor, expand, speed, 2.5D |
| **Total** | **1083** | |

The browser suites drive real Chrome; the tool suites start and stop the bridge
themselves so the unavailable path is exercised honestly.

---

## Architecture

```
    C source
        │
        ▼
   CEngine  ── the single source of truth for execution
        │        (tokenizer, parser, one generator evaluator,
        │         byte-addressed memory, recorded history)
        │
        ├──────────────┬──────────────┬───────────────┐
        ▼              ▼              ▼               ▼
   IDE debugger    Timeline       3D view        CValidate
                                                 (norm / cc / tests)
                                                       │
    real compiled run ──▶ CTrace ──▶ replay ──────────▶ 3D view
```

Rules the code holds to:

- The engine is the only thing that computes program state. Views render
  `history.stateAt(i)`; they never derive a value, an address or a pointer target.
- There is exactly one evaluator, one parser and one memory model.
- The 3D layer is a view. If it disagrees with the debugger, the 3D layer is wrong.
- Nothing is fabricated. Unobservable state renders as *unknown*.

Source layout: `index.html` is generated by concatenating the parts in the build
directory (engine, validation layer, trace, concepts, 3D view, app layers). The
markers `==== ENGINE START ====`, `==== VIZ START ====` and friends let the test
suite extract and test the *shipped* artifact rather than a copy.

---

## Deploying to GitHub Pages

`index.html` sits at the repository root, so Pages can serve it directly:

```bash
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```

Then in **Settings → Pages**, set *Source* to `Deploy from a branch`, branch
`main`, folder `/ (root)`. The site appears at
`https://<USER>.github.io/<REPO>/`.

The tools bridge is local-only by design and is not part of the deployed site;
the public page runs the simulated engine, the debugger and the 3D
visualization.

---

## Known limitations

These are deliberate and documented rather than hidden:

- **Not a real machine.** The memory model is an educational simulation.
  Addresses are simulated with fixed region bases so runs are reproducible.
  `struct`, `union`, `float` and `double` are not modelled.
- **Stack addresses are never recycled**, so a dangling pointer is always
  detectable here even where real C would appear to work.
- **A byte-level stack boundary is not modelled.** Call-depth exhaustion is; an
  address-level stack overflow is not simulated, and the app says so instead of
  faking one. The Stack overflow lesson prints that limitation in its own panel
  rather than letting the picture imply something the engine does not model.
- **Step explanations stay in the engine’s language.** The interface chrome, the
  Error Lab and the concept help are fully EN + FR; the per-step WHAT/WHY prose
  comes from the engine and is English, because translating it there would fork
  the single source of truth.
- **The engine does not parse cast expressions.** `(char *)malloc(4)` is a parse
  error; `malloc(4)` works. The Error Lab lessons are written without casts.
- **Operand flow needs engine-known operands.** `z = x + y` draws the full
  relationship. An operand that is itself a computed temporary has no address,
  and no arrow is drawn from a box that does not exist.
- **Trace mode reports what the compiled program reported.** It observes
  addresses for assignments and for side-effect-free reads in conditions; a
  read whose sub-expression has side effects is not instrumented, because
  logging it would change what the program does.
- **The spatial view paints what is visible.** Off-screen objects are culled and
  a drawn-node budget applies, so very large scenes stay responsive rather than
  rendering everything at once. Because execution never re-frames the camera,
  a scene that grows well past the viewport stays where the learner left it —
  Fit and Reset camera are one click away in the view controls. The one
  exception is a scene that would be almost entirely off-screen, which is
  framed once so the learner is never looking at an empty plane.
- **All stack frames share one size.** Every frame on screen is drawn at the
  largest size any of them needs, so they read as a stack. That shared size can
  still change between steps if a frame declares an unusually wide array — but
  all frames change together, and never because of depth.
- **The bridge is controlled local execution, not a sandbox.** It restricts what
  can be run, but it runs real programs on your machine.

---

## License

No license file is included yet; add one before publishing if you want to set
reuse terms.
