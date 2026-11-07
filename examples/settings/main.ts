// A small Settings window rendered entirely by Rune.

import { AppSpec, Color, type Cx, type Drag, type El, Spring, type Tx, col, el, row, run, text, tok } from "runex-js"
const { motion, radius, space, type_ } = tok

type Appearance = "Auto" | "Light" | "Dark"

type Settings = {
  appearance: Appearance
  accent: number
  launch_at_login: boolean
  menu_bar: boolean
  sounds: boolean
  /** Slider position 0..1; animation speed is 2^(2v − 1), so the middle is 1×. */
  speed: number
  reduce_motion: boolean
}

const Settings = {
  default(): Settings {
    return {
      appearance: "Auto",
      accent: 0,
      launch_at_login: true,
      menu_bar: true,
      sounds: false,
      speed: 0.5,
      reduce_motion: false,
    }
  },
}

function speed_of(v: number): number {
  return Math.fround(Math.pow(2, Math.fround(Math.fround(v * 2.0) - 1.0)))
}

/** `format!("{:.2}", v)` of an f32: Rust rounds an exact tie to even, `toFixed` away from zero. */
function fixed2(v: number): string {
  const scaled = v * 100 // exact for an f32
  if (Math.abs(scaled % 1) === 0.5) {
    const down = Math.trunc(scaled)
    const even = down % 2 === 0 ? down : down + Math.sign(scaled)
    return (even / 100).toFixed(2)
  }
  return v.toFixed(2)
}

// The Rust example's `#[test] cancelling_the_speed_slider_restores_its_value_before_a_track_press`
// is `cargo test` code, not part of the app. It drives a headless `rune::Runtime`, which runex
// doesn't bind (docs/porting.md, "Limits").

/** Everything a component needs to paint itself. */
type Paint = {
  t: tok.Theme
  accent: Color
  hair: number
}

function view(s: Settings, cx: Cx): El {
  const dark = s.appearance === "Auto" ? cx.system_dark() : s.appearance === "Dark"
  cx.reduced_motion(s.reduce_motion)
  cx.time_scale(speed_of(s.speed))
  const p: Paint = { t: tok.theme(dark), accent: tok.accent(s.accent, dark), hair: Math.fround(1.0 / cx.env().scale) }
  const t = p.t

  return col()
    .key("window")
    .role("window")
    .fill(t.bg)
    .child(
      row()
        .key("titlebar")
        .h(40.0)
        .w_full()
        .center()
        .child(text("Settings").key("title").font(type_.TITLE).color(t.text)),
    )
    .child(
      col()
        .key("content")
        .grow(1.0)
        .px(space.S6)
        .pt(space.S1)
        .pb(space.S6)
        .gap(space.S6)
        .clip_fade(0.0, space.S1, 0.0, space.S6)
        .child(section(
          p,
          "appearance",
          "Appearance",
          [
            setting_row(p, "theme", "Theme", null, segmented(p, s.appearance)),
            setting_row(p, "accent", "Accent colour", null, swatches(p, s.accent, dark)),
          ],
        ))
        .child(section(
          p,
          "general",
          "General",
          [
            toggle_row(p, "login", "Launch at login", s.launch_at_login, (s) => {
              s.launch_at_login = !s.launch_at_login
            }),
            toggle_row(p, "menubar", "Show in menu bar", s.menu_bar, (s) => { s.menu_bar = !s.menu_bar }),
            toggle_row(p, "sounds", "Play sounds", s.sounds, (s) => { s.sounds = !s.sounds }),
          ],
        ))
        .child(section(
          p,
          "motion",
          "Motion",
          [
            setting_row(p, "speed", "Animation speed", null, speed_control(p, s.speed)),
            toggle_row(p, "reduce", "Reduce motion", s.reduce_motion, (s) => {
              s.reduce_motion = !s.reduce_motion
            }),
          ],
        )),
    )
}

function section(p: Paint, key: string, title: string, rows: El[]): El {
  const n = rows.length
  let card = col()
    .key("card")
    .padding(space.S1)
    .fill(p.t.card)
    .radius(radius.LG)
    .border(p.hair, p.t.card_border)
    .shadow(1.0, 2.0, p.t.shadow)
    .shadow(8.0, 24.0, p.t.shadow_soft)
  rows.forEach((r, i) => {
    card = card.child(r)
    if (i + 1 < n) {
      card = card.child(el().key(`sep${i}`).h(p.hair).ml(space.S3).mr(space.S3).fill(p.t.separator).a11y_hidden())
    }
  })
  return col()
    .key(key)
    .gap(space.S2)
    .child(text(title).key("header").font(type_.SECTION).color(p.t.text_secondary).ml(space.S3))
    .child(card)
}

function setting_row(p: Paint, key: string, label: string, on_press: ((s: Settings) => void) | null, control: El): El {
  let r = row()
    .key(key)
    .h(44.0)
    .px(space.S3)
    .center_y()
    .justify_between()
    .radius(radius.MD)
    .label(label)
    .child(text(label).key("label").font(type_.BODY).color(p.t.text).a11y_hidden())
    .child(control)
  if (on_press !== null) {
    r = r.hover(p.t.hover).press(p.t.press).focusable(true).on_press(on_press)
  }
  return r
}

function toggle_row(p: Paint, key: string, label: string, on: boolean, flip: (s: Settings) => void): El {
  return setting_row(p, key, label, flip, toggle(p, on).a11y_hidden()).role("switch").checked(on)
}

function toggle(p: Paint, on: boolean): El {
  const [w, h, k] = [38.0, 22.0, 18.0]
  const inset = Math.fround((h - k) / 2.0)
  return el().key("switch")
    .role("switch")
    .size(w, h)
    .radius(Math.fround(h / 2.0))
    .fill(on ? p.accent : p.t.control_off)
    .motion(motion.SNAPPY)
    .child(
      el().key("knob")
        .size(k, k)
        .absolute(on ? Math.fround(Math.fround(w - k) - inset) : inset, inset)
        .radius(Math.fround(k / 2.0))
        .fill(p.t.knob)
        .shadow(1.0, 3.0, p.t.knob_shadow)
        .shadow(0.0, 0.5, p.t.edge),
    )
}

const APPEARANCES: [Appearance, string][] =
  [["Auto", "Auto"], ["Light", "Light"], ["Dark", "Dark"]]

function segmented(p: Paint, current: Appearance): El {
  const [w, h, pad] = [205.0, 28.0, 2.0]
  const seg = Math.fround(Math.fround(w - Math.fround(2.0 * pad)) / 3.0)
  const found = APPEARANCES.findIndex(([a, _]) => a === current)
  const idx = found === -1 ? 0 : found
  let segs = row().key("segments")
  APPEARANCES.forEach(([a, name], i) => {
    const selected = i === idx
    segs = segs.child(
      el().key(name)
        .role("segment")
        .label(name)
        .checked(selected)
        .focusable(true)
        .size(seg, Math.fround(h - Math.fround(2.0 * pad)))
        .center()
        .radius(radius.SM)
        .hover(selected ? Color.TRANSPARENT : p.t.hover)
        .on_press_tx((s: Settings, tx: Tx) => {
          s.appearance = a
          tx.color_motion(motion.CALM)
        })
        .child(
          text(name)
            .key("label")
            .font(type_.LABEL)
            .color(selected ? p.t.text : p.t.text_secondary)
            .a11y_hidden(),
        ),
    )
  })
  return el().key("segmented")
    .role("segmented")
    .size(w, h)
    .padding(pad)
    .radius(radius.MD)
    .fill(p.t.control_track)
    .motion(motion.SNAPPY)
    .child(
      el().key("indicator")
        .size(seg, Math.fround(h - Math.fround(2.0 * pad)))
        .absolute(Math.fround(pad + Math.fround(idx * seg)), pad)
        .radius(radius.SM)
        .fill(p.t.indicator)
        .shadow(1.0, 3.0, p.t.shadow)
        .shadow(0.0, 0.5, p.t.edge)
        .lead(motion.LEAD, motion.DEFAULT)
        .a11y_hidden(),
    )
    .child(segs)
}

function swatches(p: Paint, current: number, dark: boolean): El {
  const [d, gap, ring_w] = [18.0, 12.0, 2.0]
  const ring = Math.fround(d + Math.fround(2.0 * Math.fround(ring_w + 2.0)))
  let r = row().key("swatches").role("radiogroup").label("Accent colour").gap(gap).motion(motion.SNAPPY)
  r = r.child(
    el().key("ring")
      .size(ring, ring)
      .absolute(
        Math.fround(Math.fround(current * Math.fround(d + gap)) - Math.fround(Math.fround(ring - d) / 2.0)),
        -Math.fround(Math.fround(ring - d) / 2.0),
      )
      .radius(Math.fround(ring / 2.0))
      .border(ring_w, p.accent)
      .lead(Spring.new(0.22, 0.0), Spring.new(0.28, 0.0))
      .a11y_hidden(),
  )
  for (let i = 0; i < 6; i++) {
    r = r.child(
      el().key(tok.ACCENT_NAMES[i])
        .role("radio")
        .label(tok.ACCENT_NAMES[i])
        .checked(i === current)
        .focusable(true)
        .size(d, d)
        .radius(Math.fround(d / 2.0))
        .fill(tok.accent(i, dark))
        .border(p.hair, Color.BLACK.alpha(dark ? 0.0 : 0.08))
        .on_press((s: Settings) => { s.accent = i }),
    )
  }
  return r
}

function speed_control(p: Paint, v: number): El {
  const [w, h, k, bar] = [180.0, 22.0, 18.0, 4.0]
  const travel = Math.fround(w - k)
  const to_value = (x: number): number =>
    Math.min(Math.max(Math.fround(Math.fround(x - Math.fround(k / 2.0)) / travel), 0.0), 1.0)
  return row()
    .key("speed-control")
    .gap(space.S3)
    .center_y()
    .child(
      el().key("slider")
        .role("slider")
        .label("Animation speed")
        // The slider's position, in twentieths; it reads as the speed it gives.
        .range_value(v, 0.0, 1.0)
        .range_step(0.05)
        .a11y_value(`${fixed2(speed_of(v))}×`)
        .on_step((s: Settings, steps: number, _: Tx) => {
          s.speed = Math.min(Math.max(Math.fround(s.speed + Math.fround(steps * Math.fround(0.05))), 0.0), 1.0)
        })
        .size(w, h)
        .motion(motion.SNAPPY)
        .on_drag((s: Settings, d: Drag, tx: Tx) => {
          if (d.phase === "Down") {
            d.data = s.speed
            const knob = Math.fround(Math.fround(k / 2.0) + Math.fround(v * travel))
            if (Math.abs(Math.fround(d.x - knob)) > Math.fround(k / 2.0) + 2.0) {
              // Clicked the track: the knob animates there.
              s.speed = to_value(d.x)
            }
          } else if (d.phase === "Move") {
            const knob = Math.fround(Math.fround(k / 2.0) + Math.fround(d.data * travel))
            const grab = Math.abs(Math.fround(d.start_x - knob)) <= Math.fround(k / 2.0) + 2.0
              ? Math.fround(d.start_x - knob)
              : 0.0
            s.speed = to_value(Math.fround(d.x - grab))
            tx.instant()
          } else if (d.phase === "Up") {
            if (d.cancelled()) { s.speed = d.data }
          }
        })
        .child(
          el().key("track")
            .size(w, bar)
            .absolute(0.0, Math.fround(Math.fround(h - bar) / 2.0))
            .radius(Math.fround(bar / 2.0))
            .fill(p.t.control_off)
            .a11y_hidden(),
        )
        .child(
          el().key("fill")
            .size(Math.fround(Math.fround(k / 2.0) + Math.fround(v * travel)), bar)
            .absolute(0.0, Math.fround(Math.fround(h - bar) / 2.0))
            .radius(Math.fround(bar / 2.0))
            .fill(p.accent)
            .a11y_hidden(),
        )
        .child(
          el().key("knob")
            .size(k, k)
            .absolute(Math.fround(v * travel), Math.fround(Math.fround(h - k) / 2.0))
            .radius(Math.fround(k / 2.0))
            .fill(p.t.knob)
            .shadow(1.0, 3.0, p.t.knob_shadow)
            .shadow(0.0, 0.5, p.t.edge)
            .a11y_hidden(),
        ),
    )
    .child(
      text(`${fixed2(speed_of(v))}×`)
        .key("value")
        .w(40.0)
        .font(type_.MONO_CAPTION)
        .color(p.t.text_secondary)
        .align("End")
        .a11y_hidden(),
    )
}

run({
  ...AppSpec.new<Settings>("Settings", [620.0, 520.0], Settings.default, view),
  scenes: [
    ["default", (_) => {}],
    ["light", (s) => { s.appearance = "Light" }],
    ["dark", (s) => { s.appearance = "Dark" }],
    ["reduced-motion", (s) => { s.reduce_motion = true }],
    ["toggles-off", (s) => {
      s.launch_at_login = false
      s.menu_bar = false
      s.sounds = false
    }],
    ["accent-pink", (s) => { s.accent = 2 }],
    ["slow", (s) => { s.speed = 0.0 }],
  ],
})
