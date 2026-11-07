// A system material card in a transparent, borderless window, flying over a busy test pattern
// in a second window and docking, with a spring on its frame and corner radius. Rune draws the
// card's shadow and contents; on macOS the glass (or the popover material before macOS 26)
// is a native view that moves in the same Core Animation transaction as each frame.
//
// ```sh
// bun examples/glass-card/main.ts
// RUNE_SYSTEM_MATERIAL=legacy bun examples/glass-card/main.ts    # NSVisualEffectView popover
// RUNE_SYSTEM_MATERIAL=unsynced bun examples/glass-card/main.ts  # views move outside the frame's transaction
// GLASS_CARD_PATTERN=black bun examples/glass-card/main.ts       # black backdrop and a magenta card edge, to measure sync
// GLASS_CARD_BUSY_MS=6 bun examples/glass-card/main.ts           # spend 6 ms of each frame busy on the main thread
// ```
//
// Space or the button flies and docks the card; `b` toggles a busy main thread. The card
// flies on its own every 1.6 seconds unless `GLASS_CARD_MANUAL` is set, and the app quits after
// `GLASS_CARD_SECONDS` when that is set. `GLASS_CARD_AT=x,y` places both windows, in points from
// the primary display's top left (default `80,80`). `GLASS_CARD_TRACE=card.jsonl` writes the
// card window's frame trace, with each drawable's on-screen present time.

import {
  App, AppSpec, Color, type Cx, type El, type KeyEvent, LoopSpec, MacWindowOptions, Spring, type SystemMaterial, TextStyle,
  type Tx, WindowOptions, WindowSpec, col, el, oklch, row, run_windows, text,
} from "runex-js"

const SIZE: [number, number] = [760.0, 480.0]
const MAGENTA: Color = new Color({ r: 1.0, g: 0.0, b: 1.0, a: 1.0 })

/** Rust's `()` state: an empty object (nothing reads it). */
type Unit = Record<string, never>

type Card = {
  docked: boolean
  busy_ms: number
  measure: boolean
  material: SystemMaterial
}

/** `str::parse::<u64>()`: decimal digits, an optional leading `+`, nothing else. */
function parse_u64(v: string): number | null {
  return /^\+?[0-9]+$/.test(v) ? Number(v) : null
}

/** `str::parse::<f64>()`: a decimal or exponent number, `inf` or `NaN`, without surrounding spaces. */
function parse_f64(v: string): number | null {
  if (/^[+-]?(inf|infinity)$/i.test(v)) return v.startsWith("-") ? -Infinity : Infinity
  if (/^[+-]?nan$/i.test(v)) return NaN
  return /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(v) ? Number(v) : null
}

function init(): Card {
  const busy = process.env.GLASS_CARD_BUSY_MS
  return {
    docked: false,
    busy_ms: (busy !== undefined ? parse_u64(busy) : null) ?? 0,
    measure: measuring(),
    material: process.env.GLASS_CARD_POPOVER !== undefined ? "Popover" : "Glass",
  }
}

function measuring(): boolean {
  return process.env.GLASS_CARD_PATTERN === "black"
}

/** The card's frame and corner radius: a wide card, or a capsule docked bottom right. */
function frame(docked: boolean): [[number, number, number, number], number] {
  if (docked) { return [[SIZE[0] - 290.0, SIZE[1] - 94.0, 250.0, 60.0], 30.0] } else { return [[70.0, 60.0, 400.0, 260.0], 28.0] }
}

function card_view(s: Card, _: Cx): El {
  const [[x, y, w, h], radius] = frame(s.docked)
  const label = s.docked ? "Fly" : "Dock"
  const button = row().key("toggle").role("button").label(label).hit().h(30.0).px(14.0).center().radius(15.0)
    .fill(Color.WHITE.alpha(0.18)).border(1.0, Color.WHITE.alpha(0.3))
    .on_press((s: Card) => { s.docked = !s.docked })
    .child(text(label).font(TextStyle.new(13.0, 600.0)).color(Color.WHITE))
  const title = text(s.docked ? "Docked" : "Liquid glass").key("title").font(TextStyle.new(s.docked ? 15.0 : 26.0, 650.0)).color(Color.WHITE)
  const body = !s.docked
    ? text("Frame and corner radius on one spring. The material moves in the same transaction as this text, its shadow and the button.")
      .key("body").w_full().wrap().font(TextStyle.new(14.0, 450.0)).color(Color.WHITE.alpha(0.85))
    : null
  const busy = s.busy_ms > 0
    ? text(`Main thread busy ${s.busy_ms} ms a frame`).key("busy")
      .font(TextStyle.new(12.0, 500.0)).color(Color.WHITE.alpha(0.7))
    : null
  let card = col().key("card").absolute(x, y).size(w, h).radius(radius).padding(s.docked ? 16.0 : 26.0).gap(12.0)
    .shadow(18.0, 44.0, new Color({ r: 0.0, g: 0.0, b: 0.0, a: 0.35 }))
    .system_material(s.material)
    .motion(Spring.new(0.7, 0.22))
  if (s.measure) { card = card.border(2.0, MAGENTA) }
  // `Option<El>` as `children`: none or one.
  const opt = (e: El | null): El[] => (e ? [e] : [])
  const filled = s.docked
    ? card.child(row().w_full().h_full().center_y().gap(12.0).child(title).child(el().grow(1.0)).child(button))
    : card.child(title).children(opt(body)).children(opt(busy)).child(el().grow(1.0)).child(row().w_full().child(el().grow(1.0)).child(button))
  return el().key("root").w_full().h_full().child(filled)
}

function busy(s: Card, _t: number, _tx: Tx): boolean {
  if (s.busy_ms > 0) {
    const until = performance.now() + s.busy_ms
    while (performance.now() < until) { /* spin */ }
  }
  return false
}

function key(s: Card, event: KeyEvent, _: Tx): boolean {
  const k = event.key
  if (typeof k === "object" && "Text" in k && k.Text === " ") s.docked = !s.docked
  else if (typeof k === "object" && "Text" in k && k.Text === "b") s.busy_ms = s.busy_ms > 0 ? 0 : 8
  else return false
  return true
}

/** Moving bars over a grid of colour tiles, or plain black to measure edges against. */
function pattern_view(_: Unit, _cx: Cx): El {
  if (measuring()) { return el().key("pattern").w_full().h_full().fill(new Color({ r: 0.0, g: 0.0, b: 0.0, a: 1.0 })) }
  const [cols, rows] = [16, 10]
  const tile: [number, number] = [Math.fround(SIZE[0] / cols), Math.fround(SIZE[1] / rows)]
  const tiles = Array.from({ length: cols * rows }, (_, i) => {
    const [c, r] = [i % cols, Math.trunc(i / cols)]
    const light = (c + r) % 2 === 0 ? 0.78 : 0.42
    return el().absolute(Math.fround(c * tile[0]), Math.fround(r * tile[1])).size(tile[0], tile[1]).fill(oklch(light, 0.16, (i * 23) % 360))
  })
  const bars = Array.from({ length: 6 }, (_, k) =>
    el().absolute(0.0, 0.0).size(36.0, SIZE[1]).fill(k % 2 === 0 ? Color.WHITE : new Color({ r: 0.0, g: 0.0, b: 0.0, a: 1.0 }))
      .looping(new LoopSpec({ ...LoopSpec.slide(3.6, [-1.0, 0.0], [Math.fround(SIZE[0] / 36.0), 0.0]), delay: k * 0.6 })))
  const words = Array.from({ length: 3 }, (_, k) =>
    text("RUNE 120 Hz").font(TextStyle.new(64.0, 800.0)).color(Color.WHITE).absolute(40.0, Math.fround(60.0 + Math.fround(k * 170.0)))
      .looping(new LoopSpec({ ...LoopSpec.slide(4.0, [0.0, 0.0], [0.9, 0.0]), delay: k * 1.3 })))
  return el().key("pattern").w_full().h_full().fill(new Color({ r: 0.1, g: 0.1, b: 0.12, a: 1.0 })).children(tiles).children(bars).children(words)
}

run_windows((displays) => {
  const display = displays.find((d) => d.primary) ?? displays[0] ?? null
  const at = process.env.GLASS_CARD_AT
  const comma = at?.indexOf(",") ?? -1
  const parsed = at !== undefined && comma >= 0 ? [parse_f64(at.slice(0, comma)), parse_f64(at.slice(comma + 1))] : null
  const place: [number, number] | null = parsed && parsed[0] !== null && parsed[1] !== null ? [parsed[0], parsed[1]] : null
  const [x, y] = place ?? [80.0, 80.0]
  // `as i32` truncates toward zero and saturates.
  const as_i32 = (v: number) => (Number.isNaN(v) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(v))))
  const origin: [number, number] = display
    ? [display.position[0] + as_i32(x * display.scale), display.position[1] + as_i32(y * display.scale)]
    : [0, 0]
  const pattern = App.new({ ...AppSpec.new<Unit>("Glass card pattern", SIZE, () => ({}), pattern_view), min_size: SIZE }).args([])
  const trace_path = process.env.GLASS_CARD_TRACE
  const trace = trace_path === undefined ? [] : ["--native", "--trace", trace_path]
  const card = App.new({ ...AppSpec.new<Card>("Glass card", SIZE, init, card_view), min_size: SIZE, poll: busy, on_key: key }).args(trace)
  const handle = card.handle()
  if (process.env.GLASS_CARD_MANUAL === undefined) {
    const h = handle.clone()
    setInterval(() => h.update((s: Card) => { s.docked = !s.docked }), 1600)
  }
  const seconds = parse_f64(process.env.GLASS_CARD_SECONDS ?? "")
  if (seconds !== null) {
    setTimeout(() => handle.quit(), seconds * 1000)
  }
  const at_options = new WindowOptions({ borderless: true, position: origin, resizable: false, always_on_top: true })
  // Rune draws the card's shadow, so the window has none of its own.
  const over = new WindowOptions({ ...at_options, transparent: true }).macos(MacWindowOptions.default().shadow(false))
  return [
    WindowSpec.from_app("pattern", pattern).options(at_options).boxed(),
    WindowSpec.from_app("card", card).configured_options(over).boxed(),
  ]
}).then(() => process.exit(0))
