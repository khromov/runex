// The top row: scenes, the thermostat and the lights.
//
// Port of vendor/rune/examples/motion-bento/src/tiles_top.rs.

import { type El, Shape, canvas, col, el, row, spacer, text } from "runex-js"
import { type Kit, RollingText, Switch } from "runex-js/kit"
import { color, grid, to_radians } from "./chaos/look.ts"
import { LIGHTS, SCENES, SCENE_NOTES } from "./chaos/model.ts"
import type { State } from "./main.ts"
import { c, caption, font, inner_h, inner_w, nums, spring, tile, well_button } from "./style.ts"

const F = Math.fround

const SEG_H = 44.0
const SEG_PAD = 4.0

export function scenes(s: State, k: Kit): El {
  const m = s.m
  const mood = color.SCENE[m.scene]!
  const w = inner_w(2.0)
  const seg_w = F(F(w - 2.0 * SEG_PAD) / SCENES.length)
  const snap = spring(s.springs.snap)
  const morph = spring(s.springs.morph)

  let segments = row()
    .w(w)
    .h(SEG_H)
    .radius(12.0)
    .fill(c(color.WELL))
    .border(1.0, c(color.EDGE))
    .padding(SEG_PAD)
    .child(
      el().size(seg_w, SEG_H - 2.0 * SEG_PAD)
        .absolute(F(SEG_PAD + F(seg_w * m.scene)), SEG_PAD)
        .radius(9.0)
        .fill(c(mood))
        .shadow(4.0, 14.0, c(mood.alpha(0.45)))
        .motion(snap),
    )
  SCENES.forEach((name, i) => {
    const on = i === m.scene
    segments = segments.child(
      row()
        .key(`seg${i}`)
        .grow(1.0)
        .h_full()
        .center()
        .on_press((s: State) => { s.act({ Scene: i }) })
        .child(text(name).font(font(14.0, 560.0)).color(c(on ? color.ON_ACCENT : color.TEXT_2)).motion(snap)),
    )
  })

  const lights_on = m.lights.filter((l) => l).length
  const picked = m.chips.filter((c) => c).length
  const stat = (label: string, value: string) =>
    col()
      .gap(2.0)
      .padding(10.0)
      .w(118.0)
      .radius(12.0)
      .fill(c(color.WELL))
      .child(caption(label))
      .child(RollingText.new(`stat-${label}`, value).font(nums(16.0, 600.0)).color(c(color.TEXT)).build(k))
  const summary = row()
    .h(F(F(inner_h(grid.ROW1) - SEG_H) - 16.0))
    .w(w)
    .center_y()
    .gap(10.0)
    .child(
      // The mood's glow, sliding under the summary toward the picked segment.
      el().size(260.0, 90.0)
        .absolute(F(-30.0 + F(F(seg_w * m.scene) * F(0.55))), 6.0)
        .radius(45.0)
        .fill(c(mood.alpha(0.22)))
        .blur(36.0)
        .motion(morph),
    )
    .child(
      col()
        .gap(4.0)
        .grow(1.0)
        .child(RollingText.new("scene-name", SCENES[m.scene]!).value(m.scene).font(font(30.0, 650.0)).color(c(color.TEXT)).build(k))
        .child(text(SCENE_NOTES[m.scene]!).font(font(13.0, 460.0)).color(c(color.TEXT_2))),
    )
    .child(stat("Lights", `${lights_on} of 4`))
    .child(stat("Target", m.temp_label()))
    .child(stat("Genres", String(picked)))

  const swatch = row()
    .gap(8.0)
    .center_y()
    .child(caption("Mood"))
    .child(el().size(14.0, 14.0).radius(7.0).fill(c(mood)).shadow(0.0, 8.0, c(mood.alpha(0.6))).motion(morph))
  return tile("scene", "Scenes", swatch, col().gap(16.0).child(segments).child(summary)).w(F(inner_w(2.0) + 2.0 * grid.TILE_PAD))
}

/**
 * The thermostat ring's arc: 270° from the lower left, clockwise, as points. `Math.cos` and
 * `Math.sin` compute in f64 and round once, where Rust calls the platform's `cosf`/`sinf`
 * (docs/porting.md, Limits). macOS's `sinf` isn't correctly rounded for two of these angles
 * (points 24 and 85), so their y differs from Rust's by an ulp. That changes the arc's length in
 * the last bits, and with it where `live_trim` ends the ring: a render can show one pixel at
 * the trim's end off by 1/255 (seed 7 at 2.5 s and at 7 s do; t = 0 and the other moments
 * compared don't).
 */
function arc(size: number, inset: number): [number, number][] {
  const r = F(F(size / 2.0) - inset)
  const [a0, sweep] = [to_radians(135.0), to_radians(270.0)]
  return Array.from({ length: 97 }, (_, i) => {
    const a = F(a0 + F(F(sweep * i) / 96.0))
    return [F(F(size / 2.0) + F(r * F(Math.cos(a)))), F(F(size / 2.0) + F(r * F(Math.sin(a))))]
  })
}

export const RING = 150.0

export function thermostat(s: State, k: Kit): El {
  const m = s.m
  const points = arc(RING, 9.0)
  const track = Shape.new().stroke_with(points, false, 10.0, "Round", c(color.WELL_HI))
  const fill = Shape.new().stroke_with(points, false, 10.0, "Round", c(color.ACCENT))
  const ring = el()
    .size(RING, RING)
    .child(canvas(track).size(RING, RING).absolute(0.0, 0.0))
    .child(canvas(fill).size(RING, RING).absolute(0.0, 0.0).live_trim(s.ring.smooth(spring(s.springs.travel))))
    .child(
      col()
        .size(RING, RING)
        .absolute(0.0, 0.0)
        .center()
        .gap(0.0)
        .child(RollingText.new("temp", m.temp_label()).value(m.temp).font(nums(34.0, 640.0)).color(c(color.TEXT)).build(k))
        .child(caption("Target")),
    )
  const heating = m.temp > 21.0
  const aside = row()
    .gap(6.0)
    .center_y()
    .child(el().size(8.0, 8.0).radius(4.0).fill(c(heating ? color.WARM : color.ACCENT)).motion(spring(s.springs.morph)))
    .child(RollingText.new("mode", heating ? "Heating" : "Cooling").font(font(12.0, 460.0)).color(c(color.TEXT_3)).build(k))
  const buttons = col()
    .gap(10.0)
    .child(well_button("up", "+", 52.0, 44.0).on_press((s: State) => { s.act("TempUp") }))
    .child(well_button("down", "−", 52.0, 44.0).on_press((s: State) => { s.act("TempDown") }))
  const body = row().h(inner_h(grid.ROW1)).center_y().gap(14.0).child(ring).child(spacer()).child(buttons)
  return tile("thermo", "Thermostat", aside, body).w(F(inner_w(1.0) + 2.0 * grid.TILE_PAD))
}

export function lights(s: State, k: Kit): El {
  const m = s.m
  const on = m.lights.filter((l) => l).length
  let rows = col().gap(4.0)
  LIGHTS.forEach((name, i) => {
    const lit = m.lights[i]!
    rows = rows.child(
      row()
        .h(34.0)
        .center_y()
        .gap(12.0)
        .child(
          el().size(10.0, 10.0)
            .radius(5.0)
            .fill(c(lit ? color.WARM : color.WELL_HI))
            .shadow(0.0, 10.0, c(lit ? color.WARM.alpha(0.7) : color.WARM.alpha(0.0)))
            .motion(spring(s.springs.snap)),
        )
        .child(text(name).font(font(14.0, 500.0)).color(c(lit ? color.TEXT : color.TEXT_2)))
        .child(spacer())
        .child(
          Switch.new(lit)
            .label(name)
            .hide_label()
            .on_toggle((s: State) => { s.act({ Light: i }) })
            .build(k)
            .key(`light${i}`),
        ),
    )
  })
  const aside = RollingText.new("lights-on", `${on} on`).value(on).font(font(12.0, 460.0)).color(c(color.TEXT_3)).build(k)
  return tile("lights", "Lights", aside, rows).w(F(inner_w(1.0) + 2.0 * grid.TILE_PAD))
}
