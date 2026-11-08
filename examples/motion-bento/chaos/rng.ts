// SplitMix64: tiny, fast and identical on every platform, so a seed names one show everywhere.
//
// Port of vendor/rune/examples/motion-bento/chaos/src/rng.rs. A JavaScript number can't hold a
// u64, so a u64 here is its two unsigned 32-bit halves, and the helpers below are Rust's wrapping
// u64 arithmetic on them, bit for bit (BigInt would be exact too, and much slower). The stress
// wall's hash (stress.ts) does the same arithmetic on plain numbers, since it runs some twenty
// times per control per frame.

import { as_u32, as_usize } from "./fmt.ts"

/** A u64 as its high and low halves, each an unsigned 32-bit integer. */
export type U64 = [hi: number, lo: number]

const TWO32 = 4294967296

export function u64(x: bigint): U64 {
  return [Number((x >> 32n) & 0xffff_ffffn), Number(x & 0xffff_ffffn)]
}

export function u64_bigint([hi, lo]: U64): bigint {
  return (BigInt(hi) << 32n) | BigInt(lo)
}

/** `a ^ b`. */
export function xor(a: U64, b: U64): U64 {
  return [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0]
}

/** `a.wrapping_add(b)`. */
export function wrapping_add(a: U64, b: U64): U64 {
  const lo = a[1] + b[1]
  return [(a[0] + b[0] + (lo >= TWO32 ? 1 : 0)) >>> 0, lo >>> 0]
}

/** `a.wrapping_mul(b)`: the low 64 bits of the product, from 16-bit partial products that stay exact. */
export function wrapping_mul(a: U64, b: U64): U64 {
  const [ah, al] = a
  const [bh, bl] = b
  const a0 = al & 0xffff
  const a1 = al >>> 16
  const b0 = bl & 0xffff
  const b1 = bl >>> 16
  const mid = a1 * b0 + a0 * b1 // < 2^33
  const low = a0 * b0 + (mid % 65536) * 65536 // < 2^33
  const hi = a1 * b1 + Math.floor(mid / 65536) + Math.floor(low / TWO32) + Math.imul(ah, bl) + Math.imul(al, bh)
  return [hi >>> 0, low >>> 0]
}

/** `z ^ (z >> s)`, for 0 < s < 32. */
export function xor_shr(z: U64, s: number): U64 {
  const [hi, lo] = z
  return [(hi ^ (hi >>> s)) >>> 0, (lo ^ ((lo >>> s) | (hi << (32 - s)))) >>> 0]
}

const GOLDEN: U64 = u64(0x9e37_79b9_7f4a_7c15n)
const MIX_1: U64 = u64(0xbf58_476d_1ce4_e5b9n)
const MIX_2: U64 = u64(0x94d0_49bb_1331_11ebn)

export class Rng {
  #state: U64

  private constructor(state: U64) {
    this.#state = state
  }

  static new(seed: bigint): Rng {
    return new Rng(xor(u64(BigInt.asUintN(64, seed)), GOLDEN))
  }

  next_u64(): bigint {
    return u64_bigint(this.#next())
  }

  #next(): U64 {
    this.#state = wrapping_add(this.#state, GOLDEN)
    let z = this.#state
    z = wrapping_mul(xor_shr(z, 30), MIX_1)
    z = wrapping_mul(xor_shr(z, 27), MIX_2)
    return xor_shr(z, 31)
  }

  /** Uniform in [0, 1). */
  f64(): number {
    const [hi, lo] = this.#next()
    // (z >> 11) as f64 / (1 << 53) as f64: both exact.
    return (hi * 2097152 + (lo >>> 11)) / 9007199254740992
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.f64()
  }

  rangef(lo: number, hi: number): number {
    return Math.fround(this.range(Math.fround(lo), Math.fround(hi)))
  }

  /** Uniform in 0..n. */
  below(n: number): number {
    return Math.min(as_usize(this.f64() * n), Math.max(n - 1, 0))
  }

  /** An index into `weights`, chosen in proportion to them. */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((a, w) => a + w, 0)
    let pick = as_u32(this.f64() * total)
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]!
      if (pick < w) {
        return i
      }
      pick -= w
    }
    return weights.length - 1
  }

  clone(): Rng {
    return new Rng([...this.#state])
  }
}

// The Rust module's `#[cfg(test)] mod tests` (a_seed_names_one_sequence) is `cargo test` code,
// not part of the app (docs/porting.md, Limits).
