// Attributes to El builder calls, name for name: `gap={16}` is `.gap(16)`, `w_full` is
// `.w_full()`, `size={[38, 22]}` (or `size="38 22"`) is `.size(38, 22)`. A static attribute
// arrives as a string, so it is coerced by the parameter's type: numbers (`16`, `16px`),
// booleans (present, `"true"`, `"false"`), colours (any CSS colour) and string enums.
import { parse_color, is_color } from "./color.ts"
import { length, warn_once } from "./css.ts"
import { EL_METHODS } from "./gen/el.ts"
import { handler } from "./runtime.ts"
import type { Op } from "./types.ts"

/** HTML spellings with an El counterpart. */
const ALIASES: Record<string, string> = {
  "aria-label": "label",
  "aria-description": "description",
  "aria-expanded": "expanded",
  "aria-checked": "checked",
  "aria-level": "level",
  "aria-hidden": "a11y_hidden",
  "aria-valuetext": "a11y_value",
  "aria-live": "live_region",
  tabindex: "tab_index",
  title: "help",
  hidden: "a11y_hidden",
}

/** What a value could not be coerced to. */
const INVALID = Symbol("invalid")

function coerce(kind: string, value: unknown): unknown {
  const nullable = kind.endsWith("?")
  const k = nullable ? kind.slice(0, -1) : kind
  if (value === null || value === undefined || value === "none") return nullable ? null : INVALID
  switch (k) {
    case "n": {
      if (typeof value === "number") return value
      if (typeof value === "string") return length(value) ?? (Number.isFinite(Number(value)) ? Number(value) : INVALID)
      return INVALID
    }
    case "b":
      if (typeof value === "boolean") return value
      if (value === "" || value === "true") return true
      if (value === "false") return false
      return INVALID
    case "s":
      return typeof value === "string" ? value : typeof value === "object" ? value : String(value)
    case "c":
      if (is_color(value)) return value
      if (typeof value === "string") return parse_color(value) ?? INVALID
      return INVALID
    case "f":
      return typeof value === "function" ? handler(value as (...a: unknown[]) => unknown) : INVALID
    case "v": {
      // A state handler: what it returns would replace Rune's state, so nothing is returned.
      if (typeof value !== "function") return INVALID
      const f = handler(value as (...a: unknown[]) => unknown)
      return (...args: unknown[]) => {
        f(...args)
      }
    }
    default:
      return value
  }
}

/** Splits a static multi-argument string: `"38 22"`, `"38, 22"`, `"1 #333"`. */
function split(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of value.trim()) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if ((ch === "," || /\s/.test(ch)) && depth === 0) {
      if (cur) out.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** The El method an attribute name means, if any: `w_full`, `w-full`, `aria-label`. */
export function method_for(name: string): string | null {
  const alias = ALIASES[name.toLowerCase()]
  if (alias) return alias
  if (EL_METHODS[name]) return name
  const snake = name.replace(/-/g, "_")
  return EL_METHODS[snake] ? snake : null
}

/**
 * The op an attribute comes to, `null` when it calls nothing (`w_full={false}`), or `undefined`
 * when it can't be applied (unknown name or a value that doesn't fit, warned about once).
 */
export function attr_op(name: string, value: unknown, where: string): Op | null | undefined {
  const method = method_for(name)
  if (method === null) {
    warn_once(`attr:${where}:${name}`, `<${where}> ${name}: not an El method or attribute this renderer knows; ignored`)
    return undefined
  }
  const kinds = EL_METHODS[method]!
  const fail = () => {
    warn_once(`attr:${where}:${name}:${String(value)}`, `<${where}> ${name}=${JSON.stringify(value) ?? String(value)}: expected ${describe(kinds)}; ignored`)
    return undefined
  }

  if (kinds.length === 0) {
    // A flag: present (or true) calls it, false/null leaves it out.
    if (value === false || value === null || value === undefined || value === "false") return null
    return [method, []]
  }

  if (kinds.length === 1) {
    // `disabled={false}` still calls `disabled(false)`; an absent value is a missing call.
    if (value === undefined) return null
    if (value === null && !kinds[0]!.endsWith("?")) return null
    const v = coerce(kinds[0]!, value)
    return v === INVALID ? fail() : [method, [v]]
  }

  if (value === null || value === undefined || value === false) return null
  const parts = Array.isArray(value) ? value : typeof value === "string" ? split(value) : null
  if (!parts) return fail()
  const required = kinds.filter((k) => !k.endsWith("?")).length
  if (parts.length < required || parts.length > kinds.length) return fail()
  const args: unknown[] = []
  for (let i = 0; i < kinds.length; i++) {
    const v = i < parts.length ? coerce(kinds[i]!, parts[i]) : null
    if (v === INVALID) return fail()
    args.push(v)
  }
  return [method, args]
}

const KIND_NAMES: Record<string, string> = { n: "number", b: "boolean", s: "string", c: "colour", f: "function", v: "function", x: "value" }

function describe(kinds: readonly string[]): string {
  if (kinds.length === 0) return "a flag"
  const names = kinds.map((k) => KIND_NAMES[k.replace("?", "")]! + (k.endsWith("?") ? " | null" : ""))
  return kinds.length === 1 ? names[0]! : `[${names.join(", ")}] (an array, or a string like "1 2")`
}
