// Stress mode's view: the wall of controls under a header with the load and, with `--hud`, the
// frame-time HUD. What the wall shows comes from `chaos/stress.ts`; this only draws it.
//
// Port of vendor/rune/examples/motion-bento/src/stress.rs.

import { type El, Transition, col, el, row, spacer, text } from "runex-js"
import { fixed, fmin } from "./chaos/fmt.ts"
import { BUDGET_120, BUDGET_60, GRAPH, GRAPH_MAX, type Readout, grade } from "./chaos/hud.ts"
import { type Lch, color, grid, lch } from "./chaos/look.ts"
import * as stress from "./chaos/stress.ts"
import { type Cell, HEADER, type Metrics, type Wall, lh } from "./chaos/stress.ts"
import { type State, config } from "./main.ts"
import { c, caption, font, nums, spring } from "./style.ts"

const F = Math.fround

const SWITCH_OFF: Lch = lch(0.44, 0.012, 258.0)
const KNOB: Lch = lch(0.98, 0.0, 0.0)
const OVER: Lch = lch(0.66, 0.2, 25.0)
const HUD_W = 660.0
const GRAPH_W = 300.0
const GRAPH_H = 92.0

export function grade_color(ms: number): Lch {
  return [color.GOOD, color.WARM, OVER][grade(ms)]!
}

export function view(s: State, wall: Wall): El {
  let root = el().w(grid.WIDTH).h(grid.HEIGHT).fill(c(color.BG)).child(header(s, wall))
  for (const cell of wall.cells()) {
    root = root.child(control(s, cell, wall.metrics))
  }
  if (s.readout !== null) {
    root = root.child(hud(s.readout))
  }
  return root
}

function header(s: State, wall: Wall): El {
  const load = config().load
  const steps = load === null ? 1 : load.levels().length
  const step = load === null ? 0 : load.step_at(s.t)
  const n = wall.cells().length
  return col()
    .absolute(grid.PAD, grid.PAD - 8.0)
    .size(grid.WIDTH - 2.0 * grid.PAD - HUD_W - grid.GAP, HEADER)
    .gap(4.0)
    .child(
      row()
        .gap(10.0)
        .center_y()
        .child(text("Rune").font(font(24.0, 680.0)).color(c(color.ACCENT)))
        .child(text("stress wall").font(font(24.0, 680.0)).color(c(color.TEXT))),
    )
    .child(caption(`Seed ${config().seed} · every control retargets, ticks and reflows at once · t ${fixed(s.t, 2)} s`))
    .child(
      row()
        .gap(10.0)
        .items_end()
        .child(text(`${n}`).font(nums(40.0, 700.0)).color(c(color.TEXT)))
        .child(text("live controls").font(font(16.0, 560.0)).color(c(color.TEXT_2)))
        .child(caption(`step ${step + 1} of ${steps} · ${wall.cols}×${wall.rows} grid`)),
    )
}

function control(s: State, cell: Cell, m: Metrics): El {
  const [x, y, w, h] = cell.rect
  const tint = stress.tint(cell.hue)
  const [fill, edge] = cell.hot ? [stress.hot_fill(cell.hue), stress.hot_edge(cell.hue)] : [color.TILE, color.EDGE]
  const travel = spring(s.springs.travel)
  const snap = spring(s.springs.snap)
  let bars = row().w_full().h(m.bars_h).gap(m.bar_gap).items_end()
  for (const b of cell.bars) {
    bars = bars.child(el().grow(1.0).h(F(b * m.bars_h)).radius(F(2.0 * m.u)).gradient(c(stress.tint_hi(cell.hue)), c(stress.tint_lo(cell.hue))).motion(travel))
  }
  const inset = F(F(m.switch_h - m.knob) / 2.0)
  const switch_ = el()
    .size(m.switch_w, m.switch_h)
    .radius(F(m.switch_h / 2.0))
    .fill(c(cell.on ? tint : SWITCH_OFF))
    .motion(snap)
    .child(el().size(m.knob, m.knob).absolute(cell.on ? F(F(m.switch_w - inset) - m.knob) : inset, inset).radius(F(m.knob / 2.0)).fill(c(KNOB)).motion(snap))
  const track = el()
    .grow(1.0)
    .h(m.track_h)
    .radius(F(m.track_h / 2.0))
    .fill(c(color.WELL))
    .child(el().w_frac(cell.progress).h(m.track_h).radius(F(m.track_h / 2.0)).fill(c(tint)))
  return col()
    .key(`z${cell.id}`)
    .absolute(x, y)
    .size(w, h)
    .padding(m.pad)
    .gap(m.gap)
    .radius(m.radius)
    .fill(c(fill))
    .border(1.0, c(edge))
    .shadow(m.shadow_y, m.shadow_blur, c(lch(0.0, 0.0, 0.0).alpha(0.35)))
    .clip_rounded(m.radius)
    .motion(spring(s.springs.layout))
    .transition(Transition.scale(0.85).combined(Transition.opacity()))
    .child(
      row()
        .h(lh(m.name))
        .gap(m.gap)
        .center_y()
        .child(el().size(m.dot, m.dot).radius(F(m.dot / 2.0)).fill(c(tint)).shadow(0.0, F(2.0 * m.dot), c(tint.alpha(0.8))))
        .child(text(cell.name()).font(font(m.name, 520.0)).color(c(color.TEXT_2)))
        .child(spacer())
        .child(text(cell.status).font(font(m.small, 600.0)).color(c(tint))),
    )
    .child(
      row()
        .h(lh(m.reading))
        .center_y()
        .child(text(cell.reading()).font(nums(m.reading, 640.0)).color(c(color.TEXT)))
        .child(spacer())
        .child(text(cell.percent()).font(nums(m.small, 500.0)).color(c(color.TEXT_3))),
    )
    .child(bars)
    .child(row().w_full().h(m.foot_h).gap(F(2.0 * m.gap)).center_y().child(track).child(switch_))
}

function hud(r: Readout): El {
  const bw = F(GRAPH_W / GRAPH)
  let graph = row().size(GRAPH_W, GRAPH_H).items_end()
  for (const ms of r.graph) {
    graph = graph.child(el().w(bw).h(F(fmin(F(ms / GRAPH_MAX), 1.0) * GRAPH_H)).fill(c(grade_color(ms))))
  }
  const line = (ms: number, col: Lch) => el().size(GRAPH_W, 1.0).absolute(0.0, F(GRAPH_H - F(F(ms / GRAPH_MAX) * GRAPH_H))).fill(c(col))
  const label = (ms: number, s: string) =>
    text(s).font(nums(10.0, 560.0)).color(c(color.TEXT_2)).absolute(GRAPH_W + 6.0, F(F(GRAPH_H - F(F(ms / GRAPH_MAX) * GRAPH_H)) - 7.0))
  const graph_el = el()
    .size(GRAPH_W + 40.0, GRAPH_H)
    .child(el().size(GRAPH_W, GRAPH_H).absolute(0.0, 0.0).radius(4.0).fill(c(color.WELL)))
    .child(graph.absolute(0.0, 0.0))
    .child(line(BUDGET_120, color.ACCENT))
    .child(line(BUDGET_60, OVER))
    .child(label(BUDGET_120, "120 Hz"))
    .child(label(BUDGET_60, "60 Hz"))
  return row()
    .key("hud")
    .absolute(grid.WIDTH - grid.PAD - HUD_W, grid.PAD - 8.0)
    .size(HUD_W, HEADER)
    .padding(12.0)
    .gap(14.0)
    .radius(14.0)
    .fill(c(color.TILE))
    .border(1.0, c(color.ACCENT.alpha(0.4)))
    .raise()
    .child(
      col()
        .w(HUD_W - GRAPH_W - 40.0 - 14.0 - 24.0)
        .gap(1.0)
        .child(caption(`Rune · ${r.source}`))
        .child(text(r.big()).font(nums(36.0, 700.0)).color(c(grade_color(r.ms))))
        .child(text(r.detail()).font(nums(11.0, 500.0)).color(c(color.TEXT_2)))
        .child(text(r.rate()).font(nums(11.0, 500.0)).color(c(color.TEXT_2))),
    )
    .child(graph_el)
}
