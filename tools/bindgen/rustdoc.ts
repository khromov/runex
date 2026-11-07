// Loading rustdoc JSON and resolving items across crates.
import { readFileSync } from "node:fs"
import { and, cfgOfAttrs, gate, gateKey, type Cfg, type Gate } from "./cfg.ts"
import type { CrateConfig } from "./config.ts"

export type Json = any

export interface Glob {
  /** Where the glob's items land (crate-relative module path). */
  prefix: string[]
  /** The module it globs: a local id, or another crate's def key. */
  id?: string
  externKey?: string
  /** The `#[cfg]`s on the way to the glob. */
  cfg: Cfg
}

export interface Export {
  /** Crate-relative public path, e.g. ["tok", "theme"]. */
  path: string[]
  /** The local item id, when the item is defined in this crate. */
  id?: string
  /** The defining crate's key, for re-exports of other crates' items. */
  externKey?: string
  /** The `#[cfg]`s of the modules and `use`s on the way to it, and its own. */
  cfg: Cfg
}

export class Crate {
  readonly name: string
  readonly config: CrateConfig
  readonly idx: Record<string, Json>
  readonly paths: Record<string, Json>
  readonly root: string
  /** Local item id → shortest public path. */
  readonly publicPath = new Map<string, string[]>()
  /** Local item id → the `#[cfg]`s on its shortest public path. */
  readonly publicCfg = new Map<string, Cfg>()
  /** The target rustdoc documented (`aarch64-apple-darwin`). */
  readonly target: string
  /** rustdoc's JSON schema version (`format_version`); config.ts records the one this reads. */
  readonly format: number
  readonly exports: Export[] = []
  readonly globs: Glob[] = []

  constructor(config: CrateConfig, file: string) {
    const doc = JSON.parse(readFileSync(file, "utf8"))
    this.config = config
    this.name = config.crate
    this.idx = doc.index
    this.paths = doc.paths
    this.root = String(doc.root)
    this.target = doc.target?.triple ?? "unknown"
    this.format = doc.format_version
    this.findParents()
    this.walk(this.root, [], new Set(), true)
  }

  item(id: string | number): Json | undefined {
    return this.idx[String(id)]
  }

  kindOf(item: Json): string {
    return Object.keys(item.inner)[0]!
  }

  /** The defining crate and path of an id used in this crate, `rune_motion::spring::Spring`. */
  defKey(id: string | number): string | undefined {
    const p = this.paths[String(id)]
    return p ? p.path.join("::") : undefined
  }

  private denied(path: string[]): boolean {
    const joined = path.join("::")
    return (this.config.denyModules ?? []).some((m) => joined === m || joined.startsWith(m + "::"))
  }

  private record(path: string[], id: string, cfg: Cfg) {
    const prev = this.publicPath.get(id)
    if (!prev || path.length < prev.length) {
      this.publicPath.set(id, path)
      this.publicCfg.set(id, cfg)
    }
  }

  /** `scope`: the `#[cfg]`s of the modules and `use`s that lead here. */
  private walk(moduleId: string, prefix: string[], seen: Set<string>, scope: Cfg) {
    if (seen.has(moduleId)) return
    seen.add(moduleId)
    const mod = this.item(moduleId)
    if (!mod) return
    for (const childId of mod.inner.module.items) {
      const child = this.item(childId)
      if (!child) continue
      const kind = this.kindOf(child)
      if (kind === "use") {
        const use = child.inner.use
        if (use.id == null) continue
        const via = and(scope, this.cfgOf(childId))
        if (use.is_glob) {
          if (this.denied(prefix)) continue
          const target = this.item(use.id)
          if (target && this.kindOf(target) === "module") this.walk(String(use.id), prefix, seen, and(via, this.cfgOf(use.id)))
          else if (!target) this.globs.push({ prefix, externKey: this.defKey(use.id), cfg: via })
          continue
        }
        const path = [...prefix, use.name]
        if (this.denied(path)) continue
        const target = this.item(use.id)
        if (target) {
          const cfg = and(via, this.cfgOf(use.id))
          if (this.kindOf(target) === "module") {
            this.walk(String(use.id), path, seen, cfg)
            continue
          }
          this.record(path, String(use.id), cfg)
          this.exports.push({ path, id: String(use.id), cfg })
        } else {
          const key = this.defKey(use.id)
          if (key) this.exports.push({ path, externKey: key, cfg: via })
        }
        continue
      }
      if (child.visibility !== "public") continue
      const path = [...prefix, child.name]
      if (this.denied(path)) continue
      const cfg = and(scope, this.cfgOf(childId))
      if (kind === "module") {
        this.walk(String(childId), path, seen, cfg)
        continue
      }
      this.record(path, String(childId), cfg)
      this.exports.push({ path, id: String(childId), cfg })
    }
  }

  // ── #[cfg] ───────────────────────────────────────────────────────────────

  /** Item id → the item it's declared in: module, impl block, trait, struct, enum or variant. */
  private parent = new Map<string, string>()
  private cfgCache = new Map<string, Cfg>()

  private findParents() {
    const modules: { id: string; span: Json }[] = []
    for (const [id, item] of Object.entries(this.idx) as [string, Json][]) {
      const inner = item?.inner ?? {}
      const s = inner.struct?.kind
      const children: (number | null)[] =
        inner.module?.items ?? inner.impl?.items ?? inner.trait?.items ?? inner.enum?.variants
        ?? s?.plain?.fields ?? s?.tuple ?? inner.variant?.kind?.struct?.fields ?? inner.variant?.kind?.tuple ?? []
      for (const c of children) if (c != null) this.parent.set(String(c), id)
      if (inner.module && item.span) modules.push({ id, span: item.span })
    }
    // Impl blocks aren't in their module's items: the innermost module whose source holds them.
    const within = (outer: Json, inner: Json) =>
      outer.filename === inner.filename && cmp(outer.begin, inner.begin) <= 0 && cmp(inner.end, outer.end) <= 0
    for (const [id, item] of Object.entries(this.idx) as [string, Json][]) {
      if (!item?.inner?.impl || !item.span || this.parent.has(id)) continue
      let best: { id: string; span: Json } | undefined
      for (const m of modules) if (within(m.span, item.span) && (!best || within(best.span, m.span))) best = m
      if (best) this.parent.set(id, best.id)
    }
  }

  /** Every `#[cfg]` an item is declared under: its own and its enclosing items'. */
  cfgOf(id: string | number): Cfg {
    const key = String(id)
    let cfg = this.cfgCache.get(key)
    if (cfg !== undefined) return cfg
    this.cfgCache.set(key, true) // cycles can't happen, but don't loop if they do
    const item = this.item(key)
    const parent = this.parent.get(key)
    cfg = and(parent ? this.cfgOf(parent) : true, cfgOfAttrs(item?.attrs, `${this.name}::${item?.name ?? key}`))
    this.cfgCache.set(key, cfg)
    return cfg
  }

  /** The gate for `cfg` on the targets runex builds for. */
  gate(cfg: Cfg, what: string): Gate {
    return gate(cfg, this.target, what)
  }

  /** Public items directly in the module at def key `key` (for another crate's glob). */
  moduleItems(key: string): { name: string; id: string }[] {
    const id = this.localIdForKey(key)
    const mod = id ? this.item(id) : undefined
    if (!mod || this.kindOf(mod) !== "module") return []
    const out: { name: string; id: string }[] = []
    for (const childId of mod.inner.module.items) {
      const child = this.item(childId)
      if (!child) continue
      if (this.kindOf(child) === "use") {
        const use = child.inner.use
        if (!use.is_glob && use.id != null && this.item(use.id)) out.push({ name: use.name, id: String(use.id) })
        continue
      }
      if (child.visibility === "public" && child.name) out.push({ name: child.name, id: String(childId) })
    }
    return out
  }

  /** The local id whose def path is `key` (`rune::el::El`), if this crate defines it. */
  localIdForKey(key: string): string | undefined {
    if (!this.byKey) {
      this.byKey = new Map()
      for (const [id, p] of Object.entries(this.paths)) {
        if ((p as Json).crate_id === 0) this.byKey.set((p as Json).path.join("::"), id)
      }
    }
    return this.byKey.get(key)
  }
  private byKey?: Map<string, string>

  /** Trait names implemented by a struct or enum (`Clone`, `Copy`, `Default`, ...). */
  traitsOf(item: Json): Set<string> {
    const inner = item.inner.struct ?? item.inner.enum
    const out = new Set<string>()
    const own = gateKey(this.gate(this.cfgOf(item.id), item.name))
    for (const implId of inner?.impls ?? []) {
      const impl = this.item(implId)?.inner.impl
      if (!impl || !impl.trait || impl.blanket_impl || impl.is_negative) continue
      // Implemented on some platforms only: not one to rely on.
      if (gateKey(this.gate(and(this.cfgOf(item.id), this.cfgOf(implId)), item.name)) !== own) continue
      // `impl<S: Clone> Clone for X<S>`: the state type isn't Clone, so neither is X<JsState>.
      const bounded = (impl.generics?.params ?? []).some((p: Json) => (p.kind?.type?.bounds ?? []).some((b: Json) => b.trait_bound))
        || (impl.generics?.where_predicates ?? []).length > 0
      if (bounded) continue
      out.add(impl.trait.path.split("::").pop())
    }
    return out
  }

  /** `impl Trait for X` blocks of a struct or enum (not blanket or auto impls), as items. */
  traitImpls(item: Json, trait: string): Json[] {
    const inner = item.inner.struct ?? item.inner.enum
    const out: Json[] = []
    for (const implId of inner?.impls ?? []) {
      const it = this.item(implId)
      const impl = it?.inner.impl
      if (impl?.trait && !impl.blanket_impl && !impl.is_synthetic && impl.trait.path.split("::").pop() === trait) out.push(it)
    }
    return out
  }

  /** Inherent methods and associated consts, public ones only. */
  inherent(item: Json): Json[] {
    const inner = item.inner.struct ?? item.inner.enum
    const out: Json[] = []
    for (const implId of inner?.impls ?? []) {
      const impl = this.item(implId)?.inner.impl
      if (!impl || impl.trait || impl.blanket_impl) continue
      for (const m of impl.items) {
        const it = this.item(m)
        if (it && it.visibility === "public") out.push(it)
      }
    }
    return out
  }
}

function cmp(a: [number, number], b: [number, number]) {
  return a[0] - b[0] || a[1] - b[1]
}
