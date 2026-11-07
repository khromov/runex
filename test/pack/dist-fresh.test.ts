// dist/ is what tsconfig.build.json makes from ts/, and nothing else. The examples, the tests and the
// package all run dist/, so a stale or littered dist/ tests something other than the sources:
//
// - every output tsc would write for a ts/ file exists;
// - no file in dist/ lacks a ts/ source (a renamed or deleted module's leftovers, source maps once
//   they're turned off): npm would publish them;
// - outside CI, no ts/ file is newer than its output. In CI the checkout's times mean nothing, and
//   dist/ is always built fresh.
//
// The fix for any of these: rm -rf dist && bun run build:ts. `bun run test` builds dist/ first.
//
//   bun test ./test/pack/dist-fresh.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { ROOT } from "./lib.ts"

const FIX = "rm -rf dist && bun run build:ts"
const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, "tsconfig.build.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"))
  },
})!
const sources = config.fileNames.filter((f) => !f.endsWith(".d.ts"))
const outputs = new Map<string, string>() // output -> its source
for (const src of sources) for (const out of ts.getOutputFileNames(config, src, !ts.sys.useCaseSensitiveFileNames)) outputs.set(out, src)
const dist = config.options.outDir!

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else out.push(path)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split("\\").join("/")

describe("dist/ matches ts/", () => {
  test("dist/ exists", () => {
    if (!existsSync(dist)) throw new Error(`no dist/: run bun run build:ts`)
    expect(sources.length).toBeGreaterThan(0)
  })

  test("every output of a ts/ file is there", () => {
    const missing = [...outputs.keys()].filter((f) => !existsSync(f)).map(rel)
    if (missing.length) console.error(`missing from dist/ (${FIX}):`)
    expect(missing).toEqual([])
  })

  test("no file in dist/ without a ts/ source", () => {
    const orphans = existsSync(dist) ? files(dist).filter((f) => !outputs.has(f) && !f.endsWith(".DS_Store")).map(rel) : []
    if (orphans.length) console.error(`files in dist/ that no ts/ file makes (${FIX}):`)
    expect(orphans).toEqual([])
  })

  test.skipIf(!!process.env.CI)("no ts/ file is newer than its output (skipped in CI)", () => {
    const stale: string[] = []
    for (const [out, src] of outputs) {
      if (existsSync(out) && statSync(src).mtimeMs > statSync(out).mtimeMs) stale.push(`${rel(src)} is newer than ${rel(out)}`)
    }
    if (stale.length) console.error(`dist/ is stale: run bun run build:ts`)
    expect(stale).toEqual([])
  })
})
