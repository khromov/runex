// An overlay with a repeating 100 ms timer, for measuring idle cost while the panel is
// covered or the displays sleep. Prints its timer count once a second.
//
// `OCCLUDED_TIMER_SECONDS=n` quits after n seconds; `OCCLUDED_TIMER_PREWARM=1` prewarms the
// panel; `OCCLUDED_TIMER_REGIONS=1` takes pointer input over its pill only;
// `OCCLUDED_TIMER_BOTTOM=1` puts it at the bottom edge; `OCCLUDED_TIMER_WINDOW=1` runs the
// timer in a regular window instead. `OCCLUDED_TIMER_UPDATE=1` replaces the repeating timer
// with one 100 ms `wake_after` that an update from another thread sets each second, and also
// prints the latest that timer fired.
//
// (vendor/rune/examples/overlay-lab/src/bin/occluded-timer.rs)
import {
  App, type AppHandle, AppSpec, Color, type Cx, type El, type OverlayInput, OverlayOptions, OverlaySpec, type ScreenEdge,
  type Tx, WindowOptions, WindowSpec, el, run_windows_with, text,
} from "runex-js"

const PERIOD = 0.1
/** `Duration::from_millis(100)`, in seconds. */
const ARMED = 0.1
let FIRED = 0
let WORST_MS = 0

/** `armed` is an `Instant`: `performance.now()`, in milliseconds. */
type State = { next: number; armed: number | null }
/** `#[derive(Default)]`. */
const State = { default: (): State => ({ next: 0.0, armed: null }) }

function view(_: State, _cx: Cx): El {
  return el().key("pill").hit().padding(12.0).radius(16.0).fill(new Color({ r: 0.1, g: 0.12, b: 0.16, a: 0.95 }))
    .child(text(`fired ${FIRED}`).color(Color.WHITE))
}

function poll(s: State, t: number, tx: Tx): boolean {
  if (updates()) return poll_armed(s)
  const fired = t >= s.next
  if (fired) {
    FIRED += 1
    s.next = t + PERIOD
  }
  tx.wake_after(Math.max(s.next - t, 0.0))
  return fired
}

/** Counts the update's timer once it is due, and how late it ran. */
function poll_armed(s: State): boolean {
  const at = s.armed
  if (at === null || elapsed(at) < ARMED) return false
  s.armed = null
  FIRED += 1
  // `as_millis()` truncates.
  WORST_MS = Math.max(WORST_MS, Math.floor(elapsed(at) * 1000))
  return true
}

function arm(s: State, tx: Tx) {
  s.armed = performance.now()
  tx.wake_after(ARMED)
}

function updates(): boolean { return process.env.OCCLUDED_TIMER_UPDATE !== undefined }

function main() {
  void run_windows_with({ accessory: true }, (_) => {
    const window = process.env.OCCLUDED_TIMER_WINDOW !== undefined
    const spec: AppSpec<State> = { ...AppSpec.new<State>("Occluded timer", [420.0, 400.0], State.default, view), poll: window ? poll : null }
    let app = App.new(spec)
    if (window) {
      const handle = app.handle()
      report(app.handle(), () => handle.update(arm))
      // Side by side, so neither covers the other.
      const x = process.env.OCCLUDED_TIMER_BOTTOM !== undefined ? 900 : 100
      return [WindowSpec.from_app("occluded-timer", app).options(new WindowOptions({ position: [x, 200] }))]
    }
    app = app.windowless()
    const input: OverlayInput = process.env.OCCLUDED_TIMER_REGIONS !== undefined ? "Regions" : "All"
    const edge: ScreenEdge = process.env.OCCLUDED_TIMER_BOTTOM !== undefined ? "Bottom" : "Top"
    const overlay = app.overlay(new OverlaySpec({ ...OverlaySpec.new("Occluded timer", [220.0, 60.0], view), edge }).options(new OverlayOptions({
      input, prewarm: process.env.OCCLUDED_TIMER_PREWARM !== undefined,
    })).poll(poll), State.default())
    overlay.show()
    // (`OverlayHandle.update` types its `tx` as the addon's opaque `Tx`.)
    report(app.handle(), () => overlay.update((s: State, tx) => arm(s, tx as Tx)))
    return [WindowSpec.from_app("occluded-timer", app)]
  })
}

function report(handle: AppHandle<State>, arm: () => void) {
  const quit = parse_u64(process.env.OCCLUDED_TIMER_SECONDS)
  spawn(async () => {
    const start = performance.now()
    for (;;) {
      await sleep(1)
      // `as_secs()` truncates.
      const elapsed_secs = Math.floor(elapsed(start))
      console.error(`occluded-timer t=${elapsed_secs} fired=${FIRED} worst_ms=${WORST_MS}`)
      if (quit !== null && elapsed_secs >= quit) { handle.quit(); return }
      if (updates()) arm()
    }
  })
}

/** `Instant::elapsed`, in seconds. */
function elapsed(at: number): number { return (performance.now() - at) / 1000 }

// Rust's threads, as async functions. Their sleeps are unref'd timers: like a spawned thread,
// they don't keep the process alive once `main` has returned (headless renders end at once).
function spawn(f: () => Promise<void>) { void f() }
function sleep(secs: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, secs * 1000).unref() })
}

/** `str::parse::<u64>().ok()` of an optional variable: ASCII digits with an optional `+`. */
function parse_u64(s: string | undefined): number | null {
  return s !== undefined && /^\+?[0-9]+$/.test(s) ? Number(s) : null
}

main()
