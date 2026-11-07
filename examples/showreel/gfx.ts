// The compositor: every `El::effect` slot becomes one rune-fx layer. The slot's mark says which
// effect, its `effect_data` carries the effect's few live numbers, and its presented rect and
// radius are the shape. Glass, lenses and shockwaves read a backdrop copy taken at their slot.

import type { Compositor, Frame, Plan, PlanLayer } from "runex-js"
import {
  AuroraParams, ElectricParams, FillParams, FireParams, FlutedGlassParams, Fx, GlowParams, GrainGradientParams, GrainParams,
  LensParams, LiquidMetalParams, MeshGradientParams, PlasticParams, PulseParams, Shape, ShimmerParams, SparkleParams, Stops, rgb,
  type FillStyle, type FireStyle, type FxLayer, type GlowStyle, type PulseStyle, type Rgb,
} from "runex-js/fx"
import type { State } from "./main.ts"

export const CHROME = 1
export const MESH = 2
export const FLUTED = 3
export const FIRE = 4
export const ELECTRIC = 5
export const ARC = 6
export const GLOW = 7
export const SPARKLES = 8
export const SHOCK = 9
export const LENS = 10
export const PLASTIC = 11
export const PULSE = 12
export const SHIMMER = 13
export const GRAIN = 14
export const AURORA = 15
export const HAZE = 16
export const GRAIN_GRADIENT = 17

/** Effect colours, by index (effect data carries the index). */
export const COLORS: readonly number[] = [
  0xffffff, 0x4f8dff, 0x22d3ee, 0x7c5cff, 0x34d399, 0xffb547, 0xff5ca8, 0xff4d4d, 0xff7a1a, 0xf1ece1, 0x2e3036, 0xe8552b,
  0x3d6bff, 0x54b3fd,
]

// ---------------------------------------------------------------- the compositor
//
// Every `El::effect` slot becomes one rune-fx layer. The slot's mark says which effect, its
// `effect_data` carries the effect's few live numbers, and its presented rect and radius are the
// shape. Glass, lenses and shockwaves read a backdrop copy taken at their slot. Rust draws it all
// (runex's "ui" compositor pipeline); this file only plans each frame.

/** `as u32`: truncates, saturating (NaN and negatives are 0). */
function u32(x: number): number {
  return x > 0 ? Math.min(Math.trunc(x), 0xffffffff) : 0
}

function col(i: number): Rgb {
  return rgb(COLORS[Math.min(u32(Math.max(i, 0.0)), COLORS.length - 1)])
}

function fill(style: FillStyle): FillParams {
  // Rust's `Fx::fill(p)` takes `impl Into<FillParams>`: `FillParams::new(FillStyle::X(p))`.
  return FillParams.new(style)
}

function layer(kind: number, d: [number, number, number, number], shape: Shape, t: number): FxLayer | null {
  let fx: Fx
  switch (kind) {
    case CHROME: {
      let p: LiquidMetalParams
      switch (u32(d[0])) {
        case 1: p = LiquidMetalParams.gold(); break
        case 2: p = LiquidMetalParams.rose(); break
        case 3: p = LiquidMetalParams.gunmetal(); break
        case 4: p = Object.assign(LiquidMetalParams.chrome(), { light: rgb(0xd6e8ff), iridescence: 0.3, scale: 240.0, bevel: 3.5, dome: 0.2, contrast: 1.15 }); break
        case 5: p = Object.assign(LiquidMetalParams.chrome(), { scale: 360.0, flow: 0.5, speed: 0.6, dome: 0.8, contrast: 0.85, bevel: 12.0, angle: 0.45 }); break
        default: p = LiquidMetalParams.chrome()
      }
      if (d[2] > 0.0) {
        p.flow = Math.fround(p.flow * d[2])
      }
      if (d[3] > 0.5) {
        p = p.anchor("Element")
      }
      fx = d[1] > 0.0 ? Fx.fill(p.border(d[1])) : Fx.fill(fill({ LiquidMetal: p }))
      break
    }
    case MESH: {
      let p: MeshGradientParams
      switch (u32(d[0])) {
        case 1: p = MeshGradientParams.lagoon(); break
        case 2: p = MeshGradientParams.orchid(); break
        case 3: p = MeshGradientParams.graphite(); break
        case 4: p = Object.assign(MeshGradientParams.dusk(), { colors: Stops.hex([0x0d1b4c, 0x3d6bff, 0x9b5cff, 0x22d3ee, 0x101030]) }); break
        case 5: p = Object.assign(MeshGradientParams.dusk(), { colors: Stops.hex([0x2a0a12, 0xff4d4d, 0xffb547, 0x7a1640, 0xff7a1a]) }); break
        case 6: p = Object.assign(MeshGradientParams.dusk(), { colors: Stops.hex([0x062a24, 0x34d399, 0xd9f99d, 0x0f766e]) }); break
        case 7: p = Object.assign(MeshGradientParams.dusk(), { colors: Stops.hex([0x1a1033, 0xff5ca8, 0x7c5cff, 0xffd1e8, 0x2b1b5a]) }); break
        default: p = MeshGradientParams.dusk()
      }
      if (d[1] > 0.0) {
        p.speed = d[1]
      }
      if (d[3] > 0.0) {
        p.drift = d[3]
      }
      return Fx.on(Fx.fill(fill({ MeshGradient: p })), shape).at(t).seed(u32(d[2]) + 1)
    }
    case FLUTED:
      fx = Fx.fill(fill({ FlutedGlass: Object.assign(FlutedGlassParams.reeded(), { rib: d[0], refraction: d[1], frost: d[2], dispersion: d[3], highlight: 0.55 }) }))
      break
    case FIRE: {
      const style: FireStyle = (["Top", "Border", "Heat", "Embers"] as const)[u32(d[2])] ?? "Top"
      fx = Fx.fire(Object.assign(FireParams.default(), { style, height: d[0], intensity: d[1], smoke: d[3], embers: 24, scale: 26.0 }))
      break
    }
    case ELECTRIC: {
      const base = d[2] > 0.5 ? ElectricParams.charged() : ElectricParams.default()
      fx = Fx.electric(Object.assign(base, { intensity: d[0], amplitude: d[1] > 0.0 ? d[1] : base.amplitude, color: col(d[3]) }))
      break
    }
    case ARC:
      fx = Fx.electric(Object.assign(ElectricParams.default(), { style: { Arc: { a: [d[0], d[1]], b: [d[2], d[3]] } }, amplitude: 9.0, glow: 7.0, intensity: 1.2 }))
      break
    case GLOW: {
      const style: GlowStyle = u32(d[0]) === 1 ? "Neon" : u32(d[0]) === 2 ? "Aura" : "Soft"
      fx = Fx.glow(Object.assign(GlowParams.default(), { style, color: col(d[1]), intensity: d[2], radius: d[3] > 0.0 ? d[3] : 14.0, aura_speed: 0.35 }))
      break
    }
    case SPARKLES:
      fx = Fx.sparkles(Object.assign(SparkleParams.default(), { burst: d[0] >= 0.0 ? d[0] : null, count: u32(d[1]), size: d[2], color: col(d[3]), margin: 26.0 }))
      break
    case SHOCK:
      fx = Fx.distort({ Shockwave: { at: [d[0], d[1]], reach: 1100.0, width: 90.0, amount: d[3], chroma: 0.6, t0: d[2], duration: 1.1 } })
      break
    case LENS:
      fx = Fx.lens(Object.assign(LensParams.default(), {
        second: d[2] > 0.0 ? Shape.circle(d[0], d[1], d[2]) : null,
        frost: d[3],
        bevel: 16.0,
        depth: 20.0,
        dispersion: 0.18,
        magnification: 1.06,
        union_k: 26.0,
      }))
      break
    case PLASTIC:
      fx = Fx.fill(fill({ Plastic: new PlasticParams({ color: col(d[0]), roughness: d[1], dome: d[2], bevel: d[3] > 0.0 ? d[3] : 6.0, angle: -0.6 }) }))
      break
    case PULSE: {
      const style: PulseStyle = u32(d[0]) === 1 ? "Breathe" : u32(d[0]) === 2 ? "Heartbeat" : "Radar"
      fx = Fx.pulse(Object.assign(PulseParams.default(), { style, color: col(d[1]), reach: d[3], period: d[2] > 0.0 ? d[2] : 2.4 }))
      break
    }
    case SHIMMER:
      fx = Fx.shimmer(Object.assign(ShimmerParams.default(), { intensity: d[0], period: d[1], band: d[2] }))
      break
    case GRAIN:
      fx = Fx.grain(new GrainParams({ amount: d[0], fps: d[1] }))
      break
    case AURORA:
      fx = Fx.aurora(Object.assign(AuroraParams.default(), { intensity: d[0], speed: d[1] }))
      break
    case HAZE:
      fx = Fx.distort({ HeatHaze: { height: d[0], scale: 14.0, speed: 1.4, amount: d[1], whole_shape: d[2] > 0.5 } })
      break
    case GRAIN_GRADIENT:
      fx = Fx.fill(fill({ GrainGradient: Object.assign(GrainGradientParams.default(), { kind: "Radial" as const, colors: Stops.hex([0x1b1530, 0x0a0a0c]), amount: 0.12 }) }))
      break
    default:
      return null
  }
  return Fx.on(fx, shape).at(t)
}

export class Gfx implements Compositor<State> {
  readonly pipeline = "ui"
  // `FxRenderer::new(device, format, FxOptions { dither: true })` with `set_fire_sim(device, true)`.
  readonly dither = true
  readonly fire_sim = true

  render(f: Frame<State>): Plan {
    const t = Math.fround(f.t)
    const layers: PlanLayer[] = []
    for (const s of f.slots()) {
      const kind = s.mark & 0xff
      const k = s.scale
      const [x, y, w, h] = s.rect.map((v) => Math.fround(v / k))
      const r = Math.fround(s.radii.reduce((a, v) => Math.max(a, Math.abs(v)), 0.0) / k)
      const l = layer(kind, s.data, Shape.rounded(x, y, w, h, r), t)
      if (!l) continue
      layers.push({ layer: l, at: { slot: s.index } })
    }
    return { layers, animating: true }
  }
}
