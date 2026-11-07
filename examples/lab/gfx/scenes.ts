// Per-scene lights, rune-light material primitives and rune-fx layers.

import { color } from "runex-js"
import {
  AuroraParams, DistortParams, ElectricParams, FireParams, Fx, type FxLayer, GlowParams, GrainParams, Heat,
  LensParams, PulseParams, Shape, ShimmerParams, SparkleParams, rgb,
} from "runex-js/fx"
import { Gi, Light, Settings, TextPolicy } from "runex-js/light"
import { Animated, Spring, type Vec2 } from "runex-js/motion"
import { LAMP_COLORS, lin } from "../knobs.ts"
import type { Shot } from "../main.ts"
import * as stage from "../stage.ts"
import { node } from "../stage.ts"
import { type Anchor, type Cv, type Lay, SRC_MASK } from "../gfx.ts"

// Rust's f32 math rounds every step.
const f32 = Math.fround
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
/** `f32::round`: half away from zero (`Math.round` rounds half up). */
const round = (v: number) => Math.sign(v) * Math.round(Math.abs(v))
/** `as u32`: truncates and saturates (NaN is 0). */
const u32 = (v: number) => (v > 0 ? Math.min(Math.trunc(v), 0xffffffff) : 0)
/** `as usize` (for an index). */
const usize = (v: number) => (v > 0 ? Math.trunc(v) : 0)
const TAU = f32(2 * Math.PI)

/** Rust's `&mut bool` out-parameter: `*anim |= x` is `anim.value ||= x`. */
export type Flag = { value: boolean }

/** A light that follows the pointer 1:1 while it's over the stage and cools when it leaves. */
class Follow {
  pos: [number, number]
  /** `Animated<f32>`. */
  k: Animated
  inside: boolean | null

  constructor(pos: [number, number], k: Animated, inside: boolean | null) {
    this.pos = pos
    this.k = k
    this.inside = inside
  }

  static new(rest: readonly [number, number]): Follow {
    return new Follow([rest[0], rest[1]], Animated.new(1.0), null)
  }

  update(p: readonly [number, number] | null, now: number): [[number, number], number] {
    if (p !== null) {
      this.pos = [p[0], p[1]]
      if (this.inside !== true) {
        this.k.animate_to(1.0, Spring.new(0.3, 0.0), now)
        this.inside = true
      }
    } else if (this.inside === true) {
      this.k.animate_to(0.0, Spring.new(0.45, 0.0), now)
      this.inside = false
    }
    return [[this.pos[0], this.pos[1]], clamp(this.k.sample(now), 0.0, 1.0)]
  }

  moving(now: number): boolean {
    return !this.k.is_settled(now)
  }
}

/** A light switched by state: it warms up fast and cools slowly. */
class Switch {
  on: boolean | null
  heat: Heat

  constructor(on: boolean | null, heat: Heat) {
    this.on = on
    this.heat = heat
  }

  static new(attack: number, cool: number): Switch {
    return new Switch(null, Heat.new(attack, cool))
  }

  at(on: boolean, t: number): number {
    if (this.on !== on) {
      // The first sight is the resting state, not a warm-up.
      this.heat.set(this.on === null ? -10.0 : t, on)
      this.on = on
    }
    return this.heat.at(t)
  }

  moving(t: number): boolean {
    return (this.heat.is_active(t) && this.on === false) || (this.on === true && this.heat.at(t) < f32(0.999))
  }
}

/** Per-scene material inputs for prims. */
export class PrimCx {
  keys: number[] = []
  bevel = 0.0
  gloss = 0.0
  rec = 0.0
  status = 0.0
  progress = 0.0

  static default(): PrimCx {
    return new PrimCx()
  }
}

function srgbf(r: number, g: number, b: number): [number, number, number] {
  const f = color.srgb_decode
  return [f(r), f(g), f(b)]
}

// `prim(ins, material, nd, pc, s)` (a Rune instance → its rune-light `Prim`, by material) is
// `prims(pc, s)` in ../gfx.ts: material rules the compositor applies to each lit rect.

export class Live {
  torch: Follow
  keylight: Follow
  sun: Follow
  neon: Switch
  charged: Switch
  rec: Switch
  upload: Switch
  /** `Option<Animated<Vec2>>`. */
  droplet: Animated | null

  constructor() {
    this.torch = Follow.new([470.0, 250.0])
    this.keylight = Follow.new([150.0, 230.0])
    this.sun = Follow.new(stage.GODRAY_REST)
    this.neon = Switch.new(0.12, 0.32)
    this.charged = Switch.new(0.15, 0.5)
    this.rec = Switch.new(0.12, 0.6)
    this.upload = Switch.new(0.12, 0.6)
    this.droplet = null
  }

  static default(): Live {
    return new Live()
  }

  /** Lights for a lit canvas (appended, scaled by its presence) and its settings. */
  lights(cv: Cv, out: Light[], pc: PrimCx, anim: Flag): Settings {
    const s = cv.scale
    const [t, now] = [cv.t, cv.now]
    switch (cv.sc) {
      case "Lamp": {
        const p = cv.px(cv.s.lamp)
        const col = lin(LAMP_COLORS[Math.min(usize(cv.k("color")), LAMP_COLORS.length - 1)])
        out.push(
          Light.point(p[0], p[1], f32(cv.k("height") * s))
            .color(col)
            .intensity(cv.k("intensity"))
            .radius(f32(cv.k("radius") * s))
            .range(f32(1100.0 * s))
            .bulb(0.75)
            .specular(1.2)
            .scaled(cv.a),
        )
        if (cv.on("fill")) {
          const q = cv.px([-300.0, -200.0])
          out.push(Light.point(q[0], q[1], f32(900.0 * s)).color(srgbf(0.55, 0.65, 1.0)).intensity(0.35).radius(f32(220.0 * s)).range(f32(6000.0 * s)).specular(0.4).scaled(cv.a))
        }
        return new Settings({
          ambient: [0.62, 0.63, 0.7],
          albedo_floor: 0.07,
          gi: cv.on("bounce") ? new Gi({ strength: 1.0, air: 0.0, bounce: 0.6, absorption: 0.24 }) : null,
          rim: 0.9,
          contact_ao: 0.45,
        })
      }
      case "Flashlight": {
        const [p, k] = this.torch.update(cv.pointer, now)
        anim.value ||= this.torch.moving(now)
        const h = cv.k("height")
        const lp: [number, number] = [f32(p[0] + 80.0), f32(p[1] + 130.0)]
        const [a, b] = [cv.px(p), cv.px(lp)]
        const axis = [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(-h * s)]
        out.push(
          Light.point(b[0], b[1], f32(h * s))
            .color(srgbf(1.0, 0.95, 0.88))
            .intensity(cv.k("intensity"))
            .radius(f32(cv.k("radius") * s))
            .range(f32(1800.0 * s))
            .spot(axis, cv.k("beam"))
            .specular(1.4)
            .scaled(f32(cv.a * k)),
        )
        const am = cv.k("ambient")
        return new Settings({
          ambient: [am, f32(am * f32(1.07)), f32(am * f32(1.28))],
          albedo_floor: 0.04,
          text: new TextPolicy({ floor: 0.32, ceiling: 1.3, lit: 1.0, specular: 0.1 }),
          rim: 1.0,
          contact_ao: 0.3,
          background_gloss: 0.5,
        })
      }
      case "Gi": {
        const b = cv.reduced ? 1.0 : f32(f32(0.775) + f32(f32(0.225) * f32(Math.sin(f32(f32(TAU * t) / f32(2.2))))))
        anim.value ||= !cv.reduced
        const e = cv.k("emission")
        const rec = this.rec.at(cv.s.recording, t)
        const up = this.upload.at(cv.s.uploading, t)
        anim.value ||= this.rec.moving(t) || this.upload.moving(t)
        pc.rec = f32(f32(f32(7.0 * b) * rec) * e)
        pc.status = f32(f32(f32(2.2) * f32(f32(0.6) + f32(f32(0.4) * b))) * e)
        pc.progress = f32(f32(f32(f32(1.9) * f32(f32(0.85) + f32(f32(0.15) * b))) * up) * e)
        const am = cv.k("ambient")
        return new Settings({
          ambient: [am, f32(am * f32(1.03)), f32(am * f32(1.17))],
          gi: cv.on("gi") ? new Gi({ strength: cv.k("strength"), air: cv.k("air"), bounce: cv.k("bounce"), absorption: 0.24 }) : null,
          contact_ao: 0.4,
          rim: 0.6,
        })
      }
      case "Keys": {
        const [p, k] = this.keylight.update(cv.pointer, now)
        anim.value ||= this.keylight.moving(now)
        pc.keys = cv.s.keys.map((a) => a.sample(now))
        anim.value ||= cv.s.keys.some((a) => !a.is_settled(now))
        pc.bevel = cv.k("bevel")
        pc.gloss = cv.k("gloss")
        const q = cv.px(p)
        out.push(
          Light.point(q[0], q[1], f32(cv.k("height") * s))
            .color(srgbf(1.0, 0.93, 0.85))
            .intensity(3.4)
            .radius(f32(cv.k("radius") * s))
            .range(f32(2200.0 * s))
            .specular(2.4)
            .scaled(f32(cv.a * k)),
        )
        if (cv.on("fill")) {
          const q = cv.px([1100.0, 760.0])
          out.push(Light.point(q[0], q[1], f32(700.0 * s)).color(srgbf(0.5, 0.62, 1.0)).intensity(0.4).radius(f32(200.0 * s)).range(f32(5000.0 * s)).specular(0.6).scaled(cv.a))
        }
        return new Settings({ ambient: [0.3, 0.31, 0.34], rim: 1.1, contact_ao: 0.5 })
      }
      case "GodRays": {
        const [p, k] = this.sun.update(cv.pointer, now)
        anim.value ||= this.sun.moving(now)
        const q = cv.px(p)
        out.push(
          Light.point(q[0], q[1], f32(cv.k("height") * s))
            .color(srgbf(1.0, 0.8, 0.55))
            .intensity(cv.k("intensity"))
            .radius(f32(12.0 * s))
            .range(f32(3000.0 * s))
            .shafts(cv.k("shafts"))
            .softness(cv.k("softness"))
            .scaled(f32(cv.a * k)),
        )
        return new Settings({ ambient: [0.5, 0.5, 0.58], shafts_over: 0.12, rim: 0.8, contact_ao: 0.35 })
      }
      default:
        return new Settings()
    }
  }

  /** Effect layers for an effects canvas, anchored to the nodes they decorate. */
  layers(cv: Cv, out: Lay[], anim: Flag): void {
    const t = cv.t
    const sc = cv.sc
    const push = (layer: FxLayer, anchor: Anchor) => { out.push({ layer: layer.at(t), scene: sc, anchor }) }
    switch (sc) {
      case "Glow": {
        const [r, i, br, rim, hot] = [f32(cv.k("radius") / 14.0), f32(cv.k("intensity") * cv.a), cv.k("breathe"), cv.k("rim_width"), cv.k("hot")]
        const color = cv.swatch()
        push(
          Fx.on(
            Fx.glow(Object.assign(GlowParams.default(), { radius: f32(16.0 * r), intensity: f32(f32(0.85) * i), breathe: Math.max(br, f32(0.4)), breathe_period: 2.6, hot: f32(f32(f32(0.4) * hot) / f32(0.6)) })),
            cv.capsule(stage.GLOW_BTN),
          ),
          { Under: node.GLOW_BUTTON },
        )
        const heat = this.neon.at(cv.s.neon_on, t)
        anim.value ||= this.neon.moving(t)
        push(
          Fx.on(
            Fx.glow(Object.assign(GlowParams.default(), {
              style: "Neon",
              color: rgb(color),
              core: rgb(0xeafcff),
              radius: f32(10.0 * r),
              intensity: i,
              inner: 0.35,
              heat,
              hot: Math.min(f32(f32(f32(0.9) * hot) / f32(0.6)), 1.0),
              rim_width: f32(f32(rim * f32(0.55)) / f32(0.6)),
              breathe: br,
            } as const)),
            cv.rounded(stage.NEON, 16.0),
          )
            .over(),
          { Over: node.NEON },
        )
        push(
          Fx.on(
            Fx.glow(Object.assign(GlowParams.default(), {
              style: "Aura",
              color: rgb(0xff5fa2),
              core: rgb(0x8b5cf6),
              third: rgb(0x38bdf8),
              radius: f32(12.0 * r),
              intensity: f32(f32(0.9) * i),
              inner: 0.55,
              hot: 0.55,
              aura_speed: 0.15,
              rim_width: rim,
              occlusion: 0.1,
            } as const)),
            cv.capsule(stage.AURA),
          )
            .over(),
          { Over: node.AURA },
        )
        push(
          Fx.on(
            Fx.glow(Object.assign(GlowParams.default(), {
              style: "Mask",
              color: rgb(0xff8a2a),
              core: rgb(0xfff1d6),
              radius: f32(10.0 * r),
              intensity: f32(f32(1.1) * i),
              hot: 0.0,
              breathe: Math.max(br, 0.25),
              breathe_period: 3.2,
            } as const)),
            cv.rounded(stage.GLOW_TEXT, 0.0),
          )
            .source(SRC_MASK, cv.viewport),
          { Under: node.GLOW_TEXT },
        )
        push(
          Fx.on(
            Fx.glow(Object.assign(GlowParams.default(), { color: rgb(0xffa630), core: rgb(0xfff6e0), radius: f32(9.0 * r), intensity: f32(f32(1.3) * i), hot: Math.min(f32(hot / f32(0.6)), 1.0), breathe: br })),
            cv.circle(stage.HOT_DOT),
          ),
          { Under: node.HOT_DOT },
        )
        break
      }
      case "Pulses": {
        const [reach, width, period, count, i] = [cv.k("reach"), cv.k("width"), cv.k("period"), u32(round(cv.k("count"))), f32(cv.k("intensity") * cv.a)]
        const color = rgb(cv.swatch())
        push(
          Fx.on(
            Fx.pulse(Object.assign(PulseParams.default(), { color, core: rgb(0xffffff), reach: f32(f32(reach * 46.0) / 36.0), width: f32(f32(width * f32(1.3)) / f32(1.6)), period: f32(f32(period * f32(2.2)) / f32(2.4)), count, intensity: i })),
            cv.circle(stage.RADAR),
          ),
          { Under: node.RADAR },
        )
        push(
          Fx.on(
            Fx.pulse(Object.assign(PulseParams.default(), { style: "Breathe", color: rgb(0x34d399), core: rgb(0xd1fae5), reach: 12.0, period: 2.8, intensity: f32(f32(0.8) * i) } as const)),
            cv.circle(stage.AVATAR),
          ),
          { Under: node.AVATAR },
        )
        push(
          Fx.on(
            Fx.pulse(Object.assign(PulseParams.default(), { style: "Heartbeat", color: rgb(0xff3b6b), core: rgb(0xffe4ec), reach: 26.0, width: 1.1, period: 1.1, intensity: i } as const)),
            cv.capsule(stage.LIVE),
          ),
          { Under: node.LIVE },
        )
        for (const [shot, k] of cv.s.shots.live(t, 3.0)) {
          const sh: Shot = shot.data
          const push_k = (layer: FxLayer, anchor: Anchor) => push(layer.opacity(k), anchor)
          switch (sh.kind) {
            case "Ripple":
              push_k(
                Fx.on(
                  Fx.pulse(Object.assign(PulseParams.default(), {
                    style: { Ripple: { at: cv.w(sh.at) } },
                    color,
                    core: rgb(0xffffff),
                    reach: f32(reach * 6.0),
                    width: f32(f32(f32(2.2) * width) / f32(1.6)),
                    t0: sh.t0,
                    duration: 0.9,
                    intensity: f32(f32(0.7) * i),
                  })),
                  cv.everywhere(),
                )
                  .over(),
                "Top",
              )
              break
            case "RippleCard":
              push_k(
                Fx.on(
                  Fx.pulse(Object.assign(PulseParams.default(), { style: { Ripple: { at: cv.w(sh.at) } }, color, core: rgb(0xffffff), reach: 0.0, width: 2.2, t0: sh.t0, duration: 0.9, intensity: f32(f32(0.7) * i) })),
                  cv.rounded(stage.INBOX, 16.0),
                )
                  .over(),
                { Over: node.INBOX },
              )
              break
            case "Ping": {
              const from: [number, number] = [f32(stage.SEND[0] + stage.SEND[2]), stage.SEND[1]]
              const to: [number, number] = [f32(stage.INBOX.x + 6.0), f32(stage.INBOX.y + f32(stage.INBOX.h * 0.5))]
              const d = [f32(to[0] - from[0]), f32(to[1] - from[1])]
              const len = f32(Math.hypot(d[0], d[1]))
              push_k(
                Fx.on(
                  Fx.pulse(Object.assign(PulseParams.default(), {
                    style: { Ping: { from: cv.w(from), dir: [f32(d[0] / len), f32(d[1] / len)], travel: len } },
                    color,
                    core: rgb(0xf0f7ff),
                    t0: sh.t0,
                    duration: stage.PING_DURATION,
                    lag: 0.16,
                    head_radius: 2.6,
                    intensity: i,
                  })),
                  cv.circle(stage.SEND),
                ),
                "Top",
              )
              push_k(
                Fx.on(
                  Fx.pulse(Object.assign(PulseParams.default(), {
                    style: { Ripple: { at: cv.w(to) } },
                    color,
                    core: rgb(0xffffff),
                    reach: 0.0,
                    width: 2.2,
                    t0: f32(sh.t0 + stage.PING_DURATION),
                    duration: 0.9,
                    intensity: f32(f32(0.7) * i),
                  })),
                  cv.rounded(stage.INBOX, 16.0),
                )
                  .over(),
                { Over: node.INBOX },
              )
              break
            }
            default:
              break
          }
        }
        break
      }
      case "Electric": {
        const [amp, fq, sp, gl, fk] = [cv.k("amplitude"), cv.k("frequency"), cv.k("speed"), cv.k("glow"), cv.k("forks")]
        const color = rgb(cv.swatch())
        const [a, b] = [cv.w([f32(stage.ARC_A[0] + 6.0), stage.ARC_A[1]]), cv.w([f32(stage.ARC_B[0] - 6.0), stage.ARC_B[1]])]
        push(
          Fx.on(
            Fx.electric(Object.assign(ElectricParams.default(), {
              style: { Arc: { a, b } },
              color,
              amplitude: f32(f32(amp * 9.0) / 5.0),
              frequency: fq,
              speed: sp,
              glow: f32(f32(gl * 6.0) / 5.0),
              forks: Math.min(f32(f32(fk * f32(0.6)) / f32(0.55)), 1.0),
              strands: 3,
              intensity: cv.a,
            })),
            Shape.rounded(a[0], f32(a[1] - 1.0), f32(b[0] - a[0]), 2.0, 0.0),
          ),
          { Under: node.TERMINALS },
        )
        for (const [shot, k] of cv.s.shots.live(t, ElectricParams.ZAP_LIFE).filter(([sh]) => (sh.data as Shot).kind === "Zap")) {
          const to = cv.w((shot.data as Shot).at)
          const from = f32(Math.hypot(f32(to[0] - a[0]), f32(to[1] - a[1]))) < f32(Math.hypot(f32(to[0] - b[0]), f32(to[1] - b[1]))) ? a : b
          push(
            Fx.on(
              Fx.electric(Object.assign(ElectricParams.default(), {
                style: { Arc: { a: from, b: to } },
                color,
                amplitude: f32(f32(amp * 9.0) / 5.0),
                frequency: fq,
                glow: f32(f32(gl * 6.0) / 5.0),
                forks: Math.min(f32(f32(fk * f32(0.6)) / f32(0.55)), 1.0),
                intensity: cv.a,
                zap: shot.t0,
              })),
              Shape.rounded(Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(Math.abs(f32(to[0] - from[0])), 1.0), Math.max(Math.abs(f32(to[1] - from[1])), 1.0), 0.0),
            )
              .seed(shot.seed)
              .opacity(k),
            "Top",
          )
        }
        push(
          Fx.on(
            Fx.electric(Object.assign(ElectricParams.default(), { color, amplitude: f32(amp * f32(0.8)), frequency: fq, speed: sp, glow: gl, forks: fk, gap: 3.0, fork_len: 22.0, intensity: cv.a })),
            cv.rounded(stage.OVERLOAD, 18.0),
          )
            .seed(7),
          { Over: node.OVERLOAD },
        )
        const p = cv.pointer
        const r = stage.CHARGED
        const hovered = p !== null && p[0] >= r.x && p[0] <= f32(r.x + r.w) && p[1] >= r.y && p[1] <= f32(r.y + r.h)
        const heat = this.charged.at(hovered, t)
        anim.value ||= this.charged.moving(t)
        if (heat > f32(0.002)) {
          const base = ElectricParams.charged()
          push(
            Fx.on(
              Fx.electric(Object.assign(base, { color, intensity: f32(f32(base.intensity * heat) * cv.a), glow: f32(base.glow * f32(f32(0.6) + f32(f32(0.4) * heat))) })),
              cv.capsule(stage.CHARGED),
            )
              .seed(3),
            { Over: node.CHARGED },
          )
        }
        break
      }
      case "Fire": {
        const i = f32(cv.k("intensity") * cv.a)
        push(
          Fx.on(
            Fx.fire(Object.assign(FireParams.default(), {
              height: cv.k("height"),
              scale: cv.k("scale"),
              speed: cv.k("speed"),
              embers: u32(round(cv.k("embers"))),
              intensity: i,
              swirl: cv.k("swirl"),
            })),
            cv.rounded(stage.FLAMES, 18.0),
          )
            .seed(5),
          { Under: node.FLAMES },
        )
        const pl = FireParams.plasma()
        push(Fx.on(Fx.fire(Object.assign(pl, { intensity: f32(pl.intensity * i), speed: f32(f32(pl.speed * cv.k("speed")) / 1.5) })), cv.capsule(stage.PLASMA)).seed(11), { Under: node.PLASMA })
        const ht = FireParams.heat()
        push(Fx.on(Fx.fire(Object.assign(ht, { intensity: f32(ht.intensity * i) })), cv.capsule(stage.DEPLOY)).seed(2), { Under: node.DEPLOY })
        push(
          Fx.on(Fx.distort({ HeatHaze: { height: 26.0, scale: 9.0, speed: 2.0, amount: f32(f32(1.1) * cv.a), whole_shape: false } }), cv.capsule(stage.DEPLOY)),
          { Over: node.DEPLOY },
        )
        break
      }
      case "Lens": {
        const now = cv.now
        const target: Vec2 = { x: f32(cv.s.lens[0] + 128.0), y: f32(cv.s.lens[1] + 8.0) }
        const d = (this.droplet ??= Animated.new(target))
        d.animate_to(target, Spring.new(0.5, 0.0), now)
        anim.value ||= !d.is_settled(now)
        const dp: Vec2 = d.sample(now)
        for (const [shot, k] of cv.s.shots.live(t, 3.0).filter(([sh]) => (sh.data as Shot).kind === "Shockwave")) {
          const sh: Shot = shot.data
          push(
            Fx.on(Fx.distort(DistortParams.shockwave(cv.w(sh.at), sh.t0)), cv.everywhere()).opacity(k),
            "Top",
          )
        }
        if (cv.on("crt")) {
          push(Fx.on(Fx.distort(DistortParams.crt()), cv.rounded(stage.CRT, 14.0)), { Over: node.CRT })
        }
        push(
          Fx.on(Fx.distort({ ChromaSplit: { offset: [1.6, 0.0], glitch: 0.3, feather: 2.0 } }), cv.rounded(stage.CHROMA, 6.0)),
          { Over: node.CHROMA },
        )
        const q = cv.w([dp.x, dp.y])
        push(
          Fx.on(
            Fx.lens(Object.assign(LensParams.default(), {
              depth: cv.k("depth"),
              bevel: cv.k("bevel"),
              dispersion: cv.k("dispersion"),
              magnification: cv.k("magnification"),
              frost: cv.k("frost"),
              presence: cv.a,
              second: Shape.circle(q[0], q[1], 26.0),
              union_k: 26.0,
            })),
            cv.capsule(stage.lens_rect(cv.s.lens)),
          ),
          "Top",
        )
        break
      }
      case "Extras": {
        if (cv.on("shimmer")) {
          push(
            Fx.on(Fx.shimmer(Object.assign(ShimmerParams.default(), { intensity: f32(f32(0.11) * cv.a), band: 42.0, use_mask: true })), cv.rounded(stage.SKELETON, 16.0))
              .source(SRC_MASK, cv.viewport),
            { Over: node.SKELETON },
          )
          push(
            Fx.on(Fx.shimmer(Object.assign(ShimmerParams.default(), { intensity: f32(f32(0.85) * cv.a), band: 18.0, period: 1.6, angle: 0.25, use_mask: true })), cv.rounded(stage.THINKING, 0.0))
              .source(SRC_MASK, cv.viewport),
            { Over: node.THINKING },
          )
        }
        if (cv.on("aurora")) {
          push(
            Fx.on(Fx.aurora(Object.assign(AuroraParams.default(), { intensity: f32(f32(0.75) * cv.a), scale: 110.0, feather: 18.0, speed: cv.k("speed") })), cv.rounded(stage.AURORA, 18.0))
              .over(),
            { Over: node.AURORA },
          )
        }
        if (cv.on("grain")) {
          push(Fx.on(Fx.grain(new GrainParams({ amount: f32(f32(0.016) * cv.a) })), cv.rounded(stage.AURORA, 18.0)), { Over: node.AURORA })
        }
        if (cv.on("sparkles")) {
          push(
            Fx.on(Fx.sparkles(Object.assign(SparkleParams.default(), { margin: 20.0, size: 8.0, count: 6, intensity: cv.a })), cv.capsule(stage.PRO)).seed(4),
            { Over: node.PRO },
          )
        }
        const burst = Object.assign(SparkleParams.default(), { margin: 34.0, size: 9.0, count: 8, intensity: cv.a })
        for (const [shot, k] of cv.s.shots.live(t, burst.burst_life()).filter(([sh]) => (sh.data as Shot).kind === "Sparkles")) {
          push(
            Fx.on(Fx.sparkles(Object.assign(burst.clone(), { burst: shot.t0 })), cv.capsule(stage.PRO)).seed(shot.seed).opacity(k),
            { Over: node.PRO },
          )
        }
        break
      }
      default:
        break
    }
  }
}
