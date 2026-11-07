// What `npm publish` ships. lib.ts's pack() runs npm pack on a copy of the publishable files after
// prepack's `fix-dts --publish` (in the copy, never in the repo). This checks the tarball's file list:
// every entry point's JavaScript and declarations, the loader and its types, the notices, and nothing
// else. No tests, examples, sources, addons, source maps, or dist files whose ts/ source is gone.
// Relative imports must resolve inside the package. A tarball over 1 MB is a warning.
//
//   bun test ./test/pack/pack.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { cleanup, entries, pack, pkg, ROOT } from "./lib.ts"

const TOP = ["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "native.cjs", "native.d.cts"]
const MB = 1024 * 1024

beforeAll(() => {
  pack()
}, 120_000)
afterAll(cleanup)

describe(`npm pack ${pkg.name}`, () => {
  test("the copy packs what npm lists in the repo", () => {
    const p = pack()
    console.log(`${posix.basename(p.tarball)}: ${(p.size / 1024).toFixed(0)} KB packed, ${(p.unpackedSize / 1024).toFixed(0)} KB unpacked, ${p.files.length} files`)
    expect(p.files).toEqual(p.listed)
  })

  test("prepack's fix-dts ran in the copy, not in the repo", () => {
    expect(pack().repoUntouched).toBe(true)
  })

  test("every entry point, main and types are packed", () => {
    const files = new Set(pack().files)
    const wanted = [pkg.main, pkg.types, ...entries().flatMap((e) => [e.js, e.types])].map((f) => f.replace(/^\.\//, ""))
    expect(entries().length).toBeGreaterThanOrEqual(8)
    expect(wanted.filter((f) => !files.has(f))).toEqual([])
  })

  test("the loader, its types and the notices are packed", () => {
    const files = new Set(pack().files)
    expect(TOP.filter((f) => !files.has(f))).toEqual([])
  })

  test("nothing else: only dist files with a ts/ source, no maps, addons, tests, examples or sources", () => {
    const extra = pack().files.filter((f) => {
      if (TOP.includes(f)) return false
      const m = /^dist\/(.+?)(\.d\.ts|\.js)$/.exec(f)
      // dist/<x>.js and dist/<x>.d.ts come from ts/<x>.ts; anything else (a .map, a renamed module's
      // leftovers) has no business in the package.
      return !m || !existsSync(join(ROOT, "ts", `${m[1]}.ts`))
    })
    expect(extra).toEqual([])
  })

  test("relative imports in the packed JavaScript and declarations resolve inside the package", () => {
    const p = pack()
    const files = new Set(p.files)
    const broken: string[] = []
    for (const file of p.files) {
      const dts = file.endsWith(".d.ts") || file.endsWith(".d.cts")
      if (!(dts || (file.startsWith("dist/") && file.endsWith(".js")))) continue
      const src = readFileSync(join(p.copy, file), "utf8")
      const specs = [
        ...src.matchAll(/\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g),
        ...src.matchAll(/\bimport\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g),
        ...src.matchAll(/\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g),
      ].map((m) => m[1]!)
      for (const spec of new Set(specs)) {
        const target = posix.normalize(posix.join(posix.dirname(file), spec))
        // A declaration file's `./x.js` is typed by `./x.d.ts` (and `./x.cjs` by `./x.d.cts`).
        const candidates = dts ? [target.replace(/\.js$/, ".d.ts").replace(/\.cjs$/, ".d.cts"), target] : [target]
        if (!candidates.some((c) => files.has(c))) broken.push(`${file}: ${spec}`)
      }
    }
    expect(broken).toEqual([])
  })

  test("native.d.cts imports the facade's types from packed dist files", () => {
    const p = pack()
    const dts = readFileSync(join(p.copy, "native.d.cts"), "utf8")
    const block = dts.slice(dts.indexOf("// runex: facade types"))
    const from = [...block.matchAll(/^import type \{[^}]+\} from "\.\/(dist\/[^"]+)\.js"/gm)].map((m) => `${m[1]}.d.ts`)
    expect(from.length).toBeGreaterThan(0)
    expect(from.filter((f) => !p.files.includes(f))).toEqual([])
  })

  test("the tarball stays small (a warning past 1 MB)", () => {
    const { size } = pack()
    if (size > MB) console.warn(`warning: the ${pkg.name} tarball is ${(size / MB).toFixed(2)} MB, over 1 MB`)
    expect(size).toBeGreaterThan(0)
  })
})
