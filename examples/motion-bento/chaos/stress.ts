// Stress mode: a wall of live controls, each a small bento of its own, that all move at once,
// so both builds can be loaded until one of them misses its frames.
//
// `--load N` holds N controls. `--ramp A:B` steps from A controls to B, ×√2 a step, holding each
// for `--hold` seconds. Everything a control shows is a pure function of the seed, its id and the
// show time, so the two builds draw the same wall at the same moment without sharing anything
// but this module: each control's bars retarget every 0.16–0.46 s, its reading changes every
// frame, its switch flips, its tint drifts; every 1.7 s a twelfth of the wall goes wide and every
// 2 s the whole wall reshuffles, so every control flies to a new place.
//
// Port of vendor/rune/examples/motion-bento/chaos/src/stress.rs. The hash is Rust's u64
// arithmetic on 32-bit halves (rng.ts); f32 values are rounded to f32 after every step (`F`).

import { as_usize, fixed, parse_usize, round } from "./fmt.ts"
import { type Lch, grid, lch } from "./look.ts"
import { type U64, u64 } from "./rng.ts"
import { START } from "./schedule.ts"

const F = Math.fround

/** Bars in each control's meter. */
export const BARS = 8
/** The header above the wall: the title, the load and the HUD. */
export const HEADER = 120.0
/** Seconds between reshuffles of the whole wall. */
export const SHUFFLE = 2.0
/** Seconds between changes of which controls are wide. */
export const WIDE_EVERY = 1.7
/** One control in this many is wide. */
export const WIDE_SHARE = 12
export const STATUS = ["Idle", "Heat", "Cool", "Boost", "Eco", "Auto"] as const
export const HUES = [245.0, 200.0, 290.0, 165.0, 70.0] as const
/** A control's width over its height. */
const ASPECT = 1.5

/** How many controls the wall holds over time: `Fixed(n)`, or `Ramp { levels, hold }`, each level for `hold` seconds, the first from `START`. */
export class Load {
  readonly #levels: number[]
  /** `null` for `Fixed`. */
  readonly #hold: number | null

  private constructor(levels: number[], hold: number | null) {
    this.#levels = levels
    this.#hold = hold
  }

  static Fixed(n: number): Load {
    return new Load([n], null)
  }

  static Ramp(levels: number[], hold: number): Load {
    return new Load(levels, hold)
  }

  /** From `from` to `to` controls, ×√2 a step (rounded), `to` last. */
  static ramp(from: number, to: number, hold: number): Load {
    const levels: number[] = []
    let n = Math.max(from, 1)
    while (as_usize(round(n)) < to) {
      levels.push(as_usize(round(n)))
      n *= Math.SQRT2
    }
    levels.push(Math.max(to, Math.max(from, 1)))
    return Load.Ramp(levels, hold)
  }

  /** `A:B`, as `--ramp` takes it. */
  static parse_ramp(spec: string, hold: number): { Ok: Load } | { Err: string } {
    const colon = spec.indexOf(":")
    if (colon === -1) return { Err: `--ramp wants FROM:TO, got ${spec}` }
    const n = (s: string) => parse_usize(s.trim())
    const [sa, sb] = [spec.slice(0, colon), spec.slice(colon + 1)]
    const a = n(sa)
    if (a === null) return { Err: `--ramp: not a count: ${sa}` }
    const b = n(sb)
    if (b === null) return { Err: `--ramp: not a count: ${sb}` }
    if (a === 0 || b < a) {
      return { Err: `--ramp wants 0 < FROM ≤ TO, got ${spec}` }
    }
    return { Ok: Load.ramp(a, b, hold) }
  }

  levels(): readonly number[] {
    return this.#levels
  }

  /** The level index at show time `t`. */
  step_at(t: number): number {
    if (this.#hold === null) return 0
    const after = t - START
    return Math.min(as_usize((Number.isNaN(after) ? 0 : Math.max(after, 0.0)) / this.#hold), this.#levels.length - 1)
  }

  at(t: number): number {
    return this.#levels[this.step_at(t)]!
  }

  /** The show a ramp needs: every level held once. `null` for a fixed load. */
  duration(): number | null {
    return this.#hold === null ? null : START + this.#levels.length * this.#hold
  }
}

/** The wall's rectangle in window points, below the header. */
export function area(): [number, number, number, number] {
  const y = grid.PAD - 8.0 + HEADER + grid.GAP
  return [grid.PAD, y, grid.WIDTH - 2.0 * grid.PAD, grid.HEIGHT - grid.PAD - y]
}

/** A control's accent, its bars' top and bottom. */
export function tint(hue: number): Lch {
  return lch(0.72, 0.15, hue)
}
export function tint_hi(hue: number): Lch {
  return lch(0.82, 0.12, hue)
}
export function tint_lo(hue: number): Lch {
  return lch(0.52, 0.16, hue)
}
/** A hot control's card and edge. */
export function hot_fill(hue: number): Lch {
  return lch(0.235, 0.035, hue)
}
export function hot_edge(hue: number): Lch {
  return lch(0.72, 0.15, hue).alpha(0.55)
}

/** One control at one moment. */
export class Cell {
  id: number
  /** x, y, w, h in window points. */
  rect: [number, number, number, number] = [0.0, 0.0, 0.0, 0.0]
  wide = false
  hue = 0.0
  on = false
  /** Its bars average over 0.6: the card takes its tint. */
  hot = false
  /** 0..1 of the meter's height. */
  bars: number[] = new Array<number>(BARS).fill(0.0)
  progress = 0.0
  status: string = ""
  /** Rust's private `reading` field, beside the `reading()` method. */
  _reading = 0.0

  constructor(id: number) {
    this.id = id
  }

  name(): string {
    return `Zone ${this.id + 1}`
  }

  /** Changes every frame. */
  reading(): string {
    return fixed(this._reading, 2)
  }

  percent(): string {
    return `${fixed(F(this.progress * 100.0), 0)}%`
  }
}

/**
 * Every size inside a control, from the height of the wall's rows, so a control looks the same
 * from 16 on the wall to a thousand, only smaller.
 */
export type Metrics = {
  /** The scale: 1 is a 100-point-tall control. */
  u: number
  pad: number
  gap: number
  radius: number
  name: number
  reading: number
  small: number
  dot: number
  bar_gap: number
  bars_h: number
  foot_h: number
  track_h: number
  switch_w: number
  switch_h: number
  knob: number
  shadow_y: number
  shadow_blur: number
}

/** Line height for a type size, as both builds set it. */
export function lh(size: number): number {
  return round(F(size * F(1.3)))
}

export const Metrics = {
  for_height(h: number): Metrics {
    const u = F(round(F(Math.min(Math.max(F(h / 100.0), 0.25), 1.5) * 16.0)) / 16.0)
    const [pad, gap, name, reading, small] = [F(7.0 * u), F(4.0 * u), F(11.0 * u), F(16.0 * u), F(10.0 * u)]
    const foot_h = F(12.0 * u)
    const bars_h = Math.max(F(F(F(F(F(h - F(2.0 * pad)) - F(3.0 * gap)) - lh(name)) - lh(reading)) - foot_h), 2.0)
    return {
      u,
      pad,
      gap,
      radius: F(12.0 * u),
      name,
      reading,
      small,
      dot: F(6.0 * u),
      bar_gap: F(3.0 * u),
      bars_h,
      foot_h,
      track_h: F(4.0 * u),
      switch_w: F(22.0 * u),
      switch_h: F(12.0 * u),
      knob: F(10.0 * u),
      shadow_y: F(4.0 * u),
      shadow_blur: F(12.0 * u),
    }
  },
}

// `mix` runs some twenty times per control per frame, so it works on plain 32-bit halves and
// writes its result into `Z` instead of allocating: callers read it before the next call.
const ID_MUL: U64 = u64(0x9e37_79b9_7f4a_7c15n)
const EPOCH_MUL: U64 = u64(0xd6e8_feb8_6659_fd93n)
const MIX_1: U64 = u64(0xbf58_476d_1ce4_e5b9n)
const MIX_2: U64 = u64(0x94d0_49bb_1331_11ebn)

/** The last `mix`: high and low halves of its u64. */
const Z = new Uint32Array(2)
let PH = 0
let PL = 0

/** `a.wrapping_mul(b)` into `PH`, `PL` (as rng.ts's `wrapping_mul`, without the arrays). */
function mul(ah: number, al: number, bh: number, bl: number): void {
  const a0 = al & 0xffff
  const a1 = al >>> 16
  const b0 = bl & 0xffff
  const b1 = bl >>> 16
  const mid = a1 * b0 + a0 * b1 // < 2^33
  const low = a0 * b0 + (mid % 65536) * 65536 // < 2^33
  PH = (a1 * b1 + Math.floor(mid / 65536) + Math.floor(low / 4294967296) + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0
  PL = low >>> 0
}

function mix(seed: U64, id: number, salt: number, epoch: number): Uint32Array {
  // seed ^ (id as u64).wrapping_mul(..) ^ ((salt as u64) << 40) ^ epoch.wrapping_mul(..)
  mul(0, id >>> 0, ID_MUL[0], ID_MUL[1])
  let h = seed[0] ^ PH ^ (salt << 8)
  let l = seed[1] ^ PL
  mul(Math.floor(epoch / 4294967296) >>> 0, epoch >>> 0, EPOCH_MUL[0], EPOCH_MUL[1])
  h = (h ^ PH) >>> 0
  l = (l ^ PL) >>> 0
  // z = (z ^ (z >> 30)).wrapping_mul(..)
  mul((h ^ (h >>> 30)) >>> 0, (l ^ ((l >>> 30) | (h << 2))) >>> 0, MIX_1[0], MIX_1[1])
  h = PH
  l = PL
  // z = (z ^ (z >> 27)).wrapping_mul(..)
  mul((h ^ (h >>> 27)) >>> 0, (l ^ ((l >>> 27) | (h << 5))) >>> 0, MIX_2[0], MIX_2[1])
  h = PH
  l = PL
  // z ^ (z >> 31)
  Z[0] = h ^ (h >>> 31)
  Z[1] = l ^ ((l >>> 31) | (h << 1))
  return Z
}

/** `(x >> 40) as f32 / (1 << 24) as f32`: exact. */
function unit(x: Uint32Array): number {
  return (x[0]! >>> 8) / 16777216
}

/** `x % n` of a u64, for a small `n`. */
function rem(x: Uint32Array, n: number): number {
  return ((x[0]! % n) * (4294967296 % n) + (x[1]! % n)) % n
}

/** `(t / every + phase as f64).max(0.0).floor() as u64`. */
function epoch(t: number, every: number, phase: number): number {
  const v = t / every + phase
  return as_usize(Math.floor(Number.isNaN(v) ? 0.0 : Math.max(v, 0.0)))
}

/** Sorts `ids` by the u64 key `mix` gives each, as `sort_unstable_by_key` does (the keys differ). */
function sort_by_mix(ids: number[], key: (id: number) => Uint32Array): number[] {
  const hi = new Float64Array(ids.length)
  const lo = new Float64Array(ids.length)
  for (const id of ids) {
    const z = key(id)
    hi[id] = z[0]!
    lo[id] = z[1]!
  }
  return ids.sort((a, b) => (hi[a] !== hi[b] ? hi[a]! - hi[b]! : lo[a]! - lo[b]!))
}

/** The wall: its controls at the last `Wall.update`. */
export class Wall {
  #seed: U64
  #cells: Cell[] = []
  /** Ids in the order they flow into the grid, for `order_epoch`. */
  #order: number[] = []
  #order_epoch: [number, number] | null = null
  #wide: boolean[] = []
  #wide_epoch: [number, number] | null = null
  metrics: Metrics = Metrics.for_height(100.0)
  cols = 1
  rows = 1

  private constructor(seed: U64) {
    this.#seed = seed
  }

  static new(seed: bigint): Wall {
    return new Wall(u64(seed))
  }

  /** The controls by id: a control keeps its index for as long as it's on the wall. */
  cells(): readonly Cell[] {
    return this.#cells
  }

  /** Moves the wall to show time `t` with `n` controls. */
  update(t: number, n: number): void {
    const seed = this.#seed
    this.#cells.length = Math.min(this.#cells.length, n)
    while (this.#cells.length < n) {
      this.#cells.push(new Cell(this.#cells.length))
    }
    let e = epoch(t, SHUFFLE, 0.5)
    if (this.#order_epoch?.[0] !== e || this.#order_epoch[1] !== n) {
      this.#order_epoch = [e, n]
      this.#order = sort_by_mix(Array.from({ length: n }, (_, id) => id), (id) => mix(seed, id, 1, e))
    }
    e = epoch(t, WIDE_EVERY, 0.0)
    if (this.#wide_epoch?.[0] !== e || this.#wide_epoch[1] !== n) {
      this.#wide_epoch = [e, n]
      const k = Math.trunc(n / WIDE_SHARE)
      let ids = Array.from({ length: n }, (_, id) => id)
      if (k > 0) {
        // `select_nth_unstable_by_key(k - 1, ..)`: the k smallest keys first, in some order. Only
        // which ids they are matters, so a sort picks the same ones.
        ids = sort_by_mix(ids, (id) => mix(seed, id, 2, e))
      }
      this.#wide = new Array<boolean>(n).fill(false)
      for (const id of ids.slice(0, k)) {
        this.#wide[id] = true
      }
    }
    for (const c of this.#cells) {
      const id = c.id
      const h = (salt: number) => unit(mix(seed, id, salt, 0))
      const eb = epoch(t, 0.16 + 0.3 * h(3), h(4))
      for (let j = 0; j < BARS; j++) {
        c.bars[j] = F(F(0.1) + F(F(0.9) * unit(mix(seed, id, 100 + j, eb))))
      }
      let sum = 0.0
      for (const b of c.bars) sum = F(sum + b)
      const level = F(sum / BARS)
      c.hot = level > F(0.6)
      c.on = unit(mix(seed, id, 5, epoch(t, 0.7 + 1.2 * h(6), h(7)))) < 0.5
      c.hue = HUES[rem(mix(seed, id, 8, epoch(t, 3.0, h(9))), HUES.length)]!
      const p = t * (0.05 + 0.25 * h(10)) + h(11)
      c.progress = F(p - Math.trunc(p))
      c.status = STATUS[rem(mix(seed, id, 12, epoch(t, 1.1, h(13))), STATUS.length)]!
      c._reading = 20.0 + 980.0 * h(14) + t * (1.5 + 30.0 * h(15))
      c.wide = this.#wide[id]!
    }
    this.#flow()
  }

  /**
   * Places the controls in reading order: a wide control takes two columns, or one at a
   * row's end. The rows are sized for `n + n / WIDE_SHARE` slots, so they never overflow.
   */
  #flow(): void {
    const n = this.#cells.length
    const [ax, ay, aw, ah] = area()
    const slots = Math.max(n + Math.trunc(n / WIDE_SHARE), 1)
    const cols = Math.min(Math.max(as_usize(round(F(Math.sqrt(F(F(F(slots) * F(aw / ah)) / ASPECT))))), 1), slots)
    const rows = Math.ceil(slots / cols)
    const gap = Math.min(Math.max(F(10.0 * F(Math.sqrt(F(40.0 / F(slots))))), 3.0), 12.0)
    const cw = F(F(aw - F(gap * (cols - 1))) / cols)
    const ch = F(F(ah - F(gap * (rows - 1))) / rows)
    this.metrics = Metrics.for_height(ch)
    this.cols = cols
    this.rows = rows
    let [col, row] = [0, 0]
    for (const id of this.#order) {
      const c = this.#cells[id]!
      const span = c.wide && col + 2 <= cols ? 2 : 1
      c.rect = [F(ax + F(col * F(cw + gap))), F(ay + F(row * F(ch + gap))), F(F(span * cw) + F((span - 1) * gap)), ch]
      col += span
      if (col >= cols) {
        col = 0
        row += 1
      }
    }
  }
}

// The Rust module's `#[cfg(test)] mod tests` is `cargo test` code, not part of the app
// (docs/porting.md, Limits).
