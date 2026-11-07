// The names each entry point exports, as a snapshot: a dropped export fails with a readable diff,
// and an added one is a visible snapshot update. Names come from the built declarations
// (dist/<entry>.d.ts, through TypeScript's checker, so `export *` chains count) and from importing
// the entry at runtime. Each line is one name:
//
//   X                    a value: declared, and there at runtime
//   type X               a type only
//   X (runtime only)     there at runtime, but declared as a type or not at all
//   X (declared only)    declared as a value, missing at runtime (always a failure: imports crash)
//
//   bun test ./test/pack/exports.test.ts                      (after bun run build:ts)
//   bun test ./test/pack/exports.test.ts --update-snapshots   to bless a change
import { beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import ts from "typescript"
import { entries, ROOT } from "./lib.ts"

let program: ts.Program
let checker: ts.TypeChecker

/** Whether an export is type-only: an `export type` anywhere along its alias chain, or no value. */
function typeOnly(symbol: ts.Symbol): boolean {
  let s = symbol
  for (let i = 0; i < 32 && s.flags & ts.SymbolFlags.Alias; i++) {
    if (s.declarations?.some((d) => ts.isTypeOnlyImportOrExportDeclaration(d))) return true
    const next = checker.getImmediateAliasedSymbol(s)
    if (!next) break
    s = next
  }
  const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s
  return (target.flags & ts.SymbolFlags.Value) === 0
}

async function exportLines(types: string, specifier: string): Promise<string[]> {
  const file = program.getSourceFile(join(ROOT, types))
  if (!file) throw new Error(`${types} is missing: run bun run build:ts`)
  const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(file)!)
  const runtime = new Set(Object.keys(await import(specifier)))
  const lines: string[] = []
  const values = new Set<string>()
  for (const s of symbols) {
    if (typeOnly(s)) {
      lines.push(runtime.has(s.name) ? `${s.name} (runtime only)` : `type ${s.name}`)
      continue
    }
    values.add(s.name)
    lines.push(runtime.has(s.name) ? s.name : `${s.name} (declared only)`)
  }
  for (const name of runtime) if (!values.has(name) && !lines.includes(`${name} (runtime only)`)) lines.push(`${name} (runtime only)`)
  const key = (l: string) => l.replace(/^type /, "")
  return lines.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : 1))
}

beforeAll(() => {
  program = ts.createProgram(entries().map((e) => join(ROOT, e.types)), {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2023,
    types: ["node"],
    skipLibCheck: true,
    noEmit: true,
  })
  checker = program.getTypeChecker()
}, 60_000)

describe("exports per entry point", () => {
  for (const e of entries()) {
    test(e.specifier, async () => {
      const lines = await exportLines(e.types, e.specifier)
      expect(lines.filter((l) => l.endsWith("(declared only)"))).toEqual([])
      expect(lines).toMatchSnapshot()
    }, 30_000)
  }
})
