// A snapshot of Rune's values as JavaScript reads them: theme tokens, motion constants, type
// styles, the kit palettes, the opencode theme, and every constant the bindings export, walked
// from the package's entry points. No GPU is involved, so the snapshot is the same on every
// platform. compare.ts can't see a token change (both sides move together); this file does.
//
// One line per value, keyed by its path: a deliberate change in Rune shows as a diff naming each
// value (`runex-js tok.theme(true).bg`). Colours are Rune's `Color.hex()`, sRGB at 8 bits: their
// linear-light floats differ by an ulp between platforms' libm (`powf`), their hex doesn't.
// Bless it with `bun test ./test/unit/values.test.ts --update-snapshots`.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHash } from "node:crypto"
import * as rune from "runex-js"
import * as fx from "runex-js/fx"
import * as kit from "runex-js/kit"
import * as knobs from "runex-js/knobs"
import * as light from "runex-js/light"
import * as motion from "runex-js/motion"
import * as opencode from "runex-js/theme-opencode"
import native from "../../native.cjs"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const ENTRIES: [string, object][] = [
  ["runex-js", rune],
  ["runex-js/fx", fx],
  ["runex-js/kit", kit],
  ["runex-js/knobs", knobs],
  ["runex-js/light", light],
  ["runex-js/motion", motion],
  ["runex-js/theme-opencode", opencode],
]

type Flat = Record<string, string | number | boolean | null>

const isModule = (v: unknown) => typeof v === "object" && v !== null && Object.prototype.toString.call(v) === "[object Module]"
const isPlain = (v: unknown) => typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex").slice(0, 16)

/** Values a class shows only through methods: the zero-argument reads that describe it. */
const READS: Record<string, (v: any) => Record<string, unknown>> = {
  MotionIntent: (v) => ({ bits: v.bits() }),
  SystemAccent: (v) => ({ "accent(true)": v.accent(true), "accent(false)": v.accent(false), "focus(true)": v.focus(true), "focus(false)": v.focus(false) }),
  TextStyle: (v) => ({ "line_px()": v.line_px() }),
}

/** The readable fields of `v`: its own, plus getters on its class (napi classes keep fields there). */
function fields(v: object): string[] {
  const keys = new Set(Object.keys(v))
  for (let p = Object.getPrototypeOf(v); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(p))) if (d.get) keys.add(k)
  }
  return [...keys].sort()
}

/** Writes `v` into `out` as one line per leaf, each keyed by its full path. */
function flatten(path: string, v: unknown, out: Flat, depth = 0) {
  if (depth > 12) throw new Error(`${path}: nested too deep`)
  if (v === null || v === undefined) out[path] = null
  else if (typeof v === "number") out[path] = Number.isFinite(v) ? v : String(v)
  else if (typeof v === "boolean") out[path] = v
  else if (typeof v === "string") out[path] = v.length > 160 ? `${v.length} chars, sha256 ${digest(v)}` : v
  else if (typeof v === "function") out[path] = "(function)"
  else if (ArrayBuffer.isView(v)) out[path] = `${v.byteLength} bytes, sha256 ${digest(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))}`
  else if (Array.isArray(v)) {
    if (v.length === 0) out[path] = "[]"
    v.forEach((item, i) => flatten(`${path}[${i}]`, item, out, depth + 1))
  } else if (typeof v === "object") {
    const name = isPlain(v) ? "" : (v.constructor?.name ?? "")
    const keys = fields(v)
    const o = v as Record<string, any>
    // Colours and icons on one line each, so a palette stays short and every line names its value.
    if (keys.join() === "a,b,g,r") {
      out[path] = v instanceof rune.Color ? v.hex() : `(${o.r}, ${o.g}, ${o.b}, ${o.a})`
      return
    }
    if (keys.join() === "body,name,view") {
      out[path] = `${o.name}, view ${o.view}, body ${o.body.length > 80 ? `${o.body.length} chars, sha256 ${digest(o.body)}` : o.body}`
      return
    }
    const reads = READS[name]?.(v) ?? {}
    for (const k of keys) flatten(`${path}.${k}`, (v as Record<string, unknown>)[k], out, depth + 1)
    for (const [k, r] of Object.entries(reads)) flatten(`${path}.${k}`, r, out, depth + 1)
    if (keys.length === 0 && Object.keys(reads).length === 0) out[path] = name ? `(${name}, no readable fields)` : "{}"
  }
}

/** Every constant reachable from `ns`: values that aren't functions, and classes' static values. */
function constants(path: string, ns: object, found: [string, unknown][], seen: Set<unknown>) {
  for (const k of Object.keys(ns).sort()) {
    const v = (ns as Record<string, unknown>)[k]
    const p = path.endsWith(" ") ? `${path}${k}` : `${path}.${k}`
    // An item bound under #[cfg] reads as undefined where it's absent (tools/bindgen/README.md).
    if (v === undefined) continue
    if (isModule(v)) {
      constants(p, v as object, found, seen)
    } else if (typeof v === "function" || (isPlain(v) && !/^[A-Z][A-Z0-9_]*$/.test(k))) {
      // A class, or an enum's helper object (named like a type, where a constant is UPPER_CASE):
      // its static values are associated constants.
      for (const sk of Object.keys(v as object).sort()) {
        const sv = (v as Record<string, unknown>)[sk]
        if (typeof sv !== "function") push(`${p}.${sk}`, sv)
      }
    } else push(p, v)
  }
  function push(p: string, v: unknown) {
    // The same constant re-exported under several paths is listed once, at its first path.
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return
      seen.add(v)
    }
    found.push([p, v])
  }
}

function walk(): [string, unknown][] {
  const found: [string, unknown][] = []
  const seen = new Set<unknown>()
  for (const [name, ns] of ENTRIES) constants(`${name} `, ns, found, seen)
  return found
}

/**
 * Constants whose value Rune picks per platform (`cfg!` in the initializer). The snapshot says
 * so instead of holding one platform's value; this table holds each platform's.
 */
const PER_PLATFORM: Record<string, Partial<Record<NodeJS.Platform, unknown>>> = {
  // AppKit's 4 pt, GTK's 8, Windows' 4 (vendor/rune/crates/rune/src/drag_out/mod.rs).
  "runex-js drag_out.DRAG_THRESHOLD": { darwin: 4, linux: 8, win32: 4 },
}

/** The native constants (`__C_*`): what the bindings generate, one per Rust constant. */
const NATIVE = Object.keys(native).filter((k) => k.startsWith("__C_")).sort()

function flat(value: unknown, path = "v"): string {
  const out: Flat = {}
  flatten(path, value, out)
  return JSON.stringify(out)
}

describe("value snapshot", () => {
  test("every generated constant is reachable from an entry point (or listed by native name)", () => {
    expect(NATIVE.length).toBeGreaterThanOrEqual(268)
    const walked = new Set(walk().map(([, v]) => flat(v)))
    const unreached = NATIVE.filter((name) => !walked.has(flat((native as unknown as Record<string, () => unknown>)[name]!())))
    // Constants no entry point exports (a module shadowed by a function, a private type): the
    // snapshot below lists them under their native names. Recorded so a change shows.
    expect(unreached).toMatchSnapshot()
  })

  test("constants (snapshot)", () => {
    const out: Flat = {}
    for (const [path, v] of walk()) flatten(path, v, out)
    const walked = new Set(walk().map(([, v]) => flat(v)))
    for (const name of NATIVE) {
      const v = (native as unknown as Record<string, () => unknown>)[name]!()
      if (!walked.has(flat(v))) flatten(`(native) ${name}`, v, out)
    }
    for (const [path, values] of Object.entries(PER_PLATFORM)) {
      expect(out[path]).toBe(values[process.platform] as number)
      out[path] = `(per platform: ${Object.entries(values).map(([os, v]) => `${os} ${v}`).join(", ")})`
    }
    expect(Object.keys(out).length).toBeGreaterThan(1000)
    expect(out).toMatchSnapshot()
  })

  test("theme tokens and accents (snapshot; tok.motion and tok.type_ are in the constants)", () => {
    const out: Flat = {}
    for (const dark of [true, false]) {
      flatten(`runex-js tok.theme(${dark})`, rune.tok.theme(dark), out)
      for (let i = 0; i < 6; i++) flatten(`runex-js tok.accent(${i}, ${dark})`, rune.tok.accent(i, dark), out)
    }
    expect(out["runex-js tok.theme(true).bg"]).toMatch(/^#[0-9a-f]{8}$/)
    expect(out).toMatchSnapshot()
  })

  test("kit palettes (snapshot)", () => {
    const out: Flat = {}
    for (const dark of [true, false]) flatten(`runex-js/kit Kit.neutral(${dark})`, kit.Kit.neutral(dark), out)
    const hex = (s: string) => rune.color.hex(s)!
    const seed = new kit.PaletteSeed({ bg: hex("#0a0a0a"), fg: hex("#ededed"), accent: hex("#e5484d") })
    flatten("runex-js/kit Kit.from_palette(#0a0a0a, #ededed, #e5484d)", kit.Kit.from_palette(seed), out)
    expect(out).toMatchSnapshot()
  })

  test("the opencode theme (snapshot)", () => {
    const out: Flat = {}
    const source = JSON.parse(opencode.THEME) as { light: Record<string, string>; numbers: Record<string, number> }
    // The scale steps (`amber-dark-1` ...) are the source's own; the named tokens are what apps use.
    const named = Object.keys(source.light).filter((n) => !/-\d+$/.test(n)).sort()
    for (const dark of [true, false]) {
      const theme = opencode.theme(dark)
      const at = `runex-js/theme-opencode theme(${dark})`
      flatten(`${at}.name`, theme.name, out)
      flatten(`${at}.dark`, theme.dark, out)
      for (const name of named) flatten(`${at}.color(${name})`, theme.color(name), out)
      for (const name of Object.keys(source.numbers).sort()) flatten(`${at}.num(${name})`, theme.num(name), out)
      flatten(`runex-js/theme-opencode brand(${dark})`, opencode.brand(dark), out)
      flatten(`runex-js/theme-opencode kit(${dark})`, opencode.kit(dark), out)
    }
    expect(named.length).toBeGreaterThan(50)
    expect(out).toMatchSnapshot()
  })
})
