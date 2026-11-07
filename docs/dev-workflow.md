<!-- Sections for README.md: "Hot reload", "Vite", "Single executable (Bun)". -->

## Hot reload

```sh
bun --hot examples/hello/main.ts
```

Save `main.ts`, or any module it imports, and the open window shows the new view. It stays the same
process and the same window, the app's state is kept, and only one frame loop runs. Bun re-evaluates
your modules in place, and `run()` finds the live window, swaps in the new `view`, `init`, `poll`,
`on_key`, `setup` and `scenes`, and re-runs the view. Handlers such as `on_press` come from the new
view, so they're the new code too. Renaming the app (its title) retitles the same window.

A save that doesn't parse, or a module that throws at the top level, is printed and the window
keeps running its last good code. The next good save reloads. A view that throws shows Rune's red
error view and prints the error until a save fixes it. Under `bun --hot`, runex installs
`unhandledRejection` and `uncaughtException` listeners that print the error. Without them, Bun stops
running timers after an unhandled error, and the window would freeze until the next good save.

Closing the window ends the process, as it does without `--hot`, because Rune's event loop can't be
started twice in one process. With Rune's tooling arguments, a session renders headless on every
save:

```sh
bun --hot examples/hello/main.ts --snap hello.png --scene on
```

Some things a save doesn't change:

- `App` builder settings: `on_close`, `on_focus`, `keep_running()`, `accessory()` and the rest.
- `size`, `min_size`, `fonts` and `families`.
- `setup`, which runs once.
- Side effects at module top level (timers, sockets) run again on every save. Keep them in `setup`,
  or guard them with a flag on `globalThis`.

Read `extra_args()` after `run()` starts. Called before it, Rune reads the process's command line
itself, takes `--hot` for its own live-editing flag, and exits.

Node has no `--hot`, so on Node, hot reload means the Vite plugin below. `bun --watch` restarts the
process instead: a new window, and the state is lost.

## Vite

`runex-js/vite` runs the app from Vite's dev server process and hot-swaps its view on every save.

```ts
// vite.config.ts
import { defineConfig } from "vite"
import runex from "runex-js/vite"

export default defineConfig({
  plugins: [runex({ entry: "./main.ts" })],
})
```

From the directory with `vite.config.ts` (see `examples/vite`):

```sh
bunx vite                                     # Vite on Node: opens the window
bunx --bun vite                               # the same with Vite on Bun
bunx vite -- --snap out.png --scene on        # Rune's arguments after `--`: headless, re-rendered on every save
bunx vite build && node dist/main.mjs         # a Node-runnable bundle (dist/<entry>.mjs)
```

With `--bun`, name the command before Rune's arguments: `bunx --bun vite serve -- --snap out.png`.
Bun drops a `--` that directly follows the script, so `bunx --bun vite -- --snap ...` hands Vite
`--snap` and Vite rejects it as an unknown option.

Saving the entry, or any module it imports (`examples/vite/label.ts`), swaps the new view into the
open window and keeps the state. Vite logs `hmr update`. Errors (a parse error, a module that
throws, a view that throws) are logged, and the window keeps its last good code. If the entry fails
to load at startup, every save retries until one loads. Editing `vite.config.ts` restarts Vite's
server but keeps the window. Closing the window stops Vite.

How it works: the plugin adds a `runex` environment built with `createRunnableDevEnvironment`
(Vite 6 or later). Its module runner imports the entry inside Vite's process, and the plugin makes
the entry accept its own HMR updates. On a save, the changed modules and the entry run again, the
entry's `run()` finds the live window, and the same swap as `bun --hot` happens. `runex-js` itself is
external, so the native addon loads once and its registry outlives the reloads. `vite build`
builds only that environment. `runex-js` stays an import, resolved from `node_modules` at run time.

Options:

- `entry`: the module that calls `run`, relative to Vite's root.
- `args`: Rune's arguments. The default is whatever follows `--` on the command line.
- `environment`: the environment's name. The default is `"runex"`.

Other hosts can use the same contract. Set `globalThis.__runex_host = { args, hot: true, quit }`
before importing the app. `args` are Rune's arguments; `hot` lets a re-run take over the live app;
`quit()` is called after the window closes.

Vite still starts its HTTP server, which this app doesn't use. Under Bun, stack traces from modules
that Vite ran point at transformed lines rather than source lines.

## Single executable (Bun)

```sh
bun build --compile examples/hello/main.ts --outfile out/hello
out/hello                                   # opens the window
out/hello --snap hello.png --scene on       # renders headless, like `bun examples/hello/main.ts --snap ...`
```

The binary runs anywhere on the same platform, with no `node_modules` or `.node` file next to it.
Bun's bundler follows the native loader's `require("./runex.<platform>.node")`, embeds the addon,
and extracts it to `$TMPDIR` when the binary starts. Requires for other platforms' addons become
stubs that the loader skips. Inside the binary, `process.argv` is
`["bun", "/$bunfs/root/hello", ...your arguments]`, so Rune's arguments pass straight through.

Build on the platform you ship for. Cross-compiling with `--target` needs that platform's `.node`
present when you build. The binary is about the size of the Bun runtime plus the addon (roughly
170 MB today).

## Performance overlay

```sh
bun app.ts --perf               # the overlay, in each window's top-right corner
bun app.ts --perf=log           # a line a second on stderr instead
bun app.ts --perf=overlay,log   # both
RUNEX_PERF=1 bun --hot app.ts   # the environment variable works anywhere: --hot, Vite, compiled binaries
```

Or in code, for one app or window: `App.new(spec).perf()`, `App.new(spec).perf("log")`,
`WindowSpec.new(...).perf()`.

The overlay is a dark panel in each window's top-right corner. It reads the same over a light or
a dark app, and it stays out of the app's way: presses, hover, the wheel and the cursor pass
through it to the app beneath. Only its two buttons take the pointer: `?` turns explain mode on
and off, and `−` folds the panel down to its headline (`+` unfolds it). A window narrower than
464 points or shorter than 460 points starts with the panel folded: `58 fps every 17.2 ms`.

Unfolded, it shows four groups, averaged over the last second:

```
FRAME                    main   [?] [−]
 58 fps  every 17.2 ms         p95  18.9
                               max  24.1
WORK per frame        12.40 ms  max 14.02
[ rune ████████ | bindings ████ | js █████ ]
■ rune 6.10     ■ bindings 2.80     ■ js 3.50
[ the last 60 frames, stacked the same way ]
last 60 frames        ── 16.7 ms  top 20 ms
PHASES per frame  view 12/s × 5.80 ms each
[ update ███████ view ░░ | encode ████████ ]
■ update 4.31   ■ view 1.20   ■ encode 8.09
58  presents   3 input   0 skipped/s
loop  9.1 ms ×95/s  86% busy  156 MB
```

| Group | Shows |
| --- | --- |
| **FRAME** | Frames drawn, and the frame interval, the time between two drawn frames: average, p95 and worst (gaps over 250 ms are rests, left out). The top line names the window, or says `idle` once it has drawn nothing for a second (`waiting for frames` before its first). |
| **WORK** | A frame's work (Rune's update + encode) and its worst, and a bar splitting it by where it ran: **rune** (blue) is Rust (events, layout, motion, paint, GPU encoding), **bindings** (pink) is calls from JavaScript into Rust (creating elements, builder methods, conversions, and the Rune work they do), **js** (amber) is the app's TypeScript itself (views, handlers, `poll`, a compositor's plan). Under it, the last 60 frames' work stacked in the same three colours. The graph's scale fits the slowest of them, and the caption gives its top; the 16.7 ms line (one 60 Hz frame) shows when the top reaches it. |
| **PHASES** | The same work per frame split by Rune's two phases: **update** (green: events, `poll`, the view, layout, paint) and **encode** (lilac: uploads and the draw's submission, or a compositor). **view** (pale green) is the JavaScript view call, bindings included, per frame: all its calls in the last second over the frames drawn. It runs inside update, so its part of the bar sits at the end of update's. The header gives view calls a second and the time each call takes. |
| footer | Frames presented (`--` until the platform reports them), frames that followed input (pointer moves, clicks, keys: hovering over a window redraws it) and frames skipped (covered, minimised, no drawable in time), a second; then the process's turns of Rune's event loop from JavaScript, shared by all its windows (time per tick, frames included; ticks a second; the share of the main thread they take) and its memory footprint. |

The work bar, its legend and the graph use the same three colours; the phases use their own
three, apart from the work colours also for colour-blind readers. Every number is in ms per frame
unless it says otherwise. Numbers are monospaced and keep their width, so they don't jitter as
they change, and read `--` where there is nothing to average (no frames, no view calls).

**Explain mode.** Press `?`. The panel's edge lights, and the headline, each group (its header
or bar), each legend entry, the graph and each footer line take presses: a press shows what the number measures and
when to look at it (`encode`: uploading and submitting the frame's draw to the GPU, or a
compositor's passes; when high: too many draw items or heavy effects). The explanation sits
beside the panel, level with the number, when the window has room on the panel's left. Otherwise
it sits under the number, or over it, whichever side has room. In a window under 360 points tall
(or 316 wide) it sits at the top instead, under the panel's buttons and as tall as the window
allows: beside the panel, or over it when there's no room beside it. It is always inside the
window; if the window is still too short, its text scrolls and its edge fades. A press on the same number, or on the explanation, closes it; a press on another
switches to it. A folded panel unfolds while explain mode lasts. In explain mode the panel is a
modal: the app gets no presses or hover, beneath the panel or anywhere else, and its keyboard
focus moves to the panel until the mode ends. A click outside the panel, Esc or `?` leaves
explain mode; that click doesn't reach the app. Each press on the panel re-runs your view once,
to change the panel; the refreshes never do.

In a window that lets clicks through (`WindowOptions` with `click_through`, or
`set_click_through(true)`), no part of the panel can be pressed: it only shows the numbers.

Scripts can tap the panel by key: `runex-perf-explain` (`?`), `runex-perf-collapse` (`−`/`+`),
and in explain mode `runex-perf-frame`, `-work`, `-rune`, `-bindings`, `-js`, `-history` (the
graph), `-phases`, `-update`, `-view`, `-encode`, `-presents` and `-loop`. The open explanation
is `runex-perf-explanation`. The `--tree` dump shows the panel as the element keyed `runex-perf`,
inside an empty, zero-width `runex-perf-column` on the view's root (an explanation at the top sits
in `runex-perf-explanation-column`), next to an empty `runex-perf-corner` pinned to the root's
bottom-right corner, whose place gives the window's size. Folding, unfolding and explain mode
switch at once, without a fade.

Everything is measured and aggregated in Rust, so it costs JavaScript nothing per frame: Rune's
own frame reports give the update and encode times, a clock around each call from Rust into
JavaScript gives the JS share, and a clock around each binding call made while it runs gives the
bindings' share. The overlay redraws through Rune's live values, without re-running your view,
at most four times a second and only after frames of your own, so it never keeps a still window
drawing. It reads the window's size through `Cx::layout_with` only while the size decides something:
your view runs once more when a window opens, when a resize crosses the folding size (until
`−`/`+` chooses), and in explain mode when a resize moves an open explanation. A short window
caps the panel's height through layout, so other resizes run no view. Headless renders (`--snap`,
`--tree`, `--script`) draw no real frames, so there it reads `waiting for frames`.

To get the numbers in JavaScript (a dashboard, telemetry, a test asserting a frame budget), pass a
callback; it gets one `PerfStats` object a second, built in Rust:

```ts
App.new(spec).perf("none", (s) => {
  if (s.work_max_ms > 16) console.warn(`slow frame: ${s.work_max_ms.toFixed(1)} ms (js ${s.js_ms.toFixed(1)})`)
}).run()
```

Numbers from a debug build of the addon are much higher than a release build's; measure with the
published package or `bun run build:native`. With several windows, each window's panel has its
own state, and the JavaScript and binding time of whichever window drew is attributed to that
window's frame.

## Standard titlebar

On macOS, Rune's default frame (`Chrome::DEFAULT`) has no visible titlebar: the content fills the
window and the traffic lights sit over its top-left corner. Ports keep it, so they match their
Rust originals. For standard titled windows, with the title in a titlebar and the content below
it:

```sh
bun app.ts --titlebar                    # this run (or --titlebar=native)
RUNEX_TITLEBAR=native bun --hot app.ts   # the environment variable works anywhere: --hot, Vite, compiled binaries
bun scripts/demos.ts --titlebar          # every demo
```

The last flag beats the variable. An unknown value (`--titlebar=X`, `RUNEX_TITLEBAR=X`) prints a
warning, once a process, and keeps Rune's frame. Neither form of the flag reaches Rune or
`extra_args()`.

It applies to every app and window that doesn't choose its own frame. One that calls
`.chrome(..)` or `.titlebar(..)` (a titlebar the app draws) keeps its choice, and overlays keep
theirs. The window grows by the titlebar's height; the content keeps its size, and
`cx.titlebar_inset()` is 0.

Other platforms have a native frame either way, so their windows don't change. Headless runs
follow macOS on every platform (Rune's `headless_chrome` reports the frame as macOS would draw
it): with the switch, `cx.titlebar_inset()` is 0 there too, so a view that reads it lays out
differently (the playground example's sidebar, say), and `--chrome` draws no traffic lights.
So the switch changes `--snap` and `--tree` output, as RUNEX_PERF does. The tests, golden.ts and
compare.ts leave both variables out of the renders they start (docs/testing.md).
