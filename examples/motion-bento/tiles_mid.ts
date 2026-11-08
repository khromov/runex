// The middle row: the mixer, the XY pad, the play queue and the activity feed.
//
// Port of vendor/rune/examples/motion-bento/src/tiles_mid.rs.

import { type El, Shape, Transition, canvas, col, el, row, spacer, text } from "runex-js"
import { type Kit, RollingText } from "runex-js/kit"
import { fixed } from "./chaos/fmt.ts"
import { color, grid, lch, to_radians } from "./chaos/look.ts"
import { FADERS, FEED_KINDS, TRACKS } from "./chaos/model.ts"
import type { State } from "./main.ts"
import { c, caption, font, inner_h, inner_w, nums, spring, tile } from "./style.ts"

const F = Math.fround

const TRACK_H = 132.0

function tile_w(): number {
  return F(inner_w(1.0) + 2.0 * grid.TILE_PAD)
}

export function mixer(s: State, k: Kit): El {
  const travel = spring(s.springs.travel)
  let faders = row().w_full().h(inner_h(grid.ROW2)).justify_between()
  FADERS.forEach((name, i) => {
    const v = s.m.faders[i]!
    const h = F(12.0 + F(v * (TRACK_H - 12.0)))
    const track = el()
      .size(30.0, TRACK_H)
      .child(el().size(8.0, TRACK_H).absolute(11.0, 0.0).radius(4.0).fill(c(color.WELL)))
      .child(
        el().size(8.0, h)
          .absolute(11.0, F(TRACK_H - h))
          .radius(4.0)
          .gradient(c(lch(0.74, 0.14, 240.0)), c(color.ACCENT))
          .motion(travel),
      )
      .child(
        el().size(30.0, 12.0)
          .absolute(0.0, F(F(TRACK_H - h) - 6.0))
          .radius(6.0)
          .fill(c(color.TEXT))
          .shadow(2.0, 6.0, c(lch(0.0, 0.0, 0.0).alpha(0.5)))
          .motion(travel),
      )
    faders = faders.child(
      col()
        .key(`fader${i}`)
        .items_center()
        .gap(8.0)
        .on_press((s: State) => { s.act({ Fader: i }) })
        .child(RollingText.new(`level${i}`, fixed(F(v * 100.0), 0)).value(v).font(nums(12.0, 560.0)).color(c(color.TEXT_2)).build(k))
        .child(track)
        .child(caption(name)),
    )
  })
  const live = row()
    .gap(6.0)
    .center_y()
    .child(el().size(6.0, 6.0).radius(3.0).fill(c(color.GOOD)))
    .child(caption("Live"))
  return tile("mixer", "Mixer", live, faders).w(tile_w())
}

function grid_lines(w: number, h: number): Shape {
  const line = c(lch(1.0, 0.0, 0.0).alpha(0.06))
  let s = Shape.new()
  for (let i = 1; i < 4; i++) {
    const x = F(F(w * i) / 4.0)
    const y = F(F(h * i) / 4.0)
    s = s.line([x, 0.0], [x, h], 1.0, "Butt", line).line([0.0, y], [w, y], 1.0, "Butt", line)
  }
  return s
}

export function xy(s: State, k: Kit): El {
  const travel = spring(s.springs.travel)
  const [w, h] = [inner_w(1.0), inner_h(grid.ROW2)]
  const [px, py] = s.m.puck
  const [x, y] = [F(px * w), F(py * h)]
  const pad = el()
    .key("pad")
    .size(w, h)
    .radius(14.0)
    .fill(c(color.WELL))
    .border(1.0, c(color.EDGE))
    .clip_rounded(14.0)
    .on_press((s: State) => { s.act("Puck") })
    .child(canvas(grid_lines(w, h)).size(w, h).absolute(0.0, 0.0))
    .child(el().size(1.0, h).absolute(x, 0.0).fill(c(color.ACCENT.alpha(0.35))).motion(travel))
    .child(el().size(w, 1.0).absolute(0.0, y).fill(c(color.ACCENT.alpha(0.35))).motion(travel))
    .child(el().size(96.0, 96.0).absolute(F(x - 48.0), F(y - 48.0)).radius(48.0).fill(c(color.ACCENT.alpha(0.28))).blur(18.0).motion(travel))
    .child(
      el().size(24.0, 24.0)
        .absolute(F(x - 12.0), F(y - 12.0))
        .radius(12.0)
        .fill(c(color.ACCENT))
        .border(3.0, c(color.TEXT))
        .shadow(3.0, 10.0, c(lch(0.0, 0.0, 0.0).alpha(0.45)))
        .motion(travel),
    )
  const readout = row()
    .gap(10.0)
    .child(RollingText.new("cutoff", `${fixed(F(200.0 + F(px * 7800.0)), 0)} Hz`).value(px).font(nums(12.0, 500.0)).color(c(color.TEXT_3)).build(k))
    .child(RollingText.new("res", `Q ${fixed(F(0.5 + F(F(1.0 - py) * 9.5)), 1)}`).value(F(1.0 - py)).font(nums(12.0, 500.0)).color(c(color.TEXT_3)).build(k))
  return tile("xy", "Filter", readout, pad).w(tile_w())
}

/** The queue's card art: a two-tone gradient per track. */
function art(track: number): El {
  const hue = F(F(F(track * 47.0) + 200.0) % 360.0)
  return el().size(64.0, 64.0)
    .radius(12.0)
    .linear_gradient(to_radians(135.0), [[0.0, c(lch(0.72, 0.15, hue))], [1.0, c(lch(0.42, 0.14, F(F(hue + 50.0) % 360.0)))]])
}

export const CARD_H = 140.0
/** How far each card behind the front one sits lower, and how much smaller it is. */
export const PEEK = 14.0
export const SHRINK = F(0.05)

export function queue(s: State, _k: Kit): El {
  const layout = spring(s.springs.layout)
  const w = inner_w(1.0)
  const h = inner_h(grid.ROW2)
  let deck = el().w(w).h(h)
  // Back to front, so the front card paints last.
  for (let depth = s.m.queue.length - 1; depth >= 0; depth--) {
    const card = s.m.queue[depth]!
    const d = depth
    const front = depth === 0
    const [title, artist] = TRACKS[card.track]!
    const shade = lch(F(F(0.29) - F(F(0.025) * d)), 0.018, 258.0)
    const progress = F(F(0.18) + F(F(0.09) * (card.id % 7)))
    const elapsed = Math.trunc(F(progress * 220.0)) // `as u32`
    const info = col()
      .gap(14.0)
      .w_full()
      .opacity(front ? 1.0 : 0.0)
      .child(
        row()
          .gap(14.0)
          .center_y()
          .child(art(card.track))
          .child(
            col()
              .gap(3.0)
              .child(text(title).font(font(16.0, 620.0)).color(c(color.TEXT)))
              .child(text(artist).font(font(13.0, 460.0)).color(c(color.TEXT_2))),
          ),
      )
      .child(
        col()
          .gap(6.0)
          .child(el().w_full().h(4.0).radius(2.0).fill(c(color.WELL_HI)).child(el().w_frac(progress).h(4.0).radius(2.0).fill(c(color.TEXT_2))))
          .child(
            row()
              .child(text(`${Math.trunc(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`).font(nums(11.0, 500.0)).color(c(color.TEXT_3)))
              .child(spacer())
              .child(text("3:40").font(nums(11.0, 500.0)).color(c(color.TEXT_3))),
          ),
      )
    deck = deck.child(
      col()
        .key(`card${card.id}`)
        .size(w, CARD_H)
        .absolute(0.0, F(d * PEEK))
        .scale(F(1.0 - F(d * SHRINK)))
        .radius(16.0)
        .fill(c(shade))
        .border(1.0, c(color.EDGE))
        .shadow(6.0, 18.0, c(lch(0.0, 0.0, 0.0).alpha(0.35)))
        .padding(16.0)
        .motion(layout)
        .transition(Transition.asymmetric(
          Transition.scale(0.9),
          Transition.move_edge("Trailing").combined(Transition.opacity()),
        ))
        .child(info),
    )
  }
  const skip = row()
    .key("skip")
    .h(24.0)
    .px(10.0)
    .radius(12.0)
    .center()
    .fill(c(color.ACCENT_DIM))
    .hover(c(color.ACCENT.alpha(0.28)))
    .press_scale(0.94)
    .on_press((s: State) => { s.act("Queue") })
    .child(text("Skip").font(font(12.0, 600.0)).color(c(color.ACCENT)))
  return tile("queue", "Up next", skip, deck).w(tile_w())
}

const KIND_HUES = [245.0, 30.0, 155.0, 70.0, 200.0, 265.0, 330.0, 175.0] as const

export function feed(s: State, _k: Kit): El {
  let rows = col().w_full().gap(6.0)
  for (const item of s.m.feed) {
    const hue = KIND_HUES[item.kind % KIND_HUES.length]!
    rows = rows.child(
      row()
        .key(`item${item.id}`)
        .h(40.0)
        .w_full()
        .px(12.0)
        .gap(10.0)
        .radius(12.0)
        .center_y()
        .fill(c(color.WELL))
        .transition(Transition.asymmetric(
          Transition.offset(0.0, -12.0).combined(Transition.opacity()),
          Transition.scale(0.96),
        ))
        .child(el().size(8.0, 8.0).radius(4.0).fill(c(lch(0.72, 0.15, hue))))
        .child(text(FEED_KINDS[item.kind]!).font(font(13.0, 500.0)).color(c(color.TEXT)).truncate())
        .child(spacer())
        .child(text(`9:${String(item.minute).padStart(2, "0")}`).font(nums(12.0, 460.0)).color(c(color.TEXT_3))),
    )
  }
  const test = row()
    .key("test")
    .h(24.0)
    .px(10.0)
    .radius(12.0)
    .center()
    .fill(c(color.WELL))
    .hover(c(color.WELL_HI))
    .press_scale(0.94)
    .on_press((s: State) => { s.act("Feed") })
    .child(text("Test alert").font(font(12.0, 560.0)).color(c(color.TEXT_2)))
  return tile("feed", "Activity", test, rows.motion(spring(s.springs.layout))).w(tile_w())
}
