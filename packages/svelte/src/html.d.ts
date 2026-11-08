/**
 * Markup types for Rune's elements. svelte-check and the Svelte language server type every tag as
 * a DOM element unless tsconfig's `"svelteOptions": { "namespace": "runexHTML" }` points them
 * here: then `gap={16}`, `w_full`, `fill={t.bg}` and `onpress` check against El's own signatures.
 */

import type { Snippet } from "svelte"
import type { ClassValue } from "svelte/elements"
import type { El, Icon, Shape, TextStyle, Color, Span } from "runex-js"
import type { ElEventName, ElMethodName } from "./gen/el.ts"
import type { BuildContext, RunexEvent, ShadowNode } from "./types.ts"

type Flag = boolean | "true" | "false" | "" | null | undefined
type Text = string | null | undefined

/** One El method as an attribute: a flag, its one argument, or its arguments as an array (or a string like `"38 22"`). */
type ElAttr<K extends ElMethodName> =
  Parameters<El[K]> extends []
    ? Flag
    : Parameters<El[K]> extends [infer A]
      ? A | (A extends string ? never : string) | null | undefined
      : Parameters<El[K]> | string | false | null | undefined

type ElAttributes = { [K in ElMethodName]?: ElAttr<K> }

type Handler<E = {}> = ((this: ShadowNode, event: RunexEvent & E) => unknown) | null | undefined

/** `onpress`, `onhover_change`, `ondrop_files`, ...: every `on_*` El has, without the underscore after `on`. */
type RuneEvents = { [K in ElEventName as K extends `on_${infer N}` ? (N extends `${infer M}_tx` ? `on${M}` : `on${N}`) : never]?: Handler }

interface DomEvents {
  /** `onpress` (the primary button, or Return/Space on a focused element). */
  onclick?: Handler
  ondblclick?: Handler
  /** `onsecondary_press`: right click, ctrl+click on macOS. */
  oncontextmenu?: Handler
  /** `onkey` on a focusable element; return true or call `preventDefault()` to consume the key. */
  onkeydown?: Handler
  onkeyup?: Handler
  onmouseenter?: Handler
  onmouseleave?: Handler
  onmousemove?: Handler
  onpointermove?: Handler
  onscroll?: Handler
  ondragstart?: Handler
  ondragend?: Handler
  ondrop?: Handler<{ paths: string[] }>
  onwheel?: Handler
}

interface RuneAttributes extends ElAttributes, RuneEvents, DomEvents {
  children?: Snippet
  /** CSS text: lengths in px/rem, colours, flexbox. See the package README for what Rune makes of it. */
  style?: Text
  class?: ClassValue | null | undefined
  /** Rune's identity for the element across frames (default: unique per element). Script events (`--script`) target it. */
  key?: string | number | null | undefined
  /** Text colour for this element and its descendants (a CSS colour or a Rune `Color`). */
  color?: Color | string | null | undefined
  /** Type style for this element and its descendants (`tok.type_.TITLE`). */
  font?: TextStyle | null | undefined
  "aria-label"?: Text
  "aria-description"?: Text
  "aria-expanded"?: Flag
  "aria-checked"?: Flag
  "aria-hidden"?: Flag
  "aria-level"?: number | `${number}` | null | undefined
  tabindex?: number | `${number}` | null | undefined
  /** A tooltip (Rune's `help`). */
  title?: Text
  /**
   * Attributes and `on*` handlers forwarded as one object, for a component passing its rest
   * props on: `<el attrs={rest} />`. Svelte drops functions from a `{...spread}` on this
   * renderer's elements, so forward this way. The element's own attributes win.
   */
  attrs?: Record<string, unknown> | null | undefined
  // Svelte drops a return that is not a function, so `(node) => (x = node)` is fine.
  [key: symbol]: ((node: ShadowNode) => unknown) | false | null | undefined
}

interface InputAttributes extends RuneAttributes {
  /** The field's text: set it to change the field, read `event.value` in `oninput` for edits. */
  value?: string | number | null | undefined
  placeholder?: Text
  placeholder_color?: Color | string | null | undefined
  type?: "text" | "password" | null | undefined
  name?: Text
  /** `<input>` is one line unless this is set. */
  multiline?: Flag
  oninput?: Handler<{ value: string }>
  onchange?: Handler<{ value: string }>
  onsubmit?: Handler<{ value: string }>
  oninput_change?: Handler<{ value: string }>
}

interface IconAttributes extends Omit<RuneAttributes, "size"> {
  icon: Icon
  /** Points (default: the inherited font size, or 16). */
  size?: number | `${number}` | null | undefined
}

interface RawAttributes extends RuneAttributes {
  /** Builds the El (`Button.new("Save").build(ctx.kit)`); its children are `ctx.children()`. */
  build: (ctx: BuildContext) => El | null | undefined
}

interface RichAttributes extends RuneAttributes {
  content?: Text
  spans?: Span[] | null | undefined
}

interface CanvasAttributes extends RuneAttributes {
  shape: Shape
}

interface EffectAttributes extends RuneAttributes {
  mark?: number | `${number}` | null | undefined
}

interface SvelteTags {
  "svelte:element": RuneAttributes & { this?: string | null }
  "svelte:boundary": { onerror?: (error: unknown, reset: () => void) => void; failed?: Snippet<[unknown, () => void]>; pending?: Snippet; children?: Snippet }
  "svelte:options": Record<string, unknown>
  "svelte:head": { children?: Snippet }
  "svelte:window": Record<string, unknown>
  "svelte:document": Record<string, unknown>
  "svelte:body": Record<string, unknown>
}

declare global {
  namespace runexHTML {
    function mapElementTag(tag: string): ShadowNode

    function createElement<Elements extends IntrinsicElements, Key extends keyof Elements>(
      element: Key | undefined | null,
      attrs: string extends Key ? RuneAttributes : Elements[Key],
    ): ShadowNode
    function createElement<Elements extends IntrinsicElements, Key extends keyof Elements, T>(
      element: Key | undefined | null,
      attrsEnhancers: T,
      attrs: (string extends Key ? RuneAttributes : Elements[Key]) & T,
    ): ShadowNode

    interface IntrinsicElements extends SvelteTags {
      // Rune's constructors.
      el: RuneAttributes
      row: RuneAttributes
      /** Rune's `col()`: `<col>` is an HTML void element to Svelte. */
      column: RuneAttributes
      text: RuneAttributes
      spacer: RuneAttributes
      effect: EffectAttributes
      icon: IconAttributes
      rich: RichAttributes
      canvas: CanvasAttributes
      input: InputAttributes
      textarea: InputAttributes
      raw: RawAttributes
      // HTML boxes: a column, or a row under `display: flex`.
      div: RuneAttributes
      section: RuneAttributes
      main: RuneAttributes
      header: RuneAttributes
      footer: RuneAttributes
      nav: RuneAttributes
      article: RuneAttributes
      aside: RuneAttributes
      form: RuneAttributes
      ul: RuneAttributes
      ol: RuneAttributes
      li: RuneAttributes
      button: RuneAttributes
      a: RuneAttributes
      // HTML text: one `text()` of their contents.
      span: RuneAttributes
      p: RuneAttributes
      label: RuneAttributes
      strong: RuneAttributes
      b: RuneAttributes
      em: RuneAttributes
      i: RuneAttributes
      small: RuneAttributes
      code: RuneAttributes
      h1: RuneAttributes
      h2: RuneAttributes
      h3: RuneAttributes
      h4: RuneAttributes
      h5: RuneAttributes
      h6: RuneAttributes
    }
  }
}
