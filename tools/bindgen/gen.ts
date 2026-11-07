// runex's binding generator: reads rustdoc JSON for Rune's crates and writes napi-rs bindings
// (src/gen/*.rs) and the TypeScript modules that expose them (ts/gen/**). Run through
// `bun tools/bindgen/main.ts`.
//
// Every public item is bound unless config.ts denies it or a type in its signature can't cross
// into JavaScript; tools/bindgen/report.md lists what was skipped and why. Kinds:
//
// - record: a struct whose fields are all public and convertible. JavaScript sees an object with
//   those fields (an instance of a generated TypeScript class carrying the methods); literals work.
// - enum: unit variants as strings, data variants as `{ Variant: payload }`.
// - class: anything else. A napi class whose instance owns (or borrows) the Rust value; methods
//   that take `self` and return `Self` change it in place and return `this` when the type isn't
//   Clone, and return a new instance when it is.
import { and, gateKey, type Cfg, type Gate } from "./cfg.ts"
import type { CrateConfig } from "./config.ts"
import { Crate, type Json } from "./rustdoc.ts"

export type Kind = "record" | "class" | "enum"

export interface Bound {
  key: string
  crate: Crate
  id: string
  item: Json
  name: string
  /** Rust path for generated code, with `S` filled in (`rune::MenuItem<crate::state::JsState>`). */
  rust: string
  /** Unique native name (`El`, `kit_Button`, `tok__Theme`). */
  js: string
  /** Rust wrapper struct for classes. */
  wrapper: string
  kind: Kind
  traits: Set<string>
  /** Type parameters filled with the state type. */
  stateParams: string[]
  /** Public path inside its crate (module segments + name). */
  path: string[]
  docs: string
  /** Borrows for a lifetime: JavaScript only ever sees it lent to a callback. */
  lendOnly?: boolean
  /** The `#[cfg]`s it's declared and exported under (cfg.ts), and the gate they make. */
  cfg: Cfg
  gate: Gate
}

export interface Skip {
  what: string
  why: string
}

const STD: Record<string, string> = {
  "alloc::string::String": "String",
  "alloc::vec::Vec": "Vec",
  "core::option::Option": "Option",
  "core::result::Result": "Result",
  "alloc::boxed::Box": "Box",
  "alloc::rc::Rc": "Rc",
  "alloc::sync::Arc": "Arc",
  "alloc::borrow::Cow": "Cow",
  "core::time::Duration": "Duration",
  "std::path::PathBuf": "PathBuf",
  "std::path::Path": "Path",
  "core::ops::range::Range": "Range",
  "core::ops::Range": "Range",
  "core::convert::Into": "Into",
  "core::convert::AsRef": "AsRef",
  "core::iter::traits::collect::IntoIterator": "IntoIterator",
  "core::iter::traits::iterator::Iterator": "Iterator",
  "core::ops::function::Fn": "Fn",
  "core::ops::function::FnMut": "FnMut",
  "core::ops::function::FnOnce": "FnOnce",
  "alloc::string::ToString": "ToString",
  "core::fmt::Display": "Display",
  "core::hash::Hash": "Hash",
  "core::marker::Send": "Send",
  "core::marker::Sync": "Sync",
  "core::any::Any": "Any",
  "std::collections::hash::map::HashMap": "HashMap",
}

/** Types runex converts by hand (src/app.rs and friends), by def key. */
const MANUAL: Record<string, { rust: string; ts: string }> = {
  "rune::runtime::cx::Waker": { rust: "rune::Waker", ts: "Waker" },
}

const PRIMS: Record<string, string> = {
  f32: "number", f64: "number", i8: "number", i16: "number", i32: "number", i64: "number", isize: "number",
  u8: "number", u16: "number", u32: "number", u64: "number", usize: "number", bool: "boolean", char: "string", str: "string",
}

const RESERVED_TS = new Set(["default", "new", "delete", "function", "class", "in", "of", "var", "let", "const", "enum", "export", "import", "return", "switch", "case", "this", "with", "yield", "typeof", "void", "while", "for", "if", "else", "do", "break", "continue", "try", "catch", "finally", "throw", "instanceof", "super", "extends", "debugger", "null", "true", "false", "package", "private", "protected", "public", "static", "interface", "implements", "await"])

/** Rust identifiers that can't be bare locals in generated code. */
function local(name: string) {
  return `a_${name.replace(/^_+/, "")}`
}

export class Model {
  readonly crates = new Map<string, Crate>()
  readonly bound = new Map<string, Bound>()
  readonly skips: Skip[] = []
  /** Items bound under a `#[cfg]`: absent from the addon on some targets. */
  readonly gated: { what: string; cfg: string }[] = []
  /** The bound types the signature being planned names (see `track`). */
  private touched?: Set<Bound>
  private jsNames = new Set<string>()

  add(crate: Crate) {
    this.crates.set(crate.name, crate)
  }

  skip(what: string, why: string) {
    this.skips.push({ what, why })
  }

  /**
   * The gate for an item declared under `cfg`, recorded for the report: skipped when it exists on
   * none of runex's targets, listed as gated when on some. `owner`'s gate is already implied.
   */
  gate(crate: Crate, cfg: Cfg, what: string, owner?: Gate): Gate {
    const g = crate.gate(cfg, what)
    if (g === "never") this.skip(what, "exists on none of the targets runex builds for (#[cfg])")
    else if (typeof g === "object" && (!owner || gateKey(owner) !== g.cfg)) this.gated.push({ what, cfg: g.cfg })
    return g
  }

  /** Runs `fn` and returns, with its result, the `#[cfg]`s of every bound type it named. */
  track<T>(fn: () => T): { value: T; cfg: Cfg } {
    const outer = this.touched
    this.touched = new Set()
    try {
      const value = fn()
      return { value, cfg: and(...[...this.touched].map((b) => b.cfg)) }
    } finally {
      this.touched = outer
    }
  }

  denied(crate: Crate, path: string[], member?: string) {
    const deny = crate.config.deny ?? []
    const joined = path.join("::")
    return deny.includes(joined) || deny.includes(path[path.length - 1]!) || (member !== undefined && (deny.includes(`${joined}::${member}`) || deny.includes(`${path[path.length - 1]}::${member}`)))
  }

  uniqueJs(crate: Crate, path: string[]): string {
    const base = crate.config.prefix + (path.length > 1 && !this.isRootLevel(crate, path) ? path.join("__") : path[path.length - 1]!)
    let name = base
    for (let i = 2; this.jsNames.has(name); i++) name = `${base}_${i}`
    this.jsNames.add(name)
    return name
  }

  private isRootLevel(crate: Crate, path: string[]) {
    return path.length === 1
  }

  /** Collects every public struct and enum, then settles which are records. */
  collect() {
    for (const crate of this.crates.values()) {
      for (const [id, path] of crate.publicPath) {
        const item = crate.item(id)!
        const kind = crate.kindOf(item)
        if (kind !== "struct" && kind !== "enum") continue
        if (this.denied(crate, path)) continue
        const key = crate.defKey(id)
        if (!key || this.bound.has(key)) continue
        const generics = (item.inner[kind].generics.params as Json[])
        const lifetimes = generics.filter((g) => g.kind.lifetime).length
        if (lifetimes > 1 || (lifetimes === 1 && kind !== "struct")) {
          this.skip(`${crate.name}::${path.join("::")}`, "has lifetime parameters")
          continue
        }
        const stateParams: string[] = []
        let ok = true
        for (const g of generics) {
          if (g.kind.lifetime) continue
          if (g.kind.const) { ok = false; break }
          const bounds = g.kind.type?.bounds ?? []
          if (bounds.some((b: Json) => b.trait_bound)) { ok = false; break }
          if (g.name !== "S" && !(crate.config.stateGenerics ?? []).includes(g.name)) { ok = false; break }
          stateParams.push(g.name)
        }
        if (!ok) {
          this.skip(`${crate.name}::${path.join("::")}`, "generic over something other than the app state")
          continue
        }
        const what = `${crate.name}::${path.join("::")}`
        const cfg = and(crate.cfgOf(id), crate.publicCfg.get(id) ?? true)
        const gate = this.gate(crate, cfg, what)
        if (gate === "never") continue
        const rustBase = `${crate.name}::${path.join("::")}`
        // A struct borrowing for a lifetime (`Play<'a, X>`) is only ever lent to callbacks: its
        // wrapper names it at 'static, and lends cast the lifetime away for the call.
        const params = generics.map((g) => (g.kind.lifetime ? "'static" : "crate::state::JsState"))
        const rust = params.length ? `${rustBase}<${params.join(", ")}>` : rustBase
        const js = this.uniqueJs(crate, path)
        this.bound.set(key, {
          key, crate, id, item, name: item.name, rust, js, wrapper: `W_${js}`, kind: kind === "enum" ? "enum" : "class",
          traits: crate.traitsOf(item), stateParams, path, docs: item.docs ?? "", lendOnly: lifetimes === 1, cfg, gate,
        })
      }
    }
    // Records: plain structs with all fields public and convertible both ways, and Clone.
    let changed = true
    const candidates = [...this.bound.values()].filter((b) => b.kind === "class" && this.recordShape(b))
    for (const b of candidates) b.kind = "record"
    while (changed) {
      changed = false
      for (const b of [...this.bound.values()]) {
        if (b.kind === "record" && !this.recordFieldsOk(b)) { b.kind = "class"; changed = true }
        if (b.kind === "enum" && !b.traits.has("Clone")) { /* enums convert by value; non-Clone ones can't be read back from &T */ }
      }
    }
  }

  private recordShape(b: Bound): boolean {
    const s = b.item.inner.struct
    const nonExhaustive = (b.item.attrs ?? []).some((a: Json) => a === "non_exhaustive" || a?.other?.includes?.("non_exhaustive"))
    if (nonExhaustive && !b.traits.has("Default")) return false
    if (!s || !s.kind.plain || s.kind.plain.has_stripped_fields) return false
    if (b.stateParams.length) return false
    if (!b.traits.has("Clone") || b.lendOnly) return false
    const fields = s.kind.plain.fields.map((f: Json) => b.crate.item(f))
    if (!(fields.length > 0 && fields.every((f: Json) => f && f.visibility === "public"))) return false
    // A field that exists on some platforms only: a record's literal can't say so.
    const own = gateKey(b.gate)
    if (fields.some((f: Json) => gateKey(b.crate.gate(and(b.cfg, b.crate.cfgOf(f.id)), `${b.key}::${f.name}`)) !== own)) return false
    // Builder methods named like fields (`TextStyle::italic`) need a class: JavaScript has one
    // namespace for both, and the methods are what Rust code calls.
    const names = new Set(fields.map((f: Json) => f.name))
    return !b.crate.inherent(b.item).some((m: Json) => m.inner.function && names.has(m.name))
  }

  recordFields(b: Bound): { name: string; ty: Json; docs: string }[] {
    return b.item.inner.struct.kind.plain.fields.map((f: Json) => {
      const it = b.crate.item(f)!
      return { name: it.name, ty: it.inner.struct_field, docs: it.docs ?? "" }
    })
  }

  private recordFieldsOk(b: Bound): boolean {
    const ctx = new Ctx(this, b.crate, b)
    return this.recordFields(b).every((f) => {
      const v = this.value(ctx, f.ty)
      return v && !v.needsStatic && !v.isClass && !v.resultOnly
    })
  }

  // ── types ────────────────────────────────────────────────────────────────

  /** Resolves a `resolved_path` to a std name or a bound type. */
  /** A type alias's definition (`FileDialogResult` → `Result<Option<PathBuf>, FileDialogError>`). */
  aliasOf(crate: Crate, rp: Json): { crate: Crate; ty: Json } | undefined {
    const key = crate.defKey(rp.id)
    const p = crate.paths[String(rp.id)]
    if (!key || p?.kind !== "type_alias") return undefined
    const owner = this.crates.get(key.split("::")[0]!)
    const id = owner?.localIdForKey(key)
    const item = id ? owner!.item(id) : undefined
    const alias = item?.inner?.type_alias
    if (!alias || (alias.generics?.params ?? []).length) return undefined
    return { crate: owner!, ty: alias.type }
  }

  resolve(crate: Crate, rp: Json): { std?: string; bound?: Bound; key?: string } {
    const key = crate.defKey(rp.id)
    if (!key) return {}
    if (STD[key]) return { std: STD[key], key }
    const b = this.bound.get(key)
    if (b) {
      this.touched?.add(b)
      return { bound: b, key }
    }
    // A re-export of another crate's item: look it up there.
    return { key }
  }

  /** Generic type arguments of a path. */
  args(rp: Json): Json[] {
    return (rp.args?.angle_bracketed?.args ?? []).filter((a: Json) => a.type).map((a: Json) => a.type)
  }

  /** The owned value conversion for `ty`: its Rust type (FromJs/ToJs) and TS type. */
  value(ctx: Ctx, ty: Json): ValueType | null {
    if (ty.primitive) {
      if (ty.primitive === "str") return null
      const ts = PRIMS[ty.primitive]
      return ts ? { rust: ty.primitive, ts } : null
    }
    if (ty.tuple) {
      if (ty.tuple.length === 0) return { rust: "()", ts: "void" }
      const parts = ty.tuple.map((t: Json) => this.value(ctx, t))
      if (parts.some((p: ValueType | null) => !p)) return null
      return { rust: `(${parts.map((p: ValueType) => p.rust).join(", ")},)`, ts: `[${parts.map((p: ValueType) => p.ts).join(", ")}]` }
    }
    if (ty.array) {
      const inner = this.value(ctx, ty.array.type)
      return inner ? { rust: `[${inner.rust}; ${ty.array.len}]`, ts: `${wrapArray(inner.ts)}[]` } : null
    }
    if (ty.borrowed_ref) {
      const r = ty.borrowed_ref
      // `&'static str`, or `&str` with an elided lifetime: in a constant or field that's 'static.
      const statically = r.lifetime === "'static" || r.lifetime == null
      if (statically && !r.is_mutable && r.type.primitive === "str") return { rust: "&'static str", ts: "string" }
      if (statically && !r.is_mutable && r.type.slice) {
        const inner = this.value(ctx, r.type.slice)
        // Read from JavaScript only when written 'static (leaked, as a static would be).
        if (inner && !inner.isClass) return { rust: `&'static [${inner.rust}]`, ts: inner.rust === "u8" ? "Uint8Array" : `${wrapArray(inner.ts)}[]`, resultOnly: r.lifetime !== "'static" }
      }
      return null
    }
    if (ty.generic) {
      if (ctx.isState(ty.generic)) return null
      if (ty.generic === "Self" && ctx.self) return this.boundValue(ctx.self)
      return null
    }
    if (ty.resolved_path) {
      const rp = ty.resolved_path
      const manualKey = ctx.crate.defKey(rp.id)
      if (manualKey && MANUAL[manualKey]) return { ...MANUAL[manualKey]! }
      const alias = this.aliasOf(ctx.crate, rp)
      if (alias) return this.value(new Ctx(this, alias.crate, ctx.self, ctx.generics), alias.ty)
      const r = this.resolve(ctx.crate, rp)
      const a = this.args(rp)
      if (r.std === "String") return { rust: "String", ts: "string" }
      if (r.std === "Duration") return { rust: "std::time::Duration", ts: "number" }
      if (r.std === "PathBuf") return { rust: "std::path::PathBuf", ts: "string" }
      if (r.std === "Option" || r.std === "Vec") {
        const inner = a[0] && this.value(ctx, a[0])
        if (!inner) return null
        if (r.std === "Vec" && inner.rust === "u8") return { rust: "Vec<u8>", ts: "Uint8Array" }
        return r.std === "Option"
          ? { rust: `Option<${inner.rust}>`, ts: `${inner.ts} | null`, isClass: false }
          : { rust: `Vec<${inner.rust}>`, ts: `${wrapArray(inner.ts)}[]` }
      }
      if (r.std === "Result" && a[0] && a[1]) {
        const ok = this.value(ctx, a[0])
        const e = this.value(ctx, a[1])
        if (!ok || !e) return null
        return { rust: `Result<${ok.rust}, ${e.rust}>`, ts: `{ Ok: ${ok.ts} } | { Err: ${e.ts} }` }
      }
      if (r.std === "Range" && a[0]) {
        const inner = this.value(ctx, a[0])
        return inner ? { rust: `std::ops::Range<${inner.rust}>`, ts: `{ start: ${inner.ts}; end: ${inner.ts} }` } : null
      }
      if (r.std === "Arc" && a[0]?.slice?.primitive === "u8") return { rust: "std::sync::Arc<[u8]>", ts: "Uint8Array" }
      if (r.std === "Box" && a[0]) {
        const inner = this.value(ctx, a[0])
        return inner ? { ...inner, rust: `Box<${inner.rust}>` } : null
      }
      if (r.bound) {
        if (r.bound.stateParams.length !== a.length && a.length) return null
        return this.boundValue(r.bound)
      }
      if (r.key && MANUAL[r.key]) return { ...MANUAL[r.key]! }
      return null
    }
    return null
  }

  /** The public path of a type by its def key, for types runex doesn't bind (`rune::Cx`). */
  publicPathOf(key: string): string | undefined {
    const crateName = key.split("::")[0]!
    const crate = this.crates.get(crateName)
    const id = crate?.localIdForKey(key)
    const path = id ? crate!.publicPath.get(id) : undefined
    return path ? `${crateName}::${path.join("::")}` : undefined
  }

  boundValue(b: Bound): ValueType {
    this.touched?.add(b)
    return { rust: b.rust, ts: tsRef(b), isClass: b.kind === "class", bound: b, needsStatic: false, lendOnly: b.lendOnly }
  }
}

export interface ValueType {
  rust: string
  ts: string
  isClass?: boolean
  bound?: Bound
  needsStatic?: boolean
  lendOnly?: boolean
  /** Converts to JavaScript only (a borrowed slice in a constant). */
  resultOnly?: boolean
}

function wrapArray(ts: string) {
  return /[|&\s]/.test(ts) && !ts.startsWith("[") ? `(${ts})` : ts
}

/** How a bound type is named in TypeScript declarations (its unique name in the types hub). */
export function tsRef(b: Bound): string {
  return b.js
}

export class Ctx {
  constructor(
    readonly model: Model,
    readonly crate: Crate,
    readonly self?: Bound,
    readonly generics: Map<string, Json[]> = new Map(),
  ) {}
  /** A type parameter that stands for the app's state: no trait bounds. */
  isState(name: string): boolean {
    if (this.self?.stateParams.includes(name)) return true
    const bounds = this.generics.get(name)
    if (!bounds) return false
    return !bounds.some((b) => b.trait_bound && !["Any"].includes(b.trait_bound.trait.path.split("::").pop()))
  }
  with(generics: Json): Ctx {
    const map = new Map(this.generics)
    for (const p of generics?.params ?? []) if (p.kind.type) map.set(p.name, p.kind.type.bounds ?? [])
    for (const w of generics?.where_predicates ?? []) {
      const bp = w.bound_predicate
      if (bp?.type?.generic) map.set(bp.type.generic, [...(map.get(bp.type.generic) ?? []), ...bp.bounds])
    }
    return new Ctx(this.model, this.crate, this.self, map)
  }
}
