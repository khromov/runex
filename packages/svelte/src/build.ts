// The shadow tree to Rune's El tree. Rune is immediate mode: `view()` returns a fresh El tree
// every frame it builds, and Rune matches it to the last one by `key` (each element gets `n<id>`,
// stable for its lifetime, unless it sets its own), which is what keeps hover, focus, scroll,
// a text field's caret and `motion` animations across frames.
import { TextEdit, TextStyle, col, el, icon, rich, row, spacer, text, text_input, tok, canvas, effect, type Color, type Cx, type El } from "runex-js"
import { attr_op } from "./attrs.ts"
import { is_color, parse_color } from "./color.ts"
import { generation, merge, parse_declarations, translate, warn_once, type Declarations } from "./css.ts"
import { wire } from "./events.ts"
import { get_kit, handler, stylesheets } from "./runtime.ts"
import type { BuildContext, Op, Resolved, ShadowNode, TextProps } from "./types.ts"

/** Rune's own constructors, by tag. */
// `<col>` is an HTML void element to Svelte (a table column), which can't have children, so
// Rune's `col()` is `<column>`.
const RUNE_BOXES = new Set(["el", "row", "column", "spacer", "effect"])

/** HTML block tags: a column of their children, or a row under `display: flex`, as in CSS. */
const HTML_BOXES = new Set([
  "div", "section", "main", "header", "footer", "nav", "article", "aside", "form", "ul", "ol", "li",
  "figure", "dl", "dt", "dd", "fieldset", "blockquote", "button", "a",
])

/** Text tags: their descendants' text, in one `text()`. The HTML ones bring a type style. */
const TEXT_TAGS: Record<string, TextProps> = {
  text: {},
  span: {},
  p: { },
  label: {},
  strong: { weight: 600 },
  b: { weight: 600 },
  em: { italic: true },
  i: { italic: true },
  small: { size: 11 },
  code: { family: "monospace" },
  h1: { size: 28, weight: 700 },
  h2: { size: 22, weight: 650 },
  h3: { size: 18, weight: 600 },
  h4: { size: 15, weight: 600 },
  h5: { size: 13, weight: 600 },
  h6: { size: 12, weight: 600 },
}

/** Attributes the builder reads itself rather than as El methods. */
const OWN = new Set(["class", "style", "key", "color", "font", "children", "attrs"])
const OWN_BY_TAG: Record<string, Set<string>> = {
  input: new Set(["value", "placeholder", "placeholder_color", "type", "name", "multiline"]),
  textarea: new Set(["value", "placeholder", "placeholder_color", "name", "rows"]),
  icon: new Set(["icon", "size"]),
  raw: new Set(["build"]),
  rich: new Set(["content"]),
  canvas: new Set(["shape"]),
  effect: new Set(["mark"]),
}

export interface Ctx {
  cx: Cx
  /** Kit overlays (dialogs, popovers, tooltips), laid over the app at the root. */
  layer: El[]
  /** Text properties inherited from the ancestors. */
  text: TextProps
}

const warned_tags = new Set<string>()

/** The class rules matching `node`, weakest first. */
function matching_rules(node: ShadowNode) {
  const value = node.attrs.class
  if (typeof value !== "string" || value === "") return []
  const names = value.split(/\s+/)
  const out = []
  for (const name of names) {
    const sheet = stylesheets.get(name)
    if (!sheet) continue
    for (const rule of sheet) {
      if (rule.tag !== null && rule.tag !== node.name) continue
      if (rule.classes.every((c) => names.includes(c))) out.push(rule)
    }
  }
  return out
}

/** Class rules, then `style`, then attributes: what the node's El gets, cached until one changes. */
export function resolve(node: ShadowNode): Resolved {
  const cached = node.resolved
  if (cached && (!cached.uses_vars || cached.generation === generation)) return cached

  const decls: Declarations = new Map()
  const hover: Declarations = new Map()
  const active: Declarations = new Map()
  let uses_vars = false
  for (const rule of matching_rules(node)) {
    merge(rule.pseudo === "hover" ? hover : rule.pseudo === "active" ? active : decls, rule.decls)
    if (rule.decls.some(([, v]) => v.includes("var("))) uses_vars = true
  }
  const style = node.attrs.style
  if (typeof style === "string" && style.trim() !== "") {
    merge(decls, parse_declarations(style))
    if (style.includes("var(")) uses_vars = true
  }
  const t = translate(decls, { hover, active }, `<${node.name}>`)

  const own = OWN_BY_TAG[node.name]
  const ops: Op[] = t.ops
  const text: TextProps = { ...t.text }
  for (const [name, value] of Object.entries(node.attrs)) {
    if (OWN.has(name) || own?.has(name)) continue
    const op = attr_op(name, value, node.name)
    if (op) ops.push(op)
  }
  const color = node.attrs.color
  if (color !== undefined && color !== null) {
    const c = is_color(color) ? color : typeof color === "string" ? parse_color(color) : null
    if (c) text.color = c
    else warn_once(`color:${String(color)}`, `<${node.name}> color=${String(color)}: not a colour; ignored`)
  }
  const font = node.attrs.font
  if (is_text_style(font)) {
    // A whole style replaces what CSS would have inherited; this element's own CSS still applies on top.
    text.font = font
    for (const k of ["size", "weight", "line_height", "line_factor", "tracking", "tracking_em", "family", "italic"] as const) {
      if (!(k in t.text)) (text as Record<string, unknown>)[k] = undefined
    }
  }

  const resolved: Resolved = { direction: t.direction, hidden: t.hidden, ops, text, uses_vars, generation }
  node.resolved = resolved
  return resolved
}

function is_text_style(v: unknown): v is TextStyle {
  return v instanceof TextStyle || (typeof v === "object" && v !== null && "size" in v && typeof (v as { lh?: unknown }).lh === "function")
}

/** The inherited props with this element's own on top (`undefined` fields don't override). */
function inherit(parent: TextProps, own: TextProps): TextProps {
  const out: TextProps = { ...parent }
  for (const [k, v] of Object.entries(own)) {
    if (v !== undefined || k in own) (out as Record<string, unknown>)[k] = v
  }
  // A `font` attribute resets the CSS overrides above it; `inherit`'s caller cleared them in `own`.
  return out
}

const GENERIC = new Set(["sans-serif", "system-ui", "-apple-system", "inherit", "initial", "ui-sans-serif", "sans"])
const MONO = new Set(["monospace", "ui-monospace", "mono", "sfmono-regular", "menlo", "consolas"])

/** The TextStyle `props` describe: the `font` attribute's, or `type_.BODY`, with CSS fields over it. */
export function make_font(props: TextProps): TextStyle {
  const base = props.font ?? tok.type_.BODY
  const { size, weight, line_height, line_factor, tracking, tracking_em, family, italic } = props
  if (size === undefined && weight === undefined && line_height === undefined && line_factor === undefined && tracking === undefined && tracking_em === undefined && family === undefined && !italic) {
    return base
  }
  const s_size = size ?? base.size
  let s = size === undefined && weight === undefined ? base : TextStyle.new(s_size, weight ?? base.weight)
  const lh = line_height ?? (line_factor !== undefined ? line_factor * s_size : size === undefined ? undefined : 0)
  if (lh !== undefined && lh > 0) s = s.lh(lh)
  const tr = tracking ?? (tracking_em !== undefined ? tracking_em * s_size : undefined)
  if (tr !== undefined) s = s.tracking(tr)
  if (family !== undefined) {
    const first = family.split(",")[0]!.trim().replace(/^["']|["']$/g, "")
    const lower = first.toLowerCase()
    if (MONO.has(lower)) s = s.mono()
    else if (!GENERIC.has(lower)) s = s.family({ Named: first })
  }
  if (italic) s = s.italic()
  return s
}

/** Calls each op on `el`, cloning class values (a builder moves them) and reporting a failure once. */
export function apply(e: El, ops: Op[], where: string): El {
  let out = e as unknown as Record<string, (...a: unknown[]) => El>
  for (const [method, args] of ops) {
    const f = out[method]
    if (typeof f !== "function") {
      warn_once(`apply:${where}:${method}`, `${where}: El has no method ${method}; ignored`)
      continue
    }
    try {
      out = f.apply(out, args.map(owned)) as unknown as Record<string, (...a: unknown[]) => El>
    } catch (error) {
      warn_once(`apply:${where}:${method}:${(error as Error).message}`, `${where}: ${method}(${args.map(show).join(", ")}) failed: ${(error as Error).message}`)
    }
  }
  return out as unknown as El
}

/**
 * Builders take non-`Copy` classes by value and move them, so a value held by an attribute is
 * cloned for each frame; records and primitives pass as they are.
 */
function owned(v: unknown): unknown {
  if (typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { clone?: unknown }).clone === "function") {
    return (v as { clone(): unknown }).clone()
  }
  return v
}

function show(v: unknown): string {
  if (typeof v === "function") return "fn"
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

const is_blank = (s: string) => s.trim() === ""

/** The text a text element shows: every descendant text node, whitespace collapsed as HTML does. */
function text_of(node: ShadowNode, pre: boolean): string {
  let out = ""
  const walk = (n: ShadowNode) => {
    for (let c = n.first; c; c = c.next) {
      if (c.kind === "text") out += c.data
      else if (c.kind === "element") walk(c)
    }
  }
  walk(node)
  return pre ? out : out.replace(/\s+/g, " ").trim()
}

/** The children of `node`, built. */
export function build_children(node: ShadowNode, ctx: Ctx): El[] {
  const out: El[] = []
  for (let c = node.first; c; c = c.next) {
    if (c.kind === "element") {
      const built = build_node(c, ctx)
      if (built) out.push(built)
    } else if (c.kind === "text" && !is_blank(c.data)) {
      out.push(text_el(c.data.replace(/\s+/g, " ").trim(), `n${c.id}`, ctx.text))
    }
  }
  return out
}

function text_el(content: string, key: string, props: TextProps): El {
  let e = text(content).key(key).font(make_font(props))
  if (props.color) e = e.color(props.color)
  if (props.align) e = e.align(props.align)
  return e
}

function key_of(node: ShadowNode): string {
  const k = node.attrs.key
  return k === undefined || k === null || k === "" ? `n${node.id}` : String(k)
}

/** One element and its subtree, or null when it builds nothing (`display: none`). */
export function build_node(node: ShadowNode, ctx: Ctx): El | null {
  const r = resolve(node)
  if (r.hidden) return null
  const name = node.name
  const where = `<${name}>`
  const tag_text = TEXT_TAGS[name]
  const own_text = tag_text ? inherit(tag_text, r.text) : r.text
  const props = inherit(ctx.text, own_text)
  const inner: Ctx = { cx: ctx.cx, layer: ctx.layer, text: props }

  if (tag_text) {
    const pre = r.ops.some(([m]) => m === "wrap") && /pre/.test(String(node.attrs.style ?? ""))
    const e = apply(text_el(text_of(node, pre), key_of(node), props), r.ops, where)
    return wire(e, node)
  }

  switch (name) {
    case "input":
    case "textarea":
      return build_input(node, r, props, where)
    case "raw":
      return build_raw(node, r, inner, where)
    case "icon": {
      const i = node.attrs.icon
      if (!i) {
        warn_once(`icon:${node.id}`, `<icon> needs icon={...}; built nothing`)
        return null
      }
      const size = typeof node.attrs.size === "number" ? node.attrs.size : Number(node.attrs.size ?? props.size ?? 16)
      let e = icon(owned(i) as Parameters<typeof icon>[0], size).key(key_of(node))
      if (props.color) e = e.color(props.color)
      return wire(apply(e, r.ops, where), node)
    }
    case "rich": {
      const content = typeof node.attrs.content === "string" ? node.attrs.content : text_of(node, false)
      let e = rich(content, []).key(key_of(node)).font(make_font(props))
      if (props.color) e = e.color(props.color)
      return wire(apply(e, r.ops, where), node)
    }
    case "canvas": {
      const shape = node.attrs.shape
      if (!shape) return null
      return wire(apply(canvas(owned(shape) as Parameters<typeof canvas>[0]).key(key_of(node)), r.ops, where), node)
    }
  }

  let e: El
  if (name === "spacer") e = spacer()
  else if (name === "effect") e = effect(Number(node.attrs.mark ?? 0))
  else {
    let direction = r.direction
    if (!direction) {
      if (name === "column") direction = "col"
      else if (name === "row" || name === "el") direction = "row"
      else {
        // An HTML box stacks its children, unless it is a flex container (then a row, as in CSS).
        direction = /display\s*:\s*(inline-)?flex/.test(declared(node)) ? "row" : "col"
        if (!HTML_BOXES.has(name) && !RUNE_BOXES.has(name) && !warned_tags.has(name)) {
          warned_tags.add(name)
          console.warn(`[runex-svelte] <${name}> is not a Rune element; rendering it as a box (<el>/<column>/<row>/<text>/<input>...)`)
        }
      }
    }
    e = direction === "col" ? col() : name === "el" ? el() : row()
  }
  e = e.key(key_of(node))
  if (name === "button") e = e.role("button").focusable(true)
  e = apply(e, r.ops, where)
  const children = build_children(node, inner)
  if (children.length > 0) e = e.children(children)
  return wire(e, node)
}

/** The declarations text an element's display comes from (class rules and `style`), for the flex check. */
function declared(node: ShadowNode): string {
  let out = typeof node.attrs.style === "string" ? node.attrs.style : ""
  for (const rule of matching_rules(node)) {
    if (rule.pseudo === null) out = rule.decls.map(([p, v]) => `${p}: ${v}`).join("; ") + "; " + out
  }
  return out
}

function build_input(node: ShadowNode, r: Resolved, props: TextProps, where: string): El {
  const edit = (node.edit ??= TextEdit.new(String(node.attrs.value ?? "")))
  let e = text_input(edit, make_font(props))
    .key(key_of(node))
    .on_edit(() => edit)
  if (node.name === "input" && node.attrs.multiline === undefined) e = e.single_line()
  if (node.attrs.type === "password") e = e.secure()
  if (props.color) e = e.color(props.color)
  const placeholder = node.attrs.placeholder
  if (typeof placeholder === "string" && placeholder !== "") {
    const pc = node.attrs.placeholder_color
    const c = (is_color(pc) ? pc : typeof pc === "string" ? parse_color(pc) : null) ?? dim(props.color)
    e = e.placeholder(placeholder, c)
  }
  e = apply(e, r.ops, where)
  return wire(e, node, (method) => (method.startsWith("on_input") || method === "on_submit" ? { value: edit.text } : {}))
}

/** A placeholder's colour: the text colour at 45%, or a mid grey. */
function dim(c: Color | undefined): Color {
  return (c ? { r: c.r, g: c.g, b: c.b, a: c.a * 0.45 } : { r: 0.5, g: 0.5, b: 0.5, a: 0.6 }) as Color
}

function build_raw(node: ShadowNode, r: Resolved, ctx: Ctx, where: string): El | null {
  const build = node.attrs.build
  if (typeof build !== "function") {
    warn_once(`raw:${node.id}`, `<raw> needs build={(ctx) => El}; built nothing`)
    return null
  }
  const context: BuildContext = {
    kit: get_kit(),
    layer: ctx.layer,
    cx: ctx.cx,
    children: () => build_children(node, ctx),
    color: ctx.text.color ?? null,
    font: make_font(ctx.text),
    handler,
  }
  let e: El | null
  try {
    e = (build as (c: BuildContext) => El | null)(context)
  } catch (error) {
    console.error(`[runex-svelte] <raw> build failed:`, error)
    return null
  }
  if (!e) return null
  // Kit components key their own parts (a Select's trigger anchors its popup by key), so only an explicit key replaces theirs.
  if (node.attrs.key !== undefined && node.attrs.key !== null) e = e.key(String(node.attrs.key))
  return wire(apply(e, r.ops, where), node)
}
