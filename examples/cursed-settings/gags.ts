// The punchlines. Each frame turns the settings (and where Rune drew their targets) into
// rune-fx layers and rune-light lights. Every gag runs on an envelope that springs from where
// it is toward on or off, so turning one off mid-flight cools it instead of cutting it.
//
// Rust computes all of this in f32: every operation below is rounded with `f` (`Math.fround`)
// as Rust rounds it. `exp`, `sin`, `cos`, `powf` and `hypot` run in f64 here and are then
// rounded, where Rust calls libm's f32 versions; the two agree except in rare last-bit cases.

import {
  ElectricParams,
  FireParams,
  Fx,
  type FxLayer,
  GlowParams,
  LensParams,
  MotionBlurParams,
  MotionSamples,
  OneShots,
  Pose,
  PulseParams,
  type Rect,
  Rgb,
  Shape,
  rgb,
} from "runex-js/fx"
import { Light, Settings, TextPolicy } from "runex-js/light"
import { Animated, Spring, type Vec2 } from "runex-js/motion"

import type { Cursed } from "./main.ts"
import { node } from "./ui.ts"

const f = Math.fround

/** `std::f32::consts::PI` */
const PI = f(Math.PI)
/** `std::f32::consts::TAU` */
const TAU = f(2 * Math.PI)

/** How long the cache takes to go down the drain. */
export const FLUSH_SECONDS: number = f(1.3)
/** The emptied card fading back in afterwards. */
const FLUSH_REVEAL: number = f(0.35)

export const SRC_NODE: number = 0
const STRIKE_WINDUP: number = f(0.32)

/** `f32::clamp`. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

/** `x as u32` for an f32: truncates, saturates, NaN is 0. */
function as_u32(x: number): number {
  return x > 0 ? Math.min(Math.trunc(x), 0xffffffff) : 0
}

/** `f32::signum`: ±1 by the sign bit (so ±0 gives ±1), NaN for NaN. */
function signum(x: number): number {
  if (Number.isNaN(x)) return NaN
  return x < 0 || Object.is(x, -0) ? -1.0 : 1.0
}

/**
 * Rust's struct update syntax on a bound rune-fx params class, `T { a, b, ..base }`: `base`
 * (here `T::default()` or a preset) with these fields set through its setters.
 */
function update<T extends object>(base: T, fields: Partial<T>): T {
  return Object.assign(base, fields)
}

// ---------------------------------------------------------------- envelopes

/** Step response of a spring with Rune's (duration, bounce) parameters. */
function step(u: number, dur: number, bounce: number): number {
  if (u <= 0.0) {
    return 0.0
  }
  const w = f(TAU / Math.max(dur, f(1e-3)))
  if (bounce <= f(1e-3)) {
    const wu = f(w * u)
    return f(1.0 - f(f(1.0 + wu) * f(Math.exp(-wu))))
  } else {
    const z = f(1.0 - Math.min(bounce, f(0.95)))
    const wd = f(w * f(Math.sqrt(f(1.0 - f(z * z)))))
    const wdu = f(wd * u)
    const decay = f(Math.exp(f(f(-z * w) * u)))
    const osc = f(f(Math.cos(wdu)) + f(f(f(z * w) / wd) * f(Math.sin(wdu))))
    return f(1.0 - f(decay * osc))
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp(f(f(x - e0) / f(e1 - e0)), 0.0, 1.0)
  return f(f(t * t) * f(3.0 - f(2.0 * t)))
}

function mix(a: number, b: number, t: number): number {
  return f(a + f(f(b - a) * t))
}

/** A switched envelope: 0 off, 1 on, sprung from wherever it was when the switch flipped. */
export class Env {
  on: boolean | null = null
  t0 = -1e3
  from = 0.0
  up: [number, number] = [0.0, 0.0]
  down = 0.0
  /** Rust's `delay` field (the builder method below has its name). */
  delay_ = 0.0
  reduced = false

  static new(up: number, bounce: number, down: number): Env {
    const e = new Env()
    e.up = [f(up), f(bounce)]
    e.down = f(down)
    return e
  }
  /** `Copy`: a builder returns a new value. */
  delay(d: number): Env {
    const e = this.clone()
    e.delay_ = f(d)
    return e
  }
  clone(): Env {
    const e = new Env()
    e.on = this.on
    e.t0 = this.t0
    e.from = this.from
    e.up = [this.up[0], this.up[1]]
    e.down = this.down
    e.delay_ = this.delay_
    e.reduced = this.reduced
    return e
  }
  /** The first sight is the resting state, not a transition. */
  set(on: boolean, t: number, reduced: boolean): boolean {
    if (this.on === null) {
      this.on = on
      this.from = on ? 1.0 : 0.0
      return false
    }
    if (this.on !== on) {
      this.from = this.at(t)
      this.on = on
      this.t0 = t
      this.reduced = reduced
      return true
    }
    return false
  }
  is_on(): boolean {
    return this.on === true
  }
  since(t: number): number {
    return f(t - this.t0)
  }
  shape(): [number, number, number] {
    if (this.reduced) {
      return [f(0.18), 0.0, 0.0]
    }
    return this.is_on() ? [this.up[0], this.up[1], this.delay_] : [this.down, 0.0, 0.0]
  }
  at(t: number): number {
    const target = this.is_on() ? 1.0 : 0.0
    const [dur, bounce, delay] = this.shape()
    return f(this.from + f(f(target - this.from) * step(f(f(t - this.t0) - delay), dur, bounce)))
  }
  moving(t: number): boolean {
    const [dur, bounce, delay] = this.shape()
    return this.since(t) < f(delay + f(dur * f(f(1.3) + f(2.5 * bounce))))
  }
}

// ---------------------------------------------------------------- frame inputs and outputs

export type Anchor =
  | { Under: number }
  | { Over: number }
  /** Above everything but the pointer. */
  | "Top"

export type Lay = {
  layer: FxLayer
  anchor: Anchor
}

/** Where Rune drew each target this frame (points) and its opacity. */
export type Targets = {
  fast: [Rect, number] | null
  search: [Rect, number] | null
  firewall: [Rect, number] | null
  allowed: [Rect, number] | null
  ip: [Rect, number] | null
  fence: [Rect, number] | null
  perimeter: [Rect, number] | null
  reload: [Rect, number] | null
  cache: [Rect, number] | null
  sel: [Rect, number] | null
}

export const Targets = {
  default(): Targets {
    return {
      fast: null,
      search: null,
      firewall: null,
      allowed: null,
      ip: null,
      fence: null,
      perimeter: null,
      reload: null,
      cache: null,
      sel: null,
    }
  },
}

export type In = {
  s: Cursed
  t: number
  now: number
  /** Device px per pt. */
  scale: number
  /** The window in points. */
  vp: Rect
  pointer: [number, number] | null
  dark_theme: boolean
  /** The selection colour under the glass (linear). */
  glass_tint: [number, number, number]
  targets: Targets
}

export type Out = {
  lays: Lay[]
  lights: Light[]
  settings: Settings
  /** How much of the lit frame shows over the plain one (0 skips lighting). */
  lit: number
  /** The cache card's pose track while it drains, with its rest rect. */
  flush: [MotionBlurParams, MotionSamples, Rect] | null
  anim: boolean
}

export class Gags {
  fire: Env = Env.new(0.9, 0.12, 0.55).delay(0.24)
  fire_x = 0.0
  charge: Env = Env.new(0.35, 0.0, 0.5)
  fence: Env = Env.new(0.45, 0.0, 0.4).delay(0.2)
  dark: Env = Env.new(0.22, 0.0, 0.5)
  contrast: Env = Env.new(0.6, 0.0, 0.5)
  spot: Env = Env.new(0.5, 0.0, 0.55)
  spot_pos: Animated | null = null
  frost: Env = Env.new(0.5, 0.0, 0.45)
  hot: Env = Env.new(1.6, 0.0, 2.4).delay(0.1)
  fast: boolean | null = null
  strike: number | null = null
  drop: Animated | null = null
  torch: [number, number] = [480.0, 330.0]
  taps: number | null = null
  /** `OneShots<[f32; 2]>`: each shock's data is where the pointer was. */
  shocks: OneShots = OneShots.new(4)

  static default(): Gags {
    return new Gags()
  }

  frame(i: In): Out {
    const s = i.s
    const p = s.p
    const t = i.t
    const rm = p.reduce_motion
    const tg = i.targets
    const light_ui = !i.dark_theme
    // Emissive light vanishes on a white window: there it reads as ink, deep and opaque.
    const [volt, volt_core, volt_occ, volt_k] = light_ui
      ? [rgb(0x1f5cff), rgb(0x7fa6ff), f(0.95), 1.5]
      : [rgb(0x5a9bff), rgb(0xeaf3ff), f(0.12), 1.0]
    const lays: Lay[] = []
    const lights: Light[] = []
    let anim = false
    const push = (layer: FxLayer, anchor: Anchor) => {
      lays.push({ layer: layer.at(t).reduced(rm), anchor })
    }
    const light_theme = !i.dark_theme
    const px = (q: [number, number]): [number, number] => [f(q[0] * i.scale), f(q[1] * i.scale)]

    // ---- Firewall: a wall of fire along the top of "Allowed apps"; off leaves embers.
    if (this.fire.set(p.firewall, t, rm) && p.firewall) {
      this.fire_x = tg.firewall === null ? 0.0 : center(tg.firewall[0])[0]
    }
    anim ||= this.fire.moving(t)
    if (tg.allowed !== null) {
      const [a, alpha] = tg.allowed
      const g = Math.max(this.fire.at(t), 0.0)
      const since = this.fire.since(t)
      if (this.fire.is_on() && since < f(0.8) && !rm && tg.firewall !== null) {
        const [sw] = tg.firewall
        // The spark: winds up, shoots from the switch to the card's edge, blooms there.
        const from = center(sw)
        const to: [number, number] = [clamp(this.fire_x, f(a.x + 12.0), f(f(a.x + a.w) - 12.0)), a.y]
        const d: [number, number] = [f(to[0] - from[0]), f(to[1] - from[1])]
        const len = Math.max(f(Math.hypot(d[0], d[1])), 1.0)
        push(
          Fx.on(
            Fx.pulse(update(PulseParams.default(), {
              style: { Ping: { from, dir: [f(d[0] / len), f(d[1] / len)], travel: len } },
              color: rgb(0xff7a1a),
              core: rgb(0xfff1d6),
              t0: this.fire.t0,
              duration: 0.26,
              head_radius: 2.4,
              intensity: alpha,
            })),
            Shape.circle(from[0], from[1], 6.0),
          ),
          "Top",
        )
        anim = true
      }
      if (g > f(0.003)) {
        const ix = clamp(this.fire_x, a.x, f(a.x + a.w))
        const span = this.fire.is_on() && !rm ? step(f(since - f(0.24)), f(0.85), 0.0) : 1.0
        const x0 = mix(ix, a.x, span)
        const x1 = mix(ix, f(a.x + a.w), span)
        const shape = Shape.rounded(x0, a.y, Math.max(f(x1 - x0), 14.0), a.h, 8.0)
        push(
          Fx.on(
            Fx.fire(update(FireParams.default(), {
              height: f(46.0 * g),
              scale: 17.0,
              speed: 1.5,
              intensity: f(f(Math.min(g, 1.0) * alpha) * (light_theme ? 1.5 : 1.0)),
              embers: 18,
              ember_rise: 62.0,
              occlusion: light_theme ? f(0.9) : f(0.3),
              base_glow: f(0.55),
            })),
            shape,
          ).seed(5),
          { Under: node.ALLOWED },
        )
        push(
          Fx.on(
            Fx.distort({ HeatHaze: { height: f(70.0 * g), scale: 10.0, speed: 2.0, amount: f(f(f(1.3) * g) * alpha), whole_shape: false } }),
            Shape.rounded(x0, f(a.y - f(30.0 * g)), Math.max(f(x1 - x0), 14.0), a.h, 8.0),
          ),
          { Over: node.ALLOWED },
        )
      }
      if (!this.fire.is_on() && this.fire.since(t) < f(2.4) && !rm) {
        const k = f(1.0 - smooth(f(0.2), f(2.4), this.fire.since(t)))
        push(
          Fx.on(
            Fx.fire(update(FireParams.default(), {
              style: "Embers",
              embers: 26,
              ember_rise: 44.0,
              ember_life: f(1.9),
              ember_size: f(0.9),
              intensity: f(k * alpha),
            })),
            rounded(a, 8.0),
          ).seed(6),
          { Over: node.ALLOWED },
        )
        anim = true
      }
    }

    // ---- Static IP: the address field crackles with static.
    this.charge.set(p.static_ip, t, rm)
    anim ||= this.charge.moving(t)
    if (tg.ip !== null) {
      const [fr, alpha] = tg.ip
      const c = this.charge.at(t)
      if (c > f(0.003)) {
        const burst = this.charge.is_on() ? f(Math.exp(f(-this.charge.since(t) / f(0.4)))) : 0.0
        const base = ElectricParams.charged()
        push(
          Fx.on(
            Fx.electric(update(base, {
              color: volt,
              core: volt_core,
              intensity: f(f(f(f(0.85) * volt_k) * c) * alpha),
              forks: f(f(0.3) + f(f(0.6) * burst)),
              amplitude: f(base.amplitude + f(f(2.6) * burst)),
              glow: Math.max(f(f(base.glow * f(0.6)) + f(2.0 * burst)), 1.0),
              flicker: f(f(0.25) * burst),
              occlusion: volt_occ,
            })),
            rounded(fr, 6.0),
          ).seed(9),
          { Over: node.IP },
        )
      }
    }

    // ---- Electric fence: a charge runs from the switch to the perimeter, which goes live.
    this.fence.set(p.fence, t, rm)
    anim ||= this.fence.moving(t)
    if (tg.perimeter !== null) {
      const [pr, alpha] = tg.perimeter
      const v = this.fence.at(t)
      const since = this.fence.since(t)
      const blue = volt
      if (this.fence.is_on() && since < f(0.45) && tg.fence !== null) {
        const [sw] = tg.fence
        const a = center(sw)
        const b: [number, number] = [f(f(pr.x + pr.w) - 24.0), f(pr.y + 2.0)]
        const e = since < f(0.2) ? 1.0 : f(Math.exp(f(-f(since - f(0.2)) / f(0.08))))
        push(
          Fx.on(
            Fx.electric(update(ElectricParams.default(), {
              style: { Arc: { a, b } },
              color: blue,
              amplitude: 7.0,
              frequency: 2.0,
              strands: 2,
              forks: f(0.6),
              core: volt_core,
              glow: 3.5,
              intensity: f(f(e * volt_k) * alpha),
              occlusion: volt_occ,
            })),
            arc_shape(a, b),
          ).seed(2 + as_u32(f(since * 20.0))),
          "Top",
        )
        anim = true
      }
      if (v > f(0.003)) {
        push(
          Fx.on(
            Fx.electric(update(ElectricParams.default(), {
              style: "Border",
              color: blue,
              amplitude: f(3.6),
              frequency: f(2.6),
              speed: f(3.4),
              core: volt_core,
              glow: f(2.8),
              forks: 0.5,
              strands: 2,
              intensity: f(f(v * volt_k) * alpha),
              occlusion: volt_occ,
            })),
            rounded(pr, 8.0),
          ).seed(7),
          { Over: node.PERIMETER },
        )
        // Come close and it bites.
        if (i.pointer !== null) {
          const q = i.pointer
          const [d, n] = border_point(pr, 8.0, q)
          const reach = 60.0
          if (v > 0.5 && Math.abs(d) < reach) {
            const k = f(f(f(Math.pow(f(1.0 - f(Math.abs(d) / reach)), f(0.8))) * v) * alpha)
            push(
              Fx.on(
                Fx.electric(update(ElectricParams.default(), {
                  style: { Arc: { a: n, b: q } },
                  color: blue,
                  amplitude: f(3.0 + f(Math.abs(d) * f(0.08))),
                  frequency: f(2.4),
                  strands: 2,
                  forks: f(0.7),
                  fork_len: 14.0,
                  core: volt_core,
                  glow: 3.0,
                  flicker: f(0.6),
                  intensity: f(k * volt_k),
                  occlusion: volt_occ,
                })),
                arc_shape(n, q),
              ).seed(31 + as_u32(f(t * 11.0))),
              "Top",
            )
            push(
              Fx.on(
                Fx.glow(update(GlowParams.default(), {
                  color: blue,
                  core: volt_core,
                  radius: 6.0,
                  intensity: k,
                  hot: f(0.8),
                  occlusion: light_ui ? f(0.6) : 0.0,
                })),
                Shape.circle(q[0], q[1], 2.5),
              ).over(),
              "Top",
            )
            anim = true
          }
        }
      }
    }

    // ---- Lightning-fast startup: lightning strikes the switch.
    if (this.fast !== null && !this.fast && p.fast_startup && s.page === "General") {
      this.strike = t
    }
    this.fast = p.fast_startup
    let flash = 0.0
    let flash_at: [number, number] = [0.0, 0.0]
    let storm = 0.0
    if (this.strike !== null && tg.fast !== null) {
      const t0 = this.strike
      const [sw, alpha] = tg.fast
      // Anticipation: the sky darkens first, then the bolt lands and the room recovers.
      const windup = rm ? 0.0 : STRIKE_WINDUP
      const w = f(t - t0)
      storm = rm ? 0.0 : f(smooth(0.0, windup, w) * f(1.0 - smooth(f(windup + f(0.15)), f(windup + f(0.9)), w)))
      const u = f(w - windup)
      if (u < 0.0) {
        anim = true
      } else if (u < f(1.4)) {
        anim = true
        const e = rm
          ? f(1.0 - smooth(0.0, f(0.3), u))
          : u < f(0.05)
          ? 1.0
          : u < f(0.1)
          ? f(0.12)
          : u < f(0.17)
          ? 1.0
          : f(Math.exp(f(-f(u - f(0.17)) / f(0.09))))
        const b = center(sw)
        const a: [number, number] = [f(b[0] + 46.0), f(i.vp.y - 12.0)]
        if (e > f(0.01)) {
          push(
            Fx.on(
              Fx.electric(update(ElectricParams.default(), {
                style: { Arc: { a, b } },
                color: light_ui ? rgb(0x2a5cff) : rgb(0x9cc4ff),
                core: light_ui ? rgb(0x9bb8ff) : rgb(0xffffff),
                amplitude: 15.0,
                frequency: 1.5,
                speed: 6.0,
                core_width: f(1.3),
                strands: 3,
                forks: f(0.95),
                fork_len: 30.0,
                glow: 4.5,
                flicker: 0.0,
                intensity: f(f(e * alpha) * volt_k),
                occlusion: light_ui ? f(0.95) : f(0.15),
              })),
              arc_shape(a, b),
            ).seed(u < f(0.1) ? 3 : 4),
            "Top",
          )
        }
        // The bolt lands: the window rings like a struck bell.
        if (!rm) {
          const full = Shape.rounded(i.vp.x, i.vp.y, i.vp.w, i.vp.h, 0.0)
          const t1 = f(t0 + windup)
          push(
            Fx.on(Fx.distort({ Shockwave: { at: b, reach: 420.0, width: 26.0, amount: 12.0, chroma: f(0.2), t0: t1, duration: f(1.1) } }), full),
            "Top",
          )
        }
        // The switch stays hot for a moment.
        const ember = f(f(Math.exp(f(-u / 0.5))) * alpha)
        push(
          Fx.on(
            Fx.glow(update(GlowParams.default(), {
              color: rgb(0x8fb8ff),
              core: rgb(0xffffff),
              radius: 4.0,
              intensity: f(f(0.6) * ember),
              hot: f(0.7),
              occlusion: light_ui ? f(0.6) : f(0.15),
            })),
            Shape.rounded(sw.x, sw.y, sw.w, sw.h, 4.0),
          ),
          "Top",
        )
        flash = e
        flash_at = b
      } else {
        this.strike = null
      }
    }

    // ---- Reduce transparency: the sidebar's glass selection frosts over.
    this.frost.set(p.reduce_transparency, t, rm)
    anim ||= this.frost.moving(t)
    if (tg.sel !== null) {
      const [r, alpha] = tg.sel
      const c: Vec2 = { x: f(r.x + f(r.w * 0.5)), y: f(r.y + f(r.h * 0.5)) }
      const d = (this.drop ??= Animated.new(c))
      if (rm) {
        d.set(c)
      } else {
        d.animate_to(c, Spring.new(0.55, 0.0), i.now)
      }
      anim ||= !d.is_settled(i.now)
      const dc: Vec2 = d.sample(i.now)
      const fr = this.frost.at(t)
      push(
        Fx.on(
          Fx.lens(update(LensParams.default(), {
            bevel: 7.0,
            depth: 6.0,
            dispersion: f(0.12),
            magnification: f(1.03),
            presence: alpha,
            frost: fr,
            shadow: f(0.18),
            rim: f(1.3),
            tint: new Rgb(i.glass_tint),
            tint_amount: f(f(0.92) * fr),
            second: Shape.rounded(f(dc.x - f(r.w * 0.5)), f(dc.y - f(r.h * 0.5)), r.w, r.h, 6.0),
            union_k: 18.0,
          })),
          rounded(r, 6.0),
        ),
        { Over: node.NAV },
      )
    }

    // ---- Hot reload: the reload button glows red-hot and the air above it shimmers.
    this.hot.set(p.hot_reload, t, rm)
    anim ||= this.hot.moving(t)
    if (tg.reload !== null) {
      const [b, alpha] = tg.reload
      const h = clamp(this.hot.at(t), 0.0, f(1.2))
      if (h > f(0.004)) {
        anim = true
        push(
          Fx.on(
            Fx.glow(update(GlowParams.default(), {
              color: glow_of(h),
              core: rgb(0xffe6c0),
              radius: f(5.0 + f(7.0 * h)),
              intensity: f(f(f(0.9) * h) * alpha),
              hot: f(f(0.35) * h),
              breathe: f(0.18),
              breathe_period: f(1.9),
              occlusion: light_theme ? f(0.7) : f(0.1),
            })),
            rounded(b, 6.0),
          ),
          { Under: node.RELOAD },
        )
        const ht = FireParams.heat()
        push(
          Fx.on(
            Fx.fire(update(ht, {
              intensity: f(f(f(ht.intensity * 1.5) * h) * alpha),
              height: f(13.0 * h),
              occlusion: light_theme ? 1.0 : f(0.1),
            })),
            rounded(b, 6.0),
          ).seed(2),
          { Under: node.RELOAD },
        )
        push(
          Fx.on(
            Fx.distort({ HeatHaze: { height: 52.0, scale: 9.0, speed: f(2.2), amount: f(f(f(1.1) * h) * alpha), whole_shape: false } }),
            rounded(b, 6.0),
          ),
          { Over: node.RELOAD },
        )
      }
    }

    // ---- Haptic feedback: Strong means every click shakes the window.
    if (this.taps !== null && s.taps !== this.taps && p.haptics === 2 && i.pointer !== null) {
      const q = i.pointer
      this.shocks.trigger(t, [q[0], q[1]])
    }
    this.taps = s.taps
    this.shocks.prune(t, 1.4)
    for (const [sh, k] of this.shocks.live(t, 1.4)) {
      anim = true
      const at: [number, number] = sh.data
      const full = Shape.rounded(i.vp.x, i.vp.y, i.vp.w, i.vp.h, 0.0)
      push(
        Fx.on(Fx.distort({ Shockwave: { at, reach: 320.0, width: 22.0, amount: 13.0, chroma: 0.5, t0: sh.t0, duration: f(1.15) } }), full)
          .opacity(k),
        "Top",
      )
      push(
        Fx.on(
          Fx.pulse(update(PulseParams.default(), {
            style: { Ripple: { at } },
            color: light_ui ? rgb(0x4a6cff) : rgb(0x8fb0ff),
            core: light_ui ? rgb(0x8ea4ff) : rgb(0xffffff),
            reach: 300.0,
            width: 2.0,
            t0: sh.t0,
            duration: 1.0,
            intensity: light_ui ? f(0.6) : f(0.35),
            occlusion: light_ui ? f(0.7) : 0.0,
          })),
          full,
        )
          .over()
          .opacity(k),
        "Top",
      )
    }

    // ---- Flush cache: the list spirals down the drain, with real shutter blur.
    let flush: [MotionBlurParams, MotionSamples, Rect] | null = null
    if (s.flush_t0 !== null && tg.cache !== null) {
      const t0 = s.flush_t0
      const [c] = tg.cache
      const u = f(t - t0)
      if (u <= f(FLUSH_SECONDS + FLUSH_REVEAL)) {
        anim = true
        const rest = c
        const cc = center(c)
        const drain: [number, number] = [cc[0], f(f(c.y + c.h) + 36.0)]
        const pose_at = (tt: number): Pose => flush_pose(f(tt - t0), rest, cc, drain, rm)
        // `..Default::default()`: a record's missing fields take `MotionBlurParams::default()`'s.
        const mp = new MotionBlurParams({
          mode: "Shutter",
          shutter_angle: rm ? 0.0 : 200.0,
          max_samples: 48,
        })
        const samples = MotionSamples.from_track(mp, rest, t, i.scale, pose_at)
        flush = [mp, samples, rest]
      }
    }

    // ---- Lighting: brightness, dark mode (lights out + torch), spotlight, contrast, lightning.
    let amb = f(f(0.1) + f(f(0.9) * clamp(p.brightness, 0.0, 1.0)))
    amb = f(amb * mix(1.0, f(0.32), storm))

    const dark_on = p.appearance === 1
    this.dark.set(dark_on, t, rm)
    let darkness: number
    let torch: number
    if (this.dark.is_on()) {
      const u = this.dark.since(t)
      const flick = rm
        ? smooth(0.0, f(0.2), u)
        : u < f(0.05)
        ? f(0.85)
        : u < f(0.11)
        ? f(0.1)
        : u < f(0.17)
        ? f(0.92)
        : u < f(0.23)
        ? f(0.45)
        : 1.0
      const from = this.dark.from
      const d = mix(from, 1.0, flick)
      darkness = d
      torch = smooth(0.0, f(0.18), f(u - (rm ? f(0.2) : f(0.6))))
    } else {
      const d = this.dark.at(t)
      darkness = d
      torch = 0.0
    }
    anim ||= this.dark.moving(t) || (this.dark.is_on() && this.dark.since(t) < 1.0)
    amb = f(amb * mix(1.0, f(0.006), darkness))
    if (torch > 0.0) {
      if (i.pointer !== null) {
        this.torch = [i.pointer[0], i.pointer[1]]
      }
      const q = this.torch
      const lp: [number, number] = [f(q[0] + 80.0), f(q[1] + 130.0)]
      const [a, b] = [px(q), px(lp)]
      const h = 260.0
      out_light(
        lights,
        Light.point(b[0], b[1], f(h * i.scale))
          .color([1.0, 0.95, 0.87])
          .intensity(7.0)
          .radius(f(9.0 * i.scale))
          .range(f(1800.0 * i.scale))
          .spot([f(a[0] - b[0]), f(a[1] - b[1]), f(-h * i.scale)], 0.56)
          .specular(1.3)
          .scaled(torch),
      )
    }

    const spot_switched = this.spot.set(p.spotlight, t, rm)
    const sv = this.spot.at(t)
    anim ||= this.spot.moving(t)
    if (tg.search !== null) {
      const [r] = tg.search
      const target: Vec2 = { x: f(r.x + f(r.w * 0.5)), y: f(r.y + f(r.h * 0.5)) }
      const sp = (this.spot_pos ??= Animated.new(target))
      if (spot_switched && p.spotlight && !rm) {
        // Swing in from off-stage, upper right.
        sp.set({ x: f(f(i.vp.x + i.vp.w) + 60.0), y: f(i.vp.y + 40.0) })
      }
      if (rm) {
        sp.set(target)
      } else {
        sp.animate_to(target, Spring.new(1.15, 0.16), i.now)
      }
      anim ||= sv > 0.0 && !sp.is_settled(i.now)
      if (sv > f(0.003)) {
        const q0: Vec2 = sp.sample(i.now)
        const q: [number, number] = [q0.x, q0.y]
        const lp: [number, number] = [f(q[0] + 150.0), f(q[1] - 90.0)]
        const h = 420.0
        const [a, b] = [px(q), px(lp)]
        out_light(
          lights,
          Light.point(b[0], b[1], f(h * i.scale))
            .color([1.0, 0.93, 0.8])
            .intensity(4.5)
            .radius(f(5.0 * i.scale))
            .range(f(2400.0 * i.scale))
            .spot([f(a[0] - b[0]), f(a[1] - b[1]), f(-h * i.scale)], 0.27)
            .specular(1.5)
            .scaled(sv),
        )
      }
    }
    amb = f(amb * mix(1.0, f(0.025), sv))

    this.contrast.set(p.contrast, t, rm)
    const cv = this.contrast.at(t)
    anim ||= this.contrast.moving(t)
    if (cv > f(0.003)) {
      const lp = px([f(i.vp.x - 90.0), f(i.vp.y + f(i.vp.h * f(0.32)))])
      out_light(
        lights,
        Light.point(lp[0], lp[1], f(26.0 * i.scale))
          .color([1.0, 0.88, 0.72])
          .intensity(6.0)
          .radius(f(12.0 * i.scale))
          .range(f(4000.0 * i.scale))
          .specular(1.6)
          .scaled(cv),
      )
    }
    amb = f(amb * mix(1.0, f(0.28), cv))

    if (flash > f(0.003)) {
      const q = px([f(flash_at[0] + 30.0), f(flash_at[1] - 120.0)])
      out_light(
        lights,
        Light.point(q[0], q[1], f(300.0 * i.scale))
          .color([0.85, 0.9, 1.0])
          .intensity(6.0)
          .radius(f(30.0 * i.scale))
          .range(f(5000.0 * i.scale))
          .scaled(flash),
      )
    }

    const gloom = Math.max(Math.max(darkness, f(sv * f(0.85))), f(cv * f(0.6)))
    // `..Default::default()`: a record's missing fields take `Settings::default()`'s.
    const settings = new Settings({
      ambient: [amb, amb, f(amb * f(1.05))],
      text: new TextPolicy({ floor: mix(f(0.82), f(0.08), gloom), ceiling: f(1.3), lit: 1.0, specular: f(0.12) }),
      rim: f(f(0.8) + f(f(0.8) * cv)),
      contact_ao: f(f(0.35) + f(f(0.2) * cv)),
      albedo_floor: f(0.05),
      background_gloss: f(0.35),
    })
    const lit = clamp(f(f(f(1.0 - amb) * 8.0) + f(f(f(f(flash + torch) + sv) + cv) * 8.0)), 0.0, 1.0)
    return { lays, lights, settings, lit, flush, anim }
  }
}

function center(r: Rect): [number, number] {
  return [f(r.x + f(r.w * 0.5)), f(r.y + f(r.h * 0.5))]
}

function rounded(r: Rect, radius: number): Shape {
  return Shape.rounded(r.x, r.y, r.w, r.h, radius)
}

function lin3(c: Rgb): [number, number, number] {
  return c._0
}

/** Black-body-ish ramp for heating metal: dull red, orange, yellow-white. */
function glow_of(h: number): Rgb {
  const a = lin3(rgb(0x7a1204))
  const b = lin3(rgb(0xff4a12))
  const c = lin3(rgb(0xffb347))
  const k = clamp(h, 0.0, 1.0)
  const [p, q, u] = k < f(0.6) ? [a, b, f(k / f(0.6))] : [b, c, f(f(k - f(0.6)) / f(0.4))]
  return new Rgb([mix(p[0], q[0], u), mix(p[1], q[1], u), mix(p[2], q[2], u)])
}

/** Signed distance to a rounded rect and the nearest point on its border. */
function border_point(r: Rect, radius: number, p: [number, number]): [number, [number, number]] {
  const c = center(r)
  const half = [f(f(r.w * 0.5) - radius), f(f(r.h * 0.5) - radius)]
  const q = [f(p[0] - c[0]), f(p[1] - c[1])]
  const cl = [clamp(q[0], -half[0], half[0]), clamp(q[1], -half[1], half[1])]
  const d = [f(q[0] - cl[0]), f(q[1] - cl[1])]
  const len = f(Math.hypot(d[0], d[1]))
  if (len > f(1e-3)) {
    const n = [f(d[0] / len), f(d[1] / len)]
    return [f(len - radius), [f(f(c[0] + cl[0]) + f(n[0] * radius)), f(f(c[1] + cl[1]) + f(n[1] * radius))]]
  } else {
    // Inside the core: push out to the nearest side.
    const dx = f(f(half[0] + radius) - Math.abs(q[0]))
    const dy = f(f(half[1] + radius) - Math.abs(q[1]))
    if (dx < dy) {
      return [-dx, [f(c[0] + f(signum(q[0]) * f(half[0] + radius))), p[1]]]
    } else {
      return [-dy, [p[0], f(c[1] + f(signum(q[1]) * f(half[1] + radius)))]]
    }
  }
}

function arc_shape(a: [number, number], b: [number, number]): Shape {
  const x = Math.min(a[0], b[0])
  const y = Math.min(a[1], b[1])
  return Shape.rounded(x, y, Math.max(Math.abs(f(a[0] - b[0])), 2.0), Math.max(Math.abs(f(a[1] - b[1])), 2.0), 0.0)
}

function out_light(v: Light[], l: Light): void {
  v.push(l)
}

/**
 * The drain: a wind-up, then an accelerating spiral that shrinks into the plughole; then the
 * emptied card fades back in where it was.
 */
function flush_pose(u: number, rest: Rect, cc: [number, number], drain: [number, number], rm: boolean): Pose {
  void rest
  if (u <= 0.0) {
    // `Pose::default()`: a record's missing fields take the defaults (scale and opacity 1).
    return new Pose()
  }
  if (u >= FLUSH_SECONDS) {
    const k = smooth(0.0, FLUSH_REVEAL, f(u - FLUSH_SECONDS))
    return new Pose({ opacity: k })
  }
  if (rm) {
    return new Pose({ opacity: f(1.0 - smooth(0.0, f(FLUSH_SECONDS * f(0.6)), u)) })
  }
  const wind = f(0.2)
  if (u < wind) {
    const w = f(Math.sin(f(f(PI * u) / wind)))
    return new Pose({ rotation: f(-f(0.035) * w), scale: f(1.0 + f(f(0.02) * w)), y: f(-3.0 * w) })
  }
  const v = clamp(f(f(u - wind) / f(FLUSH_SECONDS - wind)), 0.0, 1.0)
  const k = f(Math.pow(v, f(2.2)))
  const r0 = Math.abs(f(cc[1] - drain[1]))
  const ang = f(f(-PI * 0.5) + f(f(k * TAU) * f(1.1)))
  const r = f(r0 * f(1.0 - k))
  const x = f(drain[0] + f(r * f(Math.cos(ang))))
  const y = f(drain[1] + f(r * f(Math.sin(ang))))
  return new Pose({
    x: f(x - cc[0]),
    y: f(y - cc[1]),
    rotation: f(f(k * TAU) * f(1.35)),
    scale: mix(1.0, f(0.03), f(Math.pow(k, f(0.75)))),
    opacity: f(1.0 - smooth(f(0.8), 1.0, v)),
  })
}
