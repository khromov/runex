// A photo library of live gradients. Taps send shockwaves through the whole window, on the beat.

import { type Cx, type El, col, el, row, spacer } from "runex-js"

import { MESH, SHOCK } from "../gfx.ts"
import { H, MUTED, TEXT, W, c, ca, fx, pointer_at, pressed, sp, t, track } from "../kit.ts"
import type { State } from "../main.ts"

/** Taps: time and grid cell (column, row). 0.6667 s apart, a beat at 90 BPM. */
const TAPS: [number, number, number][] = [[0.5, 2, 1], [1.1667, 0, 2], [1.8333, 4, 0]]

export function view(s: State, _: Cx): El {
  const t_ = s.t
  const [cols, rows] = [5, 3]
  const [gx, gy, gap] = [28.0, 92.0, 10.0]
  const tw = Math.fround(Math.fround(Math.fround(W - 2.0 * gx) - Math.fround(gap * (cols - 1.0))) / cols)
  const th = Math.fround(Math.fround(Math.fround(Math.fround(H - gy) - 24.0) - Math.fround(gap * (rows - 1.0))) / rows)

  const seg = ["Years", "Months", "Days", "All Photos"]
  const sel = track(t_, 3.0, [[0.25, 2.0, sp(0.45, 0.25)]])
  let seg_row = el().h(34.0).w(4.0 * 92.0 + 8.0).radius(10.0).fill(ca(0xffffff, 0.06))
    .child(el().absolute(Math.fround(4.0 + Math.fround(sel * 92.0)), 4.0).size(92.0, 26.0).radius(7.0).fill(ca(0xffffff, 0.14)))
  for (const [i, name] of seg.entries()) {
    seg_row = seg_row.child(row().absolute(4.0 + i * 92.0, 4.0).size(92.0, 26.0).center().child(t(name, 13.0, 500.0, Math.abs(Math.fround(sel - i)) < 0.5 ? TEXT : MUTED)))
  }
  const header = row().absolute(gx, 28.0).w(W - 2.0 * gx).center_y()
    .child(col().gap(3.0).child(t("Library", 24.0, 600.0, TEXT)).child(t("1,284 photos · 3 albums", 13.0, 400.0, MUTED)))
    .child(spacer())
    .child(seg_row)

  let root = el().w(W).h(H).fill(c(0x08080a)).child(header)
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const i = r * cols + cc
      const press = TAPS.filter(([_, x, y]) => x === cc && y === r).map(([tp, _x, _y]) => pressed(t_, tp)).reduce((a, b) => Math.max(a, b), 0.0)
      const x = Math.fround(gx + Math.fround(cc * Math.fround(tw + gap)))
      const y = Math.fround(gy + Math.fround(r * Math.fround(th + gap)))
      root = root.child(fx(MESH, [i % 8, 0.5, i, 0.25]).key(`tile-${i}`).absolute(x, y).size(tw, th).radius(12.0).scale(Math.fround(1.0 - Math.fround(Math.fround(0.06) * press))))
    }
  }
  // Always in the tree (an idle shockwave draws nothing), so no slot enters inside a fade layer,
  // where its backdrop would be the empty layer.
  for (const [tp, cc, r] of TAPS) {
    const x = Math.fround(Math.fround(gx + Math.fround(cc * Math.fround(tw + gap))) + Math.fround(tw / 2.0))
    const y = Math.fround(Math.fround(gy + Math.fround(r * Math.fround(th + gap))) + Math.fround(th / 2.0))
    root = root.child(fx(SHOCK, [x, y, Math.fround(Math.fround(tp) + Math.fround(0.03)), 22.0]).key(`shock-${cc}-${r}`).effect_backdrop(true).absolute(0.0, 0.0).size(W, H))
  }
  const path: [number, number, number][] = TAPS.map(([tp, cc, r]) => [
    tp - 0.42,
    Math.fround(Math.fround(gx + Math.fround(cc * Math.fround(tw + gap))) + Math.fround(tw / 2.0)),
    Math.fround(Math.fround(gy + Math.fround(r * Math.fround(th + gap))) + Math.fround(th / 2.0)),
  ])
  const taps: number[] = TAPS.map((x) => x[0])
  return root.child(pointer_at(t_, [700.0, 500.0], path, taps))
}
