// An app that outlives its window: it starts with none, a background thread feeds it, and
// commands on stdin open, focus, close and quit it. Closing the window keeps the app running;
// reopening shows the same state (the ticks kept counting, the note kept its text).
//
// ```sh
// bun examples/background/main.ts            # stdin: open | show | hide | focus | activate TOKEN | close | status | quit
// bun examples/background/main.ts --open     # start with the window
// bun examples/background/main.ts --release-gpu  # closing also drops the GPU device
// bun examples/background/main.ts --accessory    # macOS: no Dock icon until `dock on`
// # `hud show|hide|top|bottom|recording|transcribing|status` drives a recording-HUD overlay;
// # `capsule show|hide|left|wide|status` a clickable corner capsule
// bun examples/background/main.ts --snap /tmp/background.png
// ```

import { createInterface } from "node:readline"

import { App, AppSpec, type Cx, type El, type KeyEvent, OverlaySpec, TextEdit, type Tx, col, el, oklch, row, text, text_input, tok } from "runex-js"
const { radius, space, type_ } = tok

type Background = {
  ticks: number
  closes: number
  note: TextEdit
}

function init(): Background {
  return {
    ticks: 0,
    closes: 0,
    note: TextEdit.new("Type here, close, reopen"),
  }
}

function button(key: string, label: string, t: tok.Theme, f: (s: Background, tx: Tx) => void): El {
  return row()
    .key(key)
    .role("button")
    .label(label)
    .h(28.0)
    .px(space.S3)
    .center()
    .radius(radius.MD)
    .fill(t.card)
    .border(1.0, t.card_border)
    .on_press_tx(f)
    .child(text(label).font(type_.LABEL).color(t.text))
}

function view(s: Background, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  return col()
    .key("window")
    .fill(t.bg)
    .px(space.S6)
    .py(space.S6)
    .gap(space.S3)
    .child(text("Background app").key("title").font(type_.TITLE).color(t.text))
    .child(
      text(`${s.ticks} ticks from a background thread, window closed ${s.closes} times`)
        .key("ticks")
        .font(type_.BODY)
        .color(t.text_secondary),
    )
    .child(
      el().key("note-field")
        .w_full()
        .h(32.0)
        .px(space.S2)
        .radius(radius.MD)
        .fill(t.card)
        .border(1.0, t.card_border)
        .center_y()
        .child(
          text_input(s.note, type_.BODY)
            .key("note")
            .color(t.text)
            .on_edit((s: Background) => s.note),
        ),
    )
    .child(
      row()
        .key("actions")
        .gap(space.S2)
        .child(button("close", "Close window", t, (_, tx) => tx.close_window()))
        .child(button("quit", "Quit", t, (_, tx) => tx.quit())),
    )
}

/** Cmd/Ctrl-W closes the window, Cmd/Ctrl-Q quits. */
function on_key(_: Background, ev: KeyEvent, tx: Tx): boolean {
  const k = ev.key
  if (typeof k === "object" && "Command" in k && k.Command === "w") tx.close_window()
  else if (typeof k === "object" && "Command" in k && k.Command === "q") tx.quit()
  else return false
  return true
}

function on_close(s: Background, _: Tx) {
  s.closes += 1
  console.error("background: window closed; still running")
}

/** The overlay's own state: what a recording HUD shows. */
type Hud = {
  seconds: number
  transcribing: boolean
}

function hud(h: Hud, _: Cx): El {
  const label = h.transcribing ? "Transcribing" : `Recording ${Math.trunc(h.seconds / 60)}:${String(h.seconds % 60).padStart(2, "0")}`
  return row().key("hud").w_full().h_full().center().child(
    row()
      .key("pill")
      .h(36.0)
      .px(space.S3)
      .gap(space.S2)
      .center()
      .radius(18.0)
      .fill(oklch(0.2, 0.0, 0.0))
      .border(1.0, oklch(0.3, 0.0, 0.0))
      .child(el().key("dot").size(8.0, 8.0).radius(4.0).fill(h.seconds % 2 === 0 ? oklch(0.65, 0.2, 25.0) : oklch(0.45, 0.12, 25.0)))
      .child(text(label).key("label").font(type_.LABEL).color(oklch(0.93, 0.0, 0.0))),
  )
}

function capsule(presses: number, _: Cx): El {
  const t = tok.theme(true)
  return row().key("capsule").w_full().h_full().px(space.S2).gap(space.S2).center().radius(24.0).fill(t.card).border(1.0, t.card_border).child(
    text(`Pressed ${presses} times`).key("presses").font(type_.LABEL).color(t.text),
  )
    .child(
      row().key("press").role("button").h(28.0).px(space.S3).center().radius(radius.MD).fill(t.control_off).hover(t.hover)
        // The state is a number: returning the new count replaces it (`*n += 1`).
        .on_press((n: number) => {
          n += 1
          console.error(`background: capsule pressed ${n}`)
          return n
        })
        .child(text("Press").font(type_.LABEL).color(t.text)),
    )
}

/** `str::parse::<i32>()`: an optional sign and decimal digits, in range. */
function parse_i32(v: string): number | null {
  if (!/^[+-]?[0-9]+$/.test(v)) return null
  const n = Number(v)
  return n >= -2147483648 && n <= 2147483647 ? n : null
}

/** Rust's `{:?}` of an `Option<String>`. */
function debug_option(v: string | null): string {
  return v === null ? "None" : `Some(${JSON.stringify(v)})`
}

/** Rust's `{:?}` of a value from an externally tagged enum: `Variant(..)`, or the unit variant's name. */
function debug_enum(v: unknown): string {
  if (typeof v === "string") return v
  if (v && typeof v === "object") {
    const [[variant, fields]] = Object.entries(v)
    return `${variant}(${JSON.stringify(fields)})`
  }
  return String(v)
}

const args = process.argv.slice(2)
let app = App.new<Background>({
  ...AppSpec.new<Background>("Background", [480.0, 420.0], init, view),
  scenes: [["ticked", (s) => { s.ticks = 42 }]],
  on_key: on_key,
})
  .keep_running()
  .on_close(on_close)
// Rust's `.on_window(..)` prints the platform's raw window handle kind (`with_raw_handle`), which
// JavaScript can't hold (docs/porting.md, "Where the ports differ from the Rust examples").
if (!args.some((a) => a === "--open")) {
  app = app.windowless()
}
if (args.some((a) => a === "--accessory")) {
  app = app.accessory()
}
if (args.some((a) => a === "--release-gpu")) {
  app = app.release_gpu_when_closed()
}
// `--hud-large` covers most of the screen, to check that clicks pass through it.
const size: [number, number] = args.some((a) => a === "--hud-large") ? [1200.0, 700.0] : [240.0, 44.0]
const overlay = app.overlay(
  new OverlaySpec<Hud>({
    name: "background-hud",
    size,
    edge: "Top",
    margin: 16.0,
    align: "Center",
    inset: 0.0,
    interactive: false,
    view: hud,
  }),
  { seconds: 0, transcribing: false } satisfies Hud,
)
// A clickable capsule in the top-right corner, like a meeting offer: clicks reach it, focus
// stays where it was.
const capsule_overlay = app.overlay(
  new OverlaySpec<number>({
    name: "background-capsule",
    size: [220.0, 48.0],
    edge: "Top",
    margin: 40.0,
    align: "End",
    inset: 12.0,
    interactive: true,
    view: capsule,
  }),
  0,
)
const ticker = app.handle()
const hud_ticker = overlay.clone()
// The ticker thread: once a second.
setInterval(() => {
  ticker.update((s: Background) => { s.ticks += 1 })
  hud_ticker.update((h: Hud) => { h.seconds += 1 })
}, 1000)
const commands = app.handle()
// The stdin thread: one command per line.
void (async () => {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const list = line.split(/\s+/).filter((w) => w !== "")
    const words = list[Symbol.iterator]()
    const next = (): string | undefined => words.next().value
    const [first, second] = [next(), next()]
    if (first === "open") commands.open()
    else if (first === "show") commands.show()
    else if (first === "hide") commands.hide()
    else if (first === "focus") commands.focus()
    else if (first === "position" && second !== undefined) {
      const x = parse_i32(second)
      const third = next()
      const y = third === undefined ? undefined : parse_i32(third)
      if (x !== null && y !== undefined && y !== null) {
        commands.set_position([x, y])
      }
    } else if (first === "activate" && second !== undefined) commands.activate(second)
    else if (first === "close") commands.close()
    else if (first === "quit") commands.quit()
    else if (first === "status") console.error(`background: visible ${commands.is_visible()}, window error ${debug_option(commands.window_error())}`)
    else if (first === "dock" && second !== undefined) commands.set_dock_icon(second === "on")
    else if (first === "hud" && second === "show") overlay.show()
    else if (first === "hud" && second === "hide") overlay.hide()
    else if (first === "hud" && second === "top") overlay.set_edge("Top")
    else if (first === "hud" && second === "bottom") overlay.set_edge("Bottom")
    else if (first === "hud" && second === "transcribing") overlay.update((h: Hud) => { h.transcribing = true })
    else if (first === "hud" && second === "recording") overlay.update((h: Hud) => { h.transcribing = false })
    else if (first === "hud" && second === "status") console.error(`background: hud ${debug_enum(overlay.availability())}`)
    else if (first === "capsule" && second === "show") capsule_overlay.show()
    else if (first === "capsule" && second === "hide") capsule_overlay.hide()
    else if (first === "capsule" && second === "left") capsule_overlay.set_align("Start", 12.0)
    else if (first === "capsule" && second === "wide") capsule_overlay.resize([320.0, 48.0])
    else if (first === "capsule" && second === "status") console.error(`background: capsule ${debug_enum(capsule_overlay.availability())}`)
    else if (first !== undefined) {
      console.error(`background: unknown command ${JSON.stringify(first)} (open | show | hide | focus | position X Y | activate TOKEN | close | dock on|off | hud show|hide|top|bottom|recording|transcribing|status | capsule show|hide|left|wide|status | quit)`)
    }
  }
})()
await app.run()
// `main` returning ends the process, and the threads above with it.
process.exit(0)
