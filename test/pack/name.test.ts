// The package's name agrees everywhere it is spelled, so a rename can't be left half done:
//
// - napi.packageName (the platform packages' prefix) is in the package's scope: `@<name>/...` for an
//   unscoped name, the same scope for a scoped one;
// - ts/vite.ts keeps the package external (`resolve.external`) under its current name;
// - every bare import in examples/, test/, bench/ and the docs names the package (with a subpath
//   from `exports`), a declared dependency, or a runtime builtin. An import on a line after
//   `// @ts-expect-error` is a deliberate miss (video-tiles' `runex-js/wgpu`);
// - the publish job's step is named after the package;
// - native.cjs, when built, requires the platform packages by napi.packageName;
// - the dev link node_modules/<name>, when present, points at the repo.
//
//   bun test ./test/pack/name.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { builtinModules } from "node:module"
import { join, relative } from "node:path"
import { pkg, ROOT } from "./lib.ts"

const scope = pkg.name.startsWith("@") ? pkg.name.split("/")[0]! : `@${pkg.name}`
const subpaths = new Set(Object.keys(pkg.exports).filter((k) => k !== "./package.json").map((k) => (k === "." ? pkg.name : pkg.name + k.slice(1))))
const deps = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }))
const builtins = new Set(builtinModules)
const PACKAGE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w.-]+)*$/i

function walk(dir: string, keep: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "out" || name.startsWith(".")) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, keep, out)
    else if (keep(path)) out.push(path)
  }
  return out
}

/** Bare import specifiers in a file, with their line numbers. */
function bareImports(file: string): { spec: string; line: number; expected: boolean }[] {
  const src = readFileSync(file, "utf8")
  const lines = src.split("\n")
  const out: { spec: string; line: number; expected: boolean }[] = []
  const patterns = [/\bfrom\s*["']([^"'\s]+)["']/g, /\bimport\s*\(\s*["']([^"'\s]+)["']\s*\)/g, /^\s*import\s*["']([^"'\s]+)["']/gm, /\brequire\(\s*["']([^"'\s]+)["']\s*\)/g]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const spec = m[1]!
      if (spec.startsWith(".") || spec.startsWith("/") || !PACKAGE.test(spec)) continue
      const line = src.slice(0, m.index).split("\n").length
      out.push({ spec, line, expected: /@ts-expect-error/.test(lines[line - 2] ?? "") })
    }
  }
  return out
}

function packageOf(spec: string): string {
  const parts = spec.split("/")
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
}

describe(`the package name (${pkg.name}) agrees everywhere`, () => {
  test("napi.packageName is in the package's scope", () => {
    expect(pkg.napi.packageName.split("/")[0]).toBe(scope)
  })

  test("ts/vite.ts keeps the package external", () => {
    const src = readFileSync(join(ROOT, "ts", "vite.ts"), "utf8")
    const lists = [...src.matchAll(/external:\s*\[([^\]]*)\]/g)].map((m) => [...m[1]!.matchAll(/["']([^"']+)["']/g)].map((s) => s[1]))
    expect(lists.length).toBeGreaterThan(0)
    for (const list of lists) expect(list).toContain(pkg.name)
  })

  test("every bare import names the package, a dependency or a builtin", () => {
    const code = (f: string) => /\.(m|c)?[jt]sx?$/.test(f)
    const files = [
      ...walk(join(ROOT, "examples"), code),
      ...walk(join(ROOT, "test"), code),
      ...walk(join(ROOT, "bench"), code),
      ...walk(join(ROOT, "docs"), (f) => f.endsWith(".md")),
      join(ROOT, "README.md"),
      join(ROOT, "scripts", "README.md"),
    ].filter((f) => existsSync(f) && f !== import.meta.path)
    const bad: string[] = []
    let ours = 0
    for (const file of files) {
      for (const { spec, line, expected } of bareImports(file)) {
        const name = packageOf(spec)
        const where = `${relative(ROOT, file)}:${line}: ${spec}`
        if (expected) continue
        if (spec.startsWith("node:") || spec.startsWith("bun:") || spec === "bun" || builtins.has(spec)) continue
        if (name === pkg.name) {
          ours++
          if (!subpaths.has(spec)) bad.push(`${where} (not in package.json exports)`)
        } else if (!deps.has(name)) bad.push(`${where} (not ${pkg.name} or a declared dependency)`)
      }
    }
    expect(bad).toEqual([])
    expect(ours).toBeGreaterThan(50)
  })

  test("the publish job's step is named after the package", () => {
    const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
    expect(ci).toContain(`- name: Publish ${pkg.name}\n`)
  })

  test("native.cjs requires the platform packages by napi.packageName", () => {
    const file = join(ROOT, "native.cjs")
    if (!existsSync(file)) return console.warn("native.cjs isn't built: skipped (bun run build:native writes it)")
    const required = [...readFileSync(file, "utf8").matchAll(/require\('(@[^'/]+\/[^'/]+?)(?:\/package\.json)?'\)/g)].map((m) => m[1]!)
    expect(required.length).toBeGreaterThan(0)
    expect([...new Set(required.filter((r) => !r.startsWith(`${pkg.napi.packageName}-`)))]).toEqual([])
  })

  test("the dev link node_modules/<name> points at the repo", () => {
    const link = join(ROOT, "node_modules", ...pkg.name.split("/"))
    if (!existsSync(link)) return
    expect(realpathSync(link)).toBe(realpathSync(ROOT))
  })
})
