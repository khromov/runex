# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

runex (npm: `runex-js`) is Node.js and Bun bindings for Rune, a GPU-rendered Rust UI framework (wgpu + winit).
It is a napi-rs cdylib (`src/`, Rust) plus a TypeScript facade (`ts/`). Rune itself is the git submodule
`vendor/rune` with runex's patches applied on top. Only ARM64 is built: macOS, Linux (gnu) and Windows (msvc).

Read these for depth: `docs/porting.md` (how Rust maps to TS, the limits), `docs/testing.md` (the test layers,
golden baselines, CI, the Rune update procedure), `docs/dev-workflow.md` (hot reload, Vite, `--perf`,
`--titlebar`), `scripts/README.md` (compare.ts), `tools/bindgen/README.md` (the generator).

## Commands

```sh
node scripts/prepare-rune.mjs        # apply patches/ to vendor/rune (idempotent); --check verifies, --reapply rebuilds
bun install
bun run build                        # release addon (runex.<platform>.node, native.cjs, native.d.cts) + dist/
./scripts/dev-install.sh             # debug addon installed by atomic rename, then tsc; pass --release for release
bun run build:ts                     # ts/ -> dist/ only
bun run typecheck                    # everything; reads dist/*.d.ts, so build:ts first

bun examples/hello/main.ts                              # a window
bun examples/hello/main.ts --snap out.png --scene on    # headless render, then exit (also --tree X.json)
bun scripts/demos.ts [names...]                         # open examples one after another
```

Prefer `./scripts/dev-install.sh` to `bun run build:native`/`build:debug`. napi writes the `.node` straight into
the repo root, but running examples, the compare harness or other agents may have that file mapped. The script
copies the new file in and renames it over the old one.

Tests (Bun's runner; `bunfig.toml` sets root `test/unit` and preloads `test/preload.ts`):

```sh
bun test                                   # test/unit only: headless, no cargo, no windows
bun run test                               # fast tier: build:ts, typecheck, test/static, test/unit, dist-fresh, golden quick
bun run test:unit                          # unit tests in random order; a failure prints --seed=N
bun test ./test/unit --seed=N              # replay that order
bun test ./test/unit/conv.test.ts -t "Duration"   # one file / one test name
bun test ./test/unit --update-snapshots    # bless toMatchSnapshot values (read the diff first)
bun run test:golden                        # golden baselines, standard tier
bun scripts/golden.ts 'hello/*' kit-gallery        # golden filtered by case-id glob/prefix
bun run golden:update                      # bless golden trees + darwin manifest (Mac); scripts/golden-linux.sh --update for Linux
bun run test:windowed                      # real windows through the JS pump (RUNEX_WINDOWED=1 forces, 0 skips)
bun run test:dev                           # bun --compile, Vite, npm pack, consumer project
bun scripts/compare.ts hello --runtime bun,node    # a port vs its Rust original: identical PNG + tree
bun run test:full                          # everything (10-15 min)
bun run check:bindings                     # bindgen --check: generated code is deterministic and current
bun run update:rune <rev|--tip>            # move vendor/rune and run every layer; writes out/update-rune/*/summary.md
bun run clean                              # remove out/, temp folders and both cargo targets (--docker: the volumes too)
```

Tests import `runex-js`, which resolves to `dist/` through the package's self-reference. After editing `ts/`,
run `bun run build:ts` before `bun test`. After editing `src/`, rebuild the addon. If `dist-fresh` fails,
run `rm -rf dist && bun run build:ts`.

There is no JS linter and no `cargo fmt` gate. The Rust code isn't rustfmt-formatted, so don't run
`cargo fmt` on the crate. Rust `#[test]`s aren't used, because a napi cdylib's test binaries don't link without
Node's symbols. Rust logic is tested from JavaScript.

## Architecture

**Generated vs hand-written.** `tools/bindgen` reads Rune's rustdoc JSON and generates `src/gen/*.rs` (napi
classes, conversions, `tramp.rs` trampolines for `fn` pointers), `ts/gen/types.ts` (every declaration, with
Rune's docs as JSDoc), `ts/gen/<crate>/**` (one module per Rust module), `tools/bindgen/report.md` (what it
skipped) and `tools/bindgen/surface.txt` (the API surface). Never hand-edit these. Change `tools/bindgen/config.ts`
or the generator and run `bun tools/bindgen/main.ts` instead (`--rustdoc` refreshes the JSON, macOS only, since
`docTarget` is `aarch64-apple-darwin`). Platform-gated items get `#[cfg]`s through `tools/bindgen/cfg.ts`. The
hand-written parts are `src/app.rs` (apps and `Pump`), `src/state.rs`, `src/js.rs`, `src/conv.rs`, `src/idle.rs`,
`src/perf.rs` and `src/manual/` (windows, overlays, live values, motion, the compositor, frame reports, `tooling`,
the kit's `Tree`/`TreeModel`, the icon swap, notify's `on_click`). On the TS side they are `ts/app.ts`, `windows.ts`,
`overlay.ts`, `live.ts`, `compose.ts`, `loop.ts`, `perf.ts`, `tooling.ts`, `tree.ts`, `icons.ts`, `notify-click.ts`
and `vite.ts`. The entry points (`ts/index.ts`, `kit.ts`, `fx.ts`, `notify.ts`, ...) mostly re-export
`ts/gen/<crate>`.

**Pumped event loop.** Rune's `App::run` blocks the main thread, and JavaScript needs that thread.
`patches/0001-pump-event-loop.patch` adds `App::start() -> Pump` (winit `pump_app_events`) and a pump wake hook.
`ts/loop.ts` ticks the pump from JS timers. `tick()` returns when the next turn is due (`-2` means quit). Rune's
own wakes call back through `set_wake`. OS input is polled every `RUNEX_ACTIVE_MS`/`RUNEX_IDLE_MS`. On macOS an
idle tick only peeks AppKit's queue (`src/idle.rs`, in a private run-loop mode) because a real pump is expensive.
In the patched Rune, every wake must go through `send_wake` (`window/pump_wake.rs`). `scripts/patch-lint.ts`
fails on a raw `send_event`. It also checks sha256 fingerprints of upstream functions that the patch copies
(`patches/fingerprints.json`).

**State bridge.** Every app's Rust state type is `JsState { value: JsRef, fns: Rc<AppFns> }` (`src/state.rs`).
Rune's fn-pointer hooks (view, poll, on_key, ...) find the JS functions through the state. Hot reload (`bun --hot`,
the Vite plugin) swaps `AppFns` in place and keeps the window and state. Rune calls back into JS synchronously while
JS is inside a call into the addon. `src/js.rs` records the env, catches JS exceptions (they can't unwind through
Rune) and rethrows them when the outer call returns.

**Conversions and ownership** (`src/conv.rs`, mirrored in `docs/porting.md`). A Rust struct whose fields are all
public is a plain JS object (a "record"). Unit enum variants are strings, and other variants are `{ Variant: payload }`.
Everything else is a napi class holding a `conv::Slot`. Non-`Copy` builders mutate in place and return `this`, and
passing one by value moves it, so later use throws. `Copy` classes are values, and class constants are shared slots
that get copied on use. `Duration` is in seconds and `Option` is `T | null`. Keep napi8: with napi7, class unwraps
are about 10× slower.

**Compositor.** Rust can't take raw wgpu passes from JS. `src/manual/compose/` is one general
`rune::compose::Compositor`: Rust owns every GPU resource and pass (rune-fx, rune-light, offscreen targets,
resolve), and a JS object's `render(frame)` returns a per-frame plan. It has two pipelines, `"ui"` (fx layers at
`El::effect` slots) and `"hdr"` (an Rgba16Float scene, instances routed by `El::mark`). `ts/compose.ts` documents it.

**vendor/rune + patches.** Rune is never forked or edited in place. All changes live in `patches/*.patch`, applied
in name order by `scripts/prepare-rune.mjs`. `--check` fails on any edit beyond the pin plus the patches. Upstream
Rune bugs are carried as extra patches (for example `0002-metal-threadgroup-memory.patch`) until upstream fixes
them. The Rust toolchain is pinned to Rune's (`rust-toolchain.toml`, 1.99.1).

## Conventions and invariants

- The TS API mirrors Rust **name for name, snake_case included** (`on_press`, `w_full`, `tok.motion.SNAPPY`).
  Don't camelCase.
- `examples/<name>/main.ts` is a port of `vendor/rune/examples/<name>`. A port must render byte-identical PNGs and
  identical `--tree` output to the Rust original for every window and scene, on Bun and Node
  (`bun scripts/compare.ts <name> --runtime bun,node`). Mirror Rust's f32 arithmetic with `Math.fround` step by step
  where pixels are off by a hair. Per-example settings and skips go in `scripts/compare.config.ts`.
- Golden baselines (`test/golden/`) hold normalized trees, committed in main, and per-platform PNG sha256
  manifests. The PNG bytes live in the orphan branch `golden-images`. Bless only after reading the diff.
  `linux-arm64-lavapipe` is the canonical, blocking pixel platform. A new example or scene fails with
  "new scenes" until `--update` records its listing.
- `RUNEX_PERF` and `RUNEX_TITLEBAR` change what an app draws. Any render that a test or harness spawns must use
  `renderEnv()` (`scripts/lib/env.ts`), which strips them. `test/golden.test.ts` fails on a spawn that skips it.
- Bun 1.4 test pitfalls: `toMatchObject` writes asymmetric matchers into the object it receives. Assert on a copy
  (`expect({ ...obj }).toMatchObject(...)`), especially for shared constants such as `tok.motion.*`. All test
  files share one process, and the file order depends on the filesystem, so tests must not share state across
  `test()` calls.
- Windowed tests run each scenario as its own process, because winit allows one event loop per process.
- Tools clean up after themselves (docs/testing.md, Disk): a new script that builds or renders a lot deletes
  its scratch output once it passes, builds Rune through `runeCargoEnv()` (scripts/lib/cargo.ts), and removes
  its temp folders on every exit path (`process.exit` skips `finally`).
- Files use LF everywhere (`.gitattributes`). CRLF breaks `git apply` of the patches and the exact golden and
  snapshot comparisons.
- Changing package names or exports touches the snapshots and checks in `test/pack/` (`exports.test.ts`,
  `name.test.ts`). `native.cjs` embeds the platform package names (`@runex-js/binding-<platform>`).
