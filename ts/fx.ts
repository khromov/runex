// runex-js/fx: Rust's `rune_fx` crate (generated, tools/bindgen), plus the compositor (`./compose.ts`).
import native from "./native.js"
import type * as N from "./native.js"

export * from "./gen/fx/index.js"
export { run_with } from "./compose.js"
export type { Compositor, EffectSlot, Frame, Lighting, Match, Plan, PlanAnchor, PlanLayer, PrimRule, PrimStyle, Route, SourceKind } from "./compose.js"

/**
 * A bounded pool of overlapping one-shot effects (`rune_fx::OneShots<T>`): taps, pings,
 * shockwaves. The payload is any JavaScript value; `live(t, life)` yields `[{ t0, data, seed }, k]`.
 */
export const OneShots = native.OneShots
export type OneShots = N.OneShots

// `Rgb` is a tuple struct (`Rgb(pub [f32; 3])`): `new Rgb([r, g, b])` is Rust's `Rgb([r, g, b])` and
// `rgb._0` its `.0` (hand-bound in src/manual/tuple.rs; Bun crashes reading an index-like
// property such as `rgb[0]` of a Node-API object, so the field has a name).
declare module "./gen/types.js" {
  interface fx_Rgb {
    /** `rgb.0`: the linear-light channels. */
    readonly _0: [number, number, number]
  }
  interface fx_Rgb$Static {
    /** `Rgb([r, g, b])`: linear-light RGB. */
    new (rgb: [number, number, number]): fx_Rgb
  }
}
