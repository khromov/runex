// ᚱUNE, the wordmark from the site's pixel grid, built from liquid-metal tiles that spring in
// along the letters and then flow as one surface. `card` adds the repository line under it.

import { type Cx, type El, el } from "runex-js"

import { CHROME } from "../gfx.ts"
import { H, W, c, ease, fx, mono_a, sp, track } from "../kit.ts"
import type { State } from "../main.ts"

const GLYPHS: string[] = [
  "###....|####...|##.##..|##..##.|##..##.|##.##..|####...|##.##..|##..##.|##...##|##...##",
  "##...##|##...##|##...##|##...##|##...##|##...##|##...##|##...##|##...##|#######|.#####.",
  "###...##|####..##|####..##|####..##|##.##.##|##.##.##|##.##.##|##..####|##..####|##..####|##...###",
  "######|######|##....|##....|#####.|#####.|##....|##....|##....|######|######",
]

function ink(rows: string[], dx: number): [number, number][] {
  const v: [number, number][] = []
  rows.forEach((r, y) => {
    Array.from(r).forEach((ch, x) => {
      if (ch === "#") {
        v.push([x + dx, y])
      }
    })
  })
  return v
}

/** Every inked cell of the wordmark, letters fitted one clear pixel apart (diagonals included). */
export function cells(): [[number, number, number][], number] {
  const out: [number, number, number][] = []
  let at = 0
  let width = 0
  let prev: [number, number][] | null = null
  GLYPHS.forEach((glyph, g) => {
    const rows = glyph.split("|")
    const b = ink(rows, 0)
    if (prev !== null) {
      const a = prev
      let x = at + 1
      while (a.some(([ax, ay]) => b.some(([bx, by]) => Math.abs(bx + x - ax) <= 1 && Math.abs(by - ay) <= 1))) {
        x += 1
      }
      at = x
    }
    const placed = ink(rows, at)
    out.push(...placed.map(([x, y]): [number, number, number] => [x, y, g]))
    width = at + rows[0]!.length
    prev = placed
  })
  return [out, width]
}

export function view(s: State, _: Cx, card: boolean): El {
  const t = s.t
  const [cells_, width] = cells()
  const cell = card ? 19.0 : 25.0
  const tile = cell - 1.0
  const total_w = Math.fround(width * cell)
  const total_h = Math.fround(11.0 * cell)
  // A slow push in, about the frame's centre.
  const zoom = card ? 1.0 : Math.fround(1.0 + Math.fround(Math.fround(0.05) * ease(t, 0.0, 4.0)))
  const ox = Math.fround(Math.fround(W - Math.fround(total_w * zoom)) / 2.0)
  const oy = card ? 168.0 : Math.fround(Math.fround(H - Math.fround(total_h * zoom)) / 2.0)
  let root = el().w(W).h(H).fill(c(0x000000))
  for (const [x, y, g] of cells_) {
    // A wave left to right, each letter a beat behind the last, rows rippling down.
    const delay = 0.08 + g * 0.11 + x * 0.012 + y * 0.018
    const k = track(t, 0.0, [[delay, 1.0, sp(0.55, 0.38)]])
    const size = Math.fround(Math.fround(tile * zoom) * Math.max(k, 0.0))
    const cx = Math.fround(ox + Math.fround(Math.fround(Math.fround(x + 0.5) * cell) * zoom))
    const cy = Math.fround(oy + Math.fround(Math.fround(Math.fround(y + 0.5) * cell) * zoom))
    if (size < 0.5) {
      continue
    }
    root = root.child(
      fx(CHROME, [4.0, 0.0, 1.25, 0.0])
        .key(`c${x}_${y}`)
        .absolute(Math.fround(cx - Math.fround(size / 2.0)), Math.fround(cy - Math.fround(size / 2.0)))
        .size(size, size)
        .radius(Math.fround(Math.fround(2.5 * zoom) * k)),
    )
  }
  if (card) {
    const a = ease(t, 0.9, 0.6)
    root = root.child(
      el().absolute(0.0, Math.fround(Math.fround(Math.fround(oy + total_h) + 46.0) - Math.fround(8.0 * a)))
        .w(W)
        .center()
        .child(mono_a("github.com/anomalyco/rune", 22.0, 0xb8bcc6, a)),
    )
  }
  return root
}
