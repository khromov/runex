// The shapes shared by the renderer, the El builder and the CSS translator, and the types a
// consumer imports from `@runex-js/svelte` to type an `{@attach}`, a `bind:this` or an event.
import type { Component } from "svelte"
import type { Color, Cx, El, TextEdit, TextStyle, Tx } from "runex-js"
import type { Kit } from "runex-js/kit"

/** Any component at all: a `Component<{ a: 1 }>` is not a `Component<{}>`, so a mixed set has no other common type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponent = Component<any, any, any>

export type NodeKind = "fragment" | "element" | "text" | "comment"

/** One builder call: `[method, args]`, applied as `el[method](...args)`. */
export type Op = [method: string, args: unknown[]]

/** What a node's class rules, inline `style` and attributes come to, cached until one of them changes. */
export interface Resolved {
  /** `flex-direction` picked a constructor for a box: `row()` or `col()`. */
  direction: "row" | "col" | null
  /** `display: none`: the element and its subtree build nothing. */
  hidden: boolean
  /** Builder calls in order: class rules, then `style`, then attributes. */
  ops: Op[]
  /** Text properties this element sets for itself and its descendants (CSS inherits them). */
  text: TextProps
  /** Read a `var()`, so a `set_css_vars` call has to resolve it again. */
  uses_vars: boolean
  /** `set_css_vars` generation it was resolved under. */
  generation: number
}

/** The inherited text properties: a `font` attribute's TextStyle, then CSS overrides on top. */
export interface TextProps {
  color?: Color
  /** A whole TextStyle (`font={type_.TITLE}`); the CSS fields below override parts of it. */
  font?: TextStyle
  size?: number
  weight?: number
  line_height?: number
  /** `line-height` without a unit: a multiple of the font size. */
  line_factor?: number
  /** Letter spacing in points. */
  tracking?: number
  /** Letter spacing in ems (`letter-spacing: 0.02em`), a multiple of the size. */
  tracking_em?: number
  family?: string
  italic?: boolean
  align?: "Start" | "Center" | "End"
}

/** An event handler as Svelte attaches it (`onpress={...}`). */
export type EventHandler = (this: ShadowNode, event: RunexEvent) => unknown

/** A node of the JavaScript tree Svelte renders into; `view()` builds Rune's `El`s from it every frame. */
export interface ShadowNode {
  kind: NodeKind
  /** Unique for the life of the process; the default `key` is `n<id>`. */
  id: number
  /** The tag for elements, `""` otherwise. */
  name: string
  /** Text or comment content. */
  data: string
  /** The attributes the element builds with: its own over the ones forwarded with `attrs={...}`. */
  attrs: Record<string, unknown>
  /** Raw attribute values exactly as Svelte set them (what `getAttribute` reads back). */
  own: Record<string, unknown>
  /** The object an `attrs={...}` attribute forwarded, if any. */
  forwarded: Record<string, unknown> | null
  /** Event name as Svelte spells it (`press`, `click`, `keydown`) → handlers. */
  listeners: Map<string, EventHandler[]>
  parent: ShadowNode | null
  first: ShadowNode | null
  last: ShadowNode | null
  prev: ShadowNode | null
  next: ShadowNode | null
  /** The resolved style, or null when an attribute changed since. */
  resolved: Resolved | null
  /** `<input>` and `<textarea>`: the edit Rune's text input mutates in place. */
  edit: TextEdit | null
}

/** What every handler receives: Rune's arguments by name, plus the DOM-shaped fields Svelte code reads. */
export interface RunexEvent {
  /** The event as the handler was attached (`press`, `click`, `keydown`, `input`). */
  type: string
  target: ShadowNode
  currentTarget: ShadowNode
  /** Rune's `Tx` for this event, where the handler has one: focus, clipboard, windows, quit. */
  tx: Tx | null
  /** Rune's arguments after the state, as the `on_*` method passes them. */
  args: unknown[]
  /** `<input>`/`<textarea>`: the text after the edit. */
  value?: string
  defaultPrevented: boolean
  /** A key handler that calls this (or returns `true`) consumes the key. */
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation(): void
  [field: string]: unknown
}

/** What a `<raw build={...}>` function gets: everything needed to build any El by hand. */
export interface BuildContext {
  /** The kit the window renders with (`render`'s `kit` option, `Kit.neutral(true)` by default). */
  kit: Kit
  /** Overlays (dialogs, popovers, tooltips) go here; the window's root lays them over the app. */
  layer: El[]
  cx: Cx
  /** The element's children, built. */
  children(): El[]
  /** The inherited text colour, if any ancestor set one. */
  color: Color | null
  /** The inherited font, as a TextStyle (`type_.BODY` when nothing set one). */
  font: TextStyle
  /**
   * Wraps a callback a Rune builder will call (`Button.on_press(handler(() => ...))`), so Svelte
   * state it changes reaches the next frame, and a throw is reported instead of aborting the frame.
   */
  handler<A extends unknown[], R>(f: (...args: A) => R): (...args: A) => R
}
