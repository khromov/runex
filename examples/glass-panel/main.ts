// A floating card on a system material, built the way a native AppKit panel is. It fades in,
// flies across one big window (an arc over the menu bar, width leading height, its corners
// and shadows changing every frame), then hands off to a card-sized window that follows a
// moving target sixty times a second, and fades out.
//
// - Liquid Glass (`NSGlassEffectView`) on macOS 26+, the popover material before.
// - A frost of the window background colour at 62% over the glass, with label-colour rows,
//   a hairline and text, blended in sRGB as Core Animation blends (`srgb_blend`).
// - Continuous corners on the glass and the content clip.
// - Two Core Animation shadows, contact and ambient, that lift with the flight.
// - Non-activating overlay panels that never take focus: the flight window at
//   `.floating + 1`, the docked one at `.floating`, fading their alpha in (0.18 s) and out
//   (0.144 s).
// - Content swaps with opacity, a 0.96 scale and a 3 pt blur over the still glass.
//
// The hand-off shows the docked window and hides the flight window in one event-loop turn,
// with the same pixels in the same place. The app never activates, so the material shows
// as it does while another app is frontmost.
//
// ```sh
// bun examples/glass-panel/main.ts
// RUNE_SYSTEM_MATERIAL=legacy bun examples/glass-panel/main.ts  # the popover material, as before macOS 26
// ```
//
// `GLASS_PANEL_AT=x,y` places the flight window, in points from the primary display's top
// left (default `360,0`). The app quits after `GLASS_PANEL_SECONDS` when that is set.
// `GLASS_PANEL_POPOVER` asks for the popover material everywhere, and `GLASS_PANEL_MARK`
// draws a marker that tells the two windows apart in a recording.

import {
  App, AppSpec, Color, type Cx, type El, LoopSpec, type OverlayHandle, OverlayOptions, type OverlayPlacement,
  OverlaySpec, Shadow, type SystemMaterial, TextStyle, Transition, type Tx, WindowSpec, col, color, el, oklch, row,
  run_windows_with, text,
} from "runex-js"

const f = Math.fround

/** The flight window's size. It reaches the top of the screen, so the arc passes over the menu bar. */
const FLIGHT_WINDOW: [number, number] = [1000.0, 640.0]
/** The card where it appears and where it docks, in the flight window, with their radii. */
const START: [number, number, number, number] = [120.0, 300.0, 420.0, 236.0]
const DOCK: [number, number, number, number] = [600.0, 64.0, 320.0, 92.0]
const START_RADIUS = 26.0
const DOCK_RADIUS = 18.0
/** Room for the shadows around the docked card, in its own window. */
const MARGIN = 48.0
const FLIGHT_SECONDS = 0.6
/** The landed card holds still this long in the flight window before the hand-off. */
const HOLD_SECONDS = 0.15
const BLACK: Color = new Color({ r: 0.0, g: 0.0, b: 0.0, a: 1.0 })

type Role = "Backdrop" | "Flight" | "Dock"

type Panel = {
  role: Role
  material: SystemMaterial
  /** Start flying on the next frame. */
  fly: boolean
  started: number | null
  landed: number | null
  handed: boolean
  now: number
  frames: number
  /**
   * `GLASS_PANEL_MARK`: a few marker pixels beside the docked card, magenta from the
   * docked window and cyan from the flight window, to find the hand-off in a recording.
   */
  mark: boolean
}

function panel(role: Role): Panel {
  const material: SystemMaterial = process.env.GLASS_PANEL_POPOVER !== undefined ? "Popover" : "Glass"
  const mark = process.env.GLASS_PANEL_MARK !== undefined
  return { role, material, fly: false, started: null, landed: null, handed: false, now: 0.0, frames: 0, mark }
}

/** The flight and docked windows, for the hand-off (a `OnceLock`). */
let HANDLES: [OverlayHandle, OverlayHandle] | null = null
/** Set at the hand-off, which unparks the driver thread. */
let HANDED = false
let DRIVER: Thread | null = null

/** Steps the flight from the frame clock, and hands off once the card has held still. */
function poll(s: Panel, now: number, _: Tx): boolean {
  if (s.fly) {
    [s.fly, s.started, s.landed, s.handed, s.frames] = [false, now, null, false, 0]
  }
  const started = s.started
  if (started === null) return false
  if (s.handed) return false
  s.now = now
  s.frames += 1
  if (s.landed === null && now - started >= FLIGHT_SECONDS) {
    s.landed = now
    console.error(`glass-panel: flight drew ${s.frames} frames in ${(now - started).toFixed(3)} s`)
  }
  const landed = s.landed
  if (landed !== null && now - landed >= HOLD_SECONDS) {
    s.handed = true
    if (HANDLES !== null) {
      const [flight, dock] = HANDLES
      dock.show()
      flight.hide()
    }
    HANDED = true
    if (DRIVER !== null) DRIVER.unpark()
  }
  return true
}

function ease(t: number): number {
  t = Math.min(Math.max(t, 0.0), 1.0)
  return f(f(t * t) * f(3.0 - f(2.0 * t)))
}

function lerp(a: number, b: number, t: number): number { return f(a + f(f(b - a) * t)) }

/**
 * The card at flight time `t` (0 to 1): its rect, corner radius and lift. Width leads height,
 * and the centre rides an arc that rises over the dock before it settles.
 */
function flight(t: number): [[number, number, number, number], number, number] {
  const p = ease(t)
  const w = lerp(START[2], DOCK[2], ease(f(t * 1.25)))
  const h = lerp(START[3], DOCK[3], ease(f(f(t * 1.25) - 0.25)))
  const centre = (r: [number, number, number, number]) => [f(r[0] + f(r[2] * 0.5)), f(r[1] + f(r[3] * 0.5))]
  const [from, to] = [centre(START), centre(DOCK)]
  const control = [lerp(from[0]!, to[0]!, f(0.6)), 0.0]
  const q = f(1.0 - p)
  const arc = (a: number) => f(f(f(f(q * q) * from[a]!) + f(f(f(2.0 * p) * q) * control[a]!)) + f(f(p * p) * to[a]!))
  return [[f(arc(0) - f(w * 0.5)), f(arc(1) - f(h * 0.5)), w, h], lerp(START_RADIUS, DOCK_RADIUS, p), f(Math.sin(f(f(Math.PI) * p)))]
}

function button(label: string, ink: Color, fill: number): El {
  return row().key(label).h(30.0).px(14.0).center().radius(9.0).continuous_corners().fill(ink.alpha(fill))
    .child(text(label).font(TextStyle.new(13.0, 560.0)).color(ink.alpha(0.847)))
}

/**
 * The card: glass, frost, hairline and contents, clipped with continuous corners, over two
 * shadows that deepen and spread with `lift`.
 */
function card(s: Panel, dark: boolean, [x, y, w, h]: [number, number, number, number], radius: number, lift: number, docked: boolean): El {
  const ink = dark ? Color.WHITE : BLACK
  const frost = (dark ? color.hex("#1e1e1e") ?? BLACK : Color.WHITE).alpha(0.62)
  const swap = Transition.opacity().combined(Transition.scale(0.96)).combined(Transition.blur(3.0))
  const content = docked
    ? row().key("docked").absolute(0.0, 0.0).size(DOCK[2], DOCK[3]).px(20.0).gap(12.0).center_y().transition(swap)
      .child(col().gap(3.0)
        .child(text("Waiting for access").font(TextStyle.new(15.0, 620.0)).color(ink.alpha(0.847)))
        .child(text("Turn it on in System Settings").font(TextStyle.new(12.0, 450.0)).color(ink.alpha(0.5))))
      .child(el().grow(1.0))
      .child(button("Open", ink, 0.12))
    : col().key("asking").absolute(0.0, 0.0).size(START[2], START[3]).padding(22.0).gap(12.0).transition(swap)
      .child(text("Allow screen recording?").font(TextStyle.new(19.0, 650.0)).color(ink.alpha(0.847)))
      .child(text("The assistant needs to see the window you are working in to help with it.")
        .w_full().wrap().font(TextStyle.new(13.5, 450.0)).color(ink.alpha(0.5)))
      .child(row().key("setting").w_full().h(44.0).px(14.0).center_y().radius(11.0).continuous_corners().fill(ink.alpha(0.065))
        .child(text("Screen & System Audio Recording").font(TextStyle.new(13.0, 550.0)).color(ink.alpha(0.847))))
      .child(el().grow(1.0))
      .child(row().w_full().gap(10.0).child(el().grow(1.0)).child(button("Not Now", ink, 0.065)).child(button("Open Settings", ink, 0.12)))
  const frosted = el().key("frost").w_full().h_full().radius(radius).continuous_corners().clip_rounded(radius)
    .fill(frost).border(1.0, ink.alpha(0.08)).child(content)
  return el().key("card").absolute(x, y).size(w, h).radius(radius).continuous_corners()
    .box_shadow(Shadow.core_animation(0.0, 0.5, 1.5, BLACK.alpha(f(f(0.3) - f(f(0.1) * lift)))))
    .box_shadow(Shadow.core_animation(0.0, f(8.0 + f(12.0 * lift)), f(18.0 + f(14.0 * lift)), BLACK.alpha(f(f(0.32) + f(f(0.14) * lift)))))
    .system_material(s.material)
    .child(frosted)
}

function view(s: Panel, cx: Cx): El {
  const dark = cx.system_dark()
  const root = el().key("root").w_full().h_full()
  switch (s.role) {
    case "Backdrop": return backdrop()
    case "Dock": return root.child(card(s, dark, [MARGIN, MARGIN, DOCK[2], DOCK[3]], DOCK_RADIUS, 0.0, true))
      .children(s.mark ? [marker(4.0, 4.0, new Color({ r: 1.0, g: 0.0, b: 1.0, a: 1.0 }))] : [])
    case "Flight": {
      const started = s.started
      const t = started === null ? 0.0 : f((s.now - started) / FLIGHT_SECONDS)
      const [rect, radius, lift] = flight(t)
      const flown = root.child(card(s, dark, rect, radius, lift, t >= f(0.4)))
        .children(s.mark ? [marker(DOCK[0] - MARGIN + 12.0, DOCK[1] - MARGIN + 4.0, new Color({ r: 0.0, g: 1.0, b: 1.0, a: 1.0 }))] : [])
      // Keeps frames, and so `poll`, coming until the hand-off.
      if (s.started !== null && !s.handed) {
        return flown.child(el().key("frames").absolute(0.0, 0.0).size(1.0, 1.0).looping(LoopSpec.rotation(1.0)))
      } else return flown
    }
  }
}

function marker(x: number, y: number, color: Color): El { return el().key("mark").absolute(x, y).size(4.0, 4.0).fill(color) }

/** Colour tiles and sweeping bars behind the flight, so the glass has something to bend. */
function backdrop(): El {
  const [w, h] = FLIGHT_WINDOW
  const [cols, rows] = [20, 13]
  const tile = [f(w / cols), f(h / rows)] as const
  const tiles = Array.from({ length: cols * rows }, (_, i) => {
    const [c, r] = [i % cols, Math.trunc(i / cols)]
    const light = (c + r) % 2 === 0 ? 0.8 : 0.5
    return el().absolute(f(c * tile[0]), f(r * tile[1])).size(tile[0], tile[1]).fill(oklch(light, 0.14, i * 23 % 360))
  })
  const bars = Array.from({ length: 4 }, (_, k) => {
    return el().absolute(0.0, 0.0).size(30.0, h).fill(k % 2 === 0 ? Color.WHITE : BLACK)
      .looping(new LoopSpec({ ...LoopSpec.slide(4.8, [-1.0, 0.0], [f(w / 30.0), 0.0]), delay: k * 0.8 }))
  })
  return el().key("backdrop").w_full().h_full().children(tiles).children(bars)
}

function main() {
  const at = parse_at(process.env.GLASS_PANEL_AT) ?? [360.0, 0.0]
  void run_windows_with({ accessory: true }, (_) => {
    const app = App.new(AppSpec.new<Panel>("Glass panel", [1.0, 1.0], () => panel("Backdrop"), view)).windowless()
    const rect = (x: number, y: number, [width, height]: [number, number]): OverlayPlacement | null => ({ Rect: { x, y, width, height } })
    const options = (placement: OverlayPlacement | null) => new OverlayOptions({
      display: "Primary", placement, input: "None", keys: "None", prewarm: true,
    })
    const dock_size: [number, number] = [f(DOCK[2] + f(2.0 * MARGIN)), f(DOCK[3] + f(2.0 * MARGIN))]
    const home: [number, number] = [f(f(at[0] + DOCK[0]) - MARGIN), f(f(at[1] + DOCK[1]) - MARGIN)]
    const backdrop = app.overlay(OverlaySpec.new("Glass panel backdrop", FLIGHT_WINDOW, view)
      .options(options(rect(at[0], at[1], FLIGHT_WINDOW))).macos_level(0), panel("Backdrop"))
    const flight = app.overlay(OverlaySpec.new("Glass panel flight", FLIGHT_WINDOW, view)
      .options(options(rect(at[0], at[1], FLIGHT_WINDOW))).macos_level(4).srgb_blend(true).poll(poll), panel("Flight"))
    const dock = app.overlay(OverlaySpec.new("Glass panel dock", dock_size, view)
      .options(options(rect(home[0], home[1], dock_size))).macos_level(3).srgb_blend(true), panel("Dock"))
    if (HANDLES === null) HANDLES = [flight.clone(), dock.clone()]
    backdrop.show()
    spawn(async (thread) => {
      if (DRIVER === null) DRIVER = thread
      await sleep(0.8)
      for (;;) {
        flight.update((s: Panel, _) => { [s.started, s.landed, s.handed] = [null, null, false] })
        flight.set_macos_level(4)
        flight.fade_in(0.18)
        await sleep(0.7)
        HANDED = false
        flight.update((s: Panel, _) => { s.fly = true })
        while (!HANDED) await thread.park()
        await sleep(0.25)
        // The docked window follows a target that moves side to side, 60 times a second.
        const follow = Instant.now()
        while (Instant.elapsed(follow) < 2.4) {
          const dx = f(60.0 * f(Math.sin(f(f(f(Math.PI * 2) * f(Instant.elapsed(follow))) / f(2.4)))))
          dock.set_placement(rect(f(home[0] + dx), home[1], dock_size))
          await sleep(0.016_667)
        }
        dock.set_placement(rect(home[0], home[1], dock_size))
        dock.fade_out(0.144)
        await sleep(0.6)
      }
    })
    const seconds = parse_f64(process.env.GLASS_PANEL_SECONDS ?? "")
    if (seconds !== null) {
      const handle = app.handle()
      spawn(async () => { await sleep(Duration.from_secs_f64(seconds)); handle.quit() })
    }
    return [WindowSpec.from_app("panel", app)]
  })
}

/** `GLASS_PANEL_AT`: `x,y`, both `f32`s, split at the first comma. */
function parse_at(v: string | undefined): [number, number] | null {
  if (v === undefined) return null
  const comma = v.indexOf(",")
  if (comma < 0) return null
  const [x, y] = [parse_f64(v.slice(0, comma)), parse_f64(v.slice(comma + 1))]
  return x === null || y === null ? null : [f(x), f(y)]
}

/** `str::parse::<f64>().ok()`: Rust's float grammar, with no surrounding whitespace. */
function parse_f64(s: string): number | null {
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity
  if (/^[+-]?nan$/i.test(s)) return NaN
  return /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(s) ? Number(s) : null
}

// Rust's threads, as async functions. Their sleeps are unref'd timers: like a spawned thread,
// they don't keep the process alive once `main` has returned (headless renders end at once).
/** `std::thread::Thread`'s park and unpark, for an async stand-in of a thread. */
class Thread {
  #token = false
  #wake: (() => void) | null = null
  /** Waits for an `unpark`, or returns at once if one came since the last park. */
  park(): Promise<void> {
    if (this.#token) {
      this.#token = false
      return Promise.resolve()
    }
    return new Promise((resolve) => { this.#wake = resolve })
  }
  unpark() {
    const wake = this.#wake
    this.#wake = null
    if (wake !== null) wake()
    else this.#token = true
  }
}
/** `std::thread::spawn`: a panic ends the thread, not the process. */
function spawn(body: (thread: Thread) => Promise<void>) {
  body(new Thread()).catch((e: unknown) => console.error(`thread '<unnamed>' panicked:\n${e instanceof Error ? e.message : String(e)}`))
}
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
const Duration = {
  /** `Duration::from_secs_f64`, in seconds: it panics on a negative, NaN or overflowing value. */
  from_secs_f64(secs: number): number {
    if (secs < 0) throw new Error("cannot convert float seconds to Duration: value is negative")
    if (!(secs < 2 ** 64)) throw new Error("cannot convert float seconds to Duration: value is either too big or NaN")
    return secs
  },
}
/** `std::time::Instant`, in milliseconds; `elapsed` in seconds. */
const Instant = {
  now: (): number => performance.now(),
  elapsed: (at: number): number => (performance.now() - at) / 1000,
}

main()
