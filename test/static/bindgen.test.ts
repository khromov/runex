// The generated bindings are what tools/bindgen makes, and stay so:
// - `bun tools/bindgen/main.ts --check` from the cached rustdoc JSON (target/rustdoc/doc): two
//   runs agree, and they match src/gen, ts/gen, report.md and surface.txt. Skips with a message
//   when no JSON is cached (a fresh clone, CI): `bun tools/bindgen/main.ts --rustdoc` makes it.
// - tools/bindgen/surface.txt is the surface of the ts/gen in the repo (no JSON needed).
// - surface-diff classifies removals, changes and additions.
// `bun test ./test/static`.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { crates } from "../../tools/bindgen/config.ts"
import { breaking, diffSurface } from "../../tools/bindgen/surface-diff.ts"
import { surfaceText } from "../../tools/bindgen/surface.ts"

const ROOT = join(import.meta.dir, "..", "..")
const docDir = join(ROOT, "target", "rustdoc", "doc")
const cached = crates.every((c) => existsSync(join(docDir, `${c.crate}.json`)))
if (!cached) console.log(`bindgen --check skipped: no rustdoc JSON in ${docDir} (bun tools/bindgen/main.ts --rustdoc makes it)`)

describe("bindgen", () => {
  test.skipIf(!cached)("--check: deterministic, and the repo's generated files are up to date", () => {
    const r = spawnSync(process.execPath, ["tools/bindgen/main.ts", "--check"], { cwd: ROOT, encoding: "utf8" })
    if (r.status !== 0) console.error(r.stdout + r.stderr)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("deterministic and up to date")
  }, 30_000)

  test("surface.txt is the surface of ts/gen", () => {
    const committed = readFileSync(join(ROOT, "tools", "bindgen", "surface.txt"), "utf8")
    expect(surfaceText(join(ROOT, "ts", "gen")) === committed).toBe(true)
    expect(committed).not.toMatch(/"id":\d/)
    expect(committed).toMatch(/^class El$/m)
    expect(committed).toMatch(/^method El\.radius\(r: number\): this$/m)
  })

  test("report.md carries no rustdoc ids", () => {
    expect(readFileSync(join(ROOT, "tools", "bindgen", "report.md"), "utf8")).not.toMatch(/"id":\d/)
  })
})

describe("surface-diff", () => {
  const before = ["class El", "method El.radius(r: number): this", "method El.w(w: number): this", "enum ChordKey", "variant ChordKey.A"].join("\n")
  test("an addition, a new variant included, isn't breaking", () => {
    const d = diffSurface(before, `${before}\nvariant ChordKey.PrintScreen\nmethod El.focus_within_ring(): this`)
    expect(d.added).toEqual(["variant ChordKey.PrintScreen", "method El.focus_within_ring(): this"])
    expect(breaking(d)).toBe(false)
  })
  test("a removal or a changed signature is", () => {
    const d = diffSurface(before, before.replace("method El.w(w: number): this\n", "").replace("r: number", "r: string"))
    expect(d.removed).toEqual(["method El.w(w: number): this"])
    expect(d.changed.map((c) => c.key)).toEqual(["method El.radius"])
    expect(breaking(d)).toBe(true)
  })
  test("the CLI exits 1 on a breaking change with --fail-breaking", () => {
    const file = join(ROOT, "tools", "bindgen", "surface.txt")
    const same = spawnSync(process.execPath, ["tools/bindgen/surface-diff.ts", file, file, "--fail-breaking"], { cwd: ROOT, encoding: "utf8" })
    expect(same.status).toBe(0)
    expect(same.stdout).toContain("Removed, breaking (0)")
  })
})
