// The compositor: Rune builds the settings window as usual; this draws it into one HDR frame
// with the gags' effect layers slotted under or over the elements they belong to (by mark),
// lights the whole window with rune-light when a gag needs the lights, and resolves once with
// dither. With nothing burning it draws the plain UI and asks for no frames.
//
// Rust (`src/gfx.rs`) records the wgpu passes itself; here runex's "hdr" compositor pipeline
// records the same passes and this class plans each frame: the compositor-owned state, the
// gags, how instances are routed by mark, where each layer goes, and the lighting.

import type { Compositor, Frame, Lighting, Plan, PlanAnchor, PlanLayer, PrimRule, Route } from "runex-js"
import { Fx, Rect, Shape } from "runex-js/fx"
import { kit } from "runex-js/theme-opencode"

import { type Anchor, FLUSH_SECONDS, Gags, type Lay, SRC_NODE, type Targets } from "./gags.ts"
import type { Cursed } from "./main.ts"
import { dark_theme, mat, node } from "./ui.ts"

const f = Math.fround

/** A mark's effect node: its low 16 bits (`ui::mark_node`). */
const NODE = 0xffff
/** A mark's lighting material: bits 16..24 (`ui::mark_material`). */
const MATERIAL = 0xff0000

/** Where a gag's layer goes, as runex anchors marks (`Under`/`Over` a node, or above it all). */
function at(a: Anchor): PlanAnchor {
  if (a === "Top") return "top"
  if ("Under" in a) return { under: [a.Under, NODE] }
  return { over: [a.Over, NODE] }
}

/** How a marked rect stands on the UI plane (device px): `gfx.rs`'s `prim`. */
function prims(s: number): PrimRule[] {
  return [
    { match: [mat.CARD << 16, MATERIAL], style: { raised: f(5.0 * s), bevel: [f(5.0 * s), f(1.5 * s)], gloss: [0.45, 0.45] } },
    { match: [mat.CONTROL << 16, MATERIAL], style: { on: f(5.0 * s), raised: f(2.5 * s), bevel: [f(4.0 * s), f(f(1.2) * s)], gloss: [0.6, 0.35] } },
    { match: [mat.SEL << 16, MATERIAL], style: { raised: f(1.5 * s), bevel: [f(4.0 * s), f(f(0.8) * s)], gloss: [0.5, 0.4] } },
  ]
}

export class Gfx implements Compositor<Cursed> {
  readonly pipeline = "hdr"
  // Rust asks for `TIMESTAMP_QUERY` (its GPU frame timer) and copies backdrops without blurring them.
  readonly timestamps = true
  readonly blur_backdrop = false

  gags = new Gags()
  animating = false
  view_pending = false
  total_gpu: [number, number] = [0.0, 0]
  frames = 0
  lit_frames = 0
  max_layers = 0

  summary(): string {
    const [sum, n] = this.total_gpu
    const gpu = n > 0 ? `gpu frame mean ${(sum / n).toFixed(3)} ms over ${n} timed frames` : "no GPU timestamps"
    return `cursed-settings: ${gpu}; ${this.frames} frames, ${this.lit_frames} lit, at most ${this.max_layers} effect layers`
  }

  render(fr: Frame<Cursed>): Plan {
    this.view_pending = false
    const gpu_ms = fr.gpu_ms
    const scale = fr.env.scale
    const now = fr.t
    const t = f(now)
    const [w, h] = fr.size
    const vp = Rect.new(0.0, 0.0, f(w / scale), f(h / scale))
    const pointer = fr.pointer()

    // ---- state the compositor owns: the clock, flush timing, the demo pointer
    let dirty = false
    {
      const st = fr.state
      st.now = now
      if (st.flush_requested) {
        st.flush_requested = false
        st.flush_t0 = t
        dirty = true
      }
      if (st.flush_t0 !== null && t > f(f(st.flush_t0 + FLUSH_SECONDS) + f(0.4))) {
        st.flush_t0 = null
        dirty = true
      }
      const same = st.cursor === null ? pointer === null : pointer !== null && st.cursor[0] === pointer[0] && st.cursor[1] === pointer[1]
      if (st.show_cursor && !same) {
        st.cursor = pointer
        dirty = true
      }
    }
    if (dirty) {
      fr.invalidate()
      this.view_pending = true
    }

    // ---- the gags
    const rect = (k: string): [Rect, number] | null => {
      const p = fr.presented(k)
      if (!p || !(p[0][2] > 0.0 && p[0][3] > 0.0)) return null
      const [r, a] = p
      return [Rect.new(r[0], r[1], r[2], r[3]), a]
    }
    const targets: Targets = {
      fast: rect("fast-switch"),
      search: rect("search"),
      firewall: rect("firewall-switch"),
      allowed: rect("allowed-card"),
      ip: rect("ip-field"),
      fence: rect("fence-switch"),
      perimeter: rect("perimeter-card"),
      reload: rect("reload-btn"),
      cache: rect("cache-card"),
      sel: rect("nav-sel"),
    }
    const dark = dark_theme(fr.state, fr.env.system_dark)
    const tint = kit(dark).c.layer_03
    const out = this.gags.frame({
      s: fr.state,
      t,
      now,
      scale,
      vp,
      pointer,
      dark_theme: dark,
      glass_tint: [tint.r, tint.g, tint.b],
      targets,
    })
    let anim = out.anim
    const lit_on = out.lit > 0.002
    const flushing = out.flush !== null

    // ---- route Rune's instances: the pointer on top, the draining cache card into the node
    // layer, and (lit) everything else into the lighting pass as well as the scene
    const routes: Route[] = [{ match: [node.CURSOR, NODE], draw: "top" }]
    if (flushing) routes.push({ match: [node.CACHE, NODE], draw: SRC_NODE })
    if (lit_on) routes.push({ match: [0, 0], lit: true })

    // ---- where each effect layer goes
    const lays: Lay[] = out.lays
    if (out.flush) {
      const [p, samples, rest] = out.flush
      const layer = Fx.on(Fx.motion_blur(p, samples), Shape.rounded(rest.x, rest.y, rest.w, rest.h, 8.0)).source(SRC_NODE, vp).at(t)
      lays.push({ layer, anchor: { Over: node.CACHE } })
    }
    const layers: PlanLayer[] = []
    for (const l of lays) {
      anim ||= l.layer.is_animating()
      layers.push({ layer: l.layer, at: at(l.anchor) })
    }
    // Rust counts the layers whose anchor was on screen; the plan doesn't know, so this counts all.
    this.max_layers = Math.max(this.max_layers, layers.length)

    let lighting: Lighting | null = null
    if (lit_on) {
      const settings = out.settings
      settings.time = t
      // Lit, the window is one image: effects go on top of it.
      lighting = { lights: out.lights, settings, alpha: out.lit, at: "top", background: "clear", prims: prims(scale), min_alpha: 0.02, effects_on_top: true }
      this.lit_frames += 1
    }
    if (gpu_ms !== null) {
      this.total_gpu[0] += gpu_ms
      this.total_gpu[1] += 1
    }
    this.frames += 1
    this.animating = anim
    return { layers, routes, sources: ["layer"], lighting, animating: this.animating || this.view_pending }
  }
}
