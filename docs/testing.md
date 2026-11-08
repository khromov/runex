# Testing

runex has one hard testing problem: telling when a Rune change breaks it. `scripts/compare.ts`
checks each TypeScript port against its Rust original **at the same Rune revision**. When Rune
changes, both sides move together, and compare stays green through most of what a bump changes:
theme and motion defaults, text and layout spacing, kit restyles, shaders, a renamed tooling flag
that Rune then ignores, and the pumped event loop, which no headless run reaches.

So the suite has three more kinds of check besides compare:

- **reference baselines**, committed values that change only when someone blesses them: element
  trees, PNG hashes, token values, the API surface, export lists;
- a **windowed** layer that drives real windows through the JavaScript pump;
- an **update procedure** that runs everything around a Rune bump and writes a checklist.

Comparison is exact by default. Masks exist only where nondeterminism was measured.

## Layers

| Layer | What it runs | Needs | Catches | Doesn't catch |
| --- | --- | --- | --- | --- |
| **L0 static** | typecheck of ts, examples, test, bench, scripts and tools; dist freshness; addon surface (every `$n.X` in ts/gen exists on the addon); bindgen `--check`; API-surface snapshot; patch integrity and lint; example inventory | the addon (no GPU); rustdoc JSON for bindgen `--check` | an API removed or renamed, stale generated code, patch drift, an extra edit in vendor/rune, a raw wake that bypasses the pump, a dropped example | anything that only shows when code runs |
| **L1 unit** (`test/unit`) | conversions, moves and ownership, errors, live values, windows, overlays, compositor plans, perf modes, arguments (`extra_args`, the titlebar switch), the tooling contract, a snapshot of every token and constant, a node smoke | the addon, a headless GPU | conversion bugs, changed defaults and tokens, a tooling flag Rune stopped honouring | pixels, layout of real examples |
| **L2 golden** (`scripts/golden.ts`) | every example's windows and scenes, frozen fixture apps, scripted interaction and motion checkpoints, listings; trees (shared) and PNG hashes (per platform) | the addon, a headless GPU | everything visual or structural a Rune change moves | the event loop; per-platform pixels on platforms without a manifest |
| **L3 compare** (`scripts/compare.ts`) | each port against its Rust original, PNG and tree | cargo | port drift | Rune changes (both sides move) |
| **L4 windowed** (`test/windowed`) | real windows through the pump: frames from `poll` without input, wakes from JS and from threads, quit, idle CPU, `on_stats`, multi-window, overlays, `bun --hot` | a display | event-loop and patch regressions (the "shapes only animate when the mouse moves" kind) | pixels |
| **L5 dev and packaging** (`test/devflow`, `test/pack`) | `bun build --compile`, Vite build and dev, `bun --hot` headless; npm pack contents, a consumer project with `skipLibCheck` off, export names, name consistency, platform packages | the addon | a broken release or dev workflow, a half-done rename, a dropped export | |
| **L6 update** (`scripts/update-rune.ts`) | L0 to L5 around a submodule bump, with a checklist | cargo | (an orchestrator, not a check) | |

Rust `#[test]`s aren't used: the crate is a napi cdylib, and its test binaries don't link
without Node's symbols. Its logic (conversions, perf, compositor plans) is tested through
JavaScript instead. `cargo fmt --check` isn't gated (the code isn't rustfmt-formatted);
`cargo clippy` runs nightly as a report.

## Commands

| Command | Runs | Budget (M-series Mac, unloaded) |
| --- | --- | --- |
| `bun test` | test/unit only (bunfig.toml's `[test] root`): never cargo, never a window | 10–20 s |
| `bun run test` | the **fast tier**: `build:ts`, `typecheck`, `test/static`, `test/unit`, `test/pack/dist-fresh.test.ts`, `test/golden.test.ts` (golden quick on Bun) | 45 s or less |
| `bun run test:unit` | `bun test --randomize ./test/unit` (a random file and test order each run; a failure prints its `--seed=N`, and `bun test ./test/unit --seed=N` replays that order) | 10–20 s |
| `bun run test:golden` | golden, standard tier on Bun | 1–2 min |
| `bun scripts/golden.ts --tier full --runtime bun,node` | every golden variant, Bun and Node | 4–6 min |
| `bun run test:windowed` | `test/windowed` (opens real windows; see gating below) | about 1 min |
| `bun run test:dev` | `test/devflow` and `test/pack` | 30–60 s |
| `bun run test:compare` | `test/examples.test.ts`: every port against Rust (27 cargo builds) | 5+ min warm |
| `bun run test:full` | the fast tier, golden full, windowed, dev, compare | 10–15 min |
| `bun run check:bindings` | `bun tools/bindgen/main.ts --check`: bindings regenerate identically from the cached rustdoc JSON | 10 s |
| `bun run update:rune <rev>` | the Rune update procedure (below) | 10–30 min |

Test files run against `dist/`, because examples and tests import `runex-js`, which resolves to
`dist/` (the package refers to itself). `bun run test` builds it first. `typecheck` also reads
`dist/*.d.ts`, so run `build:ts` before it. `test/pack/dist-fresh.test.ts` fails when `dist/` has
files no ts/ source makes (a renamed module's leftovers, old source maps), and, outside CI, when a
ts/ file is newer than its output. The fix is `rm -rf dist && bun run build:ts`.

A path on the `bun test` command line runs that path, whatever bunfig.toml's root is:
`bun test ./test/static`, `bun test ./test/pack/exports.test.ts`.

Snapshots (bun's `toMatchSnapshot`) are blessed with `--update-snapshots` on the file or folder:
`bun test ./test/unit --update-snapshots` (the value and error snapshots),
`bun test ./test/pack/exports.test.ts --update-snapshots` (export names). Read the diff first.

## Environment variables

| Variable | Effect |
| --- | --- |
| `RUNEX_WINDOWED` | `1`: run the windowed tests, and fail when a window doesn't open (CI sets it). `0`: skip them. Unset: run on macOS when not in CI and not over SSH, and on Linux when `DISPLAY` or `WAYLAND_DISPLAY` is set, once a one-frame probe window opened; otherwise every test skips, its name saying why. |
| `RUNEX_WINDOWED_RUNTIMES` | runtimes for each windowed fixture (default `bun,node`) |
| `RUNEX_WINDOWED_PENDING=run` | run the windowed tests listed as pending (known event-loop bugs, `test.todo`) as ordinary tests |
| `RUNEX_ACTIVE_MS`, `RUNEX_IDLE_MS` | how often ts/loop.ts checks for OS input while the app is in use and once it is idle, in milliseconds (defaults in ts/loop.ts). The windowed tests set both to 1000 so frames must come from Rune's wakes, not from input checks. |
| `RUNEX_GOLDEN_PLATFORM` | the PNG manifest key, instead of `${os}-${arch}-${backend}` (`--platform` too) |
| `RUNEX_GOLDEN_NO_PNG=1` | test/golden.test.ts checks trees only (a platform without a manifest; CI sets it on macOS, whose pixels the golden steps report) |
| `RUNEX_GOLDEN_CACHE` | where golden images are cached (default `~/.cache/runex-golden`): those fetched from origin, and in a copy without .git the only place golden.ts looks (scripts/golden-linux.sh sets it to its exported images) |
| `RUNEX_GOLDEN_RUNE_REV` | the Rune revision a manifest records, in a copy without .git |
| `RUNEX_COMPARE_RUNTIMES` | test/examples.test.ts: `bun`, `node` or `bun,node` |
| `RUNEX_COMPARE_RELEASE=0` | test/examples.test.ts: Rust examples in debug (default release) |
| `RUNEX_COMPARE_STRICT=1` | test/examples.test.ts: an unported Rust example fails |
| `RUNEX_COMPARE_SELF_CHECK=1` | test/examples.test.ts: render the Rust side twice, fail scenes that vary |
| `RUNEX_PERF` | the performance overlay and log (`1`, `log`, `overlay,log`); the unit tests cover the modes. Left out of every render the harness starts (below) |
| `RUNEX_TITLEBAR` | `native`: standard titled windows (docs/dev-workflow.md); headless, `cx.titlebar_inset()` is 0 and `--chrome` draws no traffic lights. Left out like `RUNEX_PERF`; test/unit/args.test.ts covers it |
| `RUNEX_RUNE_BUMP` | the revision `prepare-rune --check` accepts for vendor/rune instead of the superproject's gitlink; update-rune sets it while it moves the pin |
| `RUNEX_DOCKER_PREFIX` | scripts/linux-docker.sh: names a separate set of images, volumes and containers |
| `CI` | dist-fresh skips its timestamp check; golden on macOS uses the `-ci` key (darwin-arm64-metal-ci) |

`RUNEX_PERF` and `RUNEX_TITLEBAR` change what an app draws, so a shell that exports them would
change every tree and PNG. The harness leaves them out: `renderEnv()` (scripts/lib/env.ts) is the
environment of every render golden.ts and compare.ts start (scripts/lib/proc.ts) and of the spawn
helpers in test/unit, test/windowed, test/devflow and test/pack, and test/preload.ts (bunfig.toml)
drops them from every `bun test` process, for its in-process runs. A test that checks one sets it
for that run. test/golden.test.ts runs the quick tier with both exported, so a spawn that skips
`renderEnv()` fails it.

## Golden baselines

`scripts/golden.ts` renders headless, TypeScript side only (no cargo):
`bun|node examples/<name>/main.ts` and the fixture apps in `test/golden/fixtures/`.

```sh
bun scripts/golden.ts                                    # quick tier on Bun
bun scripts/golden.ts --tier standard                    # bun run test:golden
bun scripts/golden.ts --tier full --runtime bun,node     # everything
bun scripts/golden.ts kit-gallery 'hello/*/tap/*'        # filters: case-id prefixes or globs
bun scripts/golden.ts --no-png --self-check              # trees only, each case rendered twice
bun scripts/golden.ts --list --tier full                 # the case ids
```

Exit 0 is a pass, 1 a mismatch or failed sanity check, 2 a harness or tooling error.

### Tiers

- **quick**: every fixture scene, and per example the render without a scene plus each window's
  first scene. 90 renders.
- **standard**: every example window × (no scene and each scene), the fixtures, and the scripted
  cases. This is what CI checks on every push.
- **full**: standard plus the variants (light theme, `--scale 1`, web-showcase sizes, kit-gallery
  `--kit neutral|palette`, reduced motion, playground stories, video-player times) and the long
  scripts, on Bun and Node. Nightly in CI.

A case id is `<example>/<window>/<variant>/<scene>[@<checkpoint>]`, for example
`hello/main/base/on` or `hello/main/tap/_none@0.05`. `_none` is the render without `--scene`.

### Layout

```
test/golden/
  config.ts                  tiers, variants, masks, skips, per-case arguments, treePrimary
  cases.ts                   expands config.ts and the listings into case ids
  fixtures/*.ts              frozen fixture apps: text, layout, paint, kit, motion, compose
  scripts/*.json             pinned input scripts (copies, so upstream edits don't move them)
  listings/<example>.txt     each app's windows and scenes
  trees/<case>.jsonl         normalized tree, shared by every platform
  trees/<case>.<os>.jsonl    a platform's override, only where its tree differs
  traces/<case>.jsonl        normalized traces of a few short scripts
  png/<platform>.json        { platform, env, cases: { <case>: sha256 } }
```

- **Trees.** Line 1 holds the top-level scalars, then one line per element in document order,
  then one per accessibility node, every object with sorted keys. Masked fields are dropped. The
  comparison is exact, line by line. The report groups differences by field, so a Rune schema
  addition reads as one line ("new field X in 212 cases").
- **Trees are shared.** `treePrimary` (darwin) writes `trees/<case>.jsonl`. Other platforms write
  `<case>.<os>.jsonl` only where they differ, and print them for review.
- **PNG manifests** are per platform: `linux-arm64-lavapipe` (canonical, exact and blocking in
  CI), `darwin-arm64-metal` (exact on the dev Mac), `darwin-arm64-metal-ci` (GitHub's macOS
  runners, whose GPU is paravirtual; advisory), and `win32-arm64-warp` once Windows' pixels have
  proved stable. A manifest records its environment: OS, Mesa version, adapter, Bun and Node
  versions, Rune revision.
- **Masks** (config.ts) name an element by path and drop its fields from the tree and blank its
  rect in the PNG before hashing. Today: lab's GPU and CPU readouts and background's tick counter,
  at t > 0, where wall-clock values appear.
- **PNG bytes are not in main.** They live in the orphan branch `golden-images`, one file per
  image at `<platform>/<sha256>.png`, written with git plumbing only (never the work tree, the
  index or HEAD). On a failure golden.ts looks for the expected image in the local branch, then
  `~/.cache/runex-golden`, then (with `--fetch-images`) origin, with a partial fetch of only the
  blobs it needs. Without the store a failure still shows the actual PNG and the tree diff.
  `--gc-images` rebuilds the branch with only the images the manifests reference.
- **A copy without .git** (scripts/linux-docker.sh's Docker copy) has no branch, so golden.ts
  reads only the cache there. `bun scripts/golden.ts --platform KEY --export-images DIR` copies
  the images a manifest names into `DIR/KEY/` (only those not there yet), for that copy to read
  as `RUNEX_GOLDEN_CACHE=DIR`. scripts/golden-linux.sh does this before each run.

### Sanity checks

These fail the run too, because each means a check silently tests nothing:

- an example with two or more scenes whose renders are all byte-identical (a renamed or ignored
  `--scene`);
- a scripted case whose consecutive checkpoints are identical, or whose script targets a key
  missing from the tree;
- a listing that differs from `test/golden/listings/<example>.txt`;
- a tooling exit code other than 0.

### Failures

`out/golden/` holds `report.json` (always), and on failure `summary.md` (a markdown table; CI
appends it to the job summary), `<case>/actual.png`, `expected.png` and `diff.png` (when the
store has the expected image), `<case>/tree.diff.txt`, and `proposed/`: the new trees, overrides,
listings and this platform's manifest, ready for `--accept`.

### Blessing a change

Bless only after reading the diff, and match each change to an upstream intent (update-rune's
summary prints the changelog fragments beside the changed cases).

1. **On the Mac:** `bun run golden:update` (standard tier), or
   `bun scripts/golden.ts --update --tier full` for every variant. It renders, self-checks the
   changed cases (a case that varies run to run isn't blessed, and its differing fields are
   named), prints the changed-case table, and rewrites the trees, listings, traces and the
   `darwin-arm64-metal` manifest. New images go to the local `golden-images` branch; add
   `--push-images` to push them.
2. **Linux, through Docker:** `scripts/golden-linux.sh --update` builds the Linux addon in cached
   Docker volumes (about 11 minutes cold, minutes warm) and renders in the canonical image,
   writing `png/linux-arm64-lavapipe.json`. Without `--update` it only checks. Either way its
   failures get `expected.png` and `diff.png`, as a local run's do: it first copies the expected
   images from this checkout's `golden-images` branch and cache to `out/golden-linux/images`,
   which the Docker copy reads as its cache.
3. **From a CI run:** every failed golden run uploads its `out/golden` directory as an artifact
   (`golden-linux`, `golden-macos`, `golden-ubuntu-24.04`, `golden-windows` from ci.yml;
   `full-linux`, `full-windows-golden`, `full-macos` from full.yml). In ci.yml's, each run has
   its own subdirectory (`standard-bun/`, `quick-node/`, `quick-trees/`); in full-linux and
   full-macos it is `golden/`. Download the artifact and accept the proposal of the run you're
   blessing:

   ```sh
   gh run download <run-id> -n golden-linux -D out/ci-golden
   bun scripts/golden.ts --accept out/ci-golden/standard-bun/proposed [--push-images]
   ```

   This blesses Linux's and Windows' baselines (and the macOS CI manifest) without those
   machines.

A Rune-bump PR therefore holds: the submodule move, regenerated bindings, `surface.txt`, golden
tree diffs (reviewable as text) and manifest hash changes.

### Adding a case

- A new example or scene is picked up from the listings. The run fails with "new scenes: …"
  until `--update` records the listing and the baselines.
- A scripted case: pin the script in `test/golden/scripts/`, add it to config.ts with its
  checkpoints (`--at` times or `mark:NAME`), then `--update` that case.
- An engine behaviour no example shows: add a scene to the matching fixture in
  `test/golden/fixtures/`. Fixtures use the public API only and change only when the engine does.

## Event-loop tests

`test/windowed/` runs each scenario as its own process (winit allows one event loop per
process) on Bun and Node, and asserts on the JSON the fixture prints. Windows open at the screen's
top-left for a few seconds and close themselves. Moving the pointer over one makes Rune redraw
it, which can disturb frame counts. Measured numbers (frame rates, wake latency, idle CPU) print
as `[windowed]` lines. Tests for event-loop bugs that are known and being fixed are `test.todo`
with their reason (`RUNEX_WINDOWED_PENDING=run` runs them).

On Linux without a desktop:

```sh
RUNEX_WINDOWED=1 xvfb-run -a -s "-screen 0 1920x1080x24" bun run test:windowed
```

On Windows a window that changed keeps presenting every refresh for a second (`STEADY` in
vendor/rune/crates/rune/src/window/draw.rs, against G-SYNC and FreeSync refresh swings), in Rust
as in the port. A poll that moves the picture on every frame (examples/shapes) or a change once a
second (examples/background's ticker) therefore keeps the window drawing without a rest there,
where macOS and Linux rest between changes: the two tests about resting windows check Windows
against that (`STEADY_HOLD_MS` in test/windowed/lib.ts).

The macOS run is the main guard for the idle peek in src/idle.rs, which exists only there. The
peek runs in its own run-loop mode: in the default mode, notifications AppKit delivered while it
peeked (occlusion above all) ran outside winit's handler and were lost, so a window uncovered
while idle could stay frozen. A peek-mode regression shows up as windows that stop updating, not
as a failed assertion, so check by hand after changing src/idle.rs: cover an idle window with
another app, uncover it, and see that it still updates.

## Packaging tests

`test/pack/` checks what `npm publish` would ship, without writing in the repo:

- `pack.test.ts`: `npm pack` on a temporary copy, after prepack's `fix-dts --publish` there. The
  file list must have every entry point's `.js` and `.d.ts`, `native.cjs`, `native.d.cts` and the
  notices, and nothing else: no tests, examples, sources, addons, source maps, or dist files
  without a ts/ source. Relative imports must resolve inside the package. Over 1 MB is a warning.
- `consumer.test.ts`: the tarball installed into a temporary project, the built addon beside it.
  `tsc --strict` (NodeNext, `skipLibCheck` off) over a file using every entry point; node imports
  every entry; node and bun render examples/hello from the consumer byte-identically to the repo.
- `exports.test.ts`: the names each entry point exports, declared and at runtime, as a snapshot.
- `name.test.ts`: the package name agrees in package.json, `napi.packageName`, ts/vite.ts's
  `external` list, every import in examples, tests, bench and the docs, the publish step, and
  native.cjs.
- `platform-packages.test.ts`: `npm/<platform>/package.json` matches `napi.targets`, and CI's
  build matrix builds each target.
- `dist-fresh.test.ts` (in the fast tier): see Commands.

## Updating Rune

```sh
bun run update:rune --tip              # or a revision; --dry-run tries it in a clone first
bun scripts/update-rune.ts <rev> --from bindings      # resume at a step
```

`scripts/update-rune.ts` moves vendor/rune and runs every layer around the move: preflight,
upstream summary (commits, files on the watchlist, changelog fragments), the patches (in name
order, a commit each in a clone; the first that doesn't apply stops the run with its conflicted
files and hunks, whether each later patch applies without it, and steps that rebase that patch
alone and keep its header), patch lint and fingerprints, toolchain and
dependency alignment, bindings (rustdoc refresh, `surface-diff` old vs new: Removed and Changed
are breaking, Added isn't), build and the fast tier, the windowed tests on a Mac, example
inventory, compare, golden full, and the benchmarks as a report. It writes
`out/update-rune/<old8>-<new8>/summary.md`, a checklist to paste into the PR. It never blesses,
stages or commits: it prints the commands. `tools/bindgen/README.md` ("Updating Rune") keeps the
manual steps as a fallback.

The bindings are generated from rustdoc JSON documented for `aarch64-apple-darwin`
(`docTarget` in tools/bindgen/config.ts). rustdoc documents its host, and bindgen refuses JSON
for another target unless given `--any-target`, so `bun tools/bindgen/main.ts --rustdoc --check`
runs on macOS: on the dev Mac, and in CI on the macOS build leg. Without cached JSON
(`target/rustdoc/doc/*.json`), test/static's bindgen check skips with a message.

## CI

`.github/workflows/ci.yml`, on every push to main, every pull request, `v*` tags and manual runs:

| Job | Runner | Runs | Gates |
| --- | --- | --- | --- |
| build (3 legs) | macos-26; ubuntu:22.04 container on ubuntu-24.04-arm; windows-11-arm | `prepare-rune` and `--check`, `patch-lint`, release addon, `build:ts`, uploads. macOS also `bindgen --rustdoc --check` when vendor/rune, patches, tools/bindgen, src/gen, ts/gen, Cargo.*, rust-toolchain.toml or .cargo changed (always on manual runs and tags). | yes |
| smoke linux | ubuntu:22.04 container (pinned by digest), pinned lavapipe | fast tier; golden standard on Bun and quick on Node, pixels (linux-arm64-lavapipe) and trees; windowed under Xvfb; dev and pack | yes: the canonical platform |
| smoke macos | macos-26 | the same suite; pixels under darwin-arm64-metal-ci; windowed in a real window | no (advisory) |
| smoke ubuntu-24.04 | ubuntu-24.04-arm | unit; golden quick trees, self-checked | yes |
| smoke windows | windows-11-arm, WARP | unit; golden quick trees, self-checked; windowed (advisory) | yes, except windowed |
| publish | ubuntu-24.04-arm | on `v*` tags, after every build and non-advisory smoke leg | |

A failed golden run uploads `out/golden` (7 days) and appends its summary to the job summary.

`.github/workflows/full.yml`, nightly, by hand, and on pull requests that touch vendor/rune,
patches, tools/bindgen or src:

| Job | When | Runs |
| --- | --- | --- |
| linux | nightly, PRs, by hand | compare `--all --strict` on Bun and Node, golden full (Bun and Node), benchmarks and clippy as reports; caches vendor/rune/target keyed on the Rune revision |
| windows | nightly, PRs, by hand | golden full, trees only, self-checked |
| macos | by hand (`platforms` input) | compare and golden full on Metal; advisory |
| rune-tests | PRs that move vendor/rune or patches; by hand (`rune_tests` input) | Rune's `cargo test --workspace` on the patched tree (about 3000 tests), in the canonical container, with its own cache; line-table debug info and two build jobs, to fit the runner's memory |

```sh
gh workflow run full.yml -f platforms=linux,windows,macos -f rune_tests=true
```

Costs. GitHub bills macOS minutes at about 10× Linux and Windows at 2×. macOS runs the full suite
on every push by decision; its smoke job is estimated at 6–10 minutes, plus a 10–15 minute
build. The Linux smoke job is estimated at 10–12 minutes, full.yml's Linux job at 25–40 minutes
cold and 15–20 warm, and Rune's tests at 30–45 minutes. None of this is measured yet: CI hasn't
run, and the first runs set the real numbers.

Planned changes, once stable: Windows gets pixels too, a `win32-arm64-warp` manifest accepted
from a CI artifact once five or more nightly runs propose the same one (see Troubleshooting: a
new platform's pixels); the windowed steps on Windows and macOS become blocking after two weeks
without a failure.

## Troubleshooting

- **A golden case varies run to run.** `bun scripts/golden.ts <case> --self-check` names the
  fields that differ. Fix the source of nondeterminism if it's ours. If it's measured and
  inherent (a wall-clock readout), add a mask in config.ts, keyed by element path, with the why.
- **Trees differ on one platform only.** That platform's `--update` (or `--accept` from its CI
  artifact) writes `trees/<case>.<os>.jsonl` overrides only for the cases that differ. Review
  each: shortcut labels and font fallback are the usual causes.
- **A new platform's pixels.** Check its trees only (`--no-png`) at first. Add a PNG run that
  may fail (`continue-on-error`): with no manifest, each run proposes one in its artifact. Once
  several runs propose the same hashes, `--accept` that manifest and make the step blocking.
- **`dist/` is stale or has leftovers.** `rm -rf dist && bun run build:ts`.
- **The windowed tests skip.** The skipped test's name says why. `RUNEX_WINDOWED=1` makes them
  run, or fail.
- **bindgen's check fails.** It prints the changed files and the first 40 diff lines. Regenerate
  with `bun tools/bindgen/main.ts --rustdoc` on a Mac, and review `surface.txt`'s diff.
- **Linux on the Mac.** `scripts/linux-docker.sh` builds and runs in the CI image:
  `scripts/linux-docker.sh run bun run test:unit`, `... run bun scripts/golden.ts --no-png`.
  Its copy has no .git, so `prepare-rune --check` there prints `no git` and checks only that
  the patches are applied. The full check (the pin, and no edits beyond the patches) runs on the
  host and in CI, where a missing .git fails it.

## Mutation proof

Each row is a breakage applied alone in a scratch copy of the repo, never in the repo:

```sh
rsync -a --exclude target --exclude out --exclude node_modules <repo>/ <scratch>/mut/
```

with `node_modules` linked and `CARGO_TARGET_DIR` in the scratch directory (shader mutations in
the Linux container, with their own target volume). For each, the expected layer runs, and so
does compare.ts. A mutation no layer catches is a suite bug, fixed before sign-off.

| # | Breakage | How (in the scratch copy) | Expected to catch it | Outcome: caught by, missed by (compare.ts too) |
| --- | --- | --- | --- | --- |
| 1 | Theme token changes (dark background) | `vendor/rune/crates/rune/src/tok.rs`: `bg` `oklch(0.185, …)` → `oklch(0.195, 0.004, 265.0)`; rebuild | values.test.ts snapshot (`tok.theme(true).bg`); golden trees (fill in every dark case) and PNG manifests; compare.ts should stay green | **Caught.** values.test.ts: 2 tests (`tok.theme(true).bg`, and `Kit.neutral(true)`'s `bg_deep`, `layer_01` and `page`, `#121314ff` → `#141517ff`). Golden: quick 64 of 90 fail; standard 90 of 298 (fill changed in 98 places across 90 cases, colour in 3; their PNGs changed). compare.ts missed it: 27 pass, 424 of 424 identical, after rebuilding the Rust side with the token (both sides moved). |
| 2 | Default motion constant changes | `vendor/rune/crates/rune-motion/src/tokens.rs`: `SNAP: Spring::new(0.25, 0.0)` → `(0.3, 0.0)`; rebuild | values.test.ts (`tok.motion.SNAPPY.duration`); golden motion fixture; hello tap checkpoints; compare.ts should stay green | **Caught.** values.test.ts: 2 tests (`tok.motion.SNAP`, `SNAPPY`, `QUICK` and the kit's `motion.control` duration 0.25 → 0.30000001). Golden: quick 4 of 90 (fixture-motion); full on Bun 14 of 595: hello tap @0.1, @0.2 and @0.5, settings slider and keycaps, kit-gallery's stagger list, fixture-motion. compare.ts missed it: 424 of 424 identical. |
| 3 | Rune method renamed | `el/visuals.rs`: `pub fn radius` → `corner_radius`; `bindgen --rustdoc`; rebuild | bindgen `--check`; surface-diff (Removed `El.radius`, Added `El.corner_radius`, breaking); typecheck (TS2339 in examples); golden errors | **Caught** before anything renders. Renaming took 460 call sites in 145 Rune files (compiler-driven). The addon itself stops compiling: hand-written src/perf.rs calls `.radius` 6 times (E0599). `bindgen --rustdoc --check`: exit 1, src/gen/rune.rs, ts/gen/types.ts and surface.txt stale. surface-diff `--fail-breaking`: exit 1, Removed `method El.radius(r: number): this`, Added `method El.corner_radius`. typecheck: 273 errors (268 TS2339) in examples, bench and test. Then, regenerated and with perf.rs renamed in the copy: test/static fails the surface canary and `prepare-rune --check`, test/unit fails 8 compose tests, golden standard errors in 156 of 298 renders (exit 2), and compare.ts fails 26 of 27 examples (186 TS renders error). |
| 4 | Bindgen nondeterminism | tools/bindgen: emission order from `Math.random()` or an unsorted Set | `bindgen --check` determinism phase; test/static/bindgen.test.ts | **Caught.** (Emission order: `.sort(() => Math.random() - 0.5)` over a class's methods in emit.ts.) `bindgen --check`: "two runs on the same JSON differ", 9 files, exit 1 in 0.7 s. test/static/bindgen.test.ts: 1 fail. compare.ts: 424 of 424, as expected; it doesn't regenerate bindings. |
| 5 | Conversion bug (Duration units) | `src/conv.rs`: `try_from_secs_f64(s.max(0.0))` → `(s.max(0.0) / 1000.0)`; rebuild | conv.test.ts Duration round trip; values.test.ts spring durations; golden motion and scripted cases | **Caught** by conv.test.ts alone ("Duration > numbers are seconds"). values.test.ts, golden full (595 of 595) and compare.ts (424 of 424) missed it: the bug is in `FromJs`, the value snapshot reads constants through `ToJs`, springs take f32 seconds rather than a `Duration`, and no golden case passes a `Duration` that changes a headless frame. |
| 6 | Pump skips poll-driven frames | `src/app.rs` `Pump.tick`: return early when `idle::os_events_pending()` is false, even when `next_wake()` is due; rebuild | test/windowed poll-frames fixture and shapes `--native --frames 60`, on macOS; every headless layer stays green; compare.ts should stay green | **Caught** by test/windowed alone: 24 fail, 2 pass, 3 todo. shapes and the poll fixtures draw 0 frames; wakes, quit, stats, idle CPU, multi-window and overlay fail too, because the loop never turns after launch. Control with the real addon: 26 pass, 3 todo, 0 fail. Headless layers stay green: test/static and test/unit 147 of 147, golden standard 298 of 298, test/devflow 5 of 5, compare.ts 424 of 424. |
| 7 | Extra edit in vendor/rune / patch drift | (a) a line added to `crates/rune/src/window.rs` outside the patch; (b) the submodule moved to 58eeef5f with the old patch | (a) `prepare-rune --check` tree mismatch with a diff-tree stat (test/static/patch.test.ts, every CI build leg); (b) update-rune stops at the patch step naming `window/event_loop.rs` | **Caught.** (a) `prepare-rune --check`: exit 1, DRIFT, with a one-line diff stat for crates/rune/src/window.rs. test/static/patch.test.ts: 1 fail. patch-lint: ok. compare.ts on hello, shapes and settings, Rust rebuilt: 22 of 22 pass. (b) `update-rune 58eeef5f --dry-run` stops at the patch step in 4.5 s, naming `crates/rune/src/window/event_loop.rs:77` and the conflict at line 89, with rebase steps. With the submodule checked out at 58eeef5f, `prepare-rune` fails loudly (`patch failed: …event_loop.rs:77`), `--check` reports MOVED and BROKEN, and patch.test.ts fails 2 (the check; patch-lint, which finds 9 raw `send_event` calls and asks to review `event_loop::run_configured`). compare.ts not run: the patched tree it would build doesn't exist. |
| 8 | A raw wake bypassing the pump | patched `event_loop.rs`: `let _ = proxy.send_event(WakeEvent::Turn);` outside pump_wake.rs | patch-lint; the fingerprint review when it lands in a duplicated function | **Caught** by patch-lint: "FAIL 1 raw send_event call … event_loop.rs:89". The wake is `WakeEvent::App(0)`, since d03349e2 has no `Turn`, in the patch's `build`. As a work-tree edit, `prepare-rune --check` also reports DRIFT. Folded into the patch, `--check` reports exact and only patch-lint (and patch.test.ts) fails. The fingerprint review stays quiet, as designed: it hashes upstream's functions, not the patch's copies. compare.ts on hello, shapes and settings, Rust rebuilt: 22 of 22 pass. |
| 9 | Export dropped from an entry point | `ts/fx.ts`: remove `export { run_with } from "./compose.js"`; `build:ts` | exports.test.ts snapshot; consumer.test.ts tsc; typecheck (lab, showreel, cursed-settings); golden runs of the compositor examples | **Caught** by exports.test.ts (`- "run_with"` in runex-js/fx) and consumer.test.ts (TS2305 "has no exported member 'run_with'"). typecheck (0 errors), golden on lab, showreel and cursed-settings (45 of 45) and compare.ts (424 of 424) missed it, as they must: the examples import `run_with` from `runex-js`, which still exports it. |
| 10 | Shader change (wgpu path) | Linux container: a constant in `crates/rune/src/shader.wgsl`; rebuild there | golden `linux-arm64-lavapipe` manifest, with diff PNGs; trees unchanged; macOS (Metal) unchanged; compare.ts should stay green | **Caught on both platforms.** (The rect fill's AA edge width: `soft = max(i.params.z, 0.5)` → `0.75`.) Linux lavapipe through `scripts/golden-linux.sh`: golden standard fails 289 of 298 on PNGs, every tree the same. Each of the 289 has `expected.png` (the stored Linux image; all 289 match the manifest's sha256) and `diff.png`: from 3 to 82,394 px differ, `hello/main/base/on` 528 px (max Δ38), only the switch's anti-aliased edges. macOS isn't unchanged: it also fails 289 of 298, the same 9 passing, because Rune compares the WGSL's hash with the precompiled metallib's and compiles the changed WGSL when they differ. compare.ts on hello, shapes and settings, Rust rebuilt: macOS 22 of 22 pass, Linux 20 pass and 2 close. (Re-run after two harness fixes, see below.) |
| 11 | Tooling flag renamed, `--scene` ignored | `tooling/args.rs`: `"--scene"` → `"--story"`; rebuild | tooling-contract.test.ts (`--scene a` and `b` trees identical); golden "all scenes identical" check; compare.ts should pass with every row identical (the silent collapse) | **Caught.** test/unit: 7 tests fail across tooling-contract, api, windows and errors (`--scene a` and `--scene b` give the same tree, an unknown `--scene` no longer exits 2, `--snap` loses its scene). Golden: quick 38 of 90, standard 226 of 298, and the sanity check names all 16 multi-scene apps ("kit-gallery/main/base: all 119 scenes render identically; is --scene ignored?"). compare.ts caught it too, unlike the plan expected: every row is identical (424 of 424), but its new all-scenes-identical check fails 10 examples. |
| 12 | Half-done rename / listing filter back | (a) ts/vite.ts `external` back to an old name; (b) the `/^rune[-:]/` filter back in scripts/lib/discover.ts | (a) name.test.ts and the devflow vite build; (b) golden listing check (kit-gallery loses 28 scenes) and tooling-contract.test.ts's `rune-x` scene | **Caught.** (a) With `external: ["runex"]`: name.test.ts (expected to contain `runex-js`), and test/devflow's vite build and vite dev tests. compare.ts: 424 of 424; it doesn't use Vite. (b) The golden listing check: "listing kit-gallery: removed scenes:" all 28 `rune-*` stories, in the standard tier and in test/golden.test.ts (the fast tier). tooling-contract.test.ts passed: it reads Rune's listing directly, not through discover.ts. compare.ts missed it: it passes with 368 comparisons instead of 424, the 28 stories dropped silently. |

Run on 2026-11-07 on the dev Mac (M3, load average 3 to 34 from other agents' builds). Each
mutation had its own `cp -cR` clone of the repo (APFS, target directories included, so cargo
rebuilt only what the mutation touched); shader mutation 10 also ran in the Linux image with its
own volumes. Addon rebuilds took 2.5 to 10 minutes; a compare that rebuilds the 27 Rust examples
took 15 to 28 minutes. Mutations 1 and 6 reused the addons items B and E had built from the same
sources (checked with diff). Every mutation was caught by at least one layer, so no suite bug
blocks sign-off. compare.ts caught only 3 (the ports break) and 11 (its new sanity check); it
missed 1, 2, 5 and 12 (b), as a check of the port against Rust at the same revision must.

The run found two harness defects, both in the Linux path, and mutation 10 was run again, in full,
after they were fixed:

- **No expected or diff PNGs from Docker.** linux-docker.sh's copy has no .git, so no
  golden-images branch, and golden.ts skipped even the cache when there was no repository. The
  first run printed "289 expected images aren't in the local golden-images branch or the cache"
  and wrote only `actual.png`. Now golden.ts reads the cache without a repository, and
  golden-linux.sh first copies the images the Linux manifest names into
  `out/golden-linux/images` (`golden.ts --export-images`), which the copy reads as its cache.
  test/golden.test.ts covers both; its failing-case test fails with the old code.
- **`prepare-rune --check` needed vendor/rune/.git**, which the copy excludes, so every
  linux-docker.sh command stopped at its patches step; the first run used a shim. Now, in a copy
  without .git, `--check` says so and checks only that the patches are applied, kept from using
  any repository above the copy (one would make `git apply --check` pass without checking
  anything). In CI a missing .git still fails. test/static/patch.test.ts covers the copy, nested
  in another repository; without that guard its tests fail.

The re-run used no shim, a `cp -cR` clone, and Docker volumes copied from warm ones, at load
average 6 to 12. Linux: the image export, addon rebuild (148 s) and golden standard (249 s of
rendering) took 7 min 16 s, and compare 1 min 44 s. macOS: the addon rebuild took 3 min 16 s,
golden standard 1 min 38 s, and compare 1 min 45 s.
