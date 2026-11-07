// `El.linear_gradient` / `El.radial_gradient` (hand-bound in src/manual/gradient.rs: Rust takes
// `impl AsRef<[(f32, Color)]>`, which the generator skips). Stops are `[position, color]` pairs.
import type { Color, RadialRadius } from "./gen/types.js"

declare module "./gen/types.js" {
  interface El {
    /**
     * A linear gradient at `angle` radians (CSS convention: `0` is bottom-to-top, `PI / 2`
     * left-to-right, `PI` top-to-bottom like `El.gradient`) with up to 8 stops, over the fill.
     */
    linear_gradient(angle: number, stops: [number, Color][]): this
    /**
     * A radial gradient from `center` (normalized element coordinates) out to `radius` points (a
     * number, or `[rx, ry]` for an ellipse) with up to 8 stops, over the fill.
     */
    radial_gradient(center: [number, number], radius: number | [number, number] | RadialRadius, stops: [number, Color][]): this
  }
}

export {}
