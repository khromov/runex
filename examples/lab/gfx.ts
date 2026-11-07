// The compositor: Rune's instances (tagged by `El::mark`) become rune-light occluders and anchor
// rune-fx layers. One HDR frame, one resolve into the window or the offscreen target.
//
// Per frame: partition the instances (lit canvases → base/text/prims, a moving card → its node
// layer, masks → the mask pyramid, everything else → the main list), light the lit canvases,
// then draw the main list into the HDR scene with each effect layer inserted under or over the
// node it belongs to (copying the backdrop before distortion), and resolve with dither.
//
// Rust (`src/gfx.rs`, `src/gfx/gpu.rs`) records the wgpu passes itself; here runex's "hdr"
// compositor pipeline records the same passes (HDR targets, the mask pyramid, the node layer,
// rune-light, backdrop copies, the dithered resolve) and `LabGfx` plans each frame.

import type { Compositor, Frame, Lighting, Plan, PlanAnchor, PlanLayer, PrimRule, PrimStyle, Route } from "runex-js"
import { Fx, type FxLayer, MotionBlurParams, MotionSamples, Pose, Rect, Shape } from "runex-js/fx"
import type { Light, Settings } from "runex-js/light"
import type { Vec2 } from "runex-js/motion"
import { type Flag, Live, PrimCx } from "./gfx/scenes.ts"
import { ALL, FX_COLORS, Scene } from "./knobs.ts"
import type { Lab } from "./main.ts"
import { STAGE_MARK, mat, node } from "./stage.ts"

// Rust's f32 math rounds every step.
const f32 = Math.fround

export const SRC_MASK = 0
export const SRC_NODE = 1

export type Anchor =
  | { Under: number }
  | { Over: number }
  /** Over everything in the canvas. */
  | "Top"

export type Lay = {
  layer: FxLayer
  scene: Scene
  anchor: Anchor
}

type CvFields = {
  s: Lab
  sc: Scene
  t: number
  now: number
  scale: number
  origin: [number, number]
  a: number
  pointer: [number, number] | null
  reduced: boolean
  viewport: Rect
}

/** One canvas on screen this frame. */
export class Cv {
  declare s: Lab
  declare sc: Scene
  /** `now as f32`. */
  declare t: number
  declare now: number
  declare scale: number
  declare origin: [number, number]
  /** Canvas opacity (presence): lights and effects scale with it. */
  declare a: number
  declare pointer: [number, number] | null
  declare reduced: boolean
  declare viewport: Rect

  /** Rust's struct literal: `new Cv({ s, sc, t, now, scale, origin, a, pointer, reduced, viewport })`. */
  constructor(init: CvFields) {
    Object.assign(this, init)
  }

  k(id: string): number {
    return this.s.k(this.sc, id)
  }
  on(id: string): boolean {
    return this.s.on(this.sc, id)
  }
  /** Canvas points → window points. */
  w(p: readonly [number, number]): [number, number] {
    return [f32(this.origin[0] + p[0]), f32(this.origin[1] + p[1])]
  }
  /** Canvas points → device pixels. */
  px(p: readonly [number, number]): [number, number] {
    const q = this.w(p)
    return [f32(q[0] * this.scale), f32(q[1] * this.scale)]
  }
  rounded(r: Rect, radius: number): Shape {
    return Shape.rounded(f32(this.origin[0] + r.x), f32(this.origin[1] + r.y), r.w, r.h, radius)
  }
  /** The whole viewport; the stage scissor clips it, so full-stage effects don't stop at the canvas edge. */
  everywhere(): Shape {
    const v = this.viewport
    return Shape.rounded(v.x, v.y, v.w, v.h, 0.0)
  }
  capsule(r: Rect): Shape {
    return Shape.capsule(f32(this.origin[0] + r.x), f32(this.origin[1] + r.y), r.w, r.h)
  }
  circle(c: readonly [number, number, number]): Shape {
    const q = this.w([c[0], c[1]])
    return Shape.circle(q[0], q[1], c[2])
  }
  swatch(): number {
    // `self.k("color") as usize` saturates: negative (and NaN) is 0.
    const k = this.k("color")
    return FX_COLORS[Math.min(k > 0 ? Math.trunc(k) : 0, FX_COLORS.length - 1)]
  }
}

// ---------------------------------------------------------------- the compositor

/** Mark bits: the canvas (`scene + 1`), the effect node, the lighting material (`stage::mk`). */
const SCENE_BITS = 0xff000000
const NODE_BITS = 0x0000ff00
const MATERIAL_BITS = 0x000000ff

function scene_mark(sc: Scene): number {
  return ((Scene.idx(sc) + 1) << 24) >>> 0
}

/** Where a canvas's layer goes: under or over one of its nodes, or over the whole canvas. */
function at(sc: Scene, a: Anchor): PlanAnchor {
  const m = (n: number): [number, number] => [(scene_mark(sc) | (n << 8)) >>> 0, (SCENE_BITS | NODE_BITS) >>> 0]
  if (a === "Top") return { over: [scene_mark(sc), SCENE_BITS] }
  if ("Under" in a) return { under: m(a.Under) }
  return { over: m(a.Over) }
}

/** `gfx/scenes.rs`'s `prim`: how each lit material stands on the UI plane (device px). */
function prims(pc: PrimCx, s: number): PrimRule[] {
  const [bv, g] = [pc.bevel, pc.gloss]
  const by = (material: number, style: PrimStyle): PrimRule => ({ match: [material, MATERIAL_BITS], style })
  const at_node = (n: number, material: number, style: PrimStyle): PrimRule => ({ match: [((n << 8) | material) >>> 0, (NODE_BITS | MATERIAL_BITS) >>> 0], style })
  const key = (d: number): PrimStyle => {
    d = Math.min(Math.max(d, 0.0), f32(1.2))
    return {
      floating: [f32(f32(10.0 - f32(6.0 * d)) * s), f32(f32(18.0 - f32(11.0 * d)) * s)],
      bevel: [f32(f32(12.0 * bv) * s), f32(f32(f32(4.5) * bv) * s)],
      gloss: [g, 0.28],
    }
  }
  const emit = (k: number): PrimStyle => ({ on: f32(6.0 * s), emissive: k })
  return [
    by(mat.CARD, { raised: f32(6.0 * s), bevel: [f32(6.0 * s), f32(2.0 * s)], gloss: [0.55, 0.42] }),
    by(mat.CHIP, { on: f32(6.0 * s), raised: f32(2.5 * s), bevel: [f32(4.0 * s), f32(1.0 * s)], gloss: [0.4, 0.4] }),
    by(mat.BUTTON, { on: f32(10.0 * s), raised: f32(4.0 * s), bevel: [f32(10.0 * s), f32(3.0 * s)], gloss: [0.8, 0.3] }),
    by(mat.COMPOSER, { raised: f32(10.0 * s), bevel: [f32(7.0 * s), f32(2.5 * s)], gloss: [0.6, 0.38] }),
    by(mat.ON_CARD, { on: f32(6.0 * s), gloss: [0.4, 0.4] }),
    by(mat.SWITCH, { on: f32(6.0 * s), raised: f32(5.0 * s), bevel: [f32(9.0 * s), f32(4.0 * s)], gloss: [0.7, 0.3] }),
    by(mat.PILL, { on: f32(6.0 * s), raised: f32(3.0 * s), bevel: [f32(4.0 * s), f32(f32(1.2) * s)], gloss: [0.5, 0.4] }),
    by(mat.BAR, { on: f32(6.0 * s), raised: f32(2.0 * s) }),
    by(mat.DIAL, { on: f32(6.0 * s), bevel: [f32(16.0 * s), f32(4.0 * s)], gloss: [0.6, 0.35] }),
    at_node(node.REC, mat.EMIT, emit(pc.rec)),
    at_node(node.STATUS, mat.EMIT, emit(pc.status)),
    at_node(node.PROGRESS, mat.EMIT, emit(pc.progress)),
    by(mat.EMIT, emit(0.0)),
    by(mat.FLAT, {}),
    by(mat.KNOB, { floating: [f32(10.0 * s), f32(22.0 * s)], bevel: [f32(f32(30.0 * bv) * s), f32(f32(10.0 * bv) * s)], gloss: [0.9, 0.26] }),
    ...pc.keys.map((d, i) => at_node(node.KEY0 + i, mat.KEY, key(d))),
    by(mat.KEY, key(0.0)),
    by(mat.BODY, { raised: f32(10.0 * s), bevel: [f32(f32(22.0 * bv) * s), f32(f32(7.0 * bv) * s)], gloss: [0.7, 0.32] }),
    by(mat.SCREEN, { on: f32(10.0 * s), gloss: [1.0, 0.18] }),
    by(mat.TILE, { raised: f32(14.0 * s), bevel: [f32(8.0 * s), f32(2.5 * s)], gloss: [0.5, 0.4] }),
  ]
}

export class LabGfx implements Compositor<Lab> {
  readonly pipeline = "hdr"
  // `FxRenderer::set_fire_sim(device, true)`, and Rust's GPU frame timer asks for `TIMESTAMP_QUERY`.
  readonly fire_sim = true
  readonly timestamps = true

  live = new Live()
  animating = false
  view_pending = false
  cpu: [number, number] = [0.0, 0]
  gpu: [number, number] = [0.0, 0]
  last_push: number | null = null
  shown: [number, number | null, boolean] | null = null
  last_pointer: [number, number] | null = null
  total_gpu: [number, number] = [0.0, 0]
  /** The target the last frame drew (Rust rebuilds its resources when it changes). */
  target: string | null = null

  summary(): string {
    const [sum, n] = this.total_gpu
    return n > 0
      ? `lab: gpu frame mean ${(sum / n).toFixed(3)} ms over ${n} timed frames (timestamp markers around the whole compositor)`
      : "lab: no GPU timestamps (adapter lacks TIMESTAMP_QUERY or too few frames)"
  }

  render(fr: Frame<Lab>): Plan {
    const target = `${fr.size[0]}x${fr.size[1]} ${fr.format}`
    const rebuilt = this.target !== target
    this.target = target
    this.view_pending = false
    const gpu_ms = fr.gpu_ms
    const scale = fr.env.scale
    const now = fr.t
    const t = f32(now)
    const [w, h] = fr.size
    const vp = Rect.new(0.0, 0.0, f32(w / scale), f32(h / scale))
    const stage_r = fr.presented("stage")?.[0] ?? [vp.x, vp.y, vp.w, vp.h]
    const in_stage = (p: [number, number]) =>
      p[0] >= stage_r[0] && p[0] <= f32(stage_r[0] + stage_r[2]) && p[1] >= stage_r[1] && p[1] <= f32(stage_r[1] + stage_r[3])
    const raw_pointer = fr.pointer()
    const pointer = raw_pointer && in_stage(raw_pointer) ? raw_pointer : null
    const canvases: [Scene, [number, number], number][] = []
    for (const sc of ALL) {
      const p = fr.presented(`canvas-${Scene.id(sc)}`)
      if (p && p[1] > f32(0.001)) canvases.push([sc, [p[0][0], p[0][1]], p[1]])
    }
    const s = fr.state
    const anim: Flag = { value: false }

    // ---- lights and effect layers per visible canvas
    const lights: Light[] = []
    let settings: [number, Settings] | null = null
    let lit_alpha = 0.0
    const pc = new PrimCx()
    const lays: Lay[] = []
    for (const [sc, origin, a] of canvases) {
      const cv = new Cv({
        s,
        sc,
        t,
        now,
        scale,
        origin,
        a,
        pointer: pointer ? [f32(pointer[0] - origin[0]), f32(pointer[1] - origin[1])] : null,
        reduced: s.reduced,
        viewport: vp,
      })
      if (Scene.lit(sc)) {
        lit_alpha = Math.max(lit_alpha, a)
        const st = this.live.lights(cv, lights, pc, anim)
        if (settings === null || a > settings[0]) settings = [a, st]
      } else {
        this.live.layers(cv, lays, anim)
      }
    }
    for (const l of lays) anim.value ||= l.layer.is_animating()

    // ---- the motion card: rest rect (where Rune drew it) and its pose along the track
    const card_drawn = fr.presented("card")?.[0] ?? null
    let card_blur: [MotionBlurParams, MotionSamples, Rect] | null = null
    let card_off: [number, number] = [0.0, 0.0]
    const motion = canvases.find((c) => c[0] === "Motion")
    if (card_drawn && motion) {
      const r = card_drawn
      const origin = motion[1]
      const rest = Rect.new(r[0], r[1], r[2], r[3])
      const grab = s.grab
      const dragging = grab !== null && "Card" in grab
      const pose_at = (tt: number): Pose => {
        let c: Vec2
        if (dragging) {
          const c0 = s.card.target() as Vec2
          const v = s.card_vt.velocity() as Vec2
          const dt = f32(tt - now)
          c = { x: f32(c0.x + f32(v.x * dt)), y: f32(c0.y + f32(v.y * dt)) }
        } else {
          c = s.card.sample(tt) as Vec2
        }
        return new Pose({ x: f32(f32(origin[0] + c.x) - rest.x), y: f32(f32(origin[1] + c.y) - rest.y) })
      }
      const p = new MotionBlurParams({
        mode: s.on("Motion", "directional") ? "Directional" : "Shutter",
        shutter_angle: s.reduced ? 0.0 : s.k("Motion", "shutter_angle"),
        smooth_shutter: s.on("Motion", "smooth"),
      })
      const samples = MotionSamples.from_track(p, rest, t, scale, pose_at)
      const pm = pose_at(t)
      card_off = [f32(pm.x * scale), f32(pm.y * scale)]
      anim.value ||= dragging || !s.card.is_settled(now)
      if (samples.is_moving()) card_blur = [p, samples, rest]
    }
    if (card_blur) {
      const [p, samples, rest] = card_blur
      const layer = Fx.on(Fx.motion_blur(p, samples), Shape.rounded(rest.x, rest.y, rest.w, rest.h, 14.0)).source(SRC_NODE, vp).at(t)
      lays.push({ layer, scene: "Motion", anchor: { Over: node.CARD } })
    }

    // ---- route Rune's instances: lit canvases into the lighting pass only, the moving card into
    // its node layer (or offset to its pose), glow text and skeletons also into the mask
    const routes: Route[] = ALL.filter((sc) => Scene.lit(sc)).map((sc) => ({ match: [scene_mark(sc), SCENE_BITS], draw: "none", lit: true }))
    const card: [number, number] = [(scene_mark("Motion") | (node.CARD << 8)) >>> 0, (SCENE_BITS | NODE_BITS) >>> 0]
    routes.push(card_blur ? { match: card, draw: SRC_NODE } : { match: card, offset: card_off })
    for (const n of [node.GLOW_TEXT, node.SKELETON, node.THINKING]) routes.push({ match: [n << 8, NODE_BITS], also: SRC_MASK })

    // ---- where each effect layer goes in the main list
    const layers: PlanLayer[] = lays.map((l) => ({ layer: l.layer.reduced(s.reduced), at: at(l.scene, l.anchor) }))
    let lighting: Lighting | null = null
    if (settings) {
      const st = settings[1]
      st.time = t
      lighting = { lights, settings: st, alpha: lit_alpha, at: "first", background: STAGE_MARK, prims: prims(pc, scale) }
    }
    this.animating = anim.value

    // ---- readout: averaged over a quarter second of Rune's clock. It asks for a redraw only on
    // frames that were drawing anyway (animating, the display link flipping, the pointer moving),
    // so a scene at rest never draws frames for its own readout. Times come a frame late here:
    // `compose_ms` and `stats` are the previous frame's, as the plan is made before drawing.
    const pointer_now = fr.pointer()
    const was = this.last_pointer
    this.last_pointer = pointer_now
    const moved = was === null ? pointer_now !== null : pointer_now === null || was[0] !== pointer_now[0] || was[1] !== pointer_now[1]
    // A frame that (re)built resources pays pipeline compiles; it would stick in an at-rest readout.
    if (!rebuilt) {
      this.cpu[0] += fr.update_ms + fr.compose_ms
      this.cpu[1] += 1
    }
    if (gpu_ms !== null) {
      this.gpu[0] += gpu_ms
      this.gpu[1] += 1
      this.total_gpu[0] += gpu_ms
      this.total_gpu[1] += 1
    }
    const due = this.last_push === null || now - this.last_push >= 0.25
    const live_flip = this.shown !== null && this.shown[2] !== anim.value
    if ((due && (anim.value || moved)) || live_flip) {
      const c = this.cpu[1] > 0 ? f32(this.cpu[0] / this.cpu[1]) : s.perf.cpu_ms
      const g = this.gpu[1] > 0 ? f32(this.gpu[0] / this.gpu[1]) : s.perf.gpu_ms
      const key: [number, number | null, boolean] = [Math.round(f32(c * 100.0)), g === null ? null : Math.round(f32(g * 100.0)), anim.value]
      if (this.shown === null || this.shown[0] !== key[0] || this.shown[1] !== key[1] || this.shown[2] !== key[2]) {
        s.perf = { cpu_ms: c, gpu_ms: g, draws: fr.stats.drawn, live: anim.value }
        fr.invalidate()
        this.view_pending = true
        this.shown = key
      }
      this.cpu = [0.0, 0]
      this.gpu = [0.0, 0]
      this.last_push = now
    }
    s.now = now
    return {
      layers,
      routes,
      sources: ["mask", "layer"],
      flatten_layers: true,
      lighting,
      clip: [stage_r[0], stage_r[1], stage_r[2], stage_r[3]],
      animating: this.animating || this.view_pending,
    }
  }
}
