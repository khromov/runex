# Porting Rune Rust code to runex (TypeScript)

runex mirrors Rust's API **name for name** (snake_case included). Almost everything is
generated from Rune's own signatures by `tools/bindgen`, so a Rust program ports line by line.
`ts/gen/types.ts` holds every declaration (with Rune's docs as JSDoc); search it when unsure.

## Imports

| Rust | TypeScript |
| --- | --- |
| `use rune::{AppSpec, Cx, El, col, el, row, text};` | `import { AppSpec, type Cx, type El, col, el, row, text } from "runex-js"` |
| `rune::tok::{self, motion, type_}` | `import { tok } from "runex-js"; const { motion, type_ } = tok` |
| `rune::color::hex` | `import { color } from "runex-js"; color.hex(...)` (modules are namespaces, as in Rust) |
| `use rune_kit::{Button, Kit};` | `import { Button, Kit } from "runex-js/kit"` |
| `rune_fx`, `rune_light`, `rune_knobs`, `rune_motion`, `rune_theme_opencode` | `runex-js/fx`, `runex-js/light`, `runex-js/knobs`, `runex-js/motion`, `runex-js/theme-opencode` |

A Rust module that has the same name as a function (`rune::el` the module vs `rune::el()`):
the function wins at that path; the module's items are re-exported at the crate root anyway.

## Apps

```ts
type State = { on: boolean }
function view(s: State, cx: Cx): El { ... }
run({ ...AppSpec.new<State>("Hello", [320, 200], () => ({ on: false }), view), scenes: [["on", (s) => { s.on = true }]] })
```

- `AppSpec { scenes: &[..], ..AppSpec::new(..) }` → spread: `{ ...AppSpec.new(...), scenes: [...] }`.
  Other fields: `min_size`, `fonts` (`Uint8Array[]`), `families`, `setup(s, waker)`, `poll(s, t, tx) -> boolean`,
  `on_key(s, e, tx) -> boolean`. Rust's `Waker` is a closure called as `wake()`; runex's is an object, so
  `wake()` ports as `wake.wake()`.
- `rune::run(spec)` → `run(spec)`. `App::new(spec).keep_running().run()` → `App.new(spec).keep_running().run()`.
- **State is a plain JS object, mutated in place** like `&mut S`: handlers `(s: State) => { s.n += 1 }`.
  Never replace the state object; mutate its fields.
- `fn main` → top-level code. Rune's tooling flags (`--snap`, `--scene`, `--tree`, ...) come from `process.argv`
  exactly as Rust's `Args::parse()` reads `std::env::args()`. If the Rust app reads `std::env::args()` itself
  (e.g. to skip threads when `--snap` is present), read `process.argv.slice(2)` the same way.

## Values

| Rust | TypeScript |
| --- | --- |
| `f32`, `i64`, `usize`, ... | `number`. **Rust's f32 math rounds every step**: if a port's pixels are off by a hair, wrap the arithmetic in `Math.fround(...)` step by step as Rust computes it (e.g. `Math.fround(a * b)`). Integer division `a / b` on integers → `Math.trunc(a / b)`; `%` on negatives matches JS. `as u8` etc. truncate/wrap. |
| `String`, `&str`, `impl Into<String>` | `string` |
| `Option<T>` | `T \| null` (`undefined` also reads as `None`). `x.unwrap()` → `x!`. |
| `Vec<T>`, `&[T]`, `[T; N]`, `impl IntoIterator<Item = T>` | arrays |
| tuples `(f32, f32)` | `[number, number]` |
| `Duration` | seconds (`number`) |
| `include_bytes!("x.png")` | `readFileSync(new URL("./x.png", import.meta.url))` (copy the asset next to the port) |
| `format!("{}s", n)` | template string; `{:.1}` → `n.toFixed(1)`; `{:02}` → `String(n).padStart(2, "0")` |

**Records** (structs whose fields are all public, e.g. `Color`, `Shadow`, `Spring`, `ScrollSpec`, `Span` when it
has no clashing methods): JS objects with the same field names. Rust struct literals become object literals:
`Shadow { x: 0.0, y: 2.0, blur: 8.0, spread: 0.0, color, inset: false }` → `{ x: 0, y: 2, blur: 8, spread: 0, color, inset: false }`.
`..Default::default()` → spread a default: `{ ...ScrollSpec.default(), stick_bottom: true }` (missing fields of a
type with `Default` also default). Associated functions/consts are statics: `Spring.new(0.3, 0)`, `Color.WHITE`.

**Classes** (everything else: `El`, `TextStyle`, `Transition`, `Path`, kit components, ...): methods with the
same names. `Type::new(..)` → `Type.new(..)`. Ownership follows Rust:
- builder methods (`self` → `Self`) on types that aren't `Copy` (`El`, `Transition`, kit builders) change the
  object and return it; passing such a value by value (`.child(el)`, `.transition(t)`) **moves** it, and using a
  moved value again throws, as Rust wouldn't compile it. Where Rust writes `t.clone()`, write `t.clone()`;
- on `Copy` types (`TextStyle`, ...) builders return a new value and passing copies, like Rust;
- constants of class type (`Transition::NONE`, kit glyphs) are shared: every use copies them.

**Enums**: unit variants are strings, others single-key objects (Rust's externally tagged form):
`Align::Center` → `"Center"`, `Cursor::Pointer` → `"Pointer"`, `Family::Named("Inter")` → `{ Named: "Inter" }`,
`Key::Text(s)` → `{ Text: s }`; struct variants `{ V: { field: .. } }`. Match with `if (e.key === "Enter")`,
`if (typeof k === "object" && "Text" in k)`. Associated functions of an enum: `Curve.linear(0.3)`.

**Closures**: `.on_press(|s: &mut State| s.on = !s.on)` → `.on_press((s: State) => { s.on = !s.on })`.
`&mut Tx`, `&mut Drag`, `&mut Cx` arguments are objects valid only during the call. A closure returning `El`
must return an `El`; `bool`-returning handlers return booleans.

**Primitive state.** A handler of `&mut S` may *return* a value to replace the state: a Rust overlay with
state `0` doing `*s += 1` ports as `(s: number) => s + 1`. (Objects are mutated in place as usual.)

## Apps, windows, overlays, live values (hand-written; see ts/app.ts, ts/windows.ts, ts/overlay.ts, ts/live.ts)

- `App.new(spec)` has Rust's builder methods: `keep_running()`, `windowless()`, `accessory()`, `standard_menus()`,
  `release_gpu_when_closed()`, `chrome(..)`, `titlebar(..)`, `window_options(..)`, `configured_options(..)`,
  `macos_window(..)`, `font_smoothing(..)`, `gpu_backend(..)`, `on_close/on_focus/on_ime/on_reopen/on_open_url(f)`,
  `on_window(f)`, `on_ready(f)`, `playground(pg)`, `args(argv)`, `handle()`, `run()`.
  `app.overlay(spec, state)` returns an `OverlayHandle` (show, hide, fade_in(secs), update((s, tx) => ..), place,
  set_edge, resize, ...). `app.window(windowSpec)` returns `[AppHandle, WindowHandle]`.
- `AppHandle.update((s, tx) => ..)` replaces Rust's `handle.update(move |s, tx| ..)` (no threads needed: call it from
  timers, promises, anything). Where Rust spawns a thread that sleeps and updates, use `setInterval`/`setTimeout`,
  but keep headless runs deterministic exactly as the Rust code does (it usually skips threads for `--snap`).
- Multi-window: `run_windows((displays) => [WindowSpec.new("key", spec), WindowSpec.from_app("key", app.native)])`,
  `run_windows_with(options, factory)`, `run_windows_with_args(options, args, factory)`. `WindowSpec` has `.state(s)`,
  `.options(WindowOptions)`, `.configured_options(..)`, `.on_created(f)`, `.chrome(..)`, ... and `.boxed()` (identity).
- Overlays: `OverlaySpec.new(name, size, view)` or `new OverlaySpec({ name, size, edge, margin, align, inset, interactive, view })`
  for Rust's struct literal; `.options(OverlayOptions)` gives a `ConfiguredOverlay` with `.poll(f)`, `.on_key(f)`, `.setup(f)`,
  `.on_focus(f)`, `.on_created(f)`, `.macos_level(n)`, `.animate_reveal()`, `.release_gpu_after(secs)`, ...
- `Live.new(value)` (a number, `[x, y]`, `[a, b, c, d]` or a `Color`): `.set(v)`, `.snap(v)`, `.pulse(active, rest, secs)`,
  `.get()`, `.smooth(spring)` → `Binding` (`.rest(spring)`), `Tween.linear(from, to, secs)`, `LiveText.new(text)`.
  `El.live_opacity/live_blur/live_scale/live_offset/live_trim/live_fill/live_rect(live | binding | tween)`, `El.live_text(liveText)`.
- `Player` (video/audio), `Playground`/`Story`/`Stage` are generated with Rust's names.
- Struct update on a class (`ElectricParams { intensity: 0.5, ..ElectricParams::charged() }`): its fields are
  accessors, so spread copies nothing; write `Object.assign(ElectricParams.charged(), { intensity: 0.5 })`.
  Methods of an enum take it first: `Fx::glow(p).on(shape)` → `Fx.on(Fx.glow(p), shape)`. `impl Into<FillParams>`
  arguments take the `FillParams` itself: `Fx::fill(p)` → `Fx.fill(FillParams.new({ LiquidMetal: p }))`.
- Tuple structs: `Rgb([r, g, b])` → `new Rgb([r, g, b])`, `c.0` → `c._0` (an index-like name crashes Bun on a
  Node-API object). `El::linear_gradient(angle, &[(0.0, a), (1.0, b)])` → `.linear_gradient(angle, [[0, a], [1, b]])`.
- `Animated` and `VelocityTracker` (`runex-js/motion`) are `rune_motion::Animated<T>`/`VelocityTracker<T>` for a number
  or a `Vec2`; `OneShots` (`runex-js/fx`) is `rune_fx::OneShots<T>` with any JavaScript payload (`live(t, life)` gives
  `[{ t0, data, seed }, k]`).

## Compositors (`App::compositor`, `rune::run_with`)

A Rust `Compositor` records raw wgpu passes, which TypeScript can't. runex has one general compositor instead
(ts/compose.ts documents it): Rust owns the GPU work (rune-fx's `FxRenderer`, rune-light's `LightRenderer`,
offscreen targets, backdrop copies, the resolve) and a TypeScript object plans each frame. Port `gfx.rs` as a
class with a `render(f)` method that reads what the Rust `render` read and returns a plan, and attach it with
`App.new(spec).compositor(new Gfx())`, `run_with(spec, new Gfx())`, `WindowSpec.compositor(..)` or
`ConfiguredOverlay.compositor(..)`.

| Rust (`Frame`, `f.rt`) | TypeScript (`f: Frame<S>`) |
| --- | --- |
| `f.rt.state` (and `rt.invalidate()`) | `f.state` (mutate in place; `f.invalidate()`) |
| `f.rt.t`, `f.rt.env.scale`, `f.rt.env.system_dark`, `f.size`, `f.dt`, `f.update_ms` | `f.t`, `f.env.scale`, `f.env.system_dark`, `f.size`, `f.dt`, `f.update_ms` |
| `f.rt.pointer()`, `f.rt.presented(key)`, `f.rt.clear_color()` | `f.pointer()`, `f.presented(key)`, `f.clear_color()` |
| walking `f.rt.instances` for `KIND_EFFECT` slots | `f.slots()` (`index`, `mark`, `data`, `rect`, `radii`, `scale`, `clip`, `fade`, `backdrop`) |
| `fn animating(&self)` | `animating` in the returned plan |
| GPU timestamps read back | `timestamps: true`, then `f.gpu_ms` (one frame later); `f.stats` is the previous frame's `FxStats` |

The plan picks one of two pipelines, fixed per compositor (`pipeline`):

- `"ui"`: Rune draws the frame; each fx layer draws at an effect slot (`{ layer, at: { slot: s.index } }`), the
  pattern of `Renderer::draw_with_backdrop` + `FxRenderer::draw_layer_in`, with `blur_backdrop` at backdrop slots.
  Options: `dither` (default on), `fire_sim`.
- `"hdr"`: one linear `Rgba16Float` scene resolved once with TPDF dither (the pattern of cursed-settings and lab).
  `routes` send instances by `El::mark` (`match: mark` or `[value, mask]`) to the main list, `"top"`, `"none"`,
  a source slot (`sources: ["layer" | "mask"]`, read by `FxLayer.source(slot, rect)`), `also` a second source,
  and `lit` (rune-light: glyphs to text, the rest to base, rects to `lighting.prims`, styled by `PrimStyle`).
  Layers anchor `{ under: match }`, `{ over: match }` or `"top"`; `lighting` (`lights`, `settings`, `alpha`, `at`,
  `background`, `prims`, `min_alpha`, `effects_on_top`), `clip` (the stage scissor) and `flatten_layers` cover the
  rest. Options: `fire_sim`, `blur_backdrop` (default on), `timestamps`.

examples/showreel, examples/cursed-settings and examples/lab are complete ports to read alongside their Rust.

## Limits

- `tools/bindgen/report.md` lists every Rune API the generator skipped and why (mostly GPU internals:
  `wgpu::Device`, renderer types, rune-motion's generic `Prop<T>` machinery). Items denied in
  `tools/bindgen/config.ts` aren't listed, and neither are struct fields it can't convert: `std::time::Instant` has
  no mapping, so `native_surface.FrameTiming` has no `submitted_at` or `completed_at`.
- Functions that return a closure (`impl Fn`) aren't bound. The only one is `rune_knobs::side_key`.
- No raw wgpu: a custom `Compositor` is written against the general compositor above, not as GPU passes.
  `rune::render` (`Gpu`, `OFFSCREEN_FORMAT`) and `native_surface::SurfaceRenderer` aren't bound either.
  `rune::render::NO_CLIP` has the same value as `NO_CLIP` from `runex-js/fx`.
- No headless `rune::Runtime`, Rune's test and bench driver (`Runtime::new`, `App::headless_runtime`, `frame`,
  `find`, `key`, `pointer_down`, ...). Rust code that drives one isn't ported: live-values' `--bench` and the
  `#[cfg(test)]` tests of drag-out, drop-files, frosted-bar, hello, knobs, matched, rich-clipboard, settings and
  sketch. Check the same input with a `--script` run against the Rust binary instead.
- `App` lacks some builders Rune has on every platform (the first five take effect only on web): `canvas_id`, `full_viewport`, `web_document`, `font_url`,
  `same_tab_router`, `on_frame_encoded`, `on_frame_drawn`, `dev_stats` and `try_run`. `App.run()` returns a
  Promise that rejects when the app can't start, in place of `try_run`.
- The addon builds `rune` with its default Cargo features. `frame-profile` (Rune's headless phase and allocation
  counters) and `native-file-dialog` (`FileDialogs.native()`) aren't available, and a Rust app's own
  `#[global_allocator]` has no JavaScript counterpart.
- `#[track_caller]` Rune APIs see the generated binding as their caller, not the JavaScript call site. An unkeyed
  viewport given to `El.scroll_bar` or `Kit.scroll_bar` gets a fallback key (`scroll-<hash>`) that differs from
  Rust's and is the same at every call, so two of them collide: key the viewport. In a debug build of the addon,
  warnings that name a call site point into src/gen.
- f32 transcendentals: `Math.fround` matches Rust's f32 arithmetic, but `Math.sin`, `cos`, `exp`, `pow` and
  `hypot` compute in f64 and round once, where Rust calls the platform's f32 libm (`sinf`, `expf`, ...). Rare
  results differ in the last bit or two. On macOS no compared render shows it; `--trace` numbers can. On Linux,
  glibc's `sinf` and `cosf` aren't correctly rounded: 12 of the 1,164 values shapes computes for its first frame
  differ by an ulp, and one moves one pixel by 1/255, so compare.config.ts gives shapes a tolerance there.
- Overlay typings are looser than Rust's: `ConfiguredOverlay.on_created` passes `unknown` (an `OverlayCreated` at
  run time), and `OverlayHandle.update` types its `tx` as an empty `Tx` class. Cast them
  (`created as OverlayCreated`, `tx as Tx`).
- No `Drop`: JavaScript has no destructors, so code Rust runs when a state is dropped needs an explicit hook
  (`on_close`, a `quit` path).
- No raw window handles (`WindowHandle::with_raw_handle`) and none of Rune's wasm-only API.
- A Rust panic inside Rune (an assertion) aborts the process, as it would a Rust app; JavaScript exceptions in
  views and handlers are caught and rethrown to JavaScript instead.
- Integers are JavaScript numbers: exact up to 2^53, and a negative whole number passed where Rust takes an
  unsigned integer wraps as `x >>> 0` does (bit flags built with `<<`/`|`).

## Where the ports differ from the Rust examples

Every port renders what its Rust example renders in each compared window and scene (scripts/README.md says what
the comparison doesn't cover). These differences are outside that:

- **background**: Rust's `.on_window(..)` hook prints `background: native window AppKit` when Rune creates the
  main window, through `WindowHandle::with_raw_handle`. The port leaves the hook out, so a run with `--open` (or
  the `open` stdin command) doesn't print that line.
- **cursed-settings**: gags.ts computes `exp`, `sin`, `cos`, `powf` and `hypot` in f64 (see Limits), so a value
  can differ from Rust's in the last bit. No rendered frame shows it.
- **glass-card**: a negative, NaN or infinite `GLASS_CARD_SECONDS`, or one over about 24.8 days, quits the port
  almost at once (`setTimeout` clamps the delay). Rust's timer thread panics or keeps sleeping instead, and the
  app keeps running.
- **kit-gallery**: opening the Model combobox on the index page (no `--scene`, as in a window) prints Rune's
  `duplicate sibling key "model-scrim"` and `"model-content"` warnings. Rune's example causes them: its two
  combobox stories (`rune-combobox--searchable` and `--animated-filter`) both use the key `model` and share one
  state, so opening one opens both popovers. The Rust binary prints the same warnings. They name the `.key()`
  call site: `crates/rune-kit/src/overlay.rs` in a debug Rust build, `vendor/rune/crates/rune-kit/src/overlay.rs`
  in a debug addon (built from the repo root), and `unknown (build with debug assertions for source locations)`
  in a release build of either.
- **knobs**: main.ts has a local `side_key` with the crate's body, in place of the unbound `rune_knobs.side_key`.
- **live-values**: `--bench` throws (no `rune::Runtime`). f32 `sin` and `cos` (see Limits) move some `--trace`
  numbers, such as `quality.position_error_px`, by about 1.5e-5 px; `--snap` and `--tree` match.
- **overlay**: Rust's `impl Drop for State` closes every overlay window when the controls window's state is
  dropped, and that ends the app. The port has no counterpart and adds no hook, so closing the controls window
  leaves the overlays open and the process running.
- **overlay-lab**: casts around the loose overlay typings (see Limits): `created as OverlayCreated` in main.ts and
  bin/layer-filter-overlay.ts, `tx as Tx` in bin/occluded-timer.ts. Types only.
- **settings**: its `frame-profile` feature (a counting allocator plus Rune's frame profiler, which Rune's
  scripts/bench-ui.py reads) has no runex counterpart.
- **video-tiles**: `push` checks `process.platform === "darwin"` at run time where Rust has
  `#[cfg(target_os = "macos")]`. Elsewhere Rust's `ByteFrame { .. }` literal is
  `new native_surface.ByteFrame({ .. })`: `ByteFrame` isn't `Clone`, so it's a class, and `push_bytes` takes only
  an instance (a plain object throws `expected a ByteFrame`). `--bench-native` can't run: bench.ts
  imports `render` and a `wgpu` subpath, which don't exist, and calls `SurfaceRenderer`,
  `NativeSurface.set_observer` and `FrameTiming.completed_at` (see Limits). JavaScript can't block on Rune's
  completion worker the way Rust's `recv_timeout` does, so bench.ts's `run()` is async.

## Verifying

`bun scripts/compare.ts <example> --runtime bun,node` renders every window and scene of the Rust example and
the port with `--snap`/`--tree` and diffs them, on Bun and Node (Bun alone without `--runtime`). Identical PNG and tree is the bar. Diffs are written to
`out/compare/<example>/`.
