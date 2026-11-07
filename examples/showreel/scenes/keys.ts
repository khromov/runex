// A pad controller playing a boom-bap pattern at 90 BPM: glossy plastic keys, two liquid-metal
// keys, each press springing down and lighting up.

import { type Cx, type El, col, el, row } from "runex-js"

import { CHROME, GLOW, PLASTIC } from "../gfx.ts"
import { H, W, c, ca, dot, fx, mono, pressed, t, ta } from "../kit.ts"
import type { State } from "../main.ts"

const EIGHTH = 60.0 / 90.0 / 2.0
/** (colour index, label) per key; colour 99 is liquid metal. */
const KEYS: [number, string][] = [
  [10, "A"], [9, "B"], [9, "C"], [9, "D"], [10, "E"], [12, "F"], [99, "G"], [10, "H"],
  [11, "KICK"], [10, "I"], [9, "J"], [10, "K"], [12, "SNR"], [9, "L"], [99, "M"], [11, "FX"],
]
const LIGHT: number[] = [0, 9, 9, 9, 0, 12, 0, 0, 11, 0, 9, 0, 12, 9, 0, 11]

function hits(n: number): number[] {
  const v: number[] = []
  const m = ((n % 16) + 16) % 16
  if ([0, 3, 5, 8, 11, 13].includes(m)) {
    v.push(8)
  }
  if (m % 4 === 2) {
    v.push(12)
  }
  v.push(m % 2 === 0 ? 2 : 1)
  if (m === 7 || m === 15) {
    v.push(6)
  }
  if (m === 14) {
    v.push(14)
  }
  if (m === 10) {
    v.push(5)
  }
  if (m === 6) {
    v.push(13)
  }
  return v
}

function press_of(t: number, key: number): number {
  const now = Math.floor(t / EIGHTH)
  let p = 0.0
  for (let n = now - 3; n <= now; n++) {
    if (n < 0) {
      continue
    }
    if (hits(n).includes(key)) {
      p = Math.max(p, pressed(t, n * EIGHTH))
    }
  }
  return p
}

export function view(s: State, _: Cx): El {
  const t_ = s.t
  const [bw, bh] = [864.0, 384.0]
  const [bx, by] = [(W - bw) / 2.0, (H - bh) / 2.0 + 4.0]
  const key = 86.0
  const gap = 12.0
  const kx0 = bx + (bw - 8.0 * key - 7.0 * gap) / 2.0
  const ky0 = by + 152.0

  const bar = 12 + Math.trunc(t_ / (EIGHTH * 8.0))
  const display = col().absolute(kx0, by + 38.0).w(230.0).h(70.0).px(16.0).justify_center().gap(4.0).radius(12.0).fill(c(0x050506)).border(1.0, ca(0xffffff, 0.05))
    .child(row().gap(8.0).items_end().child(mono("90", 30.0, 0x5df2a8)).child(mono("BPM", 13.0, 0x5df2a8).mb(5.0)))
    .child(mono(`pattern A · bar ${bar}`, 11.0, 0x3c9b6c))

  let root = el().w(W).h(H).linear_gradient(1.57, [[0.0, c(0x17161a)], [1.0, c(0x0a0a0b)]])
    .child(el().absolute(bx, by).size(bw, bh).radius(30.0).linear_gradient(1.57, [[0.0, c(0x232227)], [1.0, c(0x161619)]]).border(1.0, ca(0xffffff, 0.08)).shadow(30.0, 60.0, ca(0x000000, 0.6)))
    .child(display)
    .child(col().absolute(bx + bw - (kx0 - bx) - 120.0, by + 44.0).w(120.0).items_end().gap(8.0).child(t("PAD-16", 13.0, 600.0, 0x8a8a93)).child(row().gap(6.0).center_y().child(dot(0xff5a4d, 7.0)).child(t("REC", 12.0, 600.0, 0xff5a4d))))

  // Knobs that turn slowly.
  for (let i = 0; i < 4; i++) {
    const kx = kx0 + 280.0 + i * 70.0
    const ky = by + 46.0
    const ang = Math.fround(
      Math.fround(
        Math.fround(Math.sin(Math.fround(Math.fround(Math.fround(t_) * Math.fround(0.9)) + Math.fround(i * Math.fround(1.3))))) *
          Math.fround(2.2),
      ) - Math.fround(1.5708),
    )
    const [dx, dy] = [Math.fround(Math.fround(Math.cos(ang)) * 16.0), Math.fround(Math.fround(Math.sin(ang)) * 16.0)]
    root = root.child(fx(PLASTIC, [10.0, 0.35, 0.7, 10.0]).absolute(kx, ky).size(54.0, 54.0).radius(27.0))
      .child(dot(0xf1ece1, 6.0).absolute(Math.fround(Math.fround(Math.fround(kx + 27.0) + dx) - 3.0), Math.fround(Math.fround(Math.fround(ky + 27.0) + dy) - 3.0)))
  }

  for (const [i, [col_, label]] of KEYS.entries()) {
    const [cx, cy] = [i % 8, Math.trunc(i / 8)]
    const p = press_of(t_, i)
    const x = kx0 + cx * (key + gap)
    const y = Math.fround(ky0 + cy * (key + gap) + Math.fround(3.0 * p))
    const size = Math.fround(key * Math.fround(1.0 - Math.fround(Math.fround(0.04) * p)))
    const off = Math.fround(Math.fround(key - size) / 2.0)
    const dark = col_ === 10 || col_ === 99
    const face = col_ === 99
      ? fx(CHROME, [0.0, 0.0, 1.4, 1.0])
      : fx(PLASTIC, [col_, 0.22, 0.35, 7.0])
    root = root
      .child(el().absolute(x, ky0 + cy * (key + gap) + 5.0).size(key, key).radius(14.0).fill(ca(0x000000, 0.45)))
      .child(fx(GLOW, [0.0, LIGHT[i]!, Math.fround(Math.fround(1.4) * p), 16.0]).absolute(Math.fround(x + off), Math.fround(y + off)).size(size, size).radius(14.0).effect_bleed(50.0))
      .child(face.absolute(Math.fround(x + off), Math.fround(y + off)).size(size, size).radius(14.0))
      .child(el().absolute(Math.fround(Math.fround(x + off) + 10.0), Math.fround(Math.fround(y + off) + 8.0)).child(ta(label, 11.5, 600.0, dark && col_ !== 99 ? 0xb9b9c2 : 0x2a2a2e, 0.85)))
  }
  return root
}
