// Generates runex's bindings from Rune's rustdoc JSON.
//
//   bun tools/bindgen/main.ts            regenerate rustdoc JSON when missing, then bindings
//   bun tools/bindgen/main.ts --rustdoc  regenerate rustdoc JSON first
//   ... --check                          write nothing: generate twice into temp dirs, fail unless
//                                        both runs agree (determinism) and match the files in the
//                                        repo (up to date); with --rustdoc, refresh the JSON first
//   ... --out DIR                        write the generated tree under DIR instead of the repo
//                                        (DIR/src/gen, DIR/ts/gen, DIR/tools/bindgen/*)
//   ... --rustdoc-dir DIR                the cargo target dir for rustdoc (default target/rustdoc);
//                                        the JSON is read from DIR/doc/<crate>.json
//   ... --rune DIR                       the Rune checkout to document (default vendor/rune)
//   ... --any-target                     accept JSON documented for a target other than config.ts's
//                                        docTarget (the bindings lose what only that target has)
//
// Writes src/gen/*.rs, ts/gen/**/*.ts, tools/bindgen/report.md and tools/bindgen/surface.txt (the
// API surface, one line per item: surface.ts). Before anything else it checks that config.ts's
// features are Cargo.toml's, and that the JSON has the rustdoc format_version config.ts records.
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { and } from "./cfg.ts"
import { crates, docTarget, rustdocFormat } from "./config.ts"
import { Emitter } from "./emit.ts"
import { Model } from "./gen.ts"
import { Crate } from "./rustdoc.ts"
import { trampolines } from "./plan.ts"
import { surfaceText } from "./surface.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
function option(name: string): string | undefined {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const value = argv[i + 1]
  if (!value || value.startsWith("--")) die(`${name} needs a directory`)
  return resolve(value)
}
function die(message: string): never {
  console.error(`bindgen: ${message}`)
  process.exit(1)
}

const known = new Set(["--rustdoc", "--check", "--any-target", "--out", "--rustdoc-dir", "--rune"])
for (const [i, a] of argv.entries()) {
  if (a.startsWith("--") && !known.has(a)) die(`unknown option ${a} (see the header of tools/bindgen/main.ts)`)
  if (!a.startsWith("--") && !["--out", "--rustdoc-dir", "--rune"].includes(argv[i - 1] ?? "")) die(`unexpected argument ${a}`)
}
const fresh = flag("--rustdoc")
const outRoot = option("--out") ?? root
const rustdocDir = option("--rustdoc-dir") ?? join(root, "target", "rustdoc")
const runeDir = option("--rune") ?? join(root, "vendor", "rune")
const docDir = join(rustdocDir, "doc")
if (flag("--check") && flag("--out")) die("--check compares with the repo; it takes no --out")

// config.ts documents each crate with the features runex builds it with (Cargo.toml): rustdoc
// documents what those features compile, so any difference binds the wrong items (rune-knobs
// without `panel` documents its stubs).
{
  const toml = Bun.TOML.parse(readFileSync(join(root, "Cargo.toml"), "utf8")) as { dependencies?: Record<string, unknown> }
  const wrong: string[] = []
  for (const c of crates) {
    const dep = toml.dependencies?.[c.package]
    if (dep === undefined) {
      wrong.push(`${c.package}: config.ts binds it, Cargo.toml doesn't depend on it`)
      continue
    }
    const spec = (typeof dep === "object" && dep ? dep : {}) as { features?: string[]; "default-features"?: boolean }
    const want = [...(spec.features ?? [])].sort().join(",")
    const have = [...(c.features ?? [])].sort().join(",")
    if (want !== have) wrong.push(`${c.package}: Cargo.toml builds it with [${want}], config.ts documents [${have}]`)
    if (spec["default-features"] === false) wrong.push(`${c.package}: Cargo.toml turns its default features off, which config.ts can't document`)
  }
  if (wrong.length) die(`config.ts's features differ from Cargo.toml's:\n  ${wrong.join("\n  ")}\nMake config.ts list the features Cargo.toml builds each crate with.`)
}

if (fresh) {
  for (const c of crates) {
    console.log(`rustdoc ${c.package}`)
    rustdoc(c.package, c.features)
  }
} else {
  for (const c of crates) {
    if (existsSync(join(docDir, `${c.crate}.json`))) continue
    if (flag("--check")) die(`no rustdoc JSON at ${join(docDir, `${c.crate}.json`)}: run with --rustdoc, or without --check once`)
    console.log(`rustdoc ${c.package}`)
    rustdoc(c.package, c.features)
  }
}

function rustdoc(pkg: string, features: string[] | undefined) {
  const f = features?.length ? ["--features", features.join(",")] : []
  execFileSync("cargo", ["rustdoc", "-p", pkg, "--lib", ...f, "--", "-Z", "unstable-options", "--output-format", "json"], {
    cwd: runeDir,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, RUSTC_BOOTSTRAP: "1", CARGO_TARGET_DIR: rustdocDir, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
  })
}

/** What the repo holds of the generated tree, relative to the root. */
const GENERATED = ["src/gen", "ts/gen", "tools/bindgen/report.md", "tools/bindgen/surface.txt"]

if (flag("--check")) await check()

// ── --check ──────────────────────────────────────────────────────────────────

/** Runs this script twice with `--out`, compares the runs with each other and with the repo, and exits. */
async function check(): Promise<never> {
  const t0 = performance.now()
  const tmp = mkdtempSync(join(tmpdir(), "runex-bindgen-"))
  // `process.exit` skips `finally`, so every way out removes the scratch runs first.
  process.on("exit", () => rmSync(tmp, { recursive: true, force: true }))
  try {
    const pass = ["--rustdoc-dir", rustdocDir, "--rune", runeDir, ...(flag("--any-target") ? ["--any-target"] : [])]
    const [a, b] = [join(tmp, "a"), join(tmp, "b")]
    const runs = await Promise.all([a, b].map((dir) => run([fileURLToPath(import.meta.url), "--out", dir, ...pass])))
    for (const r of runs) if (r.code !== 0) die(`a generating run failed (exit ${r.code}):\n${r.output.trim()}`)
    const twice = compareTrees(a, b)
    if (twice.length) {
      console.error(`bindgen --check: two runs on the same JSON differ, so the generator isn't deterministic:`)
      report(twice, a, b)
      process.exit(1)
    }
    const stale = compareTrees(a, root)
    if (stale.length) {
      console.error(`bindgen --check: the generated files in the repo are out of date (regenerate with \`bun tools/bindgen/main.ts\`):`)
      report(stale, root, a)
      process.exit(1)
    }
    const count = GENERATED.flatMap((g) => listFiles(a, g)).length
    console.log(`bindgen --check: deterministic and up to date (${count} files, ${((performance.now() - t0) / 1000).toFixed(1)} s)`)
    process.exit(0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function run(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    p.stdout.on("data", (d) => (output += d))
    p.stderr.on("data", (d) => (output += d))
    p.on("close", (code) => done({ code: code ?? 1, output }))
  })
}

/** Files under `base/rel` (a file or a directory), relative to `base`, sorted. */
function listFiles(base: string, rel: string): string[] {
  const p = join(base, rel)
  if (!existsSync(p)) return []
  if (!statSync(p).isDirectory()) return [rel]
  return readdirSync(p).sort().flatMap((n) => listFiles(base, `${rel}/${n}`))
}

/** The generated paths that differ between two roots: `+` only in `y`, `-` only in `x`, `M` changed. */
function compareTrees(x: string, y: string): string[] {
  const xs = new Set(GENERATED.flatMap((g) => listFiles(x, g)))
  const ys = new Set(GENERATED.flatMap((g) => listFiles(y, g)))
  const out: string[] = []
  for (const f of [...new Set([...xs, ...ys])].sort()) {
    if (!ys.has(f)) out.push(`- ${f}`)
    else if (!xs.has(f)) out.push(`+ ${f}`)
    else if (!readFileSync(join(x, f)).equals(readFileSync(join(y, f)))) out.push(`M ${f}`)
  }
  return out
}

/** Prints the changed files, then the first 40 lines of their diff (`from` → `to`). */
function report(changes: string[], from: string, to: string) {
  for (const c of changes) console.error(`  ${c}`)
  const lines: string[] = []
  for (const c of changes) {
    const f = c.slice(2)
    const [x, y] = [join(from, f), join(to, f)]
    let text: string
    try {
      text = execFileSync("git", ["diff", "--no-index", "--no-color", "--", existsSync(x) ? x : "/dev/null", existsSync(y) ? y : "/dev/null"], { encoding: "utf8", maxBuffer: 1 << 28 })
    } catch (e) {
      // git diff exits 1 when the files differ.
      text = String((e as { stdout?: string }).stdout ?? "")
    }
    lines.push(...text.split("\n").filter((l) => !l.startsWith("diff --git") && !l.startsWith("index ")))
    if (lines.length >= 40) break
  }
  console.error(lines.slice(0, 40).map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l)).join("\n"))
}

// ── generate ─────────────────────────────────────────────────────────────────

const docs = crates.map((c) => new Crate(c, join(docDir, `${c.crate}.json`)))
// The schema rustdoc.ts reads: another version may rename what it looks up, and items would
// vanish from the bindings without a skip in report.md.
for (const c of docs) {
  if (c.format !== rustdocFormat) die(`${c.name}.json has rustdoc format_version ${c.format}, config.ts records ${rustdocFormat}: the toolchain changed rustdoc's schema; check rustdoc.ts and update the recorded version (config.ts rustdocFormat)`)
}
// JSON documented for another target lacks what Rune declares for docTarget only: refuse it.
const foreign = docs.filter((c) => c.target !== docTarget)
if (foreign.length && !process.argv.includes("--any-target")) {
  const where = [...new Set(foreign.map((c) => c.target))].join(", ")
  console.error(`bindgen: ${foreign.map((c) => `${c.name}.json`).join(", ")} documented ${where}, not ${docTarget} (config.ts docTarget). Bindings from it would lose the items Rune declares for ${docTarget} only. Regenerate on ${docTarget}, or pass --any-target to accept that.`)
  process.exit(1)
}
const model = new Model()
for (const c of docs) model.add(c)
// Globs of another crate's module (`pub use rune_motion::motion::*`) export its items here.
for (const crate of model.crates.values()) {
  for (const g of crate.globs) {
    const owner = g.externKey ? model.crates.get(g.externKey.split("::")[0]!) : undefined
    if (!owner || !g.externKey) continue
    for (const { name, id } of owner.moduleItems(g.externKey)) {
      const key = owner.defKey(id)
      if (key) crate.exports.push({ path: [...g.prefix, name], externKey: key, cfg: g.cfg })
    }
  }
}
model.collect()

const emit = new Emitter(model)
const fnNames = new Map<string, string>() // `${crate}:${localId}` → unique js name of a function or const

for (const b of model.bound.values()) {
  if (b.kind === "class") emit.emitClass(b)
  else if (b.kind === "record") emit.emitRecord(b)
  else emit.emitEnum(b)
}

// Public traits of the bound crates implemented for bound classes: their methods join the class.
for (const crate of model.crates.values()) {
  for (const item of Object.values(crate.idx) as any[]) {
    const impl = item?.inner?.impl
    if (!impl?.trait || impl.blanket_impl || impl.is_synthetic || impl.is_negative || !impl.for?.resolved_path) continue
    const traitKey = crate.defKey(impl.trait.id)
    const owner = traitKey ? model.crates.get(traitKey.split("::")[0]!) : undefined
    const traitId = traitKey ? owner?.localIdForKey(traitKey) : undefined
    const traitPath = traitId ? owner!.publicPath.get(traitId) : undefined
    if (!owner || !traitPath || model.denied(owner, traitPath)) continue
    const b = model.bound.get(crate.defKey(impl.for.resolved_path.id) ?? "")
    if (!b || b.kind !== "class" || b.lendOnly) continue
    emit.emitTraitImpl(crate, item, b, `${owner.name}::${traitPath.join("::")}`, and(owner.cfgOf(traitId!), owner.publicCfg.get(traitId!) ?? true))
  }
}

for (const crate of model.crates.values()) {
  for (const ex of crate.exports) {
    if (ex.externKey) {
      const b = model.bound.get(ex.externKey)
      if (b) emit.emitReexport(crate, ex.path, b.js, b.kind === "enum" && !hasEnumValue(b))
      else {
        const fn = fnNames.get(ex.externKey)
        if (fn) emit.emitReexport(crate, ex.path, fn, false)
      }
      continue
    }
    const item = crate.item(ex.id!)!
    const kind = crate.kindOf(item)
    const key = crate.defKey(ex.id!)
    if (kind === "struct" || kind === "enum") {
      const b = key ? model.bound.get(key) : undefined
      // A second public path to a bound type re-exports it there too.
      if (b && b.path.join("::") !== ex.path.join("::")) emit.emitReexport(crate, ex.path, b.js, b.kind === "enum" && !hasEnumValue(b))
      continue
    }
    if (model.denied(crate, ex.path)) continue
    const seenKey = key ?? `${crate.name}:${ex.id}`
    const already = fnNames.get(seenKey)
    if (already) {
      emit.emitReexport(crate, ex.path, already, false)
      continue
    }
    const before = emit.count.functions + emit.count.consts
    if (kind === "function") emit.emitFunction(crate, ex.path, item, ex.cfg)
    else if (kind === "constant" || kind === "static") emit.emitConstant(crate, ex.path, item, ex.cfg)
    else continue
    if (emit.count.functions + emit.count.consts > before) {
      const mods = emit.modules.get(crate.config.module)!
      const list = mods.get(ex.path.slice(0, -1).join("/"))!
      fnNames.set(seenKey, list[list.length - 1]!.unique)
    }
  }
}

function hasEnumValue(b: { js: string }) {
  return emit.ts.some((t) => t.startsWith(`export const ${b.js} = {`))
}

// ── write ────────────────────────────────────────────────────────────────────

const srcGen = join(outRoot, "src", "gen")
rmSync(srcGen, { recursive: true, force: true })
mkdirSync(srcGen, { recursive: true })
const rsMods: string[] = []
for (const [mod, parts] of emit.rs) {
  writeFileSync(join(srcGen, `${mod}.rs`), parts.join("\n"))
  rsMods.push(mod)
}
writeFileSync(
  join(srcGen, "tramp.rs"),
  `// @generated by tools/bindgen: trampolines that let fn-pointer parameters call JavaScript.
#![allow(non_snake_case, unused_mut, unused_variables, unused_imports, clippy::all)]
use crate::conv::{self, Class, FromJs, ToJs};
${[...trampolines.values()].map((t) => t.code).join("\n")}`,
)
rsMods.push("tramp")
writeFileSync(join(srcGen, "mod.rs"), `// @generated by tools/bindgen.\n${rsMods.sort().map((m) => `pub mod ${m};`).join("\n")}\n`)

const tsGen = join(outRoot, "ts", "gen")
rmSync(tsGen, { recursive: true, force: true })
mkdirSync(tsGen, { recursive: true })
writeFileSync(
  join(tsGen, "types.ts"),
  `// @generated by tools/bindgen. Every bound item of every crate, by its unique native name;
// the module files beside this one re-export them under Rust's paths and names.
/* eslint-disable */
import nativeModule from "../native.js"
import type { Waker } from "../native.js"
const $n: any = nativeModule

${emit.ts.join("\n")}
${emit.tsTail.join("\n")}
`,
)

for (const [crateModule, mods] of emit.modules) {
  const all = new Set<string>([...mods.keys()])
  for (const m of [...all]) {
    const segs = m ? m.split("/") : []
    for (let i = 0; i < segs.length; i++) all.add(segs.slice(0, i).join("/"))
  }
  for (const mod of all) {
    const file = mod ? join(tsGen, crateModule, `${mod}.ts`) : join(tsGen, crateModule, "index.ts")
    mkdirSync(dirname(file), { recursive: true })
    const hub = relative(dirname(file), join(tsGen, "types.js")).replace(/\\/g, "/")
    const items = mods.get(mod) ?? []
    const values = items.filter((i) => !i.typeOnly).map((i) => (i.local === i.unique ? i.unique : `${i.unique} as ${i.local}`))
    const types = items.filter((i) => i.typeOnly).map((i) => (i.local === i.unique ? i.unique : `${i.unique} as ${i.local}`))
    const taken = new Set(items.map((i) => i.local))
    // Rust keeps modules and values apart; JavaScript doesn't. A value (`el()`) wins over a
    // module of the same name (`el::`), whose items are re-exported elsewhere anyway.
    const children = [...all].filter((c) => c && c.split("/").slice(0, -1).join("/") === mod && c !== mod && !taken.has(c.split("/").pop()!))
    const lines = [`// @generated by tools/bindgen: ${crateModule}${mod ? "::" + mod.replace(/\//g, "::") : ""}`]
    if (values.length) lines.push(`export { ${values.join(", ")} } from "${hub.startsWith(".") ? hub : "./" + hub}"`)
    if (types.length) lines.push(`export type { ${types.join(", ")} } from "${hub.startsWith(".") ? hub : "./" + hub}"`)
    for (const c of children) {
      const name = c.split("/").pop()!
      const childFile = mod ? `./${mod.split("/").pop()}/${name}.js` : `./${name}.js`
      lines.push(`export * as ${name} from "${childFile}"`)
    }
    writeFileSync(file, lines.join("\n") + "\n")
  }
}

const gated = [...new Map(model.gated.map((g) => [g.what, g])).values()].sort((a, b) => (a.what < b.what ? -1 : 1))
const bySkip = new Map<string, string[]>()
for (const s of model.skips) {
  if (!bySkip.has(s.why)) bySkip.set(s.why, [])
  bySkip.get(s.why)!.push(s.what)
}
mkdirSync(join(outRoot, "tools", "bindgen"), { recursive: true })
writeFileSync(
  join(outRoot, "tools", "bindgen", "report.md"),
  `# Binding report\n\nGenerated: ${emit.count.classes} classes, ${emit.count.records} records, ${emit.count.enums} enums, ${emit.count.methods} methods, ${emit.count.functions} functions, ${emit.count.consts} constants.\n\nSkipped: ${model.skips.length} items.\n\n${[...bySkip]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([why, list]) => `## ${why} (${list.length})\n\n${list.sort().map((w) => `- \`${w}\``).join("\n")}\n`)
    .join("\n")}${gated.length ? `\n## Bound under #[cfg]: absent from the addon on other platforms (${gated.length})\n\n${gated.map((g) => `- \`${g.what}\`: \`cfg(${g.cfg})\``).join("\n")}\n` : ""}`,
)
writeFileSync(join(outRoot, "tools", "bindgen", "surface.txt"), surfaceText(tsGen))
console.log(`generated: ${JSON.stringify(emit.count)}; skipped ${model.skips.length} (tools/bindgen/report.md)${outRoot === root ? "" : ` in ${outRoot}`}`)
