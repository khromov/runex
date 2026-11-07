// Platform gates: which bound items exist only on some targets, and the `#[cfg(..)]` that says so.
//
// rustdoc documents one target (the host's), keeping each `#[cfg(..)]` it evaluated as a
// `CfgTrace` attribute on the item. An item documented on macOS under `#[cfg(target_os = "macos")]`
// (`native_surface::macos`, `NativeSurface::push`) must be gated the same way in the bindings, or
// they don't compile anywhere else. Every predicate is checked against the targets runex builds
// for (package.json's `napi.targets`, their values from `rustc --print cfg`):
//
// - true on every target (`not(target_arch = "wasm32")`): no gate;
// - false on every target: the item never exists in an addon, so it isn't bound;
// - otherwise the gate is emitted as written, so it holds on any target, listed or not.
//
// Some names aren't the addon's to test: `feature` (Rune's crates' features, not runex's) and
// custom cfgs held when the item was documented, so they're taken as true (false under `not`);
// `doc`, `docsrs` and `test` never hold in a build. Build settings (`debug_assertions`, `panic`,
// `target_feature`) apply to runex as to Rune, so they stay in the gate as written.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type Cfg = boolean | { name: string; value?: string } | { not: Cfg } | { all: Cfg[] } | { any: Cfg[] }

/** How an item is bound: everywhere, nowhere, or under `#[cfg(<cfg>)]`. */
export type Gate = "always" | "never" | { cfg: string }

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
/** The cfg names a target decides; `rustc --print cfg` gives their values. */
const TARGET = new Set(["unix", "windows", "target_os", "target_family", "target_arch", "target_vendor", "target_env", "target_abi", "target_pointer_width", "target_endian", "target_has_atomic"])
/** Never set when building a dependency. */
const NEVER = new Set(["doc", "docsrs", "test"])
/** Set the same way for runex as for Rune's crates, by the build: kept in the gate. */
const BUILD = new Set(["debug_assertions", "overflow_checks", "ub_checks", "panic", "target_feature", "relocation_model", "sanitize", "fmt_debug"])

// ── reading rustdoc's `CfgTrace` ─────────────────────────────────────────────

/**
 * The conjunction of an item's `#[cfg(..)]` attributes. rustdoc prints each as rustc's
 * `CfgEntry` in Debug form:
 * `#[attr = CfgTrace([Not(NameValue { name: "target_arch", value: Some("wasm32"), span: .. }, ..)])]`.
 * `CfgAttrTrace` (`#[cfg_attr(..)]`) gates attributes, not the item, and is ignored.
 */
export function cfgOfAttrs(attrs: unknown[] | undefined, what: string): Cfg {
  const parts: Cfg[] = []
  for (const a of attrs ?? []) {
    const text = typeof a === "string" ? a : (a as { other?: string })?.other
    if (typeof text !== "string" || !text.startsWith("#[attr = CfgTrace(")) continue
    const p = new Parser(text, "#[attr = CfgTrace(".length, what)
    parts.push(...p.list())
    p.expect(")]")
  }
  return and(...parts)
}

class Parser {
  constructor(readonly s: string, public i: number, readonly what: string) {}
  fail(msg: string): never {
    throw new Error(`${this.what}: can't read cfg (${msg}) at ${JSON.stringify(this.s.slice(this.i, this.i + 40))} in ${this.s}`)
  }
  eat(t: string) {
    if (!this.s.startsWith(t, this.i)) return false
    this.i += t.length
    return true
  }
  expect(t: string) {
    if (!this.eat(t)) this.fail(`expected ${JSON.stringify(t)}`)
  }
  /** `[entry, entry]` */
  list(): Cfg[] {
    this.expect("[")
    const out: Cfg[] = []
    while (!this.eat("]")) {
      if (out.length) this.expect(", ")
      out.push(this.entry())
    }
    return out
  }
  /** A span (`crates/rune/src/lib.rs:325:10: 325:34 (#0)`), up to the `)` closing its entry. */
  span() {
    for (let depth = 0; this.i < this.s.length; this.i++) {
      const c = this.s[this.i]
      if (c === "(") depth++
      else if (c === ")" && depth-- === 0) return
    }
    this.fail("unterminated span")
  }
  str(): string {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(this.s.slice(this.i))
    if (!m) this.fail("expected a string")
    this.i += m[0].length
    return JSON.parse(m[0])
  }
  entry(): Cfg {
    const op = this.eat("All(") ? "all" : this.eat("Any(") ? "any" : undefined
    if (op) {
      const items = this.list()
      this.expect(", ")
      this.span()
      this.expect(")")
      return op === "all" ? { all: items } : { any: items }
    }
    if (this.eat("Not(")) {
      const inner = this.entry()
      this.expect(", ")
      this.span()
      this.expect(")")
      return { not: inner }
    }
    if (this.eat("Bool(")) {
      const v = this.eat("true") ? true : this.eat("false") ? false : this.fail("expected a bool")
      this.expect(", ")
      this.span()
      this.expect(")")
      return v
    }
    if (this.eat("NameValue { name: ")) {
      const name = this.str()
      this.expect(", value: ")
      const value = this.eat("None") ? undefined : (this.expect("Some("), this.str())
      if (value !== undefined) this.expect(")")
      this.expect(", span: ")
      const end = this.s.indexOf(" }", this.i)
      if (end < 0) this.fail("unterminated NameValue")
      this.i = end + 2
      return value === undefined ? { name } : { name, value }
    }
    return this.fail("unknown cfg entry (a newer rustc? see tools/bindgen/cfg.ts)")
  }
}

// ── combining and simplifying ────────────────────────────────────────────────

export function and(...parts: Cfg[]): Cfg {
  const flat: Cfg[] = []
  const seen = new Set<string>()
  for (const p of parts.flatMap((p) => (typeof p === "object" && "all" in p ? p.all : [p]))) {
    if (p === true) continue
    if (p === false) return false
    const key = render(p)
    if (!seen.has(key)) {
      seen.add(key)
      flat.push(p)
    }
  }
  return flat.length === 0 ? true : flat.length === 1 ? flat[0]! : { all: flat }
}

function or(parts: Cfg[]): Cfg {
  if (parts.includes(true)) return true
  const rest = parts.filter((p) => p !== false)
  return rest.length === 0 ? false : rest.length === 1 ? rest[0]! : { any: rest }
}

/** Rust's syntax for a predicate: `all(unix, not(target_os = "macos"))`. */
export function render(c: Cfg): string {
  if (c === true) return "all()"
  if (c === false) return "any()"
  if ("not" in c) return `not(${render(c.not)})`
  if ("all" in c) return `all(${c.all.map(render).join(", ")})`
  if ("any" in c) return `any(${c.any.map(render).join(", ")})`
  return c.value === undefined ? c.name : `${c.name} = ${JSON.stringify(c.value)}`
}

/**
 * Replaces the names that aren't the addon's to test with what they were when rustdoc ran.
 * Where the item's existence pins a name's value (under `all` and `not`), that's it; under
 * `any`, it doesn't, and the generator stops rather than guess.
 */
function settle(c: Cfg, positive: boolean, pinned: boolean, what: string): Cfg {
  if (typeof c === "boolean") return c
  if ("not" in c) {
    const inner = settle(c.not, !positive, pinned, what)
    return typeof inner === "boolean" ? !inner : { not: inner }
  }
  if ("all" in c) return and(...c.all.map((x) => settle(x, positive, pinned && (positive || c.all.length === 1), what)))
  if ("any" in c) return or(c.any.map((x) => settle(x, positive, pinned && (!positive || c.any.length === 1), what)))
  if (NEVER.has(c.name)) return false
  if (TARGET.has(c.name) || BUILD.has(c.name)) return c
  if (!pinned) throw new Error(`${what}: can't tell whether cfg ${render(c)} holds in the addon's build (it sits under any(..)); bind or deny it by hand`)
  return positive
}

// ── targets ──────────────────────────────────────────────────────────────────

type TargetCfg = Map<string, Set<string>>
const targetCache = new Map<string, TargetCfg>()

/** `rustc --print cfg --target <triple>`, as name → values (`""` for a bare name). */
function targetCfg(triple: string): TargetCfg {
  let cfg = targetCache.get(triple)
  if (cfg) return cfg
  const out = execFileSync("rustc", ["--print", "cfg", "--target", triple], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
  })
  cfg = new Map()
  for (const line of out.split("\n").filter(Boolean)) {
    const m = /^([\w]+)(?:="(.*)")?$/.exec(line.trim())
    if (!m) continue
    if (!cfg.has(m[1]!)) cfg.set(m[1]!, new Set())
    cfg.get(m[1]!)!.add(m[2] ?? "")
  }
  targetCache.set(triple, cfg)
  return cfg
}

/** The targets the addon is built for: package.json's `napi.targets`. */
export const targets: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).napi.targets

/** A predicate's value on a target: true, false, or null when the build decides (`debug_assertions`). */
function holds(c: Cfg, t: TargetCfg): boolean | null {
  if (typeof c === "boolean") return c
  if ("not" in c) {
    const v = holds(c.not, t)
    return v === null ? null : !v
  }
  if ("all" in c) {
    const vs = c.all.map((x) => holds(x, t))
    return vs.includes(false) ? false : vs.includes(null) ? null : true
  }
  if ("any" in c) {
    const vs = c.any.map((x) => holds(x, t))
    return vs.includes(true) ? true : vs.includes(null) ? null : false
  }
  if (!TARGET.has(c.name)) return null
  return t.get(c.name)?.has(c.value ?? "") ?? false
}

/**
 * The gate for an item documented on `docTarget` under `cfg`. Throws if the predicate is false
 * on the documented target itself: that would be a misread `CfgTrace`.
 */
export function gate(cfg: Cfg, docTarget: string, what: string): Gate {
  if (cfg === true) return "always"
  const c = settle(cfg, true, true, what)
  if (c === true) return "always"
  if (c === false) return "never"
  if (holds(c, targetCfg(docTarget)) === false) throw new Error(`${what}: cfg ${render(c)} is false on ${docTarget}, where rustdoc documented it`)
  const values = targets.map((t) => holds(c, targetCfg(t)))
  if (values.every((v) => v === true)) return "always"
  if (values.every((v) => v === false)) return "never"
  return { cfg: render(c) }
}

/** `#[cfg(..)]` and a newline for a gate, or nothing. */
export function cfgAttr(g: Gate, indent = ""): string {
  return typeof g === "object" ? `${indent}#[cfg(${g.cfg})]\n` : ""
}

/** A key for grouping by gate: "" for always. */
export function gateKey(g: Gate): string {
  return typeof g === "object" ? g.cfg : g === "never" ? "!never" : ""
}

/** The docs of a gated item, saying where it exists. */
export function gatedDocs(docs: string | undefined | null, g: Gate): string {
  if (typeof g !== "object") return docs ?? ""
  const note = `Only where \`cfg(${g.cfg})\` holds: absent from the addon on other platforms.`
  return docs ? `${docs}\n\n${note}` : note
}
