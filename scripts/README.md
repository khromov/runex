# scripts

## compare.ts: TypeScript ports vs the Rust examples

Every Rust example in `vendor/rune/examples/<name>` except site-scenes gets a TypeScript port at
`examples/<name>/main.ts`. `compare.ts` proves a port renders 1:1 with the original: same
pixels, same element tree, same windows and scenes.

```sh
bun run compare                          # every ported example, with bun
bun scripts/compare.ts hello settings    # just these
bun scripts/compare.ts --all             # every Rust example; unported ones report "not ported"
bun scripts/compare.ts hello --runtime bun,node --json out/compare/report.json
bun scripts/compare.ts settings --scene dark --scene "(none)"
bun scripts/compare.ts hello -- --theme light --at 0.5 --scale 1   # Rune flags for both sides
```

Options: `--runtime bun|node|bun,node`, `--json FILE`, `--strict` (unported fails),
`--scene NAME` / `--window KEY` (repeatable filters), `--no-tree`, `--no-build`, `--release`,
`--self-check` (render the Rust side twice to catch nondeterminism), `--jobs N`,
`--timeout S`, `--max-diffs N`, `--out DIR`. `--help` lists them.

For each example it:

1. Builds the Rust binary with `cargo build -p <package> --bin <bin>` in `vendor/rune`, one
   package per invocation, as `cargo run -p <package>` would (building several at once unifies
   their dependencies' features, which rebuilds `rune` and links different binaries). Package
   and binary come from `cargo metadata`; a fresh build costs ~0.3 s; `--no-build` skips Cargo.
2. Discovers what to render, on both sides, and fails if the port's lists differ:
   - windows: `--list-windows` (`main` for a single-window app; `run_windows` keys otherwise);
   - each window's scenes: `--list-scenes` (with `--window KEY` when there are several). If
     the Rust listing fails it falls back to the `scenes: &[("name", ..)]` arrays in the
     source (macro-generated lists, like kit-gallery's, need the flag).
3. Renders every window × (no scene, then each scene) with
   `--snap X.png --tree X.json [--window KEY] [--scene NAME]`: the Rust binary from
   `vendor/rune`, the port as `bun|node examples/<name>/main.ts` from the repo root.
4. Compares: byte-identical PNGs pass. Otherwise it decodes both and reports the differing
   pixel count, largest channel difference and bounding box, and writes `*.diff.png`
   (differences in magenta over the faded Rust frame). The `--tree` JSON is compared field by
   field; the first differences are printed as paths such as
   `elements[3]<#0/switch>.rect[0]: rust 141, port 140`.

It prints a table, writes everything to `out/compare/<name>/` (`_none.*` is the render without
`--scene`; `*.rust.png`, `*.bun.png`, `*.node.png`, `*.diff.png`, `*.json`, `*.log` for failed
processes) and exits 1 on any failure. A missing port is "not ported", not a failure, unless
`--strict`.

Statuses: `pass` (identical), `close` (within a configured tolerance), `fail`, `error` (a
process failed, timed out or wrote nothing), `flaky` (`--self-check` saw the Rust side vary),
`skip` (config).

### compare.config.ts

Per-example settings, typed by `ExampleConfig` in `compare.ts`:

```ts
"glass-card": { skip: "why it can't render headless" },
"kit-gallery": { args: ["--kit", "neutral"] },             // Rune/app args for every render
"video-player": { scenes: { "(none)": { args: ["--at", "0.6"] } } },
"shapes": { tolerance: { pixels: 20, delta: 2 }, ignoreTree: [/\.video\.time$/] },
"launcher": { windows: { launcher: { skip: "..." } } },
```

Also `env`, `rustCwd` (relative to `vendor/rune`), `tsCwd` (relative to the repo), `timeout`,
`package`, `bin`. `"(none)"` names the render without `--scene`.

### test/examples.test.ts

`bun test test/examples.test.ts` runs the same comparison for every ported example and expects
no failures. It builds the Rust binaries once. `RUNEX_COMPARE_RUNTIMES=bun|node|bun,node`
picks the runtimes (default: both, when `node` can run `.ts`); `RUNEX_COMPARE_RELEASE=1`
builds the Rust side in release.

### Things to know when porting

- Headless renders are deterministic: a virtual clock (`--at`, default 0 = the first frame),
  `--scale 2`, dark theme, one virtual display, and video decoded on the virtual clock too.
  Every window and scene of every example except the two skipped renders byte-identically
  run to run (PNG and `--tree`), so a difference is the port's. `--self-check` re-checks it.
  Renders start without `RUNEX_PERF` and `RUNEX_TITLEBAR` (scripts/lib/env.ts), which would
  add the perf overlay or change the titlebar inset on the TypeScript side only.
- `--snap` defaults to t = 0, before anything moves. Pass `-- --at 1.5` (or put `args` in the
  config) to compare an animated moment, e.g. `shapes` (its waveform follows `poll`'s time).
  The config pins `video-player` to `--at 0.6`, where the test clip has a decoded frame
  (at 0 it shows "Loading").
- `--snap` and `--tree` come from one run, at the same frame. `--tree` has the element list
  (path, role, rect, fill, opacity, text, ...), the accessibility tree, the title, viewport
  and `animating`: a port that matches pixels but not structure (keys, roles, labels) fails.
- The Rust examples build in debug by default; the runex addon is a release build. hello
  renders the same bytes either way, but the compositor examples are slow in debug
  (cursed-settings 5–30 s, lab up to ~65 s per render): use `--release` for them.
- Some examples read `std::env::args()` themselves: `live-values`, `overlay` and `video-tiles`
  look for `--snap`/`--tree`/`--list-scenes`/... to skip their wall-clock threads or windows,
  `background` checks `--open`, `launcher` `--desktop`. The port has to read `process.argv`
  the same way, or its output (or its window list) differs.
- The port runs from the repo root and the Rust binary from `vendor/rune`; set `tsCwd` or
  `rustCwd` if an example reads files relative to the working directory.

### What the comparison doesn't cover

`compare.ts` checks what `--list-windows`, `--list-scenes`, `--snap` and `--tree` report for
each example's main binary, run headless. Check the rest by hand, giving both sides the same
flags and input:

- Overlays (`App::overlay`) and tray items aren't windows to the tooling: `--list-windows`
  doesn't list them and `--snap` doesn't draw them. In background, glass-panel and overlay-lab
  only the main window is compared (glass-panel's is 1×1 pt), not background's HUD and capsule
  or overlay-lab's pill and pickers.
- Processes get no stdin, and a render's stdout and stderr aren't compared (they're kept in
  `*.log` only when a process fails): background's stdin commands, rich-clipboard's stdout
  lines and Rune's warnings on stderr go unchecked.
- No `--script` runs unless one is passed after `--`, so press, drag and key handlers don't run
  (settings' and web-showcase's drags, for example).
- Code that runs only in a window, which both sides skip under `--snap`: live-values' and
  overlay's 120 Hz `setup` producers, overlay's `on_created` and click-through.
- One binary per example (overlay-lab's `bin/` tools aren't compared). A path behind an
  environment variable is compared only when a config entry sets it in `env` (none sets
  overlay-lab's `OVERLAY_LAB_UNDERLAY`).
- App-level modes aren't scenes: kit-gallery's `--kit neutral|palette` and `--reduced-motion`,
  playground's `--playground NAME --variant N` stories, live-values' `--rebuild`. Compare them
  by passing those flags after `--`, or in a config entry's `args`.
- glass-card is skipped (compare.config.ts): both windows call `App::args` with an empty list (the card's is empty unless
  `GLASS_CARD_TRACE` is set), in Rust and in the port, so `--snap`, `--list-windows` and the other tooling flags are ignored and real
  windows open. Comparing it needs copies of both sides without the `.args(..)` calls.
  site-scenes is skipped too: it isn't a Rune app.

## demos.ts: look through every example

Opens the examples one after another, for inspecting them by hand: the next starts when you close
the current one's window. Each gets a header with its description and the command it ran.

```sh
bun run demos                        # every example, on Bun (alphabetical)
bun scripts/demos.ts --perf          # with the performance overlay in every window (RUNEX_PERF)
bun scripts/demos.ts --titlebar      # macOS: standard titled windows (RUNEX_TITLEBAR=native)
bun scripts/demos.ts --runtime node  # on Node
bun scripts/demos.ts --rust          # Rune's Rust originals, for comparison (cargo run --release)
bun scripts/demos.ts --from matched  # resume at one; or name the ones you want: hello todo
bun scripts/demos.ts --list          # the playlist
```

Ctrl+C ends the current demo and starts the next; Ctrl+C twice within a second quits. A few keep
running without a window (`background` after its window closes, the overlay demos); their header
says how to leave them. `--skip NAME` leaves one out, and Rune arguments go after `--`.

## linux-docker.sh: Linux in Docker

CI's Linux leg on your machine: Ubuntu 22.04 in Docker (ARM64 on Apple Silicon), rendering headless
with Mesa's lavapipe software Vulkan driver. It copies the checkout into a Docker volume (nothing
builds in, or writes to, your tree), builds the addon and the TypeScript there, then runs one
command. Results (the addon, PNGs, logs, compare's report.json) go to `--out` (default
`out/linux`), the only host directory the container sees.

```sh
scripts/linux-docker.sh smoke                      # examples/hello --snap on Bun and Node
scripts/linux-docker.sh test                       # bun run test:unit
scripts/linux-docker.sh compare --all              # compare.ts --runtime bun,node --release
scripts/linux-docker.sh compare --self-check lab   # examples and options pass through
scripts/linux-docker.sh run bash -c 'RUNEX_PERF=1 node examples/todo/main.ts --tree /out/todo.json'
scripts/linux-docker.sh shell                      # an interactive shell in the built copy
```

The first run builds the image (a few minutes) and every crate; Cargo's caches, Bun's and the
copy's node_modules stay in volumes, so later runs rebuild in seconds. `compare --all` builds the
Rust examples too (about 10 minutes the first time, with the default `CARGO_BUILD_JOBS=4`) and
renders all 184 window × scene pairs on three sides in 2 to 4 minutes. Runs share one work
volume, so run one at a time (`RUNEX_DOCKER_PREFIX` names a separate set of volumes).

On Linux every compared render but one is byte-identical to the Rust example's (shapes' first
frame differs by one pixel: glibc's `sinf`, see compare.config.ts), and lavapipe renders
identically run to run. The container has no display, so a windowed app runs under Xvfb, which
the image has: `run xvfb-run -a bun examples/shapes/main.ts --native --trace /out/shapes.jsonl
--frames 200` opens the window and traces 200 frames. Without it, winit fails with `neither
WAYLAND_DISPLAY nor WAYLAND_SOCKET nor DISPLAY is set`. Xvfb has no vsync, and lavapipe draws on
the CPU, so compare frame timings with the Rust example's on the same setup.
