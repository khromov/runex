// Live values: values other code changes and bound elements follow without re-running the
// view (`rune::Live`, `Binding`, `Tween`, `LiveText`, and `El.live_*`).
import native from "./native.js"
import type * as N from "./native.js"
import type { Color } from "./gen/types.js"

export type LiveValue = number | [number, number] | [number, number, number, number] | Color

export const Live = native.Live
export type Live = N.Live
export const Binding = native.Binding
export type Binding = N.Binding
export const Tween = native.Tween
export type Tween = N.Tween
export const LiveText = native.LiveText
export type LiveText = N.LiveText

declare module "./gen/types.js" {
  interface El {
    /** Opacity follows `value` without re-running the view. */
    live_opacity(value: Live | Binding | Tween): this
    live_blur(value: Live | Binding | Tween): this
    live_scale(value: Live | Binding | Tween): this
    /** Offset `[x, y]` follows `value`. */
    live_offset(value: Live | Binding | Tween): this
    live_trim(value: Live | Binding | Tween): this
    /** Fill colour follows `value`. */
    live_fill(value: Live | Binding | Tween): this
    /** Rect `[x, y, w, h]` follows `value`. */
    live_rect(value: Live | Binding | Tween): this
    /** Draws `value`'s text, updated without re-running the view. */
    live_text(value: LiveText): this
  }
}
