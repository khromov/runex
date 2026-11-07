// Chrome in OpenCode's dark design language: a scene list, the stage, and a knobs panel with a
// frame-time readout.

import { readFileSync } from "node:fs"
import { Color, type Cx, type Drag, type El, Spring, TextStyle, Theme, type Tx, col, color, el, row, spacer, text, tok } from "runex-js"
import { ALL, type KnobSpec, Scene, specs } from "./knobs.ts"
import type { Lab } from "./main.ts"
import * as stage from "./stage.ts"
const { motion } = tok

// Rust's f32 math rounds every step.
const f32 = Math.fround
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

const SIDEBAR_W = 212.0
const PANEL_W = 272.0
// Sidebar geometry. Every text line (eyebrows, rows, the footer hint) starts on one edge,
// TEXT_X, which is also the knobs panel's inset. Row pills (hover and the travelling selection)
// sit PILL_INSET in from both sidebar edges and bleed out PILL_PAD around their text.
const PILL_INSET = 10.0
const PILL_PAD = 10.0
const TEXT_X = PILL_INSET + PILL_PAD
const PILL_W = SIDEBAR_W - 2.0 * PILL_INSET
const ROW_H = 28.0
const ROW_PITCH = 30.0
const PILL_R = 8.0
const GROUP_H = 28.0
const GROUP_GAP = 16.0
const SLIDER_W = PANEL_W - 40.0

export type Pal = {
  base: Color
  deep: Color
  text: Color
  muted: Color
  faint: Color
  accent: Color
  border: Color
  hover: Color
  pressed: Color
  selected: Color
  track: Color
  knob: Color
  shadow: Color
}

let P: Pal | null = null

export function pal(): Pal {
  P ??= (() => {
    // `Theme::from_json(..).unwrap_or_else(|e| panic!("{e}"))`: a bad theme throws.
    const t = Theme.from_json(readFileSync(new URL("./assets/theme.json", import.meta.url), "utf8"), true)
    const c = (n: string) => t.color(n)
    return {
      base: c("background-bg-base"),
      deep: c("background-bg-deep"),
      text: c("text-text-base"),
      muted: c("text-text-muted"),
      faint: c("text-text-faint"),
      accent: c("text-text-accent"),
      border: c("border-border-base"),
      hover: c("overlay-simple-overlay-hover"),
      pressed: c("overlay-simple-overlay-pressed"),
      selected: c("background-bg-layer-02"),
      track: c("background-bg-layer-03"),
      knob: c("text-text-base"),
      shadow: c("alpha-dark-30"),
    }
  })()
  return P
}

const BODY = TextStyle.new(13.0, 400.0)
const LABEL = TextStyle.new(12.5, 500.0)
const EYEBROW = TextStyle.new(11.0, 600.0).tracking(0.4)
const TITLE = TextStyle.new(17.0, 600.0)
const VALUE = TextStyle.new(11.5, 500.0).mono()

/** `format!("{:.*}", dec, v)`: Rust rounds an exact tie to even, `toFixed` away from zero. */
function fixed(v: number, dec: number): string {
  const scaled = v * 10 ** dec // exact for an f32 and dec <= 2
  if (Math.abs(scaled % 1) === 0.5) {
    const down = Math.trunc(scaled)
    const even = down % 2 === 0 ? down : down + Math.sign(scaled)
    return (even / 10 ** dec).toFixed(dec)
  }
  return v.toFixed(dec)
}

export function view(s: Lab, cx: Cx): El {
  cx.reduced_motion(s.reduced)
  const p = pal()
  const hair = f32(1.0 / cx.env().scale)
  return row()
    .key("window")
    .fill(p.deep)
    .w_full()
    .h_full()
    .child(sidebar(s, hair))
    .child(stage_view(s))
    .child(panel(s, hair))
}

// ---------------------------------------------------------------- sidebar

function sidebar(s: Lab, hair: number): El {
  const p = pal()
  let list = el().key("scenes").w_full()
  let y = 0.0
  let sel_y = 0.0
  const items: El[] = []
  const groups: [string, readonly Scene[]][] = [["Light", ALL.slice(0, 5)], ["Effects", ALL.slice(5)]]
  groups.forEach((group, g) => {
    if (g > 0) {
      y += GROUP_GAP
    }
    items.push(
      row()
        .key(`group${g}`)
        .absolute(0.0, y)
        .size(SIDEBAR_W, GROUP_H)
        .pl(TEXT_X)
        .center_y()
        .child(text(group[0].toUpperCase()).key("label").font(EYEBROW).color(p.faint)),
    )
    y += GROUP_H
    for (const sc of group[1]) {
      const selected = sc === s.scene
      if (selected) {
        sel_y = y
      }
      items.push(
        row()
          .key(Scene.id(sc))
          .role("tab")
          .label(Scene.title(sc))
          .absolute(PILL_INSET, y)
          .size(PILL_W, ROW_H)
          .px(PILL_PAD)
          .center_y()
          .radius(PILL_R)
          .hover(selected ? Color.TRANSPARENT : p.hover)
          .press(p.pressed)
          .on_press((s: Lab) => { s.select(sc) })
          .child(text(Scene.title(sc)).key("label").font(BODY).color(selected ? p.text : p.muted)),
      )
      y += ROW_PITCH
    }
  })
  list = list
    .h(y)
    .child(
      el().key("selection")
        .absolute(PILL_INSET, sel_y)
        .size(PILL_W, ROW_H)
        .radius(PILL_R)
        .fill(p.selected)
        .lead(motion.LEAD, motion.DEFAULT),
    )
    .children(items)
  return row()
    .key("sidebar-wrap")
    .h_full()
    .child(
      col()
        .key("sidebar")
        .w(SIDEBAR_W)
        .h_full()
        .fill(p.base)
        .child(row().key("brand").h(52.0).w_full().pl(86.0).center_y().child(text("Rune Lab").key("title").font(TextStyle.new(13.0, 600.0)).color(p.text)))
        .child(list)
        .child(spacer())
        .child(
          text("↑ ↓ to switch scenes")
            .key("keys-hint")
            .font(TextStyle.new(11.5, 400.0))
            .color(p.faint)
            .ml(TEXT_X)
            .mb(16.0),
        ),
    )
    .child(el().key("sidebar-edge").w(hair).h_full().fill(p.border))
}

// ---------------------------------------------------------------- stage

function stage_view(s: Lab): El {
  return el().key("stage")
    .role("canvas")
    .grow(1.0)
    .h_full()
    .center()
    .fill(stage.backdrop(s.scene))
    .motion(motion.DEFAULT)
    .clip_soft(0.0)
    .mark(stage.STAGE_MARK)
    .on_drag(stage.on_stage)
    .child(stage.canvas(s, s.scene))
}

// ---------------------------------------------------------------- panel

function panel(s: Lab, hair: number): El {
  const p = pal()
  const sc = s.scene
  let knobs = col().key(`knobs-${Scene.id(sc)}`).gap(18.0).w_full()
  specs(sc).forEach((k, i) => {
    knobs = knobs.child(knob(s, sc, i, k))
  })
  return row()
    .key("panel-wrap")
    .h_full()
    .child(el().key("panel-edge").w(hair).h_full().fill(p.border))
    .child(
      col()
        .key("panel")
        .w(PANEL_W)
        .h_full()
        .fill(p.base)
        .px(20.0)
        .pt(48.0)
        .pb(20.0)
        .child(text(Scene.title(sc)).key("scene-title").font(TITLE).color(p.text))
        .child(text(Scene.hint(sc)).key("scene-hint").w(PANEL_W - 40.0).wrap().font(TextStyle.new(12.5, 400.0).lh(18.0)).color(p.muted).mt(8.0))
        .child(el().key("sep").h(hair).w_full().fill(p.border).mt(20.0).mb(20.0))
        .child(knobs)
        .child(spacer())
        .child(el().key("sep2").h(hair).w_full().fill(p.border).mb(14.0))
        .child(toggle_row("reduced", "Reduce motion", s.reduced, (s: Lab) => { s.reduced = !s.reduced }))
        .child(readout(s)),
    )
}

function readout(s: Lab): El {
  const p = pal()
  const f = (v: number | null): string => v === null ? "—" : `${fixed(v, 2)} ms`
  const line = (key: string, name: string, value: string): El =>
    row()
      .key(key)
      .h(20.0)
      .w_full()
      .center_y()
      .justify_between()
      .child(text(name).key("name").font(TextStyle.new(12.0, 400.0)).color(p.faint))
      .child(text(value).key("value").font(VALUE).color(p.muted).align("End"))
  const state = s.perf.live ? "Animating" : "At rest · no frames"
  return col()
    .key("readout")
    .mt(12.0)
    .gap(2.0)
    .child(line("gpu", "GPU frame", f(s.perf.gpu_ms)))
    .child(line("cpu", "CPU frame", f(s.perf.cpu_ms > 0.0 ? s.perf.cpu_ms : null)))
    .child(line("state", "Display link", state))
}

function knob(s: Lab, sc: Scene, i: number, k: KnobSpec): El {
  const v = s.vals[Scene.idx(sc)][i]
  const kind = k.kind
  if (kind === "Toggle") {
    const on = v > 0.5
    return toggle_row(k.id, k.label, on, (s: Lab) => {
      const vals = s.vals[Scene.idx(sc)]
      vals[i] = vals[i] > 0.5 ? 0.0 : 1.0
    })
  }
  if ("Slider" in kind) return slider(sc, i, k, v, kind.Slider)
  // `v as usize` saturates: negative (and NaN) is 0.
  return swatches(sc, i, k, v > 0 ? Math.trunc(v) : 0, kind.Swatch)
}

function slider(sc: Scene, i: number, k: KnobSpec, v: number, dec: number): El {
  const p = pal()
  const [w, h, kd, bar] = [SLIDER_W, 18.0, 14.0, 4.0]
  const travel = f32(w - kd)
  const [min, max] = [k.min, k.max]
  const u = clamp(f32(f32(v - min) / f32(max - min)), 0.0, 1.0)
  const to_value = (x: number): number =>
    f32(min + f32(clamp(f32(f32(x - f32(kd / 2.0)) / travel), 0.0, 1.0) * f32(max - min)))
  const value = fixed(v, dec)
  return col()
    .key(k.id)
    .gap(6.0)
    .child(
      row()
        .key("head")
        .w_full()
        .justify_between()
        .child(text(k.label).key("label").font(LABEL).color(p.text))
        .child(text(value).key("value").font(VALUE).color(p.muted).align("End")),
    )
    .child(
      el().key("slider")
        .role("slider")
        .label(k.label)
        .size(w, h)
        .motion(motion.SNAPPY)
        .on_drag((s: Lab, d: Drag, tx: Tx) => {
          const cur = s.vals[Scene.idx(sc)][i]
          const knob_x = f32(f32(kd / 2.0) + f32(clamp(f32(f32(cur - min) / f32(max - min)), 0.0, 1.0) * travel))
          if (d.phase === "Down") {
            d.data = cur
            if (Math.abs(f32(d.x - knob_x)) > f32(f32(kd / 2.0) + 3.0)) {
              s.vals[Scene.idx(sc)][i] = to_value(d.x)
            }
          } else if (d.phase === "Move") {
            const knob = f32(f32(kd / 2.0) + f32(clamp(f32(f32(d.data - min) / f32(max - min)), 0.0, 1.0) * travel))
            const grab = Math.abs(f32(d.start_x - knob)) <= f32(f32(kd / 2.0) + 3.0) ? f32(d.start_x - knob) : 0.0
            s.vals[Scene.idx(sc)][i] = to_value(f32(d.x - grab))
            tx.instant()
          } else if (d.phase === "Up") {
            if (d.cancelled()) { s.vals[Scene.idx(sc)][i] = d.data }
          }
        })
        .child(el().key("track").size(w, bar).absolute(0.0, f32(f32(h - bar) / 2.0)).radius(f32(bar / 2.0)).fill(p.track))
        .child(el().key("fill").size(f32(f32(kd / 2.0) + f32(u * travel)), bar).absolute(0.0, f32(f32(h - bar) / 2.0)).radius(f32(bar / 2.0)).fill(p.accent))
        .child(
          el().key("knob")
            .size(kd, kd)
            .absolute(f32(u * travel), f32(f32(h - kd) / 2.0))
            .radius(f32(kd / 2.0))
            .fill(p.knob)
            .shadow(1.0, 3.0, p.shadow),
        ),
    )
}

function toggle_row(key: string, label: string, on: boolean, flip: (s: Lab) => void): El {
  const p = pal()
  const [w, h, k] = [32.0, 18.0, 14.0]
  const inset = f32(f32(h - k) / 2.0)
  return row()
    .key(key)
    .role("toggle")
    .label(label)
    .h(26.0)
    .w_full()
    .center_y()
    .justify_between()
    .on_press(flip)
    .child(text(label).key("label").font(LABEL).color(p.text))
    .child(
      el().key("switch")
        .size(w, h)
        .radius(f32(h / 2.0))
        .fill(on ? p.accent : p.track)
        .motion(motion.SNAPPY)
        .child(el().key("knob").size(k, k).absolute(on ? f32(f32(w - k) - inset) : inset, inset).radius(f32(k / 2.0)).fill(p.knob).shadow(1.0, 2.0, p.shadow)),
    )
}

function swatches(sc: Scene, i: number, k: KnobSpec, cur: number, palette: readonly number[]): El {
  const p = pal()
  const [d, gap, ring_w] = [16.0, 10.0, 1.5]
  const ring = f32(d + f32(2.0 * f32(ring_w + 2.0)))
  let r = row().key("swatches").gap(gap).motion(motion.SNAPPY).child(
    el().key("ring")
      .size(ring, ring)
      .absolute(f32(f32(cur * f32(d + gap)) - f32(f32(ring - d) / 2.0)), -f32(f32(ring - d) / 2.0))
      .radius(f32(ring / 2.0))
      .border(ring_w, p.text)
      .lead(Spring.new(0.22, 0.0), Spring.new(0.28, 0.0)),
  )
  palette.forEach((hex, j) => {
    const c = color.hex(`#${hex.toString(16).padStart(6, "0")}`) ?? Color.WHITE
    r = r.child(
      el().key(`c${j}`)
        .role("swatch")
        .size(d, d)
        .radius(f32(d / 2.0))
        .fill(c)
        .on_press((s: Lab) => { s.vals[Scene.idx(sc)][i] = j }),
    )
  })
  return col().key(k.id).gap(10.0).child(text(k.label).key("label").font(LABEL).color(p.text)).child(r)
}
