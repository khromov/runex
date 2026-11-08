// Post-processes napi-rs's generated native.d.cts:
//
// 1. napi-derive prints doc comments that pass through `macro_rules!` as raw-string tokens
//    (`r" text`); strip that prefix.
// 2. Hand-written bindings name runex's TypeScript types in their signatures (`Spring`,
//    `WindowOptions`, ...), which live in the TypeScript facade, not here. With `--publish`
//    (npm's prepack) each is imported from the facade entry point in dist/ that exports it
//    (type-only, so the cycle is harmless), so consumers type-check without `skipLibCheck`.
//    Without it (development, where dist/ is the build's output) they're `any`. A name nothing
//    exports is `any` either way.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const file = join(root, "native.d.cts")
let text = readFileSync(file, "utf8").replace(/(\/\*\*|\*) r" /g, "$1 ").replace(/(\/\*\*|\*) r"$/gm, "$1")
text = text.replace(/\n\/\/ runex: facade types[\s\S]*$/, "\n")

/** Names a TypeScript module exports at top level, following `export *` and re-export lists. */
function exportsOf(path, seen = new Set()) {
  const names = new Set()
  if (seen.has(path) || !existsSync(path)) return names
  seen.add(path)
  const src = readFileSync(path, "utf8")
  const target = (spec) => resolve(dirname(path), spec.replace(/\.js$/, ".ts"))
  for (const m of src.matchAll(/^export \* from "([^"]+)"/gm)) for (const n of exportsOf(target(m[1]), seen)) names.add(n)
  for (const m of src.matchAll(/^export (?:type )?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()
      if (name) names.add(name)
    }
  }
  for (const m of src.matchAll(/^export (?:declare )?(?:abstract )?(?:class|interface|type|const|function|enum) ([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  return names
}

const entries = ["index", "kit", "fx", "light", "motion", "knobs", "theme-opencode", "notify"]
  .map((name) => ({ name, names: exportsOf(join(root, "ts", `${name}.ts`)) }))

const declared = new Set([...text.matchAll(/^export (?:declare )?(?:class|interface|type|const|function|enum) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))
const builtins = new Set(["Array", "Promise", "Record", "Uint8Array", "Buffer", "Function", "Object", "String", "Number", "Boolean", "Error", "Map", "Set", "ReadonlyArray", "Partial", "Readonly", "Iterable", "Date"])
// Identifiers used in type positions: after `:`, `|`, `<`, `(`, `[`, `,`, `=>` or `extends`.
const publish = process.argv.includes("--publish")
const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const used = new Set()
for (const m of code.matchAll(/(?:[:|<(\[,]|=>|extends)\s*([A-Z][A-Za-z0-9_]*)\b/g)) used.add(m[1])
const missing = [...used].filter((n) => !declared.has(n) && !builtins.has(n))

const imports = new Map()
const unknown = []
for (const name of missing) {
  const entry = publish ? entries.find((e) => e.names.has(name)) : undefined
  if (!entry) {
    unknown.push(name)
    continue
  }
  if (!imports.has(entry.name)) imports.set(entry.name, [])
  imports.get(entry.name).push(name)
}
const lines = ["", "// runex: facade types the hand-written bindings name (scripts/fix-dts.mjs)."]
for (const [entry, names] of imports) {
  lines.push(`import type { ${names.sort().join(", ")} } from "./dist/${entry}.js" with { "resolution-mode": "import" }`)
}
for (const name of unknown.sort()) lines.push(`type ${name} = any`)
writeFileSync(file, text.trimEnd() + "\n" + lines.join("\n") + "\n")
