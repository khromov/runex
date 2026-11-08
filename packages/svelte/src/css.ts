// CSS to El builder calls. Declarations from class rules and the `style` attribute are merged in
// cascade order into one map (later wins, a shorthand clears the longhands before it), then each
// property becomes one or more `[method, args]` ops. Rune has no cascade, selectors or units of
// its own, so lengths are points (`px`, `rem` = 16px, a bare number), percentages exist only for
// widths (and `100%` heights), and what has no Rune counterpart is dropped with a one-time warning.
import { Shadow } from "runex-js"
import { parse_color } from "./color.ts"
import type { Op, TextProps } from "./types.ts"

export type Declarations = Map<string, string>

/** What a set of declarations comes to: builder ops plus what only the El builder can act on. */
export interface Translated {
  direction: "row" | "col" | null
  hidden: boolean
  ops: Op[]
  text: TextProps
}

const warned = new Set<string>()

export function warn_once(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[runex-svelte] ${message}`)
}

/** For tests: forget which warnings were printed. */
export function reset_warnings() {
  warned.clear()
}

/** `a: b; c: d` → [[a, b], [c, d]], skipping comments and empty declarations. */
export function parse_declarations(css: string): [string, string][] {
  const out: [string, string][] = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "")
  let depth = 0
  let cur = ""
  const flush = () => {
    const at = cur.indexOf(":")
    if (at > 0) {
      const prop = cur.slice(0, at).trim().toLowerCase()
      const value = cur.slice(at + 1).trim().replace(/\s*!\s*important$/i, "")
      if (prop && value) out.push([prop, value])
    }
    cur = ""
  }
  for (const ch of text) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === ";" && depth === 0) flush()
    else cur += ch
  }
  flush()
  return out
}

/** Longhands a shorthand resets when it comes later in the cascade. */
const LONGHANDS: Record<string, string[]> = {
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left", "padding-inline", "padding-block"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left", "margin-inline", "margin-block"],
  border: ["border-width", "border-color", "border-style"],
  background: ["background-color", "background-image"],
  gap: ["row-gap", "column-gap"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  overflow: ["overflow-x", "overflow-y"],
  font: ["font-size", "font-weight", "font-family", "font-style", "line-height"],
  inset: ["top", "right", "bottom", "left"],
}

/** Adds `decls` to `into` in cascade order. */
export function merge(into: Declarations, decls: [string, string][]) {
  for (const [prop, value] of decls) {
    for (const long of LONGHANDS[prop] ?? []) into.delete(long)
    into.delete(prop) // re-inserted last, so iteration order is cascade order
    into.set(prop, value)
  }
}

let vars = new Map<string, string>()

/** Bumped by every `set_vars` that changed something; resolved styles remember it. */
export let generation = 0

/** `set_css_vars`: `{ surface: "#fff" }` for `var(--surface)`. Returns whether anything changed. */
export function set_vars(next: Record<string, string | number | null | undefined>): boolean {
  let changed = false
  for (const [name, value] of Object.entries(next)) {
    const key = name.startsWith("--") ? name.slice(2) : name
    const v = value == null ? undefined : String(value)
    if (vars.get(key) === v) continue
    changed = true
    if (v === undefined) vars.delete(key)
    else vars.set(key, v)
  }
  if (changed) generation++
  return changed
}

export function reset_vars() {
  vars = new Map()
  generation++
}

/** Replaces each `var(--name[, fallback])`; null when one is undefined and has no fallback. */
export function substitute(value: string): string | null {
  let out = value
  for (let i = 0; i < 16 && out.includes("var("); i++) {
    let missing = false
    out = out.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, name: string, fallback?: string) => {
      const v = vars.get(name) ?? fallback?.trim()
      if (v === undefined) {
        missing = true
        warn_once(`var:${name}`, `var(--${name}) is not defined (set_css_vars) and has no fallback; the declaration is dropped`)
        return ""
      }
      return v
    })
    if (missing) return null
  }
  return out
}

/** Points from `12px`, `1.5rem`, `0`, `12`; null for anything else (`%`, `em`, `auto`). */
export function length(v: string): number | null {
  const s = v.trim().toLowerCase()
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)?$/.exec(s)
  if (!m) return null
  const n = parseFloat(m[1]!)
  return m[2] === "rem" ? n * 16 : n
}

/** Splits a value at top-level whitespace (`1px solid rgb(0 0 0 / 50%)` → 3 parts). */
export function words(v: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of v.trim()) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** Splits at top-level commas. */
function commas(v: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of v) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** 1-4 box values (top right bottom left, CSS order). */
function box(v: string): [number, number, number, number] | null {
  const parts = words(v).map(length)
  if (parts.length === 0 || parts.length > 4 || parts.some((p) => p === null)) return null
  const [t, r = t, b = t, l = r] = parts as number[]
  return [t!, r!, b!, l!]
}

function angle(v: string): number | null {
  const m = /^(-?[\d.]+)(deg|rad|turn|grad)?$/.exec(v.trim())
  if (!m) return null
  const n = parseFloat(m[1]!)
  switch (m[2]) {
    case "rad":
      return n
    case "turn":
      return n * 2 * Math.PI
    case "grad":
      return (n / 400) * 2 * Math.PI
    default:
      return (n / 180) * Math.PI
  }
}

const SIDES: Record<string, number> = { top: 0, right: Math.PI / 2, bottom: Math.PI, left: (3 * Math.PI) / 2 }

/** `linear-gradient(<angle>|to <side>, color [pos], ...)` → `linear_gradient(angle, stops)`. */
function gradient(v: string): Op | null {
  const m = /^linear-gradient\((.*)\)$/i.exec(v.trim())
  if (!m) return null
  const parts = commas(m[1]!)
  let a = Math.PI // CSS's default: to bottom
  if (parts[0] && (/^to\s/.test(parts[0]) || angle(parts[0]) !== null)) {
    const head = parts.shift()!
    if (head.startsWith("to ")) {
      const sides = head.slice(3).trim().split(/\s+/)
      const xs = sides.map((s) => SIDES[s]).filter((x): x is number => x !== undefined)
      if (xs.length === 0) return null
      // Two sides (to bottom right) point at the corner: the mean of their angles.
      a = xs.length === 2 && sides.includes("top") && sides.includes("left") ? (7 * Math.PI) / 4 : xs.reduce((s, x) => s + x, 0) / xs.length
    } else a = angle(head)!
  }
  const stops: [number, unknown][] = []
  parts.forEach((part, i) => {
    const w = words(part)
    const c = parse_color(w[0] ?? "")
    if (!c) return
    const pos = w[1]?.endsWith("%") ? parseFloat(w[1]) / 100 : parts.length === 1 ? 0 : i / (parts.length - 1)
    stops.push([pos, c])
  })
  if (stops.length < 2) return null
  return ["linear_gradient", [a, stops.slice(0, 8)]]
}

/** `x y [blur [spread]] color [inset]`, the first of a list. */
function shadow(v: string): Shadow | null {
  const first = commas(v)[0]
  if (!first || first === "none") return null
  const parts = words(first)
  let inset = false
  let col = null
  const nums: number[] = []
  for (const p of parts) {
    if (p === "inset") inset = true
    else if (length(p) !== null) nums.push(length(p)!)
    else col = parse_color(p)
  }
  if (nums.length < 2 || !col) return null
  return new Shadow({ x: nums[0]!, y: nums[1]!, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color: col, inset })
}

const CURSORS: Record<string, string> = {
  default: "Default",
  auto: "Default",
  pointer: "Pointer",
  text: "Text",
  grab: "Grab",
  grabbing: "Grabbing",
  "not-allowed": "NotAllowed",
  move: "Move",
  "col-resize": "ResizeColumn",
  "ew-resize": "ResizeColumn",
  "row-resize": "ResizeRow",
  "ns-resize": "ResizeRow",
  crosshair: "Crosshair",
  none: "Hidden",
}

const ALIGN_ITEMS: Record<string, string> = {
  center: "items_center",
  "flex-start": "items_start",
  start: "items_start",
  "flex-end": "items_end",
  end: "items_end",
  stretch: "items_stretch",
}

const ALIGN_SELF: Record<string, string> = {
  center: "self_center",
  "flex-start": "self_start",
  start: "self_start",
  "flex-end": "self_end",
  end: "self_end",
  stretch: "self_stretch",
}

const JUSTIFY: Record<string, string> = {
  center: "justify_center",
  "flex-start": "justify_start",
  start: "justify_start",
  "flex-end": "justify_end",
  end: "justify_end",
  "space-between": "justify_between",
  "space-around": "justify_around",
  "space-evenly": "justify_evenly",
}

const TEXT_ALIGN: Record<string, TextProps["align"]> = {
  left: "Start",
  start: "Start",
  center: "Center",
  right: "End",
  end: "End",
}

const WEIGHTS: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 }

/** Properties with no Rune counterpart that are common enough to name in the warning. */
const NO_EQUIVALENT: Record<string, string> = {
  transition: "use the `motion` attribute (a Spring, such as tok.motion.SNAPPY) to animate changes",
  animation: "use the `motion`, `looping` or `sequence` attributes",
  "z-index": "paint order is document order; `raise` lifts an element",
  "box-sizing": "Rune sizes boxes as border-box already",
}

/**
 * Translates merged declarations (already cascaded) for an element named `tag` into ops.
 * `pseudo` holds the `:hover` and `:active` declarations, which Rune expresses as `hover(color)`
 * and `press(color)` fills.
 */
export function translate(decls: Declarations, pseudo: { hover?: Declarations; active?: Declarations } = {}, where = "style"): Translated {
  const out: Translated = { direction: null, hidden: false, ops: [], text: {} }
  const ops = out.ops
  const get = (p: string) => {
    const v = decls.get(p)
    return v === undefined ? undefined : (substitute(v) ?? undefined)
  }
  const bad = (prop: string, value: string, why = "") =>
    warn_once(`${prop}:${value}`, `${where}: \`${prop}: ${value}\` has no Rune equivalent${why ? ` (${why})` : ""}; dropped`)

  // Absolute positioning reads four properties together.
  let position: string | undefined
  const inset: { top?: number; right?: number; bottom?: number; left?: number } = {}
  let border_width: number | undefined
  let border_color: unknown
  let outline: [number, unknown] | undefined
  let outline_offset = 0
  let radius_seen: number | undefined

  for (const [prop, raw] of decls) {
    const value = get(prop)
    if (value === undefined) continue
    const v = value.trim()
    const lower = v.toLowerCase()
    const len = length(v)
    switch (prop) {
      case "width":
        if (lower === "100%") ops.push(["w_full", []])
        else if (lower.endsWith("%")) ops.push(["w_frac", [parseFloat(lower) / 100]])
        else if (len !== null) ops.push(["w", [len]])
        else if (lower !== "auto") bad(prop, v)
        break
      case "height":
        if (lower === "100%") ops.push(["h_full", []])
        else if (len !== null) ops.push(["h", [len]])
        else if (lower !== "auto") bad(prop, v, "heights take points or 100%")
        break
      case "min-width":
      case "max-width":
      case "min-height":
      case "max-height": {
        const method = (prop.startsWith("min") ? "min_" : "max_") + (prop.endsWith("width") ? "w" : "h")
        if (len !== null) ops.push([method, [len]])
        else if (lower !== "none" && lower !== "auto") bad(prop, v)
        break
      }
      case "padding": {
        const b = box(v)
        if (!b) bad(prop, v)
        else if (b.every((x) => x === b[0])) ops.push(["padding", [b[0]]])
        else ops.push(["pt", [b[0]]], ["pr", [b[1]]], ["pb", [b[2]]], ["pl", [b[3]]])
        break
      }
      case "padding-top":
      case "padding-right":
      case "padding-bottom":
      case "padding-left":
        if (len === null) bad(prop, v)
        else ops.push([`p${prop[8]}`, [len]])
        break
      case "padding-inline":
      case "padding-block": {
        const b = words(v).map(length)
        if (b.length === 0 || b.some((x) => x === null)) bad(prop, v)
        else if (prop === "padding-inline") ops.push(["pl", [b[0]]], ["pr", [b[1] ?? b[0]]])
        else ops.push(["pt", [b[0]]], ["pb", [b[1] ?? b[0]]])
        break
      }
      case "margin": {
        const b = box(v)
        if (!b) bad(prop, v, "margins take points; `auto` has no equivalent, use justify/align or a spacer")
        else ops.push(["mt", [b[0]]], ["mr", [b[1]]], ["mb", [b[2]]], ["ml", [b[3]]])
        break
      }
      case "margin-top":
      case "margin-right":
      case "margin-bottom":
      case "margin-left":
        if (len === null) bad(prop, v)
        else ops.push([`m${prop[7]}`, [len]])
        break
      case "margin-inline":
      case "margin-block": {
        const b = words(v).map(length)
        if (b.length === 0 || b.some((x) => x === null)) bad(prop, v)
        else if (prop === "margin-inline") ops.push(["ml", [b[0]]], ["mr", [b[1] ?? b[0]]])
        else ops.push(["mt", [b[0]]], ["mb", [b[1] ?? b[0]]])
        break
      }
      case "gap": {
        const g = words(v).map(length)
        if (g.length === 0 || g.some((x) => x === null)) bad(prop, v)
        else if (g.length === 1 || g[0] === g[1]) ops.push(["gap", [g[0]]])
        else ops.push(["gaps", [g[0], g[1]]])
        break
      }
      case "row-gap":
      case "column-gap": {
        if (len === null) {
          bad(prop, v)
          break
        }
        const other = length(get(prop === "row-gap" ? "column-gap" : "row-gap") ?? "")
        if (prop === "row-gap") ops.push(["gaps", [len, other ?? 0]])
        else if (!decls.has("row-gap")) ops.push(["gaps", [0, len]])
        break
      }
      case "background":
      case "background-color":
      case "background-image": {
        if (lower === "none") break
        if (lower.startsWith("linear-gradient(")) {
          const g = gradient(v)
          if (g) ops.push(g)
          else bad(prop, v)
          break
        }
        const c = parse_color(v)
        if (c) ops.push(["fill", [c]])
        else bad(prop, v, "colours and linear-gradient() only")
        break
      }
      case "color": {
        const c = parse_color(v)
        if (c) out.text.color = c
        else if (lower !== "inherit" && lower !== "currentcolor") bad(prop, v)
        break
      }
      case "border": {
        if (lower === "none" || lower === "0") break
        for (const w of words(v)) {
          if (length(w) !== null) border_width = length(w)!
          else if (parse_color(w)) border_color = parse_color(w)
          else if (!/^(solid|dashed|dotted|double)$/.test(w)) bad(prop, v)
          if (w === "dashed") ops.push(["border_dash", [4, 4]])
          else if (w === "dotted") ops.push(["border_dash", [1, 2]])
        }
        border_width ??= 1
        break
      }
      case "border-width":
        if (len === null) bad(prop, v, "one width for all sides")
        else border_width = len
        break
      case "border-color":
        border_color = parse_color(v) ?? (bad(prop, v), undefined)
        break
      case "border-style":
        if (lower === "dashed") ops.push(["border_dash", [4, 4]])
        else if (lower === "dotted") ops.push(["border_dash", [1, 2]])
        break
      case "border-radius": {
        if (/%$/.test(lower)) {
          // Rune clamps a radius to half the shorter side, so `50%` is a circle or pill.
          if (parseFloat(lower) >= 50) ops.push(["radius", [1e4]])
          else bad(prop, v, "percentages other than 50% need a size; use points")
          break
        }
        const b = box(v)
        if (!b) bad(prop, v)
        else if (b.every((x) => x === b[0])) {
          ops.push(["radius", [b[0]]])
          radius_seen = b[0]
        } else ops.push(["corners", [[b[0], b[1], b[2], b[3]]]])
        break
      }
      case "opacity": {
        const n = lower.endsWith("%") ? parseFloat(lower) / 100 : parseFloat(lower)
        if (Number.isFinite(n)) ops.push(["opacity", [n]])
        else bad(prop, v)
        break
      }
      case "box-shadow": {
        if (lower === "none") break
        const s = shadow(v)
        if (s) ops.push(["box_shadow", [s]])
        else bad(prop, v)
        break
      }
      case "display":
        if (lower === "none") out.hidden = true
        else if (lower === "grid") bad(prop, v, "use `equal_columns` for a grid of equal columns")
        break
      case "visibility":
        if (lower === "hidden") ops.push(["opacity", [0]])
        break
      case "flex-direction":
        if (lower === "row" || lower === "row-reverse") out.direction = "row"
        else if (lower === "column" || lower === "column-reverse") out.direction = "col"
        if (lower.endsWith("-reverse")) bad(prop, v, "no reversed direction")
        break
      case "flex-wrap":
        if (lower === "wrap") ops.push(["flex_wrap", []])
        break
      case "flex": {
        if (lower === "none" || lower === "auto") break
        const grow = parseFloat(words(v)[0] ?? "")
        if (Number.isFinite(grow)) {
          if (grow > 0) ops.push(["grow", [grow]])
          const shrink = parseFloat(words(v)[1] ?? "1")
          if (shrink > 0 && grow > 0) ops.push(["shrink", []])
        } else bad(prop, v)
        break
      }
      case "flex-grow": {
        const g = parseFloat(lower)
        if (Number.isFinite(g)) ops.push(["grow", [g]])
        else bad(prop, v)
        break
      }
      case "flex-shrink":
        if (parseFloat(lower) > 0) ops.push(["shrink", []])
        break
      case "flex-basis":
        if (lower !== "auto" && lower !== "0" && lower !== "0px" && lower !== "0%") bad(prop, v, "set width or height instead")
        break
      case "align-items":
        if (ALIGN_ITEMS[lower]) ops.push([ALIGN_ITEMS[lower]!, []])
        else if (lower !== "normal") bad(prop, v)
        break
      case "align-self":
        if (ALIGN_SELF[lower]) ops.push([ALIGN_SELF[lower]!, []])
        else if (lower !== "auto") bad(prop, v)
        break
      case "justify-content":
        if (JUSTIFY[lower]) ops.push([JUSTIFY[lower]!, []])
        else if (lower !== "normal") bad(prop, v)
        break
      case "position":
        position = lower
        if (lower !== "absolute" && lower !== "relative" && lower !== "static") bad(prop, v, "absolute only")
        break
      case "top":
      case "right":
      case "bottom":
      case "left":
        if (len === null) bad(prop, v, "points only")
        else inset[prop] = len
        break
      case "inset": {
        const b = box(v)
        if (!b) bad(prop, v)
        else [inset.top, inset.right, inset.bottom, inset.left] = b
        break
      }
      case "overflow":
      case "overflow-y":
        if (lower === "auto" || lower === "scroll") ops.push(["scroll", [{ stick_bottom: false }]])
        else if (lower === "hidden" || lower === "clip") ops.push(["clip_rounded", [radius_seen ?? 0]])
        else if (lower !== "visible") bad(prop, v)
        break
      case "overflow-x":
        if (lower === "auto" || lower === "scroll") ops.push(["scroll_x", []])
        else if (lower === "hidden" || lower === "clip") ops.push(["clip_rounded", [radius_seen ?? 0]])
        break
      case "cursor":
        if (CURSORS[lower]) ops.push(["cursor", [CURSORS[lower]]])
        else bad(prop, v)
        break
      case "transform":
        for (const fn of words(v)) {
          const m = /^([a-zA-Z]+)\((.*)\)$/.exec(fn)
          if (!m) {
            bad(prop, v)
            continue
          }
          const parts = commas(m[2]!).flatMap((p) => words(p))
          const name = m[1]!.toLowerCase()
          if (name === "scale") ops.push(["scale", [parseFloat(parts[0]!)]])
          else if (name === "rotate") {
            const a = angle(parts[0] ?? "")
            if (a !== null) ops.push(["rotate", [a]])
            else bad(prop, v)
          } else if (name === "translate" || name === "translatex" || name === "translatey") {
            const x = name === "translatey" ? 0 : (length(parts[0] ?? "") ?? NaN)
            const y = name === "translate" ? (length(parts[1] ?? "0") ?? NaN) : name === "translatey" ? (length(parts[0] ?? "") ?? NaN) : 0
            if (Number.isFinite(x) && Number.isFinite(y)) ops.push(["offset", [x, y]])
            else bad(prop, v, "translate takes points")
          } else bad(prop, v)
        }
        break
      case "filter":
      case "backdrop-filter": {
        const m = /^blur\((.*)\)$/.exec(lower)
        const n = m ? length(m[1]!) : null
        if (n !== null) ops.push([prop === "filter" ? "blur" : "backdrop_blur", [n]])
        else if (lower !== "none") bad(prop, v, "blur() only")
        break
      }
      case "aspect-ratio": {
        const m = /^([\d.]+)\s*(?:\/\s*([\d.]+))?$/.exec(lower)
        if (m) ops.push(["aspect_ratio", [parseFloat(m[1]!) / (m[2] ? parseFloat(m[2]) : 1)]])
        else if (lower !== "auto") bad(prop, v)
        break
      }
      case "font-size":
        if (len === null) bad(prop, v, "points only")
        else out.text.size = len
        break
      case "font-weight": {
        const w = WEIGHTS[lower] ?? parseFloat(lower)
        if (Number.isFinite(w)) out.text.weight = w
        else bad(prop, v)
        break
      }
      case "line-height":
        if (/^[\d.]+$/.test(lower)) out.text.line_factor = parseFloat(lower)
        else if (len !== null) out.text.line_height = len
        else if (lower !== "normal") bad(prop, v)
        break
      case "letter-spacing":
        // Rune's tracking is in points; `em` is resolved against the font size when it's built.
        if (/^-?[\d.]+em$/.test(lower)) out.text.tracking_em = parseFloat(lower)
        else if (len !== null) out.text.tracking = len
        else if (lower !== "normal") bad(prop, v)
        break
      case "font-family":
        out.text.family = v
        break
      case "font-style":
        out.text.italic = lower === "italic" || lower === "oblique"
        break
      case "text-align":
        if (TEXT_ALIGN[lower]) out.text.align = TEXT_ALIGN[lower]
        else bad(prop, v)
        break
      case "white-space":
      case "text-wrap":
        if (lower === "normal" || lower === "pre-wrap" || lower === "wrap" || lower === "pre-line") ops.push(["wrap", []])
        break
      case "word-break":
      case "overflow-wrap":
        if (lower === "break-all" || lower === "anywhere" || lower === "break-word") ops.push(["wrap_anywhere", []])
        break
      case "text-overflow":
        if (lower === "ellipsis") ops.push(["truncate", []])
        break
      case "-webkit-line-clamp":
      case "line-clamp": {
        const n = parseInt(lower)
        if (n > 0) ops.push(["max_lines", [n]], ["truncate", []])
        break
      }
      case "text-transform":
        if (lower === "uppercase") ops.push(["text_case", ["Uppercase"]])
        else if (lower === "lowercase") ops.push(["text_case", ["Lowercase"]])
        else if (lower !== "none") bad(prop, v)
        break
      case "outline": {
        if (lower === "none" || lower === "0") break
        let w = 1
        let c: unknown = null
        for (const part of words(v)) {
          if (length(part) !== null) w = length(part)!
          else c = parse_color(part) ?? c
        }
        if (c) outline = [w, c]
        else bad(prop, v)
        break
      }
      case "outline-offset":
        outline_offset = len ?? 0
        break
      case "pointer-events":
        if (lower === "none") ops.push(["inert", []])
        break
      case "user-select":
        if (lower === "none") ops.push(["selectable", [false]])
        else if (lower === "text" || lower === "all") ops.push(["selectable", [true]])
        break
      default:
        if (prop.startsWith("--")) break // a custom property declared in a rule is just a name here
        if (NO_EQUIVALENT[prop]) warn_once(`prop:${prop}`, `${where}: \`${prop}\` has no Rune equivalent: ${NO_EQUIVALENT[prop]}`)
        else warn_once(`prop:${prop}`, `${where}: \`${prop}: ${raw}\` is not supported; dropped`)
    }
  }

  if (border_width !== undefined || border_color !== undefined) {
    if (border_color === undefined) warn_once(`border-color:${where}`, `${where}: a border needs a colour (border: 1px solid #333); dropped`)
    else if ((border_width ?? 1) > 0) ops.push(["border", [border_width ?? 1, border_color]])
  }
  if (outline) ops.push(["outline", [outline[0], outline_offset, outline[1]]])
  if (position === "absolute") {
    const { top, right, bottom, left } = inset
    if (right === undefined && bottom === undefined) ops.push(["absolute", [left ?? 0, top ?? 0]])
    else ops.push(["pin", [left ?? null, top ?? null, right ?? null, bottom ?? null]])
  } else if (Object.keys(inset).length > 0 && position !== "relative") {
    warn_once(`inset:${where}`, `${where}: top/right/bottom/left need \`position: absolute\`; dropped`)
  } else if (position === "relative" && (inset.left !== undefined || inset.top !== undefined)) {
    ops.push(["offset", [inset.left ?? 0, inset.top ?? 0]])
  }

  for (const [state, method] of [
    ["hover", "hover"],
    ["active", "press"],
  ] as const) {
    const d = pseudo[state]
    if (!d) continue
    for (const [prop, raw] of d) {
      const v = substitute(raw)
      if (v === null) continue
      if (prop === "background" || prop === "background-color") {
        const c = parse_color(v)
        if (c) ops.push([method, [c]])
        else warn_once(`:${state}:${v}`, `${where}: \`:${state} { ${prop}: ${v} }\` needs a plain colour; dropped`)
      } else if (state === "active" && prop === "transform" && /^scale\(/.test(v)) {
        ops.push(["press_scale", [parseFloat(v.slice(6))]])
      } else {
        warn_once(`:${state}:${prop}`, `${where}: \`:${state}\` can only change \`background\` in Rune${state === "active" ? " (and `transform: scale()`)" : ""}; \`${prop}\` dropped`)
      }
    }
  }
  return out
}
