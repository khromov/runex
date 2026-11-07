// The live panel on Rune's website: a switch, a spring picker and a puck you can throw along a
// track, drawn by Rune on a canvas the page already has. Nothing moves until you touch it.
// `bun examples/web-showcase/main.ts --snap poster.png --size 560x320 --scale 2` draws the page's poster.
//
// Port of vendor/rune/examples/web-showcase/src/lib.rs. Rust's f32 arithmetic is kept with
// `Math.fround` at every step, as Rust rounds it.

import { AppSpec, Color, type Cx, type Drag, type El, Spring, TextStyle, type Tx, col, el, oklch, oklcha, row, run, text, tok } from "runex-js"

const SPRINGS: [string, Spring][] =
  [["Snappy", Spring.new(0.25, 0.0)], ["Smooth", Spring.new(0.4, 0.0)], ["Bouncy", Spring.new(0.5, 0.3)]]
const CARD_W = 376.0
/** The canvas is this tall; the page reserves the same box, so nothing shifts when it mounts. */
const STAGE_H = 320.0
const PUCK = 28.0
const STOPS = 4

export type State = {
  on: boolean
  spring: number
  /** The puck's position along the track, 0 to 1. */
  at: number
}

const State = {
  default(): State {
    return { on: true, spring: 2, at: 0.0 }
  },
}

/** `f32::clamp`. */
function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max)
}

/** `f32::round`: halves round away from zero (JS `Math.round` rounds them up). */
function round(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

function ink(): Color {
  return oklch(0.74, 0.14, 245.0)
}

function snap(at: number): number {
  const n = STOPS - 1
  return Math.fround(round(Math.fround(at * n)) / n)
}

function switch_(s: State): El {
  const t = tok.theme(true)
  const [w, h, k] = [44.0, 26.0, 22.0]
  const inset = (h - k) / 2.0
  return el().key("switch").role("switch").label("Lights").checked(s.on).focusable(true)
    .size(w, h).radius(h / 2.0)
    .fill(s.on ? ink() : t.control_off)
    .motion(SPRINGS[s.spring]![1])
    .on_press((s: State) => { s.on = !s.on })
    .child(el().key("knob").size(k, k).radius(k / 2.0).fill(t.knob)
      .absolute(s.on ? w - k - inset : inset, inset)
      .shadow(1.0, 3.0, t.knob_shadow))
}

function picker(s: State, seg: number): El {
  const t = tok.theme(true)
  const [h, pad] = [32.0, 3.0]
  let segs = row().key("springs")
  for (const [i, [name, _]] of SPRINGS.entries()) {
    const selected = i === s.spring
    segs = segs.child(
      el().key(name).role("segment").label(name).checked(selected).focusable(true)
        .size(seg, h - 2.0 * pad).center()
        .on_press((s: State) => { s.spring = i })
        .child(text(name).font(TextStyle.new(13.0, 500.0))
          .color(selected ? t.text : t.text_secondary)),
    )
  }
  return el().key("picker").size(Math.fround(Math.fround(seg * 3.0) + 2.0 * pad), h).radius(h / 2.0).fill(t.control_track)
    .child(el().key("thumb").size(seg, h - 2.0 * pad).radius((h - 2.0 * pad) / 2.0)
      .absolute(Math.fround(pad + Math.fround(seg * s.spring)), pad)
      .fill(oklcha(1.0, 0.0, 0.0, 0.12))
      .motion(SPRINGS[s.spring]![1]))
    .child(segs.absolute(pad, pad))
}

function track(s: State, track_w: number): El {
  const t = tok.theme(true)
  const travel = Math.fround(track_w - PUCK)
  const to_at = (x: number) => clamp(Math.fround(Math.fround(x - PUCK / 2.0) / travel), 0.0, 1.0)
  let stops = row().key("stops").w(travel).h(PUCK).absolute(PUCK / 2.0, 0.0)
  for (let i = 0; i < STOPS; i++) {
    const x = Math.fround(Math.fround(travel * i) / (STOPS - 1))
    stops = stops.child(el().key(`stop-${i}`).size(4.0, 4.0).radius(2.0)
      .fill(oklcha(1.0, 0.0, 0.0, 0.22)).absolute(Math.fround(x - 2.0), PUCK / 2.0 - 2.0))
  }
  return el().key("track").role("slider").label("Puck").range_value(s.at, 0.0, 1.0)
    .range_step(1.0 / (STOPS - 1))
    .on_step((s: State, steps: number, _: Tx) => {
      s.at = clamp(snap(Math.fround(s.at + Math.fround(steps / (STOPS - 1)))), 0.0, 1.0)
    })
    .size(track_w, PUCK)
    .motion(SPRINGS[s.spring]![1])
    .on_drag((s: State, d: Drag, tx: Tx) => {
      switch (d.phase) {
        case "Down": {
          d.data = s.at
          const puck = Math.fround(PUCK / 2.0 + Math.fround(s.at * travel))
          if (Math.abs(Math.fround(d.x - puck)) > PUCK / 2.0 + 4.0) {
            // Tapped the track: the puck springs to the nearest stop, keeping its speed.
            s.at = snap(to_at(d.x))
          }
          break
        }
        case "Move": {
          const puck = Math.fround(PUCK / 2.0 + Math.fround(d.data * travel))
          const grab = Math.abs(Math.fround(d.start_x - puck)) <= PUCK / 2.0 + 4.0 ? Math.fround(d.start_x - puck) : 0.0
          s.at = to_at(Math.fround(d.x - grab))
          tx.instant()
          break
        }
        case "Up": {
          s.at = d.cancelled() ? d.data : snap(s.at)
          break
        }
      }
    })
    .child(el().key("rail").size(travel, 2.0).radius(1.0).fill(t.control_off)
      .absolute(PUCK / 2.0, PUCK / 2.0 - 1.0).a11y_hidden())
    .child(el().key("lit").size(Math.fround(travel * s.at), 2.0).radius(1.0).fill(ink())
      .absolute(PUCK / 2.0, PUCK / 2.0 - 1.0).a11y_hidden())
    .child(stops.a11y_hidden())
    .child(el().key("puck").size(PUCK, PUCK).radius(PUCK / 2.0).fill(t.knob)
      .absolute(Math.fround(travel * s.at), 0.0)
      .shadow(2.0, 8.0, oklcha(0.0, 0.0, 0.0, 0.5)).a11y_hidden())
}

function line(label: string, control: El): El {
  const t = tok.theme(true)
  return row().w_full().h(36.0).center_y()
    .child(text(label).font(TextStyle.new(14.0, 400.0)).color(t.text_secondary).grow(1.0))
    .child(control)
}

function view(s: State, cx: Cx): El {
  // As wide as the page lets it be, up to CARD_W; the canvas is as wide as its parent.
  const stage = cx.layout_size("stage")?.[0] ?? 560.0
  const card_w = clamp(Math.fround(stage - 16.0), 280.0, CARD_W)
  const pad = card_w < CARD_W ? 20.0 : 32.0
  const inner = Math.fround(card_w - 2.0 * pad)
  const seg = Math.min(Math.fround(Math.fround(inner - 76.0) / 3.0), 88.0)
  const card = col().key("card").w(card_w).padding(pad).gap(16.0).radius(20.0)
    .fill(oklch(0.17, 0.006, 265.0))
    .border(1.0, oklcha(1.0, 0.0, 0.0, 0.08))
    .child(line("Lights", switch_(s)))
    .child(line("Spring", picker(s, seg)))
    .child(el().h(8.0))
    .child(track(s, inner))
  return col().key("stage").w_full().h(STAGE_H).center().fill(Color.BLACK).child(card)
}

function spec(): AppSpec<State> {
  return AppSpec.new<State>("Rune", [560.0, STAGE_H], State.default, view)
}

export function start() {
  // wasm32 only: `App::new(spec()).canvas_id("rune-live").fit_content_height().try_run()`, logging
  // the error to the console. runex runs natively, so this is the `not(wasm32)` path.
  run(spec())
}
