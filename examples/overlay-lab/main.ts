// The overlay lab (vendor/rune/examples/overlay-lab/src/main.rs): a transparent pill on the
// display under the pointer whose chips alone take clicks, full-display pickers that select an
// area, and an underlay window for pass-through checks. See the Rust example's README.md.
//
// ```sh
// bun examples/overlay-lab/main.ts
// bun examples/overlay-lab/main.ts --scene picker --size 960x600 --snap picker.png
// ```

import { createServer } from "node:net"
import { createRequire } from "node:module"
import {
  App, type AppHandle, AppSpec, Color, ConfiguredWindowOptions, type Cx, type DisplayTarget, type El, type KeyEvent,
  type Key, Live, MacWindowOptions, type OverlayCreated, type OverlayHandle, OverlayOptions, OverlaySpec, type Tx,
  WindowOptions, WindowSpec, col, el, row, run_windows, run_windows_with, text,
} from "runex-js"

const BLUE: Color = new Color({ r: 0.25, g: 0.55, b: 1.0, a: 1.0 })
const DARK: Color = new Color({ r: 0.055, g: 0.065, b: 0.085, a: 0.97 })

type Handles = { pill: OverlayHandle | null; pickers: OverlayHandle[] }
/** `#[derive(Default)]`. */
const Handles = { default: (): Handles => ({ pill: null, pickers: [] }) }
type Rect = [number, number, number, number]
type State = {
  underlay: boolean
  hit_only: boolean
  clicks: number
  picker: boolean
  expanded: boolean
  hovered: string
  selection: Rect | null
  selection_at_press: Rect | null
  pointer: Live
  /** Shared by every surface's state (Rust's `Arc<Mutex<Handles>>`). */
  handles: Handles
}
function init(): State {
  return { underlay: false, hit_only: false, clicks: 0, picker: false, expanded: false, hovered: "", selection: null, selection_at_press: null, pointer: Live.new([160.0, 100.0]), handles: Handles.default() }
}
function show_picker(s: State) {
  const handles = s.handles
  for (const picker of handles.pickers) picker.show()
  // One key owner, even with several full-display surfaces.
  const first = handles.pickers[0]
  if (first !== undefined) first.request_keys()
  console.error("overlay-lab picker shown")
}
function hide_picker(s: State) {
  for (const picker of s.handles.pickers) picker.hide()
  console.error("overlay-lab picker hidden")
}
function key(s: State, event: KeyEvent, _: Tx): boolean {
  console.error(`overlay-lab key ${debug_key_event(event)}`)
  if (event.key === "Escape") { hide_picker(s); return true }
  return false
}
function chip(label: string, action: (s: State) => void): El {
  return el().key(label).hit().padding(10.0).radius(16.0).fill(BLUE.alpha(0.16))
    .child(text(label).color(Color.WHITE))
    .on_hover((s: State) => { s.hovered = label })
    .on_press((s: State) => { console.error(`overlay-lab chip ${label}`); action(s) })
}
function view(s: State, _: Cx): El {
  if (s.underlay) {
    return el().w_full().h_full().fill(DARK).padding(40.0)
      .child(text(`Underlay clicks: ${s.clicks}`).color(Color.WHITE))
      .on_press((s: State) => { s.clicks += 1; console.error(`overlay-lab underlay click ${s.clicks}`) })
  }
  if (s.picker) {
    let root = el().w_full().h_full().hit().fill(BLUE.alpha(0.06))
      .on_pointer_move((s: State, p) => { s.pointer.set([p.x, p.y]) })
      .on_drag((s: State, drag, tx) => {
        tx.instant()
        if (drag.phase === "Down") s.selection_at_press = s.selection
        if (drag.cancelled()) { s.selection = s.selection_at_press; s.selection_at_press = null; return }
        const [x, y] = [Math.min(drag.x, drag.start_x), Math.min(drag.y, drag.start_y)]
        s.selection = [x, y, Math.abs(Math.fround(drag.x - drag.start_x)), Math.abs(Math.fround(drag.y - drag.start_y))]
        if (drag.phase === "Up") console.error(`overlay-lab selection ${debug_selection(s.selection)}`)
      })
      .child(text("Drag an area · Escape to close").color(Color.WHITE).pin(24.0, 24.0, null, null))
      .child(el().size(8.0, 8.0).radius(4.0).fill(BLUE).pin(0.0, 0.0, null, null).live_offset(s.pointer))
    if (s.selection !== null) {
      const [x, y, w, h] = s.selection
      root = root.child(el().key("selection").size(w, h).border(2.0, BLUE).fill(BLUE.alpha(0.12)).pin(x, y, null, null))
    }
    return root
  }
  if (s.hit_only) {
    return col().w_full().h_full().center().child(el().key("hit-only").size(300.0, 48.0).hit()
      .fill(DARK).child(text("Native hit region").color(Color.WHITE)))
  }
  let chips = row().key("pill").padding(8.0).gap(4.0).radius(28.0).fill(DARK)
    .child(chip("Area", show_picker)).child(chip("Window", show_picker))
    .child(chip("Screen", show_picker)).child(chip("iPhone", (s) => { s.expanded = !s.expanded }))
  if (s.expanded) chips = chips.child(chip("Route", (s) => { s.expanded = false }))
  chips = chips.child(chip("Paste", (s) => { s.expanded = !s.expanded }))
    .child(chip("×", (s) => { const pill = s.handles.pill; if (pill !== null) pill.hide() }))
  return col().w_full().h_full().center().gap(8.0).child(chips)
    .child(text(s.hovered).color(BLUE))
}
function spec(): AppSpec<State> {
  return {
    title: "Overlay lab", size: [680.0, 160.0], min_size: null, init, view,
    scenes: [["pill", (_) => {}], ["expanded", (s) => { s.expanded = true }], ["picker", (s) => { s.picker = true; s.selection = [140.0, 100.0, 560.0, 320.0] }]],
    fonts: [], families: ["sans-serif", "monospace"], setup: null, poll: null, on_key: key,
  }
}

/** Optional local control socket for bounded native lifecycle/presentation probes. */
function native_probe(pill: OverlayHandle, app: AppHandle<State>) {
  const path = process.env.OVERLAY_LAB_CONTROL
  if (path === undefined) return
  // Each connection sends one command line and reads one line back, as a thread looping over
  // `UnixListener::incoming` serves them. Unref'd: like that thread, it doesn't keep the process alive.
  const listener = createServer({ allowHalfOpen: true }, (stream) => {
    let command = ""
    let read = false
    const serve = () => {
      if (read) return
      read = true
      const at = CACurrentMediaTime()
      switch (command.trim()) {
        case "show": pill.show(); break
        case "hide": pill.hide(); break
        case "none": pill.set_input("None"); break
        case "all": pill.set_input("All"); break
        case "regions": pill.set_input("Regions"); break
        case "hit-only": pill.update((s: State, _) => { s.hit_only = true }); break
        case "chips": pill.update((s: State, _) => { s.hit_only = false }); break
        case "status": break
        case "quit": app.quit(); break
        default: stream.end("unknown command\n"); return
      }
      const line = `probe command=${command.trim()} time=${at.toFixed(9)} window=${debug_option(pill.window_number())}`
      console.error(line)
      stream.end(`${line}\n`)
    }
    stream.setEncoding("utf8")
    stream.on("data", (chunk: string) => {
      command += chunk
      const newline = command.indexOf("\n")
      if (newline >= 0) { command = command.slice(0, newline + 1); serve() }
    })
    stream.on("end", serve)
    // A failed read skips the connection.
    stream.on("error", () => { read = true; stream.destroy() })
  })
  listener.on("error", (e) => { throw new Error(`unique overlay probe socket: ${e.message}`) })
  listener.listen(path)
  listener.unref()
}
function main() {
  if (process.env.OVERLAY_LAB_UNDERLAY !== undefined) {
    void run_windows((displays) => {
      const state = init(); state.underlay = true
      const app: App<State> = App.new(spec()).init(() => state)
      const seconds = parse_u64(process.env.OVERLAY_LAB_SECONDS ?? "")
      if (seconds !== null) {
        const handle = app.handle()
        spawn(async () => { await sleep(seconds); handle.quit() })
      }
      const display = displays.find((d) => d.primary) ?? displays[0]
      const options = display !== undefined ? new WindowOptions({
        borderless: true, position: display.position, physical_size: display.size,
      }) : new WindowOptions()
      const configured = process.env.OVERLAY_LAB_NATIVE_WINDOW !== undefined
        ? options.macos(MacWindowOptions.default().shadow(false).level(24)
          .collection_behavior(1 | 16 | 64 | 256).exclude_from_capture(true))
        : ConfiguredWindowOptions.from(options)
      return [WindowSpec.from_app("underlay", app).configured_options(configured)]
    })
    return
  }
  void run_windows_with({ accessory: true }, (displays) => {
    const exclude = process.env.OVERLAY_LAB_INCLUDE_IN_CAPTURE === undefined
    const handles = Handles.default()
    const app = App.new(spec()).windowless()
    for (const display of displays) {
      const state = init()
      state.picker = true
      state.handles = handles
      const target: DisplayTarget = display.id == null ? "Primary" : { Id: display.id.clone() }
      const picker = app.overlay(OverlaySpec.new("Rune picker", [680.0, 160.0], view).options(new OverlayOptions({
        display: target, placement: "FullScreen", level: "AboveStatus",
        input: "All", exclude_from_capture: exclude, keys: "OnDemand", prewarm: true,
      })).on_key(key).on_created((created) => console.error(`overlay-lab picker created ${debug_created(created as OverlayCreated)}`)), state)
      handles.pickers.push(picker)
    }
    const state = init()
    state.handles = handles
    const pill = app.overlay(new OverlaySpec({ ...OverlaySpec.new("Rune pill", [680.0, 160.0], view), margin: 40.0 }).options(new OverlayOptions({
      display: "UnderPointer", follow_pointer: true,
      input: "Regions", exclude_from_capture: exclude, level: "AboveOverlays", prewarm: true,
    })).on_created((created) => console.error(`overlay-lab pill created ${debug_created(created as OverlayCreated)}`)), state)
    handles.pill = pill.clone()
    if (process.platform === "darwin") native_probe(pill.clone(), app.handle())
    if (process.platform !== "darwin" || process.env.OVERLAY_LAB_CONTROL === undefined) pill.show()
    if (process.env.OVERLAY_LAB_PICKER !== undefined) {
      const state = init(); state.handles = handles; show_picker(state)
    }
    const seconds = parse_u64(process.env.OVERLAY_LAB_SECONDS ?? "")
    if (seconds !== null) {
      const app_handle = app.handle()
      spawn(async () => {
        await sleep(0.75)
        console.error(`overlay-lab window=${debug_option(pill.window_number())} capture=${pill.capture_exclusion()}`)
        await sleep(seconds)
        app_handle.quit()
      })
    }
    return [WindowSpec.from_app("lab", app).options(new WindowOptions({ transparent: true }))]
  })
}

// Rust's threads, as async functions. Their sleeps are unref'd timers: like a spawned thread,
// they don't keep the process alive once `main` has returned (headless renders end at once).
function spawn(f: () => Promise<void>) { void f() }
/** `std::thread::sleep`, in seconds (in steps, past a timer's 24.8-day limit). */
function sleep(secs: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (ms: number) => {
      const now = Math.min(ms, 0x7fff_ffff)
      setTimeout(() => { if (ms > now) step(ms - now); else resolve() }, now).unref()
    }
    step(secs * 1000)
  })
}

/** `str::parse::<u64>`: ASCII digits with an optional `+`. */
function parse_u64(s: string): number | null {
  return /^\+?[0-9]+$/.test(s) ? Number(s) : null
}

/**
 * QuartzCore's `CACurrentMediaTime`, the host clock in seconds that the native probes compare
 * against. Node's `process.hrtime` reads the same clock (mach_absolute_time); Bun's counts from
 * launch, so Bun calls QuartzCore through `bun:ffi`, as Rust's `extern "C"` block does.
 */
const CACurrentMediaTime: () => number = (() => {
  if (process.versions.bun === undefined) return () => Number(process.hrtime.bigint()) / 1e9
  let symbol: (() => number) | null = null
  return () => {
    if (symbol === null) {
      const ffi = createRequire(import.meta.url)("bun:ffi")
      const lib = ffi.dlopen("/System/Library/Frameworks/QuartzCore.framework/QuartzCore", {
        CACurrentMediaTime: { args: [], returns: ffi.FFIType.f64 },
      })
      symbol = lib.symbols.CACurrentMediaTime as () => number
    }
    return symbol()
  }
})()

// Rust's `{:?}` for what the lab logs: the native probes parse these lines.
function debug_option(v: number | null | undefined): string {
  return v == null ? "None" : `Some(${v})`
}
function debug_created(c: OverlayCreated): string {
  const caps = c.capabilities
  return `OverlayCreated { window_number: ${debug_option(c.window_number)}, capabilities: OverlayCapabilities { ` +
    `capture_exclusion: ${caps.capture_exclusion}, nonactivating_keys: ${caps.nonactivating_keys}, global_pointer: ${caps.global_pointer} } }`
}
function debug_key_event(e: KeyEvent): string {
  const m = e.mods
  return `KeyEvent { key: ${debug_key(e.key)}, mods: Mods { shift: ${m.shift}, cmd: ${m.cmd}, alt: ${m.alt}, ctrl: ${m.ctrl}, logo: ${m.logo} } }`
}
function debug_key(k: Key): string {
  if (typeof k === "string") return k
  if ("Text" in k) return `Text(${debug_str(k.Text, '"')})`
  if ("Command" in k) return `Command(${debug_str(k.Command, "'")})`
  if ("Function" in k) return `Function(${k.Function})`
  return `Modifier { modifier: ${k.Modifier.modifier}, pressed: ${k.Modifier.pressed} }`
}
function debug_str(s: string, quote: string): string {
  let out = ""
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === quote || ch === "\\") out += `\\${ch}`
    else if (ch === "\n") out += "\\n"
    else if (ch === "\r") out += "\\r"
    else if (ch === "\t") out += "\\t"
    else if (ch === "\0") out += "\\0"
    else if (c < 0x20 || c === 0x7f) out += `\\u{${c.toString(16)}}`
    else out += ch
  }
  return `${quote}${out}${quote}`
}
function debug_selection(sel: Rect | null): string {
  return sel === null ? "None" : `Some([${sel.map(debug_f32).join(", ")}])`
}
/** An `f32`'s `{:?}`: the shortest decimal that reads back as the same `f32`. */
function debug_f32(x: number): string {
  if (Number.isNaN(x)) return "NaN"
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf"
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0"
  let n = x
  for (let p = 1; p <= 9; p++) {
    const d = Number(x.toPrecision(p))
    if (Math.fround(d) === x) { n = d; break }
  }
  const a = Math.abs(n)
  if (a >= 1e16 || a < 1e-4) return n.toExponential().replace("e+", "e")
  const s = String(n)
  return s.includes(".") ? s : `${s}.0`
}

main()
