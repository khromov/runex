// Shared look and motion helpers for the scenes.

import { type Color, type El, TextStyle, color, effect, el, text } from "runex-js"
import { Spring } from "runex-js/motion"

export const W = 960.0
export const H = 540.0

/** An sRGB hex colour. */
export function c(hex: number): Color {
  return color.hex(`#${hex.toString(16).padStart(6, "0")}`)!
}

export function ca(hex: number, a: number): Color {
  return c(hex).alpha(a)
}

export const BG = 0x0b0b0d
export const PANEL = 0x141417
export const RAISED = 0x1b1b1f
export const TEXT = 0xededef
export const MUTED = 0x9a9aa3
export const FAINT = 0x5f5f68

export function hair(): Color {
  return ca(0xffffff, 0.08)
}

/** `f32::clamp`. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

export function t(s: string, size: number, weight: number, color: number): El {
  return text(s).font(TextStyle.new(size, weight)).color(c(color))
}

export function ta(s: string, size: number, weight: number, color: number, alpha: number): El {
  return text(s).font(TextStyle.new(size, weight)).color(ca(color, clamp(alpha, 0.0, 1.0)))
}

export function mono_a(s: string, size: number, color: number, alpha: number): El {
  return text(s).font(TextStyle.new(size, 500.0).mono()).color(ca(color, clamp(alpha, 0.0, 1.0)))
}

export function mono(s: string, size: number, color: number): El {
  return text(s).font(TextStyle.new(size, 500.0).mono()).color(c(color))
}

/** An effect slot: `kind` is a `gfx` constant, `data` its numbers. */
export function fx(kind: number, data: [number, number, number, number]): El {
  return effect(kind).effect_data(data)
}

/** 0 → 1 between `t0` and `t0 + dur`, smoothstep. */
export function ease(t: number, t0: number, dur: number): number {
  const x = Math.fround(clamp((t - t0) / dur, 0.0, 1.0))
  return Math.fround(Math.fround(x * x) * Math.fround(3.0 - Math.fround(2.0 * x)))
}

/** A key of `track`: (time, target, spring). */
export type Key = [number, number, Spring]

/**
 * A value that starts at `from` and springs to each key's target at its time, carrying velocity
 * across retargets (as an interrupted Rune spring does).
 */
export function track(t: number, from: number, keys: Key[]): number {
  let [x, v, target, t0, spring] = [from, 0.0, from, 0.0, Spring.new(0.3, 0.0)]
  for (const [tk, to, sp] of keys) {
    if (t < tk) {
      break
    }
    const [nx, nv] = spring.sample(x, v, target, Math.fround(tk - t0))
    x = nx
    v = nv
    target = to
    t0 = tk
    spring = sp
  }
  return spring.sample(x, v, target, Math.fround(t - t0))[0]
}

export function sp(duration: number, bounce: number): Spring {
  return Spring.new(duration, bounce)
}

/** An iPad-style round pointer at (x, y), centred, squeezed while pressed. */
export function pointer(x: number, y: number, press: number): El {
  const r = Math.fround(9.0 * Math.fround(1.0 - Math.fround(Math.fround(0.22) * press)))
  return el().key("pointer")
    .absolute(Math.fround(x - r), Math.fround(y - r))
    .size(Math.fround(2.0 * r), Math.fround(2.0 * r))
    .radius(r)
    .fill(ca(0xf4f4f6, 0.92))
    .border(1.0, ca(0x000000, 0.35))
    .shadow(2.0, 8.0, ca(0x000000, 0.45))
}

/** A pointer that follows `path` (time, x, y) on springs and presses at each time in `taps`. */
export function pointer_at(t: number, start: [number, number], path: [number, number, number][], taps: number[]): El {
  const s = sp(0.55, 0.0)
  const kx: Key[] = path.map(([tk, x, _]) => [tk, x, s])
  const ky: Key[] = path.map(([tk, _, y]) => [tk, y, s])
  const x = track(t, start[0], kx)
  const y = track(t, start[1], ky)
  const k: Key[] = taps.flatMap((tp): Key[] => [[tp, 1.0, sp(0.12, 0.0)], [tp + 0.14, 0.0, sp(0.3, 0.4)]])
  return pointer(x, y, track(t, 0.0, k))
}

/** Press depth (0 → 1 → 0) for a tap at `tp`: down fast, back on a bouncy spring. */
export function pressed(t: number, tp: number): number {
  return track(t, 0.0, [[tp, 1.0, sp(0.12, 0.0)], [tp + 0.14, 0.0, sp(0.35, 0.45)]])
}

export function avatar(letter: string, color: number, size: number): El {
  return el().size(size, size)
    .radius(Math.fround(size / 2.0))
    .fill(c(color))
    .center()
    .child(t(letter, Math.fround(size * Math.fround(0.42)), 600.0, 0x0b0b0d))
}

export function dot(color: number, size: number): El {
  return el().size(size, size).radius(Math.fround(size / 2.0)).fill(c(color))
}
