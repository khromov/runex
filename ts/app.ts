// Apps: `AppSpec`, `App` and `run`, as in Rust, plus the hot-reload registry.
import native from "./native.js"
import type * as N from "./native.js"
import type { NativeApp, Pump, Waker } from "./native.js"
import type { AppHandle } from "./index.js"
import type { Chrome, ConfiguredWindowOptions, Cx, El, FontSmoothing, GpuBackend, Ime, KeyEvent, MacWindowOptions, Mods, Playground, Titlebar, Tx, WindowHandle, WindowOptions } from "./gen/types.js"
import { drive } from "./loop.js"
import type { PerfMode, PerfStats } from "./perf.js"
import { ConfiguredOverlay, OverlaySpec } from "./overlay.js"
import type { WindowSpec } from "./windows.js"
import type { Compositor } from "./compose.js"

/** One frame a window ran, as `App.on_frame_encoded` reports it (`rune::FrameEncoded`). */
export type FrameEncoded = N.FrameEncoded
/** What a frame came to (`rune::FrameOutcome`). */
export type FrameOutcome = "Drawn" | "Unchanged" | "Skipped"

/**
 * The current instant (`Instant::now()`), as seconds on the monotonic clock that
 * `FrameEncoded`'s instants use. Subtract two for a duration.
 */
export const instant_now: () => number = native.instant_now

/** An app: its title, first size, state, view and optional hooks (`rune::AppSpec`). */
export class AppSpec<S> {
  title: string
  size: [number, number]
  /** The smallest window the user can resize to, in points (`null`: 420×400). */
  min_size: [number, number] | null = null
  init: () => S
  view: (s: S, cx: Cx) => El
  /** Named states for snapshots (`--scene name`): each modifies the initial state. */
  scenes: [string, (s: S) => void][] = []
  /** Font files replacing the built-in Inter (empty keeps it). */
  fonts: Uint8Array[] = []
  /** The sans and mono family names (CSS lists). */
  families: [string, string] = ["Inter", "Inter"]
  /** Called once with a waker other code uses when new data arrives. */
  setup: ((s: S, waker: Waker) => void) | null = null
  /** Called at the start of every frame with seconds since start; true when state changed. */
  poll: ((s: S, t: number, tx: Tx) => boolean) | null = null
  /** Keys unhandled by the focused control, or every key while nothing has focus; true consumes it. */
  on_key: ((s: S, e: KeyEvent, tx: Tx) => boolean) | null = null

  constructor(title: string, size: [number, number], init: () => S, view: (s: S, cx: Cx) => El) {
    this.title = title
    this.size = size
    this.init = init
    this.view = view
  }

  /** The required parts; everything else at its default (`AppSpec::new`). */
  static new<S>(title: string, size: [number, number], init: () => S, view: (s: S, cx: Cx) => El): AppSpec<S> {
    return new AppSpec(title, size, init, view)
  }
}

type Running = { native: NativeApp; handle: AppHandle; pump: Pump; done: Promise<void>; title: string }

/**
 * What a host that re-runs the app's module on edits (the Vite plugin) tells runex, on
 * `globalThis.__runex_host`. `bun --hot` needs none: runex sees `--hot` in `process.execArgv`.
 */
export type Host = {
  /** Rune's arguments (`--snap out.png`, ...) for apps that don't set their own with `App.args`. */
  args?: string[]
  /** The module is re-run on edits: a run while an app is live swaps into it, whatever its title. */
  hot?: boolean
  /** Called once a windowed app has quit. Rune can't start another event loop in this process. */
  quit?: () => void
}

const G = globalThis as {
  __runex_apps?: Map<string, Running>
  __runex_host?: Host
  /** The older spelling of `__runex_host.args`. */
  __runex_args?: string[]
  __runex_hot_errors?: boolean
  /** An unknown `--titlebar=X` or `RUNEX_TITLEBAR` was reported. */
  __runex_titlebar_warned?: boolean
}

// One registry per process, kept on `globalThis` so `bun --hot` and Vite's HMR, which re-run
// the app's module (and under `bun --hot` this one too), find the window the first run opened.
const registry: Map<string, Running> = (G.__runex_apps ??= new Map())

/** Rune's arguments: the process's, unless a host (the Vite plugin) set them. */
export function hostArgs(): string[] {
  return processArgs()
}

/** What runs after an app's event loop ends (a hot session's host decides). */
export function onAppQuit() {
  if (hot()) quit()
}

function rawArgs(): string[] {
  return G.__runex_host?.args ?? G.__runex_args ?? process.argv.slice(2)
}

/** Whether `a` is one of runex's own flags (`--perf[=mode]`, `--titlebar[=native]`), which Rune doesn't know. */
export function isRunexArg(a: string): boolean {
  return a === "--perf" || a.startsWith("--perf=") || isTitlebarArg(a)
}

function isTitlebarArg(a: string): boolean {
  return a === "--titlebar" || a.startsWith("--titlebar=")
}

/** Rune's arguments, without runex's own flags. */
function processArgs(): string[] {
  return rawArgs().filter((a) => !isRunexArg(a))
}

/**
 * Whether windows that don't choose their own frame are standard titled windows, from
 * `--titlebar` (or `--titlebar=native`) or `RUNEX_TITLEBAR=native`. The last flag beats the
 * variable. Without them windows keep Rune's default: on macOS the content fills the window under
 * a transparent, title-less titlebar, traffic lights over it. An unknown value keeps it too.
 */
function nativeTitlebar(): boolean {
  const flag = rawArgs().findLast(isTitlebarArg)
  if (flag !== undefined) return titlebarValue(flag === "--titlebar" ? "native" : flag.slice("--titlebar=".length), flag, "--titlebar")
  const env = process.env.RUNEX_TITLEBAR ?? ""
  return env !== "" && titlebarValue(env, `RUNEX_TITLEBAR=${env}`, "native")
}

/** Whether `value` asks for the native titlebar; warns about an unknown one, once a process. */
function titlebarValue(value: string, given: string, hint: string): boolean {
  if (value === "native") return true
  // `bun --hot` evaluates this module again on every save.
  if (!G.__runex_titlebar_warned) console.warn(`runex: ${given} isn't known (use ${hint}); keeping Rune's titlebar`)
  G.__runex_titlebar_warned = true
  return false
}

// Before any App or WindowSpec exists: each starts with this frame, and its own `chrome` or
// `titlebar` call replaces it.
native.set_titlebar_default(nativeTitlebar())

/**
 * The performance overlay's mode from `--perf` / `--perf=log` / `--perf=overlay,log` or the
 * `RUNEX_PERF` environment variable (`1`, `log`, `overlay,log`); `""` when neither asks for it.
 */
export function perfMode(): string {
  const flag = rawArgs().findLast((a) => a === "--perf" || a.startsWith("--perf="))
  if (flag) return flag === "--perf" ? "overlay" : flag.slice("--perf=".length)
  return process.env.RUNEX_PERF ?? ""
}

/** Applies `perfMode()` to every window that doesn't choose its own, before an app starts. */
export function applyPerfDefault() {
  native.set_perf_default(perfMode())
}

/** `bun --hot`: Bun re-evaluates every module in place on each save. */
function bunHot(): boolean {
  return process.versions.bun !== undefined && process.execArgv.includes("--hot")
}

function hot(): boolean {
  return G.__runex_host?.hot === true || bunHot()
}

/** The live app a run with this title takes over: the one with the title, or in a hot session the only one. */
function live(title: string): Running | undefined {
  const running = registry.get(title)
  if (running && !running.pump.exited) return running
  if (!hot()) return undefined
  const all = [...registry.values()].filter((r) => !r.pump.exited)
  return all.length === 1 ? all[0] : undefined
}

/**
 * Under `bun --hot`, an unhandled error (a save that doesn't parse, a module that throws) parks
 * Bun's timers until the next good save, which would freeze the window. With a listener it is
 * only reported, and the window keeps running its last good code.
 */
function reportHotErrors() {
  if (G.__runex_hot_errors) return
  G.__runex_hot_errors = true
  const report = (error: unknown) => {
    console.error(error)
    console.error("runex: the window keeps its last good code; save a fix to reload")
  }
  process.on("unhandledRejection", report)
  process.on("uncaughtException", report)
}

/** After the app quits: a host decides; `bun --hot` would otherwise wait for saves it can't show. */
function quit() {
  const host = G.__runex_host
  if (host?.quit) host.quit()
  else if (bunHot()) setImmediate(() => process.exit(0))
}

/** `rune::App`: an `AppSpec` with its lifetime. */
export class App<S> {
  #spec: AppSpec<S>
  #steps: ((app: NativeApp) => void)[] = []
  #native: NativeApp | null = null
  #args: string[] | null = null

  private constructor(spec: AppSpec<S>) {
    this.#spec = spec
  }

  static new<S>(spec: AppSpec<S>): App<S> {
    return new App(spec)
  }

  #step(f: (app: NativeApp) => void): this {
    this.#steps.push(f)
    if (this.#native) f(this.#native)
    return this
  }

  #build(): NativeApp {
    if (!this.#native) {
      this.#native = new native.NativeApp(this.#spec)
      for (const step of this.#steps) step(this.#native)
    }
    return this.#native
  }

  /** Keeps the app running after its last window closes. */
  keep_running(): this { return this.#step((a) => a.keep_running()) }
  /** Starts with no window open. */
  windowless(): this { return this.#step((a) => a.windowless()) }
  /** macOS: the standard App, Edit and Window menus. */
  standard_menus(): this { return this.#step((a) => a.standard_menus()) }
  /** macOS: no Dock icon or menu bar (an accessory app). */
  accessory(): this { return this.#step((a) => a.accessory()) }
  fit_content_height(): this { return this.#step((a) => a.fit_content_height()) }
  float_on_open(): this { return this.#step((a) => a.float_on_open()) }
  modifier_keys(): this { return this.#step((a) => a.modifier_keys()) }
  release_gpu_when_closed(): this { return this.#step((a) => a.release_gpu_when_closed()) }
  tab_visits_controls(on: boolean): this { return this.#step((a) => a.tab_visits_controls(on)) }
  srgb_blend(enabled: boolean): this { return this.#step((a) => a.srgb_blend(enabled)) }
  on_close(f: (s: S, tx: Tx) => void): this { return this.#step((a) => a.on_close(f as any)) }
  on_focus(f: (s: S, focused: boolean, tx: Tx) => void): this { return this.#step((a) => a.on_focus(f as any)) }
  on_ime(f: (s: S, ime: Ime, tx: Tx) => boolean): this { return this.#step((a) => a.on_ime(f as any)) }
  on_reopen(f: (s: S, has_visible_windows: boolean, tx: Tx) => boolean): this { return this.#step((a) => a.on_reopen(f as any)) }
  on_open_url(f: (s: S, url: string, tx: Tx) => void): this { return this.#step((a) => a.on_open_url(f as any)) }
  /** Runs whenever the held modifiers change, for an Alt-hold reveal (`App::on_modifiers`). */
  on_modifiers(f: (s: S, mods: Mods, tx: Tx) => void): this { return this.#step((a) => a.on_modifiers(f as any)) }
  /** The first open leaves focus where it is (`App::open_inactive`). */
  open_inactive(): this { return this.#step((a) => a.open_inactive()) }
  /** Opens the window maximized (`App::maximized`). */
  maximized(maximized: boolean): this { return this.#step((a) => a.maximized(maximized)) }
  /**
   * Calls `f(frame)` with what each of the window's frames came to (`App::on_frame_encoded`):
   * drawn, unchanged or skipped, when, and its update and encode times, for an app's own frame
   * meter. Headless runs report every frame on their virtual clock as `Drawn`. Instants are
   * seconds on `instant_now()`'s clock. It changes nothing about when or what the window draws.
   */
  on_frame_encoded(f: (frame: FrameEncoded) => void): this { return this.#step((a) => a.on_frame_encoded(f as any)) }
  /** Runs `f(handle)` after each native window creation. */
  on_window(f: (window: WindowHandle) => void): this { return this.#step((a) => a.on_window(f as any)) }
  /** Runs `f(handle)` once the window's first frame is ready. */
  on_ready(f: (window: WindowHandle) => void): this { return this.#step((a) => a.on_ready(f as any)) }
  font_smoothing(mode: FontSmoothing): this { return this.#step((a) => a.font_smoothing(mode as any)) }
  /** The window's frame (`App::chrome`), instead of Rune's default or `--titlebar`'s. */
  chrome(chrome: Chrome): this { return this.#step((a) => a.chrome(chrome as any)) }
  /** A titlebar the view draws (`App::titlebar`); `--titlebar` leaves it alone. */
  titlebar(titlebar: Titlebar): this { return this.#step((a) => a.titlebar(titlebar as any)) }
  window_options(options: WindowOptions): this { return this.#step((a) => a.window_options(options as any)) }
  configured_options(options: ConfiguredWindowOptions): this { return this.#step((a) => a.configured_options(options as any)) }
  macos_window(options: MacWindowOptions): this { return this.#step((a) => a.macos_window(options as any)) }
  gpu_backend(backend: GpuBackend): this { return this.#step((a) => a.gpu_backend(backend as any)) }
  playground(playground: Playground): this { return this.#step((a) => a.playground(playground as any)) }
  /** Draws every frame through `compositor` instead of Rune's default pass (`App::compositor`; see ts/compose.ts). */
  compositor(compositor: Compositor<S>): this { return this.#step((a) => a.compositor(compositor)) }

  /** Adds an overlay above other apps with its own state (`App::overlay`). */
  overlay<T>(spec: OverlaySpec<T> | ConfiguredOverlay<T>, state: T): N.OverlayHandle {
    return this.#build().overlay(ConfiguredOverlay.from(spec).toNative(), state)
  }

  /** Adds a window with its own state; returns its `AppHandle` and `WindowHandle` (`App::window`). */
  window(spec: WindowSpec): [AppHandle, WindowHandle] {
    return this.#build().window(spec) as [AppHandle, WindowHandle]
  }

  /** The native app, for `WindowSpec.from_app`. */
  get native(): NativeApp {
    return this.#build()
  }
  /** Rune's arguments (`--snap out.png`, ...) instead of the process's. */
  args(argv: Iterable<string>): this {
    const list = [...argv]
    this.#args = list
    // Also on the native app now, for a `WindowSpec.from_app(app)` that never reaches `run()`.
    return this.#step((a) => a.args(list))
  }
  /**
   * Shows the performance overlay in the window's top-right corner, grouped and colour-coded:
   * frames per second and the frame interval (average, p95, max); each frame's work split into
   * Rune (Rust), bindings (calls from JavaScript into Rust) and JS, with a stacked frame-work
   * graph in the same colours; Rune's update and encode phases and the view's time; presents and
   * skipped frames, the cost of turning Rune's loop and memory. Presses and hover pass through
   * the panel to the app; its `?` button turns on explain mode, where a click on a number shows
   * what it measures, and `−` folds it to the headline (small windows start folded).
   * `"log"` prints the same once a second to stderr instead, `"overlay,log"` does both, and
   * `"none"` neither. `on_stats`, if given, receives the numbers as one object a second, from
   * the first drawn frame on; headless runs (`--snap`, `--tree`, `--script`) report their frames
   * too, as Rune reports them to `on_frame_encoded`. Everything is measured in Rust; nothing
   * crosses into JavaScript per frame.
   *
   * Without calling this, `--perf` (or `--perf=log`, or `RUNEX_PERF=1`) turns it on at launch.
   */
  perf(mode: PerfMode = "overlay", on_stats?: (stats: PerfStats) => void): this {
    return this.#step((a) => a.perf(mode, on_stats as any))
  }
  /** Makes the first state with `f` instead of the spec's `init` (`App::init`). */
  init(f: () => S): this { return this.#step((a) => a.init(f)) }
  /** Runs `handler` when `accelerator` ("mod+shift+k") is pressed anywhere (`App::global_shortcut`). */
  global_shortcut(accelerator: string, handler: (s: S, tx: Tx) => void): this { return this.#step((a) => a.global_shortcut(accelerator, handler as any)) }
  allow_unmodified_shortcuts(): this { return this.#step((a) => a.allow_unmodified_shortcuts()) }

  /** Opens, focuses, closes and feeds the app once it runs. */
  handle(): AppHandle {
    return live(this.#spec.title)?.handle ?? this.#build().handle()
  }

  /**
   * Opens the window and resolves when the app quits. With Rune's tooling arguments
   * (`--snap`, `--tree`, ...) it renders headless instead and resolves when that's done.
   *
   * Run again in the same process (a hot reload), it keeps the open window and its state, and
   * swaps in this spec's view and hooks.
   */
  run(): Promise<void> {
    const title = this.#spec.title
    const running = live(title)
    if (running) {
      running.pump.swap(this.#spec)
      if (running.title === title) {
        running.handle.refresh()
      } else {
        // A hot reload that renamed the app: same window, new title.
        registry.delete(running.title)
        registry.set(title, running)
        running.title = title
        running.handle.update((_s, tx) => tx.set_title(title))
      }
      return running.done
    }
    let app: NativeApp, handle: AppHandle, pump: Pump | null
    try {
      app = this.#build()
      app.args(this.#args ?? processArgs())
      applyPerfDefault()
      handle = app.handle()
      pump = app.start()
    } catch (error) {
      // A headless run whose view threw, an app that can't start: `run()` rejects, as an async
      // call does, rather than throwing.
      return Promise.reject(error)
    }
    if (!pump) return Promise.resolve()
    if (bunHot()) reportHotErrors()
    let entry: Running
    const done = drive(pump).finally(() => {
      if (registry.get(entry.title) === entry) registry.delete(entry.title)
      if (hot()) quit()
    })
    entry = { native: app, handle, pump, done, title }
    registry.set(title, entry)
    return done
  }
}

/** Opens the app's window and resolves when it closes (`rune::run`). */
export function run<S>(spec: AppSpec<S>): Promise<void> {
  return App.new(spec).run()
}
