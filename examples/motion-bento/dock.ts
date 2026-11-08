// The bottom row: five tiles that reflow so the focused one is wide.
//
// Port of vendor/rune/examples/motion-bento/src/dock.rs. Its `#[cfg(test)] mod tests`
// (thousands_groups_digits) is `cargo test` code, not part of the app (docs/porting.md, Limits).

import { type El, Transition, Vec2, col, el, row, spacer, text } from "runex-js"
import { type Kit, RollingText } from "runex-js/kit"
import { fixed } from "./chaos/fmt.ts"
import { color, grid, lch, to_radians } from "./chaos/look.ts"
import { CHIPS, DOCK, DOCK_KEYS, FILES, VISIT_MAX } from "./chaos/model.ts"
import type { State } from "./main.ts"
import { c, caption, font, nums, spring, tile } from "./style.ts"

const F = Math.fround

const DAYS = ["M", "T", "W", "T", "F", "S", "S"] as const

export function dock(s: State, k: Kit): El {
  const body_h = F(F(dock_h() - 2.0 * grid.TILE_PAD) - 34.0)
  let dock = row().key("dock").w_full().h(dock_h()).gap(grid.GAP)
  for (let i = 0; i < DOCK.length; i++) {
    const [aside, body] =
      i === 0 ? energy(s, k, body_h)
      : i === 1 ? chips(s, k)
      : i === 2 ? orb(s, k, body_h)
      : i === 3 ? transfers(s, k)
      : visitors(s, k, body_h)
    const focused = s.m.focus === i
    dock = dock.child(
      tile(DOCK_KEYS[i]!, DOCK[i]!, aside, body)
        .grow(focused ? grid.DOCK_FOCUS : 1.0)
        .w(0.0)
        .h_full()
        .fill(c(focused ? color.TILE_FOCUS : color.TILE))
        .border(1.0, c(focused ? color.ACCENT.alpha(0.45) : color.EDGE))
        .clip_rounded(grid.RADIUS)
        .on_press((s: State) => { s.act({ Focus: i }) }),
    )
  }
  return dock
}

export function dock_h(): number {
  return F(F(F(F(F(grid.HEIGHT - 2.0 * grid.PAD) - grid.HEADER) - grid.ROW1) - grid.ROW2) - 3.0 * grid.GAP)
}

function energy(s: State, k: Kit, h: number): [El, El] {
  const bars_h = F(h - 22.0)
  let bars = row().key("bars").w_full().h(bars_h).items_end().gap(6.0).on_press((s: State) => { s.act("Energy") })
  let days = row().w_full().gap(6.0)
  s.m.energy.forEach((v, i) => {
    const peak = s.m.energy.reduce((a, b) => Math.max(a, b), 0.0) === v
    bars = bars.child(
      el().grow(1.0)
        .w(0.0)
        .h(F(10.0 + F(v * F(bars_h - 10.0))))
        .radius(6.0)
        .gradient(c(peak ? lch(0.8, 0.13, 240.0) : lch(0.5, 0.1, 250.0)), c(peak ? color.ACCENT : lch(0.36, 0.07, 255.0)))
        .motion(spring(s.springs.travel)),
    )
    days = days.child(row().grow(1.0).w(0.0).center().child(caption(DAYS[i]!)))
  })
  const aside = RollingText.new("kwh", `${s.m.energy_kwh()} kWh`).value(s.m.kwh_tenths).font(nums(12.0, 560.0)).color(c(color.TEXT_2)).build(k)
  return [aside, col().w_full().gap(6.0).child(bars).child(days)]
}

function chips(s: State, _k: Kit): [El, El] {
  const snap = spring(s.springs.snap)
  let wrap = row().w_full().flex_wrap().gap(6.0).motion(spring(s.springs.layout))
  for (let i = 0; i < s.m.chips_shown(); i++) {
    const on = s.m.chips[i]!
    wrap = wrap.child(
      row()
        .key(`chip${i}`)
        .h(28.0)
        .px(12.0)
        .radius(14.0)
        .center()
        .fill(c(on ? color.ACCENT : color.WELL))
        .border(1.0, c(on ? color.ACCENT.alpha(0.0) : color.EDGE))
        .press_scale(0.94)
        .transition(Transition.scale(0.8))
        .on_press((s: State) => { s.act({ Chip: i }) })
        .child(text(CHIPS[i]!).font(font(13.0, 540.0)).color(c(on ? color.ON_ACCENT : color.TEXT_2)).motion(snap))
        .motion(snap),
    )
  }
  const more = row()
    .key("more")
    .h(22.0)
    .px(8.0)
    .radius(11.0)
    .center()
    .hover(c(color.WELL))
    .on_press((s: State) => { s.act("ChipsMore") })
    .child(RollingText.new("more-label", s.m.chips_open ? "Less" : "More").font(font(12.0, 560.0)).color(c(color.ACCENT)).build(_k))
  return [more, wrap]
}

function orb(s: State, k: Kit, h: number): [El, El] {
  const o = s.m.orb
  const side = F(40.0 + F(o.size * F(h - 50.0)))
  const tint = lch(0.7, 0.16, o.hue)
  const shape = el()
    .key("orb")
    .size(side, side)
    .radius(F(o.round * side))
    .gradient(c(lch(0.84, 0.12, F(o.hue - 20.0))), c(lch(0.52, 0.19, F(o.hue + 25.0))))
    .shadow(10.0, 44.0, c(tint.alpha(0.55)))
    .rotate(to_radians(o.turn))
    .motion(spring(s.springs.morph))
    .on_press((s: State) => { s.act("Orb") })
    .child(el().size(F(side * F(0.34)), F(side * F(0.34))).absolute(F(side * F(0.14)), F(side * F(0.14))).radius(F(side * F(0.17))).fill(c(lch(1.0, 0.0, 0.0).alpha(0.28))))
  const aside = RollingText.new("hue", `${fixed(o.hue, 0)}°`).value(o.hue).font(nums(12.0, 560.0)).color(c(color.TEXT_2)).build(k)
  return [aside, row().w_full().h(h).center().child(shape)]
}

function transfers(s: State, k: Kit): [El, El] {
  const travel = spring(s.springs.travel)
  let rows = col().w_full().gap(12.0)
  FILES.forEach((name, i) => {
    const p = s.m.transfers[i]!
    const done = p >= 1.0
    const label = done ? "Done" : `${fixed(F(p * 100.0), 0)}%`
    rows = rows.child(
      col()
        .key(`row${i}`)
        .w_full()
        .gap(6.0)
        .on_press((s: State) => { s.act({ Transfer: i }) })
        .child(
          row()
            .w_full()
            .center_y()
            .child(text(name).font(font(13.0, 500.0)).color(c(color.TEXT)).truncate())
            .child(spacer())
            .child(RollingText.new(`pct${i}`, label).value(p).font(nums(12.0, 560.0)).color(c(done ? color.GOOD : color.TEXT_2)).trailing().build(k)),
        )
        .child(
          el().w_full().h(6.0).radius(3.0).fill(c(color.WELL)).child(
            el().w_frac(Math.max(p, F(0.02))).h(6.0).radius(3.0).fill(c(done ? color.GOOD : color.ACCENT)).motion(travel),
          ),
        ),
    )
  })
  const active = s.m.transfers.filter((p) => p < 1.0).length
  const aside = RollingText.new("active", `${active} active`).value(active).font(font(12.0, 460.0)).color(c(color.TEXT_3)).build(k)
  return [aside, rows]
}

function thousands(n: number): string {
  const s = String(n)
  let out = ""
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) {
      out += ","
    }
    out += s[i]
  }
  return out
}

function visitors(s: State, k: Kit, h: number): [El, El] {
  const count = row()
    .key("count")
    .on_press((s: State) => { s.act("Visitors") })
    .child(RollingText.new("visitors", thousands(s.m.visitors)).value(s.m.visitors).font(nums(40.0, 660.0)).color(c(color.TEXT)).build(k))
  const chart_h = F(F(F(h - 52.0) - 18.0) - 14.0)
  const newest = s.m.visits.at(-1)?.id ?? null
  let chart = row().w_full().h(chart_h).items_end().gap(4.0).motion(spring(s.springs.layout))
  for (const v of s.m.visits) {
    const fresh = v.id === newest
    chart = chart.child(
      el().key(`visit${v.id}`)
        .grow(1.0)
        .w(0.0)
        .h(F(4.0 + F(F(F(chart_h - 4.0) * v.count) / VISIT_MAX)))
        .radius(3.0)
        .fill(c(fresh ? color.GOOD : lch(0.4, 0.06, 160.0)))
        .transition(Transition.scale_anchor(0.05, Vec2.new(0.5, 1.0))),
    )
  }
  const body = col().gap(4.0).child(count).child(caption("Unique visitors today")).child(el().h(10.0)).child(chart)
  const live = row().gap(6.0).center_y().child(el().size(6.0, 6.0).radius(3.0).fill(c(color.GOOD))).child(caption("Live"))
  return [live, body]
}
