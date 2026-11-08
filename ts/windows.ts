// Several windows from one factory (`rune::run_windows`, `WindowSpec`).
import native from "./native.js"
import type * as N from "./native.js"
import type { Chrome, ConfiguredWindowOptions, Display, FontSmoothing, Ime, Mods, Playground, RunOptions, Titlebar, Tx, WindowHandle, WindowOptions } from "./gen/types.js"
import type { FrameEncoded } from "./app.js"
import type { App, AppSpec } from "./app.js"
import type { NativeApp } from "./native.js"
import type { Compositor } from "./compose.js"
import type { PerfMode, PerfStats } from "./perf.js"
import { drive } from "./loop.js"
import { applyPerfDefault, hostArgs, onAppQuit } from "./app.js"

/**
 * One window: a key, an app and its options (`rune::WindowSpec`). `S` is the window's state.
 * Typed here rather than from the native declarations, which can't name runex's own types.
 */
export interface WindowSpec<S = any> {
  /** The window's key (`--window KEY` picks it in headless runs). */
  readonly key: string
  /** The window's frame options. */
  options(options: WindowOptions): this
  configured_options(options: ConfiguredWindowOptions): this
  /** The window's initial state, instead of its spec's `init`. */
  state(state: S): this
  /** Runs once the native window exists (not in headless runs). */
  on_created(f: (window: WindowHandle) => void): this
  /** Runs once the window's first frame is ready, once per native creation. */
  on_ready(f: (window: WindowHandle) => void): this
  chrome(chrome: Chrome): this
  titlebar(titlebar: Titlebar): this
  srgb_blend(enabled: boolean): this
  font_smoothing(mode: FontSmoothing): this
  modifier_keys(): this
  tab_visits_controls(on: boolean): this
  on_focus(f: (s: S, focused: boolean, tx: Tx) => void): this
  on_ime(f: (s: S, ime: Ime, tx: Tx) => boolean): this
  on_reopen(f: (s: S, has_visible_windows: boolean, tx: Tx) => boolean): this
  on_open_url(f: (s: S, url: string, tx: Tx) => void): this
  /** Runs whenever the held modifiers change (`WindowSpec::on_modifiers`). */
  on_modifiers(f: (s: S, mods: Mods, tx: Tx) => void): this
  /** Opens without taking focus from the window that has it (`WindowSpec::inactive`). */
  inactive(): this
  /** Opens maximized (`WindowSpec::maximized`). */
  maximized(maximized: boolean): this
  /** This window's frame reports (see `App.on_frame_encoded`). */
  on_frame_encoded(f: (frame: FrameEncoded) => void): this
  playground(playground: Playground): this
  /** This window's compositor (see ts/compose.ts). */
  compositor(compositor: Compositor<S>): this
  /** The performance overlay in this window (see `App.perf`). */
  perf(mode?: PerfMode, on_stats?: (stats: PerfStats) => void): this
  /** The same window, its state type erased (`WindowSpec::boxed`): in JavaScript, itself. */
  boxed(): this
}

export interface WindowSpecStatic {
  /** A window keyed `key` running the app `spec` describes. */
  new: <S>(key: string, spec: AppSpec<S>) => WindowSpec<S>
  /** A window keyed `key` running `app` (keeps its handle, lifetime, options and hooks). */
  from_app: <S>(key: string, app: NativeApp | App<S>) => WindowSpec<S>
}

export const WindowSpec: WindowSpecStatic = native.WindowSpec as any

/**
 * Opens another window in the running app's event loop (`rune::open_window`), with its own state
 * and functions: a second document window, or a tab dragged out of its strip. Call it from a
 * handler, an update or `on_ready`; the window starts at the end of the turn and keeps the app
 * running until it closes. Its key must differ from every open window's. Headless runs open
 * nothing. The handle places, focuses and closes it.
 */
export function open_window<S>(spec: WindowSpec<S>): WindowHandle {
  return native.open_window(spec as any) as WindowHandle
}

type Factory = (displays: Display[]) => Iterable<WindowSpec>

type Running = { pump: N.Pump; done: Promise<void>; displays: Display[] }
const G = globalThis as { __runex_windows?: Running }

/** Opens the windows `factory(displays)` returns and resolves when the app quits (`rune::run_windows`). */
export function run_windows(factory: Factory): Promise<void> {
  return run_windows_with({ accessory: false }, factory)
}

/** `run_windows` with process-level options, such as macOS accessory activation. */
export function run_windows_with(options: RunOptions, factory: Factory): Promise<void> {
  return run_windows_with_args(options, hostArgs(), factory)
}

/**
 * `run_windows_with` with explicit Rune arguments instead of the process's.
 *
 * Run again in the same process (a hot reload), it calls `factory` for fresh specs and gives each
 * open window with the same key its new view and hooks, keeping its state.
 */
export function run_windows_with_args(options: RunOptions, args: Iterable<string>, factory: Factory): Promise<void> {
  const running = G.__runex_windows
  if (running && !running.pump.exited) {
    for (const spec of factory(running.displays)) running.pump.swap_from(spec as any)
    return running.done
  }
  let displays: Display[] = []
  let pump: N.Pump | null
  try {
    applyPerfDefault()
    pump = native.start_windows(options, [...args], (d: Display[]) => {
      displays = d
      return [...factory(d)]
    })
  } catch (error) {
    return Promise.reject(error)
  }
  if (!pump) return Promise.resolve()
  const entry: Running = { pump, done: Promise.resolve(), displays }
  entry.done = drive(pump).finally(() => {
    if (G.__runex_windows === entry) G.__runex_windows = undefined
    onAppQuit()
  })
  Object.defineProperty(entry, "displays", { get: () => displays })
  G.__runex_windows = entry
  return entry.done
}
