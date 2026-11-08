// Rust's number formatting, parsing and float-to-integer casts, where JavaScript's differ. The
// chaos crate and the bento print and parse with Rust's std; these keep every string and every
// index the same. Not a Rust module: the crate gets these from std.

/**
 * `format!("{:.p$}", x)` of an f32 or f64 (an f32 is exact as a JavaScript number): the exact
 * value rounded to `p` decimals. Rust rounds an exact tie to even where `toFixed` rounds it away
 * from zero, keeps the sign of a negative zero (`-0.0`) and writes `inf`, `-inf` and `NaN`.
 */
export function fixed(x: number, p: number): string {
  if (Number.isNaN(x)) return "NaN"
  if (x === Infinity) return "inf"
  if (x === -Infinity) return "-inf"
  const sign = x < 0 || Object.is(x, -0) ? "-" : ""
  const a = Math.abs(x)
  // At 1e21 and up `toFixed` turns to exponent form; such a double is an integer, digits exact.
  if (a >= 1e21) return sign + BigInt(a).toString() + (p > 0 ? `.${"0".repeat(p)}` : "")
  const rounded = a.toFixed(p)
  // Every double at or above 2^-48 has at most 100 decimals, so this is its exact value; one
  // below can't be a tie at the few decimals formatted here.
  const exact = a.toFixed(100)
  const point = exact.indexOf(".")
  const after = exact.slice(point + 1)
  const tie = after[p] === "5" && /^0*$/.test(after.slice(p + 1))
  if (!tie) return sign + rounded
  const kept = p === 0 ? exact.slice(0, point) : exact.slice(0, point + 1 + p)
  const last = Number(kept[kept.length - 1])
  return sign + (last % 2 === 0 ? kept : rounded)
}

/**
 * `format!("{}", x)` of an f64: the shortest digits that read back as `x`, as JavaScript's
 * `String(x)` picks them, but never in exponent form, with `-0`, `inf`, `-inf` and `NaN`.
 */
export function display(x: number): string {
  if (Number.isNaN(x)) return "NaN"
  if (x === Infinity) return "inf"
  if (x === -Infinity) return "-inf"
  if (Object.is(x, -0)) return "-0"
  const s = String(x)
  const e = s.indexOf("e")
  if (e === -1) return s
  const sign = s.startsWith("-") ? "-" : ""
  const mantissa = s.slice(sign.length, e)
  const exp = Number(s.slice(e + 1))
  const dot = mantissa.indexOf(".")
  const digits = mantissa.replace(".", "")
  const point = (dot === -1 ? mantissa.length : dot) + exp
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length)
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/** `s.parse::<f64>()`: Rust's grammar (no whitespace, no hex, `inf`/`infinity`/`nan` in any case); `null` on an error. */
export function parse_f64(s: string): number | null {
  const m = /^([+-]?)(?:(inf|infinity)|(nan)|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))$/i.exec(s)
  if (!m) return null
  const neg = m[1] === "-"
  if (m[2] !== undefined) return neg ? -Infinity : Infinity
  if (m[3] !== undefined) return NaN
  const v = Number(m[4])
  return neg ? -v : v
}

/**
 * `s.parse::<f32>()`. Rounds the decimal through an f64 first, which can differ from Rust's
 * direct rounding only for a decimal within 2^-53 of the midpoint between two f32s.
 */
export function parse_f32(s: string): number | null {
  const v = parse_f64(s)
  return v === null ? null : Math.fround(v)
}

const U64_MAX = (1n << 64n) - 1n

/** `s.parse::<u64>()`: digits with an optional `+`, at most `u64::MAX`; `null` on an error. */
export function parse_u64(s: string): bigint | null {
  if (!/^\+?\d+$/.test(s)) return null
  const v = BigInt(s.startsWith("+") ? s.slice(1) : s)
  return v > U64_MAX ? null : v
}

/** `s.parse::<usize>()` (a 64-bit usize), as a number: exact up to 2^53, which no count here reaches. */
export function parse_usize(s: string): number | null {
  const v = parse_u64(s)
  return v === null ? null : Number(v)
}

/** `x.round()`: half away from zero (`Math.round` takes a negative half up). */
export function round(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

/** `a.max(b)` of floats: a NaN gives the other argument, where `Math.max` gives NaN. */
export function fmax(a: number, b: number): number {
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return Math.max(a, b)
}

/** `a.min(b)` of floats: a NaN gives the other argument, where `Math.min` gives NaN. */
export function fmin(a: number, b: number): number {
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return Math.min(a, b)
}

/** `x as usize` (and `as u64`) of a float: toward zero, saturating, NaN to 0. */
export function as_usize(x: number): number {
  if (Number.isNaN(x) || x <= 0) return 0
  return Math.min(Math.trunc(x), 18446744073709551615)
}

/** `x as u32` of a float: toward zero, saturating, NaN to 0. */
export function as_u32(x: number): number {
  if (Number.isNaN(x) || x <= 0) return 0
  return Math.min(Math.trunc(x), 4294967295)
}

/**
 * `a.total_cmp(&b)` for the values sorted here: `-0` before `+0`, and NaN (positive, as Rust
 * parses and prints it) after everything.
 */
export function total_cmp(a: number, b: number): number {
  const an = Number.isNaN(a)
  const bn = Number.isNaN(b)
  if (an || bn) return an === bn ? 0 : an ? 1 : -1
  if (a < b) return -1
  if (a > b) return 1
  if (a === 0 && b === 0) return (Object.is(a, -0) ? 0 : 1) - (Object.is(b, -0) ? 0 : 1)
  return 0
}

/** `slice.partition_point(pred)`: the first index where `pred` turns false (`pred` true, then false). */
export function partition_point<T>(v: readonly T[], pred: (x: T) => boolean): number {
  let lo = 0
  let hi = v.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (pred(v[mid]!)) lo = mid + 1
    else hi = mid
  }
  return lo
}
