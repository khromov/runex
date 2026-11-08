// The shared look in Rune terms: colours, type and the tile frame every tile sits in.
//
// Port of vendor/rune/examples/motion-bento/src/style.rs.

import { type Color, type El, Spring, TextStyle, col, oklcha, row, spacer, text } from "runex-js"
import { round } from "./chaos/fmt.ts"
import * as look from "./chaos/look.ts"
import { type Lch, color, grid } from "./chaos/look.ts"

const F = Math.fround

export function c(l: Lch): Color {
  return oklcha(l.l, l.c, l.h, l.a)
}

export function spring(s: look.Spring): Spring {
  return Spring.new(s.duration, s.bounce)
}

export function font(size: number, weight: number): TextStyle {
  return TextStyle.new(size, weight).lh(round(F(size * F(1.3))))
}

/** Tabular figures, so changing numbers don't jitter sideways. */
export function nums(size: number, weight: number): TextStyle {
  return font(size, weight).features("'tnum' 1")
}

export function title(s: string): El {
  return text(s).font(font(13.0, 560.0)).color(c(color.TEXT_2))
}

export function caption(s: string): El {
  return text(s).font(font(12.0, 460.0)).color(c(color.TEXT_3))
}

/** A tile: a rounded card with a title row (title on the left, `aside` on the right) over `body`. */
export function tile(key: string, name: string, aside: El, body: El): El {
  return col()
    .key(key)
    .radius(grid.RADIUS)
    .fill(c(color.TILE))
    .border(1.0, c(color.EDGE))
    .padding(grid.TILE_PAD)
    .gap(14.0)
    .child(row().key("head").h(20.0).center_y().gap(8.0).child(title(name)).child(spacer()).child(aside))
    .child(body)
}

/** Column width in the 4-column grid. */
export function col_w(): number {
  return F(F(F(grid.WIDTH - 2.0 * grid.PAD) - 3.0 * grid.GAP) / 4.0)
}

/** A tile's inside width for a span of `cols` columns. */
export function inner_w(cols: number): number {
  return F(F(F(col_w() * cols) + F(grid.GAP * F(cols - 1.0))) - 2.0 * grid.TILE_PAD)
}

/** A tile's body height for a row of height `h`. */
export function inner_h(h: number): number {
  return F(F(F(h - 2.0 * grid.TILE_PAD) - 20.0) - 14.0)
}

/** A rounded button in the well colour. */
export function well_button(key: string, label: string, w: number, h: number): El {
  return row()
    .key(key)
    .size(w, h)
    .radius(F(h * F(0.32)))
    .center()
    .fill(c(color.WELL))
    .border(1.0, c(color.EDGE))
    .hover(c(color.WELL_HI))
    .press(c(color.WELL_HI))
    .press_scale(0.94)
    .child(text(label).font(font(15.0, 560.0)).color(c(color.TEXT)))
}
