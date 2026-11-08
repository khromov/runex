# runex

Node.js and Bun bindings for [Rune](https://github.com/anomalyco/rune), the GPU-rendered Rust UI
framework (wgpu + winit). Write a Rune app in TypeScript, with the same API as Rust's, and run it
with `bun app.ts` or `node app.ts`. Prebuilt for ARM64 on macOS, Linux and Windows.

```ts
import { AppSpec, type El, col, el, run, text, tok } from "runex-js"
const { motion, type_ } = tok

type State = { on: boolean }

function view(s: State): El {
  const t = tok.theme(true)
  const knob = el().key("knob").size(18, 18).radius(9).fill(t.knob).absolute(s.on ? 18 : 2, 2)
  const sw = el().key("switch").role("switch").label("Lights").checked(s.on).focusable(true)
    .size(38, 22).radius(11).fill(s.on ? tok.accent(0, true) : t.control_off).motion(motion.SNAPPY)
    .on_press((s: State) => { s.on = !s.on })
    .child(knob)
  return col().w_full().h_full().center().gap(16).fill(t.bg)
    .child(text(s.on ? "Lights on" : "Lights off").font(type_.TITLE).color(t.text))
    .child(sw)
}

run({ ...AppSpec.new<State>("Hello", [320, 200], () => ({ on: false }), view), scenes: [["on", (s) => { s.on = true }]] })
```

```sh
bun hello.ts                         # a window
node hello.ts                        # the same, on Node 22.18+
bun --hot hello.ts                   # hot reload: edit and save, the window updates in place
bun hello.ts --snap out.png --scene on   # headless: render to PNG and exit
bun build --compile hello.ts --outfile hello   # one self-contained executable
```

That's Rune's [examples/hello][hello-rs] line for line, and it renders the same pixels: every
example in [examples/](examples) except `vite` (this app under Vite) is a port of one of Rune's,
checked byte for byte against the Rust original (see [Examples](#examples)).

[hello-rs]: https://github.com/anomalyco/rune/blob/d03349e25189ce1edc8c26ada6bf6d4aac72c826/examples/hello/src/main.rs

## The API

The TypeScript API mirrors Rust's `rune` crate **name for name**, snake_case included, so Rune's
docs, examples and your Rust knowledge carry over. Almost all of it is generated from Rune's own
signatures and docs (`tools/bindgen`, from rustdoc JSON), so it tracks Rune and every item has Rune's
documentation as JSDoc.

| Rust crate | Import |
| --- | --- |
| `rune` | `runex-js` |
| `rune_kit` (components) | `runex-js/kit` |
| `rune_fx`, `rune_light` (effects) | `runex-js/fx`, `runex-js/light` |
| `rune_motion` | `runex-js/motion` (and `runex-js` for what `rune` re-exports) |
| `rune_knobs`, `rune_theme_opencode` | `runex-js/knobs`, `runex-js/theme-opencode` |
| `rune_notify` (system notifications) | `runex-js/notify` |

How Rust maps to TypeScript, in short ([docs/porting.md](docs/porting.md) has the whole guide):

- The app's state is a plain object that handlers mutate in place, as `&mut S` is: `(s: State) => { s.on = !s.on }`.
- Structs whose fields are all public (`Color`, `Shadow`, `Spring`, `ScrollSpec`, ...) are plain objects:
  Rust's struct literal is an object literal, `..Default::default()` a spread.
- Other types are classes with Rust's methods: `TextStyle.new(13, 600).lh(16)`, `el().key("k").w_full()`.
  Builders of types that aren't `Clone` (`El`, kit components) change in place and return `this`,
  and using a moved value throws, as Rust wouldn't compile it.
- Enums are strings for unit variants and `{ Variant: value }` otherwise: `"Center"`, `{ Named: "Inter" }`.
- `Option<T>` is `T | null`, `Vec<T>` an array, tuples arrays, `Duration` seconds.
- Modules are namespaces: `tok.motion.SNAPPY`, `color.hex("#3d6bff")`.

`App`, `run_windows`/`WindowSpec`, overlays (`OverlaySpec`, `app.overlay`), live values (`Live`,
`LiveText`) and the effect compositor are written by hand on top, with the same names.

### How it runs

Rune draws on the main thread, and so does JavaScript. Instead of handing the thread to Rune's
event loop (`App::run` never returns), runex turns it a step at a time from JavaScript's own loop
(a small Rune patch adds `App::start` and `Pump`), so timers, promises, `fetch` and I/O keep working
next to the window. Views and handlers are called synchronously from Rust; an exception in one is
rethrown to JavaScript (a throwing view shows an error view until it's fixed). An idle window costs
about 1 to 2% of a core.

On macOS, runex turns off AppKit's update cycle for the process (`NSApplicationUpdateCycleEnabled`
in the registration domain), as it is for apps built with an SDK older than macOS 26. With it on,
AppKit holds events back from a pumped loop for part of each frame, and each turn spins until it
lets them through. Under Bun, which is built with the macOS 26 SDK, an animating window took 1.4 to
4 times Node's CPU. A user default still turns the update cycle back on.

On Linux and Windows, an animating window asks for its next frame from inside the frame, and winit
delivers it on the loop's next pass. A turn that asks for one makes the next turn due at once, so
frames follow each other as they do in Rust. Before, each frame waited for the next input check,
about 11 ms later: under Xvfb, frames that Rust drew at 58 fps came at 35 fps from Bun and Node.

Each builder call crosses into Rust: about 0.25 µs for a method like `.w(10)`, about 1 µs to create
an element (release build, M-series Mac; `bun bench/calls.ts`). A view of 1,000 rows of 11 calls
each builds in about 9 ms on Bun and 12 ms on Node (`bench/rows.ts`). Rune re-runs a view only when
state changes, never for hover, press or animation, and `virtual_rows`/`memo` keep large views cheap
as they do in Rust.

## Hot reload, Vite and single executables

- **`bun --hot app.ts`**: saving any module updates the open window in place: same process, same
  window, state kept, handlers from the new code.
- **Vite** (`runex-js/vite`): `plugins: [runex({ entry: "./main.ts" })]` in `vite.config.ts`, then `vite`.
  The dev server opens the window and HMR swaps the view in place, on Node or Bun. `vite build`
  bundles the app into one `.mjs` for `node`/`bun`.
- **`bun build --compile app.ts --outfile app`**: one executable with the native addon embedded.

- **`--perf`** (or `RUNEX_PERF=1`, or `App.new(spec).perf()`): a performance overlay in the window's
  corner with fps, frame times and each frame's work split into Rune (Rust), bindings and JS, Rune's
  update and encode phases, plus a frame-work graph. Clicks and hover pass through it to the app; its
  `?` button turns on explain mode, where a click on any number shows what it measures and when to
  look at it. `--perf=log` prints it once a second instead.
- **`--titlebar`** (or `--titlebar=native`, or `RUNEX_TITLEBAR=native`): on macOS, standard titled
  windows instead of Rune's default frame, whose content runs under the traffic lights.

[docs/dev-workflow.md](docs/dev-workflow.md) has the details and limits.

## Svelte

[`@runex-js/svelte`](packages/svelte) is a Svelte custom renderer for runex: components in
`.svelte` files, Rune's `El` methods as attributes (`<row gap={8} w_full fill={t.card}>`), CSS in
`<style>` blocks, rune_kit's controls as components, hot reload, and the same headless `--snap`,
`--tree` and `--script` tooling. `npm create runex-svelte@latest my-app` scaffolds an app
([packages/create-runex-svelte](packages/create-runex-svelte)). Its README has the details.

## Examples

Every Rust example in Rune's `examples/` is ported to TypeScript in [examples/](examples), except
site-scenes, which is a renderer CLI rather than an app. Each port is verified with
`bun scripts/compare.ts <example> --runtime bun,node`, which renders every window and scene of the
Rust original and of the port (`--snap`, `--tree`) on Bun and on Node and requires identical PNGs and element trees
([scripts/README.md](scripts/README.md)).

The table counts one comparison per window, scene and runtime. "identical (4/4)" means that in all
four, the PNG was byte-identical to the Rust original's and so was the element tree. In the last
full run (macOS, release build), all 424 comparisons were identical. glass-card is ported but can't
render headless, so it isn't compared.

<!-- examples-table -->

| Example | Windows × scenes | Result (bun, node) |
| --- | --- | --- |
| [background](examples/background) | 2 | identical (4/4) |
| [cursed-settings](examples/cursed-settings) | 17 | identical (34/34) |
| [drag-out](examples/drag-out) | 1 | identical (2/2) |
| [drop-files](examples/drop-files) | 1 | identical (2/2) |
| [frosted-bar](examples/frosted-bar) | 3 | identical (6/6) |
| [glass-card](examples/glass-card) | – | skipped: both windows set App::args(vec![]), which replaces Rune's tooling flags: --snap and --list-scenes open real windows (and never exit) instead of rendering headless |
| [glass-panel](examples/glass-panel) | 1 | identical (2/2) |
| [hello](examples/hello) | 2 | identical (4/4) |
| [kit-gallery](examples/kit-gallery) | 120 | identical (240/240) |
| [knobs](examples/knobs) | 3 | identical (6/6) |
| [lab](examples/lab) | 16 | identical (32/32) |
| [launcher](examples/launcher) | 2 | identical (4/4) |
| [live-values](examples/live-values) | 2 | identical (4/4) |
| [matched](examples/matched) | 3 | identical (6/6) |
| [odometer](examples/odometer) | 1 | identical (2/2) |
| [overlay](examples/overlay) | 2 | identical (4/4) |
| [overlay-lab](examples/overlay-lab) | 4 | identical (8/8) |
| [playground](examples/playground) | 4 | identical (8/8) |
| [rich-clipboard](examples/rich-clipboard) | 1 | identical (2/2) |
| [settings](examples/settings) | 8 | identical (16/16) |
| [shapes](examples/shapes) | 1 | identical (2/2) |
| [showreel](examples/showreel) | 12 | identical (24/24) |
| [site-scenes](https://github.com/anomalyco/rune/tree/d03349e25189ce1edc8c26ada6bf6d4aac72c826/examples/site-scenes) | – | skipped: not a Rune app: a custom renderer CLI (--out DIR, --only NAME, --t SECONDS) that writes its own PNGs and ignores Rune's tooling flags (--snap, --tree, --list-scenes) |
| [sketch](examples/sketch) | 1 | identical (2/2) |
| [todo](examples/todo) | 1 | identical (2/2) |
| [video-player](examples/video-player) | 1 | identical (2/2) |
| [video-tiles](examples/video-tiles) | 1 | identical (2/2) |
| [web-hello](examples/web-hello) | 1 | identical (2/2) |
| [web-showcase](examples/web-showcase) | 1 | identical (2/2) |

## Install

```sh
npm install runex-js
# or
bun add runex-js
```

The package is plain JavaScript plus a loader (`native.cjs`). Its `optionalDependencies` list one
prebuilt addon per platform, and npm, pnpm, Yarn and Bun install only the one whose `os`, `cpu`
and `libc` match:

| Platform | Package |
| --- | --- |
| macOS, Apple Silicon | `@runex-js/binding-darwin-arm64` |
| Linux arm64, glibc 2.35+ (Ubuntu 22.04+, Debian 12+, Fedora 36+) | `@runex-js/binding-linux-arm64-gnu` |
| Windows 11 on Arm | `@runex-js/binding-win32-arm64-msvc` |

Requirements:

- **Node.js 22.6+ or Bun 1.2+**, running as a native ARM64 process. An x64 runtime under Rosetta or
  Windows' x64 emulation looks for an x64 addon, which isn't published. Node runs `.ts` files
  directly from 22.18 / 23.6.
- **Linux**: a Vulkan driver. That's your GPU's Mesa driver, or Mesa's software rasterizer
  (lavapipe, `sudo apt-get install mesa-vulkan-drivers`) on a machine without one. Apps that
  open windows also need `libxkbcommon-x11-0` and an X11 or Wayland session. Headless runs need
  neither.
- **Windows**: Direct3D 12. With no GPU, WARP (D3D12's software rasterizer) works. The addon links
  the C runtime statically, so the Visual C++ Redistributable isn't needed.

Every runex app also takes Rune's headless flags. It renders offscreen, with no window or display,
then exits:

```sh
bun app.ts --snap out.png --scene on    # or: node app.ts --snap out.png --scene on
```

"Cannot find native binding" means the platform package wasn't installed. Either optional
dependencies were skipped (`--omit=optional`, `--no-optional`), the lockfile came from another
platform, or the runtime isn't ARM64.

## Building from source

You need git, [rustup](https://rustup.rs), Bun 1.2+ and Node.js 22.6+. `rust-toolchain.toml` pins
Rust 1.99.1 (the same as Rune), and rustup installs it on first use. Per platform you also need:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux (Debian/Ubuntu)**: `sudo apt-get install build-essential pkg-config libxkbcommon-dev`.
  On Fedora: `sudo dnf install gcc pkgconf-pkg-config libxkbcommon-devel`. libxkbcommon is the
  only system library the link needs. Rune dlopens Wayland and X11, so `libwayland-dev` isn't
  needed. rustc links with `--as-needed`, and the addon calls nothing in libxkbcommon, so the
  linker drops it again and the published addon depends only on glibc.
- **Windows**: Visual Studio 2022 (or its Build Tools) with "Desktop development with C++" and the
  MSVC ARM64 build tools.

The repository, [khromov/runex](https://github.com/khromov/runex), is private for now.

```sh
git clone --recurse-submodules https://github.com/khromov/runex.git && cd runex
node scripts/prepare-rune.mjs     # apply patches/ to vendor/rune (idempotent; --check verifies)
bun install
bun run build                     # build:native (release addon, native.cjs, native.d.cts) + build:ts (dist/)

bun examples/hello/main.ts                              # a window
bun examples/hello/main.ts --snap hello.png --scene on  # headless
node examples/hello/main.ts --snap hello.png --scene on
```

`bun run build:debug` builds an unoptimized addon faster. The addon lands in the repository root
as `runex.<platform>.node`, next to the `native.cjs` that loads it.

`vendor/rune` is a git submodule pinned to a Rune revision. `patches/` holds runex's two changes
to it: `0001-pump-event-loop.patch` adds `App::start` and `Pump`, so JavaScript can drive winit's
event loop, and `0002-metal-threadgroup-memory.patch` fixes a bug in Rune's Metal backend (see
[Platforms and CI](#platforms-and-ci)), carried until Rune fixes it upstream.
`scripts/prepare-rune.mjs` applies them in order and fetches the submodule if it's empty. Moving
the submodule to another revision may need the patches refreshed.

Headless on Linux without a GPU:

```sh
sudo apt-get install mesa-vulkan-drivers
bun examples/hello/main.ts --snap hello.png --scene on
```

To make sure lavapipe draws when a GPU is present too, set `VK_ICD_FILENAMES` to its manifest:
`/usr/share/vulkan/icd.d/lvp_icd.json` on Ubuntu 24.04, `lvp_icd.aarch64.json` on 22.04.

### Cross-compiling Windows ARM64 from macOS or Linux

[cargo-xwin](https://github.com/rust-cross/cargo-xwin) downloads the MSVC CRT and Windows SDK on
first use, which means accepting Microsoft's license. It compiles C with clang-cl and links with
Rust's own `rust-lld`.

```sh
uv tool install cargo-xwin        # or: cargo install --locked cargo-xwin
brew install llvm                 # clang-cl, llvm-lib (Linux: clang, llvm)
rustup target add aarch64-pc-windows-msvc
PATH="$(brew --prefix llvm)/bin:$PATH" npx napi build --platform --release \
  --target aarch64-pc-windows-msvc --cross-compile --target-dir target/xwin \
  --js native.cjs --dts native.d.cts && node scripts/fix-dts.mjs
```

The Linux addon builds natively on any ARM64 Linux, including a `linux/arm64` Docker container on
an Apple Silicon Mac. Use Ubuntu 22.04 (`ubuntu:22.04`) to match the glibc that CI links against.

## Platforms and CI

| Target | npm package | Built on (GitHub runner) | Smoke test |
| --- | --- | --- | --- |
| `aarch64-apple-darwin` | `@runex-js/binding-darwin-arm64` | `macos-26` | Metal; allowed to fail (below) |
| `aarch64-unknown-linux-gnu` | `@runex-js/binding-linux-arm64-gnu` | `ubuntu:22.04` container on `ubuntu-24.04-arm` | lavapipe on 24.04, and in an `ubuntu:22.04` container |
| `aarch64-pc-windows-msvc` | `@runex-js/binding-win32-arm64-msvc` | `windows-11-arm` | WARP (software D3D12) |

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, `v*` tags and manual runs
(`workflow_dispatch`):

1. **build**, one job per target. It checks out `vendor/rune` (shallow), installs Node 24 and Bun,
   runs `scripts/prepare-rune.mjs` (then `--check`), installs the pinned Rust, restores the Cargo cache,
   then runs `bun install`, `bun run build:native` (release) and `bun run build:ts`. It uploads
   `runex.<platform>.node`. The Linux job also uploads `dist/`, `native.cjs` and `native.d.cts`;
   the loader and types are the same from every platform's build.
2. **smoke**, one job per platform, on a clean checkout with the built artifacts. The Linux job
   (the `ubuntu:22.04` container, pinned lavapipe) is the canonical platform: the fast tier
   (`bun run test`), golden pixels and trees, the windowed tests under Xvfb, and the dev-workflow
   and packaging tests. macOS runs the same suite. Ubuntu 24.04 and Windows run the unit tests
   (`bun run test:unit`) and golden trees. [docs/testing.md](docs/testing.md) lists each job's
   checks. Golden diffs are uploaded when a check fails. Smoke runs even when another target's
   build fails, so the other platforms still report. A failed Linux build is the exception: every
   smoke job also needs the `js` artifact, which only the Linux build uploads. GitHub's macOS
   runners are VMs with Apple's paravirtual Metal device, which may be missing or reject a
   pipeline, so the macOS job may fail without failing the run.
3. **publish**, on `v*` tags only (see below).

Linux packages (Debian/Ubuntu names):

| Purpose | Packages |
| --- | --- |
| Build | `libxkbcommon-dev` (plus `build-essential` and `pkg-config`, which CI installs in its `ubuntu:22.04` container) |
| Headless rendering with no GPU | `mesa-vulkan-drivers` (lavapipe; pulls in `libvulkan1`). CI points `VK_ICD_FILENAMES` at `/usr/share/vulkan/icd.d/lvp_icd*.json` |
| Windowed apps | `libxkbcommon-x11-0` and a display (X11 or Wayland) |

The Linux addon is built in an `ubuntu:22.04` container so that it needs only glibc 2.35. Linked
on Ubuntu 24.04, Rust's standard library makes it require glibc 2.39, and it then fails to load on
22.04 or Debian 12 with "version `GLIBC_2.39' not found".

Snapshots aren't byte-identical across platforms. Rune rasterizes text itself everywhere, but its
default font smoothing is on for macOS, where it dilates glyph outlines to match Core Text, and
off elsewhere, so glyph edges differ slightly. Shapes, colors and layout match. Lighting did not:
Rune's Metal backend never sets the threadgroup memory a compute shader declares, so on macOS
rune-light's global illumination and shadows came out wrong (the lab and cursed-settings
examples). runex carries the fix, `patches/0002-metal-threadgroup-memory.patch`, until Rune fixes
it upstream. Compare snapshots per platform, not across them.

Only ARM64 is built. To add a target (for example `x86_64-unknown-linux-gnu`), add it to
`napi.targets` in `package.json`, run `npx napi create-npm-dirs`, and add a row to the CI
`build` and `smoke` matrices.

## Publishing

Releases go out from CI. Set the version, then tag:

```sh
npm version 0.2.0 --no-git-tag-version   # package.json; CI sets the platform packages' versions
(cd packages/svelte && npm version 0.2.0 --no-git-tag-version)
(cd packages/create-runex-svelte && npm version 0.2.0 --no-git-tag-version)
git commit -am "v0.2.0" && git tag -a v0.2.0 -m "v0.2.0" && git push --follow-tags
```

`@runex-js/svelte` and `create-runex-svelte` release in lockstep with `runex-js`: the `publish`
job fails when their versions differ from the tag.

The tag must be annotated (`-a`): `--follow-tags` pushes only annotated tags.
`git push origin v0.2.0` pushes a tag of either kind.

On a `v*` tag, the `publish` job runs once **build** and **smoke** pass (the macOS smoke may
fail). It checks that the tag matches `package.json`, then:

1. downloads the three `.node` artifacts and the JS build;
2. runs `napi artifacts`, which moves each addon into `npm/<platform>/`, and copies `LICENSE` and
   `THIRD_PARTY_NOTICES.md` in next to it;
3. runs `napi prepublish -t npm --no-gh-release`. This sets each platform package's version,
   publishes it, and writes `optionalDependencies` (`@runex-js/binding-<platform>` at the same
   version) into `package.json`. Those entries exist only in the published manifest, never in the
   repository;
4. runs `node scripts/fix-dts.mjs --publish` (the `prepack` step, which `--ignore-scripts` skips)
   and `npm publish --ignore-scripts` for `runex-js`. `prepublishOnly` would run step 3 again;
5. publishes `@runex-js/svelte` with `packages/svelte/scripts/publish.ts` (TypeScript compiled to
   `lib/`, the vendored Svelte build bundled, `runex-js` as a peer at this minor), then
   `create-runex-svelte` (its `prepack` copies the starter into `template/`).

**Publishing uses npm trusted publishing (OIDC): there is no npm token.** The `publish` job has
`id-token: write`, and `npm publish` trades that GitHub identity for a short-lived publish token,
which npm grants because each package names `khromov/runex`'s `ci.yml` as its trusted publisher.
It needs npm 11.5.1 or later (the job checks; Node 24 bundles npm 11) and a `repository.url` in
every package's `package.json` that matches this repository exactly. npm makes no provenance for
a private repository; once it is public, trusted publishing adds provenance by itself.

A trusted publisher can only be added to a package that already exists on npm, so each package's
first version is published by hand; after that, add `khromov/runex` and `ci.yml` as the trusted
publisher of all six packages (`runex-js`, the three `@runex-js/binding-<platform>`,
`@runex-js/svelte`, `create-runex-svelte`) in their settings on npmjs.com, or with
`npm trust github <package> --file ci.yml --repo khromov/runex --allow-publish`, allowed to
`npm publish` (new ones default to staged publishing only). Renaming `ci.yml` or moving the
repository means updating every package's trusted publisher.

What each package contains:

- **runex-js**: `dist/`, `native.cjs`, `native.d.cts`, `README.md`, `LICENSE`,
  `THIRD_PARTY_NOTICES.md` and `package.json`. No `.node` binaries, `vendor/`, sources or
  examples. Check with `npm pack --dry-run` after a build.
- **@runex-js/binding-\<platform\>**: `runex.<platform>.node`, `LICENSE`, `THIRD_PARTY_NOTICES.md`,
  `README.md` and `package.json`. `npm/<platform>/package.json` sets `os`, `cpu` and, on Linux,
  `libc: ["glibc"]`.
- **@runex-js/svelte**: `lib/` (compiled JS, declarations, the kit components as `.svelte`),
  `bin/`, `README.md`, `LICENSE`, and the custom-renderer Svelte build bundled under
  `node_modules/svelte`. `bun run pack` in `packages/svelte` makes the tarball;
  `bun run test:pack` installs it into a scaffolded app.
- **create-runex-svelte**: `index.js` and `template/` (the starter, `packages/svelte/starter`).

**Names.** `name` in `package.json` (`runex-js`) names the main package. `napi.packageName`
(`@runex-js/binding`) names the platform packages, which add the platform
(`@runex-js/binding-darwin-arm64`, ...) as in `npm/*/package.json`. The `@runex-js` scope belongs
to the npm organization `runex-js`, which must exist before the first publish. `native.cjs` embeds
the platform package names, so a rename needs a rebuild. `publishConfig.access` is `public`, which
scoped packages need.

## License

MIT © 2026 Stanislav Khromov. See [LICENSE](LICENSE).

runex builds on [Rune](https://github.com/anomalyco/rune), MIT © 2026 Anomaly, which is vendored
as a submodule in `vendor/rune` and statically linked into the native addon. The addon also embeds
fonts under the SIL Open Font License 1.1: Inter Regular, Medium and SemiBold (Rune's default UI
font), and Inter Variable and IBM Plex Mono Regular and Medium (from `rune-theme-opencode`). That
crate also carries [OpenCode](https://github.com/anomalyco/opencode)'s design tokens and icons,
MIT © 2025 opencode. The addon links crates from crates.io under their own licenses. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
