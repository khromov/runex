# tools/bindgen

Generates runex's bindings from Rune's rustdoc JSON, so the TypeScript API is Rune's own: the
same names, signatures and docs, for every public item of `rune`, `rune_motion`, `rune_kit`,
`rune_fx`, `rune_light`, `rune_knobs`, `rune_theme_opencode` and `rune_notify`.

```sh
bun tools/bindgen/main.ts             # regenerate (rustdoc JSON is reused when present)
bun tools/bindgen/main.ts --rustdoc   # rebuild the rustdoc JSON first (after bumping vendor/rune)
bun tools/bindgen/main.ts --check     # write nothing; fail unless deterministic and up to date
./scripts/dev-install.sh              # build the addon and the TypeScript
```

It writes:

- `src/gen/<crate>.rs`: napi-rs bindings (classes, conversions, functions, constants) and
  `src/gen/tramp.rs` (trampolines for `fn` pointer parameters);
- `ts/gen/types.ts`: every declaration, with Rune's docs as JSDoc, by unique name;
- `ts/gen/<crate>/**.ts`: one module per Rust module, re-exporting those under Rust's paths;
- `tools/bindgen/report.md`: what was skipped and why, and what exists on some platforms only.
  Read it after a Rune bump. Skip reasons carry no rustdoc ids, so its diff shows real changes;
- `tools/bindgen/surface.txt`: the API surface, one sorted line per class, method, field, enum
  variant, function, constant and export path, with TypeScript signatures and platform gates
  (`surface.ts` explains the format). Its diff is the API change of a Rune bump.

Options (the header of `main.ts` has them all): `--out DIR` writes the tree under DIR instead of
the repo; `--rustdoc-dir DIR` reads (and with `--rustdoc` writes) JSON in `DIR/doc` instead of
`target/rustdoc/doc`; `--rune DIR` documents another Rune checkout.

Before generating, `main.ts` stops when:

- a crate's `features` in `config.ts` differ from the ones `Cargo.toml` builds it with (rustdoc
  documents what those features compile: rune-knobs without `panel` documents its stubs);
- the JSON's `format_version` isn't `config.ts`'s `rustdocFormat` (61, Rust 1.99.1): a toolchain
  bump changed rustdoc's schema; check `rustdoc.ts` against it, then update the number;
- the JSON was documented for a target other than `docTarget` (below), unless `--any-target`.

## Checks

- `bun tools/bindgen/main.ts --check` runs the generator twice into temp dirs, fails if the runs
  differ (determinism), then compares them with `src/gen`, `ts/gen`, `report.md` and
  `surface.txt` (up to date), printing the changed files and the first 40 diff lines. It reads
  the cached JSON (about 2 s); with `--rustdoc` it rebuilds the JSON first (about 35 s warm, 5 min
  cold). `test/static/bindgen.test.ts` runs it when JSON is cached and skips otherwise.
- `bun tools/bindgen/surface-diff.ts OLD NEW [--fail-breaking] [--json FILE]` compares two
  surfaces (files, or trees holding `tools/bindgen/surface.txt`): Removed and Changed break code
  written against OLD, Added doesn't. A rename is a removal plus an addition.
- `test/static/native-surface.test.ts` checks the built addon has every export and method
  `ts/gen` expects, gated items exactly where their `#[cfg]` holds.

rustdoc JSON is not host-independent, so the freshness check must run on macOS. Measured at
d03349e2 with the same features: the Linux JSON documents `aarch64-unknown-linux-gnu` and has
fewer items (rune: 12353 index entries against 12913), and bindings from it (`--any-target`)
lose `native_surface::macos::PixelBuffer` and `NativeSurface::push`: surface-diff reports 5
removals, nothing else. The Windows JSON matches the Linux one. CI runs `--rustdoc --check` on
the macOS leg, path-filtered; the other legs check what needs no JSON (surface.txt against
ts/gen, the addon surface).

## Updating Rune

`bun scripts/update-rune.ts <rev|--tip>` does it: it checks the submodule is its pin plus
`patches/`, lists the upstream commits and changelog fragments, moves the submodule and re-applies
the patch (stopping with the conflicted hunks if it doesn't apply), lints it
(`scripts/patch-lint.ts`), checks the toolchain and wgpu/objc2 pins, regenerates the bindings and
diffs `surface.txt` and `report.md`, builds and tests, checks the example inventory, and runs
compare, the golden baselines and the benches. It writes a checklist to
`out/update-rune/<old>-<new>/summary.md` and never stages, commits or blesses. `--dry-run` tries it
all in a clone without touching the repo; the header of the script has the options.

By hand, when the script can't help:

1. Move the submodule: `git -C vendor/rune fetch && git -C vendor/rune checkout <rev>`
   (take the patches off first: `git -C vendor/rune apply -R ../../patches/*.patch`).
2. `node scripts/prepare-rune.mjs` re-applies `patches/` (fix the patch if Rune's event loop
   moved; `--reapply` rebuilds vendor/rune from its pin and `patches/` after a patch changed).
   `node scripts/prepare-rune.mjs --check` then confirms the tree is the pin plus the patches.
3. `bun scripts/patch-lint.ts`: compare any function it reports with the patch's copy, then
   `bun scripts/patch-lint.ts --accept-fingerprints`.
4. `bun tools/bindgen/main.ts --rustdoc`, then `cargo build`.
5. `git diff tools/bindgen/surface.txt tools/bindgen/report.md`, and run `bun scripts/compare.ts`.

## How types map

`config.ts` chooses what's bound (deny lists of modules and items; everything else public is
bound when its signature converts). The generator sorts each public struct and enum into:

- **record**: all fields public and convertible, `Clone`, no method named like a field. JavaScript
  sees a plain object (an instance of a generated TS class carrying the methods); literals work.
- **enum**: unit variants as strings, data variants as `{ Variant: payload }`.
- **class**: everything else, as a napi class whose instance holds the value in a `conv::Slot`:
  owned, moved, lent to a callback, leaked for a `&'static`, or a shared constant. Builders on
  non-`Copy` classes change the instance in place and return it; passing one by value moves it.

Signatures convert through `src/conv.rs` (`FromJs`/`ToJs`): numbers, strings, `Option`, `Vec`,
slices, arrays, tuples, `Duration` (seconds), paths, bytes (`Uint8Array`), records, enums, classes;
`Rc<str>`/`Arc<str>` (strings); `&'static T` results of a class that isn't `Clone` (a theme's
icons: `file_icons::file`, `icons::ALL`), as instances that refer to the static, like a static of
that class; `impl Into<..>`/`AsRef<..>`/`IntoIterator<..>`; closures (`impl Fn`, `Box<dyn Fn>`, `Rc<dyn Fn>`)
and `fn` pointers (via trampolines) whose arguments are lent to JavaScript for the call, including
the app state (`&mut S`) and `&mut Tx`; callbacks returning `&mut T` (`on_edit`); `&mut Vec<T>`
(written back into the array); `Deref` targets' methods; `From` impls as static `from`.

A type parameter is the app's state (`crate::state::JsState`) when it's named `S` (or listed in
`stateGenerics`) and has no trait bounds. A struct with one lifetime (`Play<'a, X>`) is bound as
"lend-only": JavaScript sees it only inside callbacks. A builder whose lifetime only borrows
strings (`TabStrip<'a, S>`, `TabItem<'a, S>`, `Note<'a>`) is listed in the crate's `ownedLifetimes`
instead: its methods are read with `'a` as `'static`, so `Cow<'a, str>` takes an owned string and
`&'a str` an interned one (leaked once per distinct string, as element roles are), and JavaScript
owns it like any builder. A struct field borrowing a string for the struct's lifetime
(`TreeRow::id`) reads as a copy. A field named like a method shows only when that method isn't
bound (`TreeRow::selected` the field, beside the skipped builder `selected(bool)`).

## Platforms

rustdoc documents one target, the host's. An item Rune declares under a platform `#[cfg]`
(`native_surface::macos::PixelBuffer`, `NativeSurface::push` on macOS) keeps it in the JSON as a
`CfgTrace` attribute. `cfg.ts` reads it, adds the `#[cfg]`s of the enclosing modules, impl blocks
and `use`s and of the bound types its signature names, and evaluates the result on package.json's
`napi.targets` (`rustc --print cfg`): true on all, no gate; false on all, not bound; otherwise the
Rust bindings carry the same `#[cfg(..)]` and the TypeScript docs say so. Where it's absent,
JavaScript reads such a class, function or method as `undefined`. `report.md` lists them.

Rune's own features (`feature = "markdown"`) are taken as they were when rustdoc ran, so
`config.ts` lists the features Cargo.toml builds with. Items that exist only on platforms other
than the one the JSON came from aren't bound, and JSON from another platform would drop the ones
only macOS has: bindgen takes JSON documented for `docTarget` (`config.ts`, macOS ARM64) and
refuses any other unless given `--any-target`.

Hand-written code covers what has no generic shape: apps and their pump (`src/app.rs`),
multi-window apps and `open_window`, overlays, live values and the compositor, frame reports
(`App.on_frame_encoded`, `instant_now`), `tooling::headless_run`, the tree over the app's own node
type (`Tree`, `TreeModel`, with ts/tree.ts's `FileNode` and `FileTree`), the icon swap and
`rune_notify::on_click` (`src/manual/`). `config.ts` denies the Rune items these replace.
