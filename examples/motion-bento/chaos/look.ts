// The look both builds share: colours as OKLCH, the grid's measurements, and the springs, as
// perceptual duration and bounce (SwiftUI's `Spring(duration:bounce:)`).
//
// Port of vendor/rune/examples/motion-bento/chaos/src/look.rs. Every field is an f32 in Rust, so
// values are rounded to f32 where they're made and after each step of arithmetic (`F`).

const F = Math.fround

/** `x.to_radians()` of an f32: `x * (PI / 180.0)`, all in f32. */
export function to_radians(x: number): number {
  return F(x * F(F(Math.PI) / 180.0))
}

/** An OKLCH colour with alpha. */
export class Lch {
  declare l: number
  declare c: number
  declare h: number
  declare a: number

  constructor(init: { l: number; c: number; h: number; a: number }) {
    this.l = F(init.l)
    this.c = F(init.c)
    this.h = F(init.h)
    this.a = F(init.a)
  }

  alpha(a: number): Lch {
    return new Lch({ ...this, a })
  }

  /** OKLab (L, a, b): the space both builds interpolate colour in. */
  lab(): [number, number, number] {
    const h = to_radians(this.h)
    return [this.l, F(this.c * F(Math.cos(h))), F(this.c * F(Math.sin(h)))]
  }

  /** Gamma-encoded sRGB, clamped to the gamut, with alpha. */
  srgb(): [number, number, number, number] {
    const [r, g, b] = lab_to_linear(this.lab())
    return [encode(r), encode(g), encode(b), this.a]
  }
}

export function lch(l: number, c: number, h: number): Lch {
  return new Lch({ l, c, h, a: 1.0 })
}

export function lab_to_linear([l, a, b]: [number, number, number]): [number, number, number] {
  const l_ = F(F(l + F(F(0.396_337_78) * a)) + F(F(0.215_803_76) * b))
  const m_ = F(F(l - F(F(0.105_561_346) * a)) - F(F(0.063_854_17) * b))
  const s_ = F(F(l - F(F(0.089_484_18) * a)) - F(F(1.291_485_5) * b))
  const [l3, m3, s3] = [F(F(l_ * l_) * l_), F(F(m_ * m_) * m_), F(F(s_ * s_) * s_)]
  return [
    F(F(F(F(4.076_741_7) * l3) - F(F(3.307_711_6) * m3)) + F(F(0.230_969_94) * s3)),
    F(F(F(F(-1.268_438) * l3) + F(F(2.609_757_4) * m3)) - F(F(0.341_319_38) * s3)),
    F(F(F(F(-0.004_196_086_3) * l3) - F(F(0.703_418_6) * m3)) + F(F(1.707_614_7) * s3)),
  ]
}

/** Linear to gamma-encoded sRGB, clamped to 0..1. */
export function encode(x: number): number {
  x = Math.min(Math.max(x, 0.0), 1.0)
  return x <= F(0.003_130_8) ? F(F(12.92) * x) : F(F(F(1.055) * F(Math.pow(x, F(1.0 / F(2.4))))) - F(0.055))
}

const ACCENT_HUE = 245.0

export const color = {
  ACCENT_HUE,
  BG: lch(0.155, 0.012, 260.0),
  TILE: lch(0.205, 0.014, 258.0),
  TILE_FOCUS: lch(0.235, 0.022, 252.0),
  EDGE: lch(1.0, 0.0, 0.0).alpha(0.07),
  WELL: lch(0.255, 0.014, 258.0),
  WELL_HI: lch(0.31, 0.016, 258.0),
  TEXT: lch(0.96, 0.005, 258.0),
  TEXT_2: lch(0.72, 0.012, 258.0),
  TEXT_3: lch(0.54, 0.014, 258.0),
  ACCENT: lch(0.66, 0.17, ACCENT_HUE),
  ACCENT_DIM: lch(0.66, 0.17, ACCENT_HUE).alpha(0.18),
  ON_ACCENT: lch(0.99, 0.0, 0.0),
  GOOD: lch(0.74, 0.15, 155.0),
  WARM: lch(0.78, 0.14, 70.0),

  /** Each scene's mood: its swatch, and the glow it casts on the header. */
  SCENE: [
    lch(0.66, 0.17, ACCENT_HUE),
    lch(0.74, 0.13, 175.0),
    lch(0.78, 0.14, 70.0),
    lch(0.6, 0.17, 295.0),
  ] as const,
} as const

/** The window and the grid, in points. */
export const grid = {
  WIDTH: 1440.0,
  HEIGHT: 900.0,
  PAD: 28.0,
  GAP: 14.0,
  HEADER: 64.0,
  RADIUS: 18.0,
  TILE_PAD: 18.0,
  /** Row heights below the header; the dock row takes what's left. */
  ROW1: 236.0,
  ROW2: 262.0,
  /** The focused dock tile's share of the row against 1 for each other tile. */
  DOCK_FOCUS: F(2.4),
} as const

/** A spring as perceptual duration (seconds) and bounce, mass 1. */
export class Spring {
  declare duration: number
  declare bounce: number

  constructor(init: { duration: number; bounce: number }) {
    this.duration = F(init.duration)
    this.bounce = F(init.bounce)
  }

  static new(duration: number, bounce: number): Spring {
    return new Spring({ duration, bounce })
  }

  /** ω = 2π / duration. */
  omega(): number {
    return F(F(2 * Math.PI) / this.duration)
  }

  /** ζ = 1 − bounce (≥ 0), 1 / (1 + bounce) below. */
  zeta(): number {
    return this.bounce >= 0.0 ? F(1.0 - this.bounce) : F(1.0 / F(1.0 + this.bounce))
  }

  /** k = ω². */
  stiffness(): number {
    return F(this.omega() * this.omega())
  }

  /** c = 2ζω. */
  damping(): number {
    return F(F(2.0 * this.zeta()) * this.omega())
  }
}

/** The springs each kind of motion uses. */
export type Springs = {
  /** Tiles reflowing, cards and feed rows moving. */
  layout: Spring
  /** Controls: switches, segments, chips filling. */
  snap: Spring
  /** Shape and colour changes. */
  morph: Spring
  /** Things arriving with a little life. */
  pop: Spring
  /** The XY pad's puck and the mixer's faders. */
  travel: Spring
}

export const Springs = {
  /** `default` is the shipped tuning. `bouncy` and `stiff` exist for A/B runs. */
  variant(name: string): Springs {
    const base: Springs = {
      layout: Spring.new(0.4, 0.0),
      snap: Spring.new(0.25, 0.0),
      morph: Spring.new(0.3, 0.16),
      pop: Spring.new(0.25, 0.15),
      travel: Spring.new(0.35, 0.12),
    }
    switch (name) {
      case "bouncy":
        return {
          layout: Spring.new(0.5, 0.28),
          snap: Spring.new(0.3, 0.22),
          morph: Spring.new(0.45, 0.35),
          pop: Spring.new(0.35, 0.35),
          travel: Spring.new(0.5, 0.35),
        }
      case "stiff":
        return {
          layout: Spring.new(0.22, 0.0),
          snap: Spring.new(0.15, 0.0),
          morph: Spring.new(0.18, 0.0),
          pop: Spring.new(0.15, 0.0),
          travel: Spring.new(0.2, 0.0),
        }
      default:
        return base
    }
  },
}

// The Rust module's `#[cfg(test)] mod tests` is `cargo test` code, not part of the app
// (docs/porting.md, Limits).
