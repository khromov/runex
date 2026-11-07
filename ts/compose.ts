// The fx compositor (`rune::compose::Compositor`): Rust owns the GPU work (rune-fx's
// `FxRenderer`, rune-light's `LightRenderer`, offscreen targets, backdrop copies, the resolve)
// and TypeScript decides, once per frame, what to draw.
//
// A compositor is an object with a `render(frame)` method. Rune calls it every frame, after the
// view, layout and animation ran and before anything is drawn, with a `Frame`: the clock, sizes,
// the pointer, where keyed elements were presented, the effect slots, and the app state. It
// returns a `Plan`: which rune-fx layers to draw and where, which rune-light lights, and which
// pipeline features the frame uses. Attach one with `App.compositor(c)`, `run_with(spec, c)`,
// `WindowSpec.compositor(c)` or `ConfiguredOverlay.compositor(c)`.
//
// Two pipelines (`Compositor.pipeline`, fixed per compositor):
//
// - `"ui"` (default): Rune draws the frame as usual; every layer is anchored to an `El::effect`
//   slot (`{ slot: frame.slots()[i].index }`) and draws inside that slot's pass, so the slot's
//   opacity, clip and transform apply. Slots with `effect_backdrop(true)` get a copy of what's
//   beneath them (blurred for frosted glass and lenses).
//
// - `"hdr"`: the compositor draws the frame into one linear `Rgba16Float` scene and resolves it
//   into the window once, with TPDF dither. Rune's instances are routed by their `El::mark`
//   (`Plan.routes`): the main list (default), a top list drawn above everything, offscreen
//   sources effects read (`FxLayer.source(slot, rect)`: a node layer for motion blur, a mask
//   pyramid for glow through text), and rune-light's lighting pass (`Plan.lighting`), whose lit
//   image composites back into the main list. Layers anchor `{ under: match }` (before the first
//   main-list instance whose mark matches), `{ over: match }` (after the last) or `"top"`; a layer
//   that reads the backdrop (distortion, glass) gets a copy of the scene drawn so far.
//
//   // "ui": a glow on every `effect(GLOW)` slot.
//   App.new(spec).compositor({
//     render(f) {
//       const layers = f.slots().filter((s) => s.mark === GLOW).map((s) => {
//         const [x, y, w, h] = s.rect.map((v) => v / s.scale)
//         return { layer: Fx.on(Fx.glow(GlowParams.default()), Shape.rounded(x, y, w, h, 12)).at(f.t), at: { slot: s.index } }
//       })
//       return { layers, animating: layers.length > 0 }
//     },
//   })
//
//   // "hdr": fire under the card marked CARD, and the window lit by one lamp.
//   App.new(spec).compositor({
//     pipeline: "hdr",
//     render(f) {
//       const [[x, y, w, h]] = f.presented("card") ?? [[0, 0, 0, 0]]
//       const s = f.env.scale
//       return {
//         layers: [{ layer: Fx.on(Fx.fire(FireParams.default()), Shape.rounded(x, y, w, h, 12)).at(f.t), at: { under: CARD } }],
//         routes: [{ match: [0, 0], lit: true }],
//         lighting: { lights: [Light.point(x * s, (y - 80) * s, 300 * s).intensity(3)], settings: new Settings(), alpha: 1, at: "top",
//                     prims: [{ match: CARD, style: { raised: 6 * s, bevel: [6 * s, 2 * s], gloss: [0.5, 0.4] } }] },
//         animating: true,
//       }
//     },
//   })
import type * as N from "./native.js"
import { App, type AppSpec } from "./app.js"
import type { Env, fx_FxLayer, fx_FxSlot, fx_FxStats, light_Light, light_Settings } from "./gen/types.js"

/**
 * Instances whose `El::mark` satisfies `mark & mask == value`: a mark alone compares every bit,
 * `[value, mask]` the bits in `mask` (marks are u32; a negative int32 from `|`/`<<` reads as its
 * bit pattern).
 */
export type Match = number | [value: number, mask: number]

/** Where a layer draws (`PlanLayer.at`, `Lighting.at`). Not Rune's `Anchor`, which places an element beside a keyed one (`El::anchored`). */
export type PlanAnchor =
  /** `"ui"`: at the effect slot with this painter index (`EffectSlot.index`). */
  | { slot: number }
  /** `"hdr"`: just before the first main-list instance whose mark matches. */
  | { under: Match }
  /** `"hdr"`: just after the last main-list instance whose mark matches. */
  | { over: Match }
  /** `"hdr"`: after the whole main list (below the top list). */
  | "top"

/** One rune-fx layer and where it draws. A layer whose anchor matches nothing this frame is skipped. */
export type PlanLayer = {
  layer: fx_FxLayer
  at: PlanAnchor
  /** `"ui"`: the layer's placement in its slot. Default: the slot's scale, clip and fade (`FxSlot.default().scale(s.scale).clip(s.clip, s.fade)`). */
  slot?: fx_FxSlot | null
}

/**
 * `"hdr"`: where instances with matching marks go. The first route that matches wins; instances
 * no route matches draw in the main list.
 */
export type Route = {
  match: Match
  /**
   * `"main"` (default): the main list, in painter order. `"top"`: after everything else (layers
   * included); top instances are neither lit nor anchors. `"none"`: only where `also`/`lit`
   * send them. A number: into that source slot instead of the scene (an effect redraws them;
   * on a frame no layer reads the slot, they draw nowhere).
   */
  draw?: "main" | "top" | "none" | number
  /** Also draw into this source slot (e.g. a mask), wherever `draw` puts the instance, on frames a layer reads the slot. */
  also?: number | null
  /** Feed the lighting pass: glyphs to its text layer, the rest to its base, rects to `Lighting.prims`. */
  lit?: boolean
  /** Device pixels added to the rect where `draw` puts it. */
  offset?: [number, number] | null
}

/**
 * `"hdr"`: an offscreen source a layer reads through `FxLayer.source(slot, rect)`: `"layer"` is a
 * window-sized `Rgba16Float` texture; `"mask"` a mask with its blur pyramid (`MaskPyramid`).
 * Routed instances draw into it (cleared first) on frames that route any and a layer reads it
 * (`FxLayer.source(slot, rect)`); otherwise it keeps its last contents.
 */
export type SourceKind = "layer" | "mask"

/**
 * How a lit rect stands on the UI plane (rune-light `Prim`), applied in this order to
 * `Prim.from_rune(rect, radii).albedo(fill / alpha)`. Device pixels.
 */
export type PrimStyle = {
  /** `Prim.on(z)`: sits on a surface at height z. */
  on?: number
  /** `Prim.raised(height)`: stands proud of its base and casts shadows. */
  raised?: number
  /** `Prim.floating(bottom, top)`. */
  floating?: [number, number]
  /** `Prim.bevel(width, height)`. */
  bevel?: [number, number]
  /** `Prim.gloss(gloss, roughness)`. */
  gloss?: [number, number]
  /** `Prim.emissive(albedo × k)`. */
  emissive?: number
}

/** The first rule whose match fits a lit rect's mark styles it; `style: null` (or no rule) leaves it flat. */
export type PrimRule = { match: Match; style: PrimStyle | null }

/** `"hdr"`: light the instances routed with `lit: true` (rune-light), and composite the lit image. */
export type Lighting = {
  /** Device pixels. Empty: ambient only. */
  lights: light_Light[]
  settings: light_Settings
  /** How much of the lit image shows (premultiplied over the scene). */
  alpha: number
  /** Where the lit image draws in the main list: `"first"` (default) where the first lit instance would have. */
  at?: PlanAnchor | "first"
  /** The lit base layer's backdrop: the window's clear colour (default), or the fill of the last rect whose mark matches. */
  background?: "clear" | Match
  prims?: PrimRule[]
  /** Rects with less fill alpha than this make no primitive. */
  min_alpha?: number | null
  /** While lit, layers whose anchor is present draw over the lit image (at its place) instead. */
  effects_on_top?: boolean
}

/** What `render` returns: this frame's drawing. `null`/`undefined` draws the frame with no layers. */
export type Plan = {
  layers?: PlanLayer[]
  /** True keeps frames coming (what Rust's `Compositor::animating` answers until the next frame). */
  animating?: boolean
  /** `"hdr"`: instance routing by mark. */
  routes?: Route[]
  /** `"hdr"`: the offscreen source slots, by index. */
  sources?: SourceKind[]
  /** `"hdr"`: multiply isolated-layer opacity into the instances inside and drop the layer records. */
  flatten_layers?: boolean
  /** `"hdr"`: the lighting pass, or none this frame. */
  lighting?: Lighting | null
  /** `"hdr"`: `[x, y, w, h]` in points: scissors layers and the lit image, and bounds backdrop copies. */
  clip?: [number, number, number, number] | null
}

/** An `El::effect` slot in this frame (`Frame.slots()`). */
export type EffectSlot = {
  /** Painter index: anchor a `"ui"` layer here with `{ slot: index }`. */
  index: number
  /** The slot's `El::mark` (`effect(mark)` sets it). */
  mark: number
  /** The slot's effect tag (`EffectSite::mark`). */
  effect: number
  /** `El::effect_data`. */
  data: [number, number, number, number]
  /** `[x, y, w, h]`, device pixels. */
  rect: [number, number, number, number]
  /** Corner radii, device pixels. */
  radii: [number, number, number, number]
  /** Device pixels per point at the slot. */
  scale: number
  /** Window device-pixel clip `[x0, y0, x1, y1]` and packed soft edges, for `FxSlot.clip`. */
  clip: [number, number, number, number]
  fade: [number, number, number, number]
  /** `El::effect_backdrop(true)`. */
  backdrop: boolean
}

/** One frame handed to a compositor's `render`; valid only during that call. */
export interface Frame<S = any> extends Omit<N.ComposeFrame, "state" | "env" | "stats" | "slots" | "viewport" | "size" | "pointer" | "presented" | "clear_color"> {
  /** The app state (`rt.state`): change it in place, then `invalidate()` so the view re-runs. */
  readonly state: S
  /** `rt.env`: `scale` (device pixels per point) and `system_dark`. */
  readonly env: Env
  /** The previous frame's effect stats. */
  readonly stats: fx_FxStats
  /** The window in points. */
  readonly viewport: [number, number]
  /** The target in device pixels. */
  readonly size: [number, number]
  /** The pointer in window points, or null. */
  pointer(): [number, number] | null
  /** `[[x, y, w, h], opacity]` (points) of the element keyed `key` as presented this frame, or null. */
  presented(key: string): [[number, number, number, number], number] | null
  /** The window's clear colour (premultiplied, in the frame's encoding). */
  clear_color(): [number, number, number, number]
  /** The effect slots, in painter order. */
  slots(): EffectSlot[]
}

/** Draws every frame of a window: `render` plans it, Rust draws it. */
export interface Compositor<S = any> {
  /** `"ui"` (default) or `"hdr"`; see the top of this file. */
  readonly pipeline?: "ui" | "hdr"
  /** TPDF dither in the effect shaders. Default: on for `"ui"`, off for `"hdr"` (which dithers at its resolve). */
  readonly dither?: boolean
  /** Simulate fire and smoke on small fluid grids (`FxRenderer.set_fire_sim`). Default off. */
  readonly fire_sim?: boolean
  /** Blur backdrop copies for frosted layers (`FxRenderer.blur_backdrop`). Default on; off, frost uses the shader's small blur. */
  readonly blur_backdrop?: boolean
  /** Ask for GPU timestamps around the compositor's passes (`Frame.gpu_ms`; `"hdr"` only). Default off. */
  readonly timestamps?: boolean
  /** This frame's plan. Called once per frame. */
  render(f: Frame<S>): Plan | null | undefined | void
  /** Printed after a headless run (Rust's `Compositor::summary`). */
  summary?(): string | null
}

/** `rune::run_with`: opens `spec`'s window drawn through `compositor`, and resolves when it closes. */
export function run_with<S>(spec: AppSpec<S>, compositor: Compositor<S>): Promise<void> {
  return App.new(spec).compositor(compositor).run()
}
