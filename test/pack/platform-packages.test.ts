// The platform packages (npm/<platform>/package.json) match napi.targets: one directory per target,
// named as napi-rs names it (`linux-arm64-gnu`), with the matching name, os, cpu, libc, main and files,
// and the root package's version, license, description and engines. CI's build matrix builds each
// target under the same platform name, which `napi artifacts` uses to move the addons into npm/.
//
//   bun test ./test/pack/platform-packages.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pkg, platformOf, ROOT } from "./lib.ts"

type Platform = { name: string; version: string; os?: string[]; cpu?: string[]; libc?: string[]; main: string; files: string[]; license: string; description: string; engines: Record<string, string> }

const targets = pkg.napi.targets.map((triple) => platformOf(triple))

describe("npm/<platform> packages", () => {
  test("one directory per napi target, and no others", () => {
    const dirs = readdirSync(join(ROOT, "npm")).filter((d) => existsSync(join(ROOT, "npm", d, "package.json"))).sort()
    expect(dirs).toEqual(targets.map((t) => t.platformArchABI).sort())
  })

  for (const t of targets) {
    test(`${t.triple}: npm/${t.platformArchABI}`, () => {
      const p: Platform = JSON.parse(readFileSync(join(ROOT, "npm", t.platformArchABI, "package.json"), "utf8"))
      const main = `${pkg.napi.binaryName}.${t.platformArchABI}.node`
      expect(p.name).toBe(`${pkg.napi.packageName}-${t.platformArchABI}`)
      expect(p.os).toEqual([t.platform])
      expect(p.cpu).toEqual([t.arch])
      expect(p.libc).toEqual(t.abi === "gnu" ? ["glibc"] : t.abi === "musl" ? ["musl"] : undefined)
      expect(p.main).toBe(main)
      expect(p.files).toContain(main)
      expect({ version: p.version, license: p.license, description: p.description, engines: p.engines }).toEqual({
        version: pkg.version,
        license: pkg.license,
        description: pkg.description,
        engines: pkg.engines,
      })
    })
  }

  test("CI builds every target under its platform name", () => {
    type Leg = { target?: string; platform?: string }
    const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")) as { jobs: { build: { strategy: { matrix: { include: Leg[] } } } } }
    const legs = ci.jobs.build.strategy.matrix.include.map((l) => `${l.target} ${l.platform}`).sort()
    expect(legs).toEqual(targets.map((t) => `${t.triple} ${t.platformArchABI}`).sort())
  })
})
