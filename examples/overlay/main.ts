// One normal control window and one transparent, borderless, always-on-top overlay per display,
// sharing one background-driven `Live<[f32; 2]>` remote cursor (README.md).

import { AppSpec, Color, type Cx, type El, Icon, Live, type Tx, type Waker, type WindowHandle, WindowOptions, WindowSpec, col, el, icon, run_windows, text, tok } from "runex-js"

// Rust's f32 math rounds every step.
const f32 = Math.fround

let WINDOWED = false
const STROKE: Icon = new Icon({
  name: "shared-stroke", view: 240.0,
  body: `<path d="M 12 190 C 55 30 90 210 130 70 S 190 170 228 35" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`,
})
class State {
  overlay: boolean
  cursor: Live // Live<[f32; 2]>
  overlays: WindowHandle[] // Arc<Mutex<Vec<WindowHandle>>>: one array, shared by reference
  constructor(init: { overlay: boolean; cursor: Live; overlays: WindowHandle[] }) {
    this.overlay = init.overlay
    this.cursor = init.cursor
    this.overlays = init.overlays
  }
  // Rust's `impl Drop for State` (the controls state closes every overlay when it is dropped) has
  // no JavaScript counterpart (docs/porting.md, "Where the ports differ from the Rust examples").
}
function init(): State {
  return new State({ overlay: false, cursor: Live.new([120.0, 90.0]), overlays: [] })
}
function view(s: State, _: Cx): El {
  const green = new Color({ r: 0.1, g: 0.85, b: 0.45, a: 1.0 })
  if (s.overlay) {
    return el().w_full().h_full().child(icon(STROKE, 240.0).key("stroke").color(green)
      .pin(80.0, 80.0, null, null))
      .child(el().key("remote-cursor").size(12.0, 18.0).radius(3.0).fill(green)
        .pin(0.0, 0.0, null, null).live_offset(s.cursor))
      .on_press((s: State) => {
        for (const window of s.overlays) { try { window.set_click_through(true) } catch { /* let _ = */ } }
      })
  }
  return col().w_full().h_full().padding(40.0).gap(20.0)
    .fill(new Color({ r: 0.018, g: 0.024, b: 0.03, a: 1.0 }))
    .child(text("Display overlays").font(tok.type_.BODY))
    .child(el().padding(16.0).radius(8.0).fill(green.alpha(0.15))
      .child(text("Test overlay input"))
      .on_press((s: State) => {
        for (const window of s.overlays) {
          try { window.set_click_through(false) } catch (e) { console.error(`click-through: ${e instanceof Error ? e.message : e}`) }
        }
      }))
}
function point(t: number): [number, number] {
  const t32 = f32(Math.min(t, 4.0))
  return [f32(120.0 + f32(120.0 * f32(Math.sin(f32(t32 * f32(0.7)))))), f32(90.0 + f32(50.0 * f32(Math.sin(t32))))]
}
function poll(s: State, t: number, _: Tx): boolean {
  if (!WINDOWED) s.cursor.set(point(t))
  return false
}
/** `std::thread::sleep`, for the producer task below (JavaScript's threads are timers). */
function sleep(secs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000))
}
function setup(s: State, _: Waker) {
  if (!WINDOWED || s.overlay) return
  const cursor = s.cursor.clone()
  void (async () => {
    const start = performance.now() / 1000
    for (let tick = 1; tick <= 480; tick++) {
      const t = tick / 120.0
      await sleep(Math.max(0, start + t - performance.now() / 1000))
      cursor.set(point(t))
    }
  })()
}
function spec(): AppSpec<State> {
  return { ...AppSpec.new<State>("Rooms overlay example", [560.0, 440.0], init, view), setup, poll }
}
function main() {
  WINDOWED = !process.argv.slice(2).some((a) => ["--snap", "--trace", "--tree", "--frames", "--strip", "--first-pixels", "--list-scenes", "--list-windows"].includes(a))
  run_windows((displays) => {
    const controls = init()
    const cursor = controls.cursor.clone()
    const overlays = controls.overlays
    const windows = [WindowSpec.new("controls", spec()).state(controls)]
    displays.forEach((display, i) => {
      const state = new State({ overlay: true, cursor: cursor.clone(), overlays })
      const handles = overlays
      windows.push(WindowSpec.new(`overlay-${i}`, spec()).state(state)
        .options(WindowOptions.overlay(display)).on_created((created) => {
          const window = created as unknown as WindowHandle
          // ScreenCaptureKit: exclude this CGWindowID using SCContentFilter.
          const number = window.window_number()
          console.error(`overlay native window number: ${number === null ? "None" : `Some(${number})`}`)
          handles.push(window)
        }))
    })
    return windows
  })
}

main()
