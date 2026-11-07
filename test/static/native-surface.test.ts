// The loaded addon has everything ts/gen expects of it: every `$n.X` that ts/gen/types.ts reads
// is exported, and every method, getter and static a generated class declares is on the class or
// its prototype. A platform-gated item (`[cfg(..)]` in tools/bindgen/surface.txt) must be there
// exactly where its gate holds. Needs the built addon (native.cjs), no GPU.
// `bun test ./test/static`.
import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { join } from "node:path"
import { nativeRefs, surfaceLines } from "../../tools/bindgen/surface.ts"

const ROOT = join(import.meta.dir, "..", "..")
const native = createRequire(join(ROOT, "package.json"))("./native.cjs") as Record<string, any>

/** Whether a `#[cfg]` predicate holds here; undefined for names this can't decide. */
export function holdsHere(cfg: string): boolean | undefined {
  const os = ({ darwin: "macos", linux: "linux", win32: "windows" } as Record<string, string>)[process.platform]
  const family = process.platform === "win32" ? "windows" : "unix"
  let i = 0
  const s = cfg.replace(/\s+/g, "")
  const expr = (): boolean | undefined => {
    const name = /^[A-Za-z_]\w*/.exec(s.slice(i))?.[0]
    if (!name) throw new Error(`can't read cfg ${cfg}`)
    i += name.length
    if (s[i] === "(") {
      i++
      const parts: (boolean | undefined)[] = []
      while (s[i] !== ")") {
        parts.push(expr())
        if (s[i] === ",") i++
      }
      i++
      if (name === "not") return parts[0] === undefined ? undefined : !parts[0]
      if (name === "all") return parts.includes(false) ? false : parts.includes(undefined) ? undefined : true
      if (name === "any") return parts.includes(true) ? true : parts.includes(undefined) ? undefined : false
      return undefined
    }
    if (s[i] === "=") {
      const value = /^="([^"]*)"/.exec(s.slice(i))![1]!
      i += value.length + 3
      if (name === "target_os") return value === os
      if (name === "target_family") return value === family
      return undefined
    }
    if (name === "unix") return family === "unix"
    if (name === "windows") return family === "windows"
    return undefined
  }
  return expr()
}

describe("the addon matches ts/gen", () => {
  test("every native export ts/gen/types.ts reads exists (where its gate holds)", () => {
    const refs = nativeRefs(join(ROOT, "ts", "gen", "types.ts"))
    expect(refs.length).toBeGreaterThan(500)
    const missing: string[] = []
    const unexpected: string[] = []
    for (const r of refs) {
      const holds = r.gate ? holdsHere(r.gate) : true
      if (r.guarded || holds === undefined) continue
      if (holds && !(r.name in native)) missing.push(r.name)
      if (!holds && r.name in native) unexpected.push(`${r.name} [cfg(${r.gate})]`)
    }
    expect(missing).toEqual([])
    expect(unexpected).toEqual([])
  })

  test("every member a generated class declares is on the class or its prototype", () => {
    const lines = surfaceLines(join(ROOT, "ts", "gen"))
    const gateOf = (l: string) => / \[cfg\((.*)\)\]$/.exec(l)?.[1]
    const classes = new Map<string, string | undefined>()
    for (const l of lines) {
      const m = /^class (\S+)/.exec(l)
      if (m) classes.set(m[1]!, gateOf(l))
    }
    expect(classes.size).toBeGreaterThan(100)
    const missing: string[] = []
    const unexpected: string[] = []
    let checked = 0
    for (const l of lines) {
      const m = /^(method|prop|get|static|class) ([A-Za-z0-9_$]+)(?:\.([A-Za-z0-9_$]+))?/.exec(l)
      if (!m || !classes.has(m[2]!)) continue
      const gate = gateOf(l) ?? classes.get(m[2]!)
      const holds = gate ? holdsHere(gate) : true
      if (holds === undefined) continue
      const cls = native[m[2]!]
      let present: boolean
      if (m[1] === "class") present = typeof cls === "function"
      else if (typeof cls !== "function") present = false
      else if (m[1] === "static") present = m[3]! in cls
      else present = m[3]! in cls.prototype
      checked++
      if (holds && !present) missing.push(l)
      if (!holds && present) unexpected.push(l)
    }
    expect(checked).toBeGreaterThan(1000)
    expect(missing).toEqual([])
    expect(unexpected).toEqual([])
  })
})

describe("holdsHere", () => {
  test("reads the gates bindgen emits", () => {
    const mac = process.platform === "darwin"
    expect(holdsHere('target_os = "macos"')).toBe(mac)
    expect(holdsHere('not(target_os = "macos")')).toBe(!mac)
    expect(holdsHere('any(target_os = "macos", target_os = "linux", target_os = "windows")')).toBe(true)
    expect(holdsHere('all(unix, not(target_os = "macos"))')).toBe(process.platform === "linux")
    expect(holdsHere("debug_assertions")).toBeUndefined()
  })
})
