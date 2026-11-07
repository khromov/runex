// Shared-element motion with `El::matched`: a 2×2 grid of picture tiles. 1–4 picks a tile, ↩
// (or a click) zooms it to the whole stage and Esc zooms it back. Both places are plain flex
// layout; the tile flies between them because both carry the same `matched` id.
//
// ```sh
// bun examples/matched/main.ts
// bun examples/matched/main.ts --script examples/matched/scripts/zoom.json --frames 240 --out frames
// ```

import { AppSpec, Color, type Cx, type El, type KeyEvent, Pixels, TextStyle, Transition, type Tx, col, el, row, run, text, tok } from "runex-js"
const { type_ } = tok

// Rust computes in f32: every step rounds.
const f = Math.fround

type State = {
  picked: number
  zoomed: boolean
  pictures: Pixels[]
}

type Rgb = [number, number, number]

/** Sky, ground and sun colours of each tile's picture, as sRGB bytes. */
const SCENES: [Rgb, Rgb, Rgb][] = [
  [[255, 166, 120], [58, 40, 92], [255, 236, 170]],
  [[120, 200, 255], [30, 90, 70], [255, 255, 235]],
  [[196, 150, 255], [40, 30, 70], [255, 200, 240]],
  [[255, 214, 120], [120, 60, 30], [255, 250, 220]],
]

const NAMES = ["Dusk", "Lake", "Haze", "Dune"]

function picture(i: number): Pixels {
  const [w, h] = [320, 240]
  const [sky, ground, sun] = SCENES[i]!
  const mix = (a: Rgb, b: Rgb, t: number) => a.map((a, c) => f(a + f((b[c]! - a) * t)))
  // `Vec::with_capacity(w * h * 4)` filled in order: a byte buffer of that size.
  const rgba = new Uint8Array(w * h * 4)
  let o = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [u, v] = [f(x / w), f(y / h)]
      const horizon = f(f(0.62) + f(f(0.04) * f(Math.sin(f(f(u * 6.0) + i)))))
      // Ground coverage of this pixel, anti-aliased over one pixel row.
      const land = Math.min(Math.max(f(f(f(v - horizon) * h) + 0.5), 0.0), 1.0)
      const air0 = mix(sky, ground, f(f(Math.pow(Math.min(f(v / horizon), 1.0), f(2.2))) * 0.5))
      const du = f(f(u - f(0.3)) - f(f(0.12) * i))
      const dv = f(f(v - f(0.42)) * 0.75)
      const d = f(Math.sqrt(f(f(du * du) + f(dv * dv))))
      const glow = f(Math.pow(Math.min(Math.max(f(1.0 - f(d / f(0.16))), 0.0), 1.0), f(0.6)))
      const air = air0.map((a, c) => f(a + f(f(sun[c]! - a) * glow)))
      const soil = mix(ground, [10, 10, 16], f(Math.max(f(v - horizon), 0.0) * f(1.6)))
      for (let c = 0; c < 3; c++) {
        const a = air[c]!
        // `as u8` truncates.
        rgba[o++] = Math.trunc(Math.min(Math.max(f(a + f(f(soil[c]! - a) * land)), 0.0), 255.0))
      }
      rgba[o++] = 255
    }
  }
  const p = Pixels.new()
  p.set(w, h, rgba)
  return p
}

function init(): State {
  return { picked: 0, zoomed: false, pictures: Array.from({ length: 4 }, (_, i) => picture(i)) }
}

function tile(s: State, i: number): El {
  const id = `tile-${i + 1}`
  let t = el().key(id).matched(id).grow(1.0).radius(20.0).clip_rounded(20.0)
    .fill(Color.BLACK)
    .on_press((s: State) => {
      if (s.zoomed) { s.zoomed = false } else { [s.picked, s.zoomed] = [i, true] }
    })
    .child(el().w_full().h_full().pixels_fit(s.pictures[i]!, "Fill"))
    .child(text(`${i + 1}  ${NAMES[i]}`).font(TextStyle.new(22.0, 600.0)).color(Color.WHITE).absolute(18.0, 14.0))
  if (s.picked === i) {
    t = t.child(el().absolute(0.0, 0.0).w_full().h_full().radius(20.0).border(3.0, Color.WHITE))
  }
  return t
}

function view(s: State, _: Cx): El {
  const theme = tok.theme(true)
  const hint = text("1–4 pick    ↩ zoom    esc back").font(type_.LABEL).color(theme.text_secondary)
  let stage = col().key("stage").w_full().grow(1.0)
  if (s.zoomed) {
    stage = stage.child(tile(s, s.picked))
  } else {
    // The grid's own entrance and exit; the matched tile rides above it.
    const pair = (a: number) => row().key(`row-${a}`).grow(1.0).gap(12.0).child(tile(s, a)).child(tile(s, a + 1))
    stage = stage.child(col().key("grid").grow(1.0).gap(12.0).transition(Transition.scale(0.96))
      .child(pair(0)).child(pair(2)))
  }
  return col().w_full().h_full().padding(24.0).gap(14.0).fill(theme.bg).child(hint).child(stage)
}

/** Rust's `t.parse::<usize>().ok()`: ASCII digits after an optional `+`, else `None`. */
function parse_usize(t: string): number | null {
  return /^\+?[0-9]+$/.test(t) ? Number(t) : null
}

function on_key(s: State, e: KeyEvent, _: Tx): boolean {
  const k = e.key
  const n = typeof k === "object" && "Text" in k ? parse_usize(k.Text) : null
  if (typeof k === "object" && "Text" in k && !s.zoomed && n !== null && n >= 1 && n <= 4) {
    s.picked = n - 1
  } else if (k === "Enter") {
    s.zoomed = true
  } else if (k === "Escape") {
    s.zoomed = false
  } else {
    return false
  }
  return true
}

run({
  ...AppSpec.new<State>("Matched", [720.0, 480.0], init, view),
  scenes: [["grid", (_) => {}], ["one", (s) => { s.zoomed = true }]],
  on_key,
})
