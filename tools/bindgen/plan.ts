// Planning one binding: how each parameter converts from JavaScript, how the result converts
// back, and how closures become JavaScript callbacks.
import { Ctx, type Bound, type Model, tsRef } from "./gen.ts"
import type { Json } from "./rustdoc.ts"

export class Unsupported extends Error {}

const fail = (why: string): never => {
  throw new Unsupported(why)
}

export interface ParamPlan {
  name: string
  ts: string
  /** Statements that read the raw argument `${raw}` into locals. */
  stmts: string[]
  /** The expression passed to the Rust call. */
  pass: string
  /** Statements after the call (writing a `&mut Vec<T>` back into its array). */
  post?: string[]
}

export interface ResultPlan {
  ts: string
  /** Converts `expr` (of the call's return type) into `conv::Result<conv::Value>`. */
  toJs(expr: string): string
}

function lastSeg(path: string) {
  return path.split("::").pop()!
}

/** Prints a rustdoc type as Rust source for generated code. */
export function rustType(ctx: Ctx, ty: Json): string {
  const m = ctx.model
  if (ty.primitive) return ty.primitive
  if (ty.tuple) return `(${ty.tuple.map((t: Json) => rustType(ctx, t)).join(", ")}${ty.tuple.length === 1 ? "," : ""})`
  if (ty.array) return `[${rustType(ctx, ty.array.type)}; ${ty.array.len}]`
  if (ty.slice) return `[${rustType(ctx, ty.slice)}]`
  if (ty.borrowed_ref) {
    const r = ty.borrowed_ref
    const lt = r.lifetime === "'static" ? "'static " : ""
    return `&${lt}${r.is_mutable ? "mut " : ""}${rustType(ctx, r.type)}`
  }
  if (ty.generic) {
    if (ty.generic === "Self" && ctx.self) return ctx.self.rust
    if (ctx.isState(ty.generic)) return "crate::state::JsState"
    return fail(`generic ${ty.generic}`)
  }
  if (ty.dyn_trait) {
    const t = ty.dyn_trait.traits.map((t: Json) => traitSource(ctx, t.trait)).join(" + ")
    return `dyn ${t}`
  }
  if (ty.resolved_path) {
    const rp = ty.resolved_path
    const r = m.resolve(ctx.crate, rp)
    const args = m.args(rp).map((a: Json) => rustType(ctx, a))
    const withArgs = (p: string) => (args.length ? `${p}<${args.join(", ")}>` : p)
    if (r.std) {
      const full: Record<string, string> = {
        String: "String", Vec: "Vec", Option: "Option", Result: "Result", Box: "Box", Rc: "std::rc::Rc", Arc: "std::sync::Arc",
        Cow: "std::borrow::Cow", Duration: "std::time::Duration", PathBuf: "std::path::PathBuf", Path: "std::path::Path",
        Range: "std::ops::Range", HashMap: "std::collections::HashMap",
      }
      return withArgs(full[r.std] ?? fail(`std ${r.std}`))
    }
    if (r.bound) {
      if (r.bound.stateParams.length && !args.length) return r.bound.rust
      return withArgs(r.bound.rust.replace(/<.*>$/, ""))
    }
    const pub = r.key ? m.publicPathOf(r.key) : undefined
    if (pub) return withArgs(pub)
    return fail(`type ${r.key ?? rp.path}`)
  }
  if (ty.impl_trait) return fail("impl Trait in a nested position")
  if (ty.function_pointer) return fail("fn pointer")
  return fail(`type ${Object.keys(ty)[0]}`)
}

function traitSource(ctx: Ctx, tr: Json): string {
  const name = lastSeg(tr.path)
  const p = tr.args?.parenthesized
  if (p) {
    const ins = p.inputs.map((t: Json) => rustType(ctx, t)).join(", ")
    return `${name}(${ins})${p.output ? ` -> ${rustType(ctx, p.output)}` : ""}`
  }
  return name
}

/** Bounds of an `impl Trait` or of a generic parameter. */
function boundsOf(ctx: Ctx, ty: Json): Json[] | undefined {
  if (ty.impl_trait) return ty.impl_trait
  if (ty.generic && !ctx.isState(ty.generic) && ty.generic !== "Self") return ctx.generics.get(ty.generic)
  return undefined
}

function traitBound(bounds: Json[], ...names: string[]): Json | undefined {
  return bounds.map((b) => b.trait_bound?.trait).find((t) => t && names.includes(lastSeg(t.path)))
}

function wrapTs(ts: string) {
  return /[|&\s]/.test(ts) && !ts.startsWith("[") ? `(${ts})` : ts
}

function isStrRef(ty: Json) {
  return ty.borrowed_ref && ty.borrowed_ref.type.primitive === "str"
}

function isStatic(ty: Json) {
  return ty.borrowed_ref?.lifetime === "'static"
}

/** A value of `ty` by value from a raw JS argument. */
function ownedParam(ctx: Ctx, name: string, raw: string, ty: Json): ParamPlan {
  const v = ctx.model.value(ctx, ty)
  if (!v) return fail(`parameter type ${describe(ty)}`)
  if (v.lendOnly) return fail(`${v.rust} only exists inside callbacks`)
  if (v.resultOnly) return fail(`parameter ${v.rust}`)
  return { name, ts: v.ts, stmts: [`let ${name}: ${v.rust} = conv::arg(${raw}, ${JSON.stringify(name.replace(/^a_/, ""))})?;`], pass: name }
}

/** A rustdoc type for a skip reason in report.md, without rustdoc's item ids (they change with
 * every regeneration, so a report diff would show them instead of what changed). */
export function describe(ty: Json): string {
  try {
    return JSON.stringify(ty, (key, value) => (key === "id" ? undefined : value)).slice(0, 120)
  } catch {
    return "?"
  }
}

export function planParam(ctx: Ctx, rawName: string, ty: Json, index = 0): ParamPlan {
  // A pattern (`(a, b): (f32, f32)`) or a bare `_` has no usable name: name it by position, so
  // several `_` parameters (rune-knobs' stubs without `panel`) don't all become `a_arg`.
  if (!/^[A-Za-z_]\w*$/.test(rawName) || /^_+$/.test(rawName)) rawName = `arg${index}`
  const name = `a_${rawName.replace(/^_+/, "")}`
  const raw = `${name}.0`
  const label = JSON.stringify(rawName)
  const m = ctx.model
  const bounds = boundsOf(ctx, ty)
  if (bounds) {
    const into = traitBound(bounds, "Into", "AsRef", "Borrow")
    if (into) {
      const target = into.args?.angle_bracketed?.args?.[0]?.type
      if (!target) return fail("Into without a target")
      if (target.primitive === "str" || (target.resolved_path && m.resolve(ctx.crate, target.resolved_path).std === "String")) {
        return { name, ts: "string", stmts: [`let ${name}: String = conv::arg(${raw}, ${label})?;`], pass: name }
      }
      if (target.resolved_path && m.resolve(ctx.crate, target.resolved_path).std === "Path") {
        return { name, ts: "string", stmts: [`let ${name}: std::path::PathBuf = conv::arg(${raw}, ${label})?;`], pass: name }
      }
      if (target.resolved_path && m.resolve(ctx.crate, target.resolved_path).std === "Cow") {
        return { name, ts: "string", stmts: [`let ${name}: String = conv::arg(${raw}, ${label})?;`], pass: name }
      }
      return ownedParam(ctx, name, raw, target)
    }
    if (traitBound(bounds, "ToString", "Display")) {
      return { name, ts: "string", stmts: [`let ${name}: String = conv::arg(${raw}, ${label})?;`], pass: name }
    }
    const iter = traitBound(bounds, "IntoIterator")
    if (iter) {
      const item = iter.args?.angle_bracketed?.constraints?.find((c: Json) => c.name === "Item")?.binding?.equality?.type
      if (!item) return fail("IntoIterator without Item")
      if (isStrRef(item)) {
        return { name, ts: "string[]", stmts: [`let ${name}_owned: Vec<String> = conv::arg(${raw}, ${label})?;`, `let ${name}: Vec<&str> = ${name}_owned.iter().map(String::as_str).collect();`], pass: name }
      }
      const inner = itemValue(ctx, item)
      return { name, ts: `${inner.ts.includes(" ") ? `(${inner.ts})` : inner.ts}[]`, stmts: [`let ${name}: Vec<${inner.rust}> = conv::arg(${raw}, ${label})?;`], pass: name }
    }
    const fn = traitBound(bounds, "Fn", "FnMut", "FnOnce")
    if (fn) {
      if (bounds.some((b) => b.trait_bound && ["Send", "Sync"].includes(lastSeg(b.trait_bound.trait.path)))) return fail("a Send closure")
      return closureParam(ctx, name, raw, label, fn, (c) => c)
    }
    return fail(`bound ${bounds.map((b) => b.trait_bound?.trait?.path ?? b.outlives).join(" + ")}`)
  }
  if (ty.borrowed_ref) {
    const r = ty.borrowed_ref
    const inner = r.type
    if (inner.primitive === "str") {
      if (isStatic(ty)) return { name, ts: "string", stmts: [`let ${name}: &'static str = conv::arg(${raw}, ${label})?;`], pass: name }
      return { name, ts: "string", stmts: [`let ${name}: String = conv::arg(${raw}, ${label})?;`], pass: `&${name}` }
    }
    if (inner.slice?.tuple && inner.slice.tuple.length === 2 && inner.slice.tuple.every(isStrRef)) {
      if (isStatic(ty)) {
        return { name, ts: "[string, string][]", stmts: [`let ${name}: Vec<(&'static str, &'static str)> = conv::arg(${raw}, ${label})?;`, `let ${name}: &'static [(&'static str, &'static str)] = Box::leak(${name}.into_boxed_slice());`], pass: name }
      }
      return { name, ts: "[string, string][]", stmts: [`let ${name}_owned: Vec<(String, String)> = conv::arg(${raw}, ${label})?;`, `let ${name}: Vec<(&str, &str)> = ${name}_owned.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();`], pass: `&${name}` }
    }
    if (inner.resolved_path && r.is_mutable && m.resolve(ctx.crate, inner.resolved_path).std === "Vec") {
      // `&mut Vec<T>`: the array's items move in; afterwards the array holds the Vec's items.
      const item = m.args(inner.resolved_path)[0]
      const v = item && m.value(ctx, item)
      if (!v || v.resultOnly || v.lendOnly) return fail("&mut Vec of an unsupported item")
      return { name, ts: `${wrapTs(v.ts)}[]`, stmts: [`let ${name}_raw = ${raw};`, `let mut ${name}: Vec<${v.rust}> = conv::arg(${name}_raw, ${label})?;`], pass: `&mut ${name}`, post: [`conv::write_array(${name}_raw, ${name})?;`] }
    }
    if (inner.slice && r.is_mutable) {
      // `&mut [T]`: the array's items in, the slice's items written back after the call.
      const v = m.value(ctx, inner.slice)
      if (!v || v.resultOnly || v.lendOnly) return fail("&mut slice of an unsupported item")
      return { name, ts: `${wrapTs(v.ts)}[]`, stmts: [`let ${name}_raw = ${raw};`, `let mut ${name}: Vec<${v.rust}> = conv::arg(${name}_raw, ${label})?;`], pass: `&mut ${name}`, post: [`conv::write_array(${name}_raw, ${name})?;`] }
    }
    if (inner.slice) {
      if (isStatic(ty)) {
        // `&'static [T]`: leaked, as Rust code would pass a static.
        if (isStrRef(inner.slice)) {
          return { name, ts: "string[]", stmts: [`let ${name}: Vec<&'static str> = conv::arg(${raw}, ${label})?;`, `let ${name}: &'static [&'static str] = Box::leak(${name}.into_boxed_slice());`], pass: name }
        }
        const v = itemValue(ctx, inner.slice)
        return { name, ts: `${v.ts.includes(" ") ? `(${v.ts})` : v.ts}[]`, stmts: [`let ${name}: Vec<${v.rust}> = conv::arg(${raw}, ${label})?;`, `let ${name}: &'static [${v.rust}] = Box::leak(${name}.into_boxed_slice());`], pass: name }
      }
      if (isStrRef(inner.slice)) {
        if (isStatic(inner.slice)) return { name, ts: "string[]", stmts: [`let ${name}: Vec<&'static str> = conv::arg(${raw}, ${label})?;`], pass: `&${name}` }
        return { name, ts: "string[]", stmts: [`let ${name}_owned: Vec<String> = conv::arg(${raw}, ${label})?;`, `let ${name}: Vec<&str> = ${name}_owned.iter().map(String::as_str).collect();`], pass: `&${name}` }
      }
      const v = itemValue(ctx, inner.slice)
      const ts = v.rust === "u8" ? "Uint8Array" : `${v.ts.includes(" ") ? `(${v.ts})` : v.ts}[]`
      return { name, ts, stmts: [`let ${name}: Vec<${v.rust}> = conv::arg(${raw}, ${label})?;`], pass: `&${name}` }
    }
    if (inner.resolved_path && m.resolve(ctx.crate, inner.resolved_path).std === "Path") {
      return { name, ts: "string", stmts: [`let ${name}: std::path::PathBuf = conv::arg(${raw}, ${label})?;`], pass: `&${name}` }
    }
    if (inner.dyn_trait) return fail("&dyn Trait")
    const v = m.value(ctx, inner)
    if (!v) return fail(`reference to ${describe(inner)}`)
    if (v.lendOnly) return fail(`${v.rust} only exists inside callbacks`)
    if (v.isClass && v.bound) {
      const b = v.bound
      const get = isStatic(ty) ? `leak(${JSON.stringify(b.name)})` : r.is_mutable ? `get_mut(${JSON.stringify(b.name)})` : `get(${JSON.stringify(b.name)})`
      return {
        name, ts: v.ts,
        stmts: [`let mut ${name}_i = conv::instance::<crate::gen::${b.crate.config.module}::${b.wrapper}>(${raw}).map_err(|e| conv::err(format!("{}: {}", ${label}, e.reason)))?;`, `let ${name} = ${name}_i.slot().${get}?;`],
        pass: name,
      }
    }
    if (r.is_mutable) return fail(`&mut ${describe(inner)}`)
    if (isStatic(ty)) return fail(`&'static ${v.rust}`)
    return { name, ts: v.ts, stmts: [`let ${name}: ${v.rust} = conv::arg(${raw}, ${label})?;`], pass: `&${name}` }
  }
  if (ty.resolved_path) {
    const r = m.resolve(ctx.crate, ty.resolved_path)
    const a = m.args(ty.resolved_path)
    if (r.std === "Option" && a[0]?.borrowed_ref) {
      const inner = a[0].borrowed_ref.type
      if (inner.primitive === "str" && isStatic(a[0])) return { name, ts: "string | null", stmts: [`let ${name}: Option<&'static str> = conv::arg(${raw}, ${label})?;`], pass: name }
      if (inner.primitive === "str") return { name, ts: "string | null", stmts: [`let ${name}: Option<String> = conv::arg(${raw}, ${label})?;`], pass: `${name}.as_deref()` }
      const v = m.value(ctx, inner)
      if (v && !v.isClass && !a[0].borrowed_ref.is_mutable) return { name, ts: `${v.ts} | null`, stmts: [`let ${name}: Option<${v.rust}> = conv::arg(${raw}, ${label})?;`], pass: `${name}.as_ref()` }
      if (v?.isClass && v.bound && !v.lendOnly && !a[0].borrowed_ref.is_mutable) {
        const w = `crate::gen::${v.bound.crate.config.module}::${v.bound.wrapper}`
        const get = isStatic(a[0]) ? `leak(${JSON.stringify(v.bound.name)})` : `get(${JSON.stringify(v.bound.name)})`
        return {
          name, ts: `${v.ts} | null`,
          stmts: [`let mut ${name}_i = if conv::is_nullish(${raw}) { None } else { Some(conv::instance::<${w}>(${raw})?) };`, `let ${name} = match ${name}_i.as_mut() { Some(i) => Some(i.slot().${get}?), None => None };`],
          pass: name,
        }
      }
      return fail("Option of a reference")
    }
    if ((r.std === "Box" || r.std === "Rc") && a[0]?.dyn_trait) {
      const traits = a[0].dyn_trait.traits.map((t: Json) => t.trait)
      const fn = traits.find((t: Json) => ["Fn", "FnMut", "FnOnce"].includes(lastSeg(t.path)))
      if (!fn) return fail("dyn trait object")
      if (traits.some((t: Json) => ["Send", "Sync"].includes(lastSeg(t.path)))) return fail("a Send closure")
      const wrap = r.std === "Box" ? (c: string) => `Box::new(${c})` : (c: string) => `std::rc::Rc::new(${c})`
      return closureParam(ctx, name, raw, label, fn, wrap)
    }
  }
  if (ty.function_pointer) return fnPointerParam(ctx, name, raw, label, ty.function_pointer)
  return ownedParam(ctx, name, raw, ty)
}

/** The element type of a sequence parameter. */
function itemValue(ctx: Ctx, ty: Json) {
  const bounds = boundsOf(ctx, ty)
  if (bounds) {
    const asRef = traitBound(bounds, "AsRef")
    const asRefTarget = asRef?.args?.angle_bracketed?.args?.[0]?.type
    if (asRefTarget?.primitive === "str") return { rust: "String", ts: "string" }
    const into = traitBound(bounds, "Into")
    const target = into?.args?.angle_bracketed?.args?.[0]?.type
    if (target) {
      if (target.resolved_path && ctx.model.resolve(ctx.crate, target.resolved_path).std === "String") return { rust: "String", ts: "string" }
      const v = ctx.model.value(ctx, target)
      if (v) return v
    }
    return fail("sequence of an unsupported bound")
  }
  const v = ctx.model.value(ctx, ty)
  if (!v) return fail(`sequence of ${describe(ty)}`)
  return v
}

// ── closures ────────────────────────────────────────────────────────────────

interface CbArg {
  ts: string
  tsName: string
  /** Rust type annotation for the closure parameter. */
  rust: string
  /** Wraps `body` (which uses `${v}`) so `${v}` holds the JS value for `${a}`. */
  wrap(a: string, v: string, body: string): string
  usesState: boolean
}

/** A callback parameter's name from its type: `KeyEvent` → `key_event`. */
function argName(b: { name: string } | undefined, fallback: string): string {
  if (!b) return fallback
  if (b.name === "Tx") return "tx"
  return b.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
}

function cbArg(ctx: Ctx, ty: Json, i: number): CbArg {
  const m = ctx.model
  const plain = (ts: string, tsName: string, expr: (a: string) => string): CbArg => ({
    ts, tsName, rust: rustType(ctx, ty), usesState: false,
    wrap: (a, v, body) => `{ let ${v} = ${expr(a)}; ${body} }`,
  })
  if (ty.borrowed_ref) {
    const inner = ty.borrowed_ref.type
    if (inner.generic && ctx.isState(inner.generic)) {
      return { ts: "S", tsName: "s", rust: `&${ty.borrowed_ref.is_mutable ? "mut " : ""}crate::state::JsState`, usesState: true, wrap: (a, v, body) => `{ let ${v} = ${a}.value(); ${body} }` }
    }
    if (inner.primitive === "str") return plain("string", `s${i}`, (a) => `conv::arg_js(${a})`)
    if (inner.slice) {
      const v = m.value(ctx, inner.slice)
      if (!v) return fail(`callback slice of ${describe(inner.slice)}`)
      return plain(`${v.ts}[]`, `items${i}`, (a) => `conv::arg_js(${a}.to_vec())`)
    }
    const v = m.value(ctx, inner)
    if (!v) return fail(`callback argument ${describe(inner)}`)
    if (v.isClass && v.bound) {
      const w = `crate::gen::${v.bound.crate.config.module}::${v.bound.wrapper}`
      const fnName = ty.borrowed_ref.is_mutable ? "lend" : "lend_ref"
      const tsName = argName(v.bound, `v${i}`)
      const mut = ty.borrowed_ref.is_mutable ? "mut " : ""
      // A lend-only type borrows for the callback's length; its wrapper names it at 'static.
      const cast = (a: string) => (v.lendOnly ? `unsafe { std::mem::transmute::<&${mut}${rustType(ctx, inner)}, &${mut}${v.rust}>(${a}) }` : a)
      return { ts: v.ts, tsName, rust: rustType(ctx, ty), usesState: false, wrap: (a, v2, body) => `conv::${fnName}::<${w}, _>(${cast(a)}, |${v2}| { ${body} })` }
    }
    if (ty.borrowed_ref.is_mutable) return fail(`callback &mut ${v.rust}`)
    return plain(v.ts, argName(v.bound, `v${i}`), (a) => `conv::arg_js(${a}.clone())`)
  }
  const v = m.value(ctx, ty)
  if (!v) return fail(`callback argument ${describe(ty)}`)
  return plain(v.ts, argName(v.bound, `v${i}`), (a) => `conv::arg_js(${a})`)
}

interface CbRet {
  ts: string
  rust: string
  /** Converts `r: Option<conv::Value>` (None when the callback threw). */
  from(r: string): string
}

function cbRet(ctx: Ctx, ty: Json | null): CbRet {
  if (!ty || (ty.tuple && ty.tuple.length === 0)) return { ts: "void", rust: "()", from: () => "()" }
  if (ty.primitive === "bool") return { ts: "boolean", rust: "bool", from: (r) => `conv::ret_or(${r}, || false)` }
  if (ty.generic && ctx.isState(ty.generic)) return { ts: "S", rust: "crate::state::JsState", from: (r) => `crate::state::JsState::detached(${r})` }
  if (ty.primitive && ty.primitive !== "str") return { ts: "number", rust: ty.primitive, from: (r) => `conv::ret_or(${r}, || 0 as ${ty.primitive})` }
  const m = ctx.model
  if (ty.borrowed_ref?.is_mutable) {
    // `-> &'a mut T` (`on_edit`): the instance the callback returned, from the state it lives in.
    const v = m.value(ctx, ty.borrowed_ref.type)
    if (v?.isClass && v.bound && v.bound.traits.has("Default") && !v.lendOnly) {
      return { ts: v.ts, rust: `&'static mut ${v.rust}`, from: (x) => `conv::ret_mut::<crate::gen::${v.bound!.crate.config.module}::${v.bound!.wrapper}>(${x})` }
    }
    return fail(`callback result &mut ${describe(ty.borrowed_ref.type)}`)
  }
  if (ty.resolved_path) {
    const r = m.resolve(ctx.crate, ty.resolved_path)
    if (r.bound?.name === "El" && r.bound.crate.name === "rune") return { ts: "El", rust: "rune::El", from: (x) => `conv::ret_el(${x})` }
    const v = m.value(ctx, ty)
    if (!v) return fail(`callback result ${describe(ty)}`)
    if (r.std === "Option") return { ts: v.ts, rust: v.rust, from: (x) => `conv::ret_or(${x}, || None)` }
    if (r.std === "String") return { ts: "string", rust: "String", from: (x) => `conv::ret_or(${x}, String::new)` }
    if (v.bound?.traits.has("Default") || r.std === "Vec") return { ts: v.ts, rust: v.rust, from: (x) => `conv::ret_or(${x}, Default::default)` }
    return fail(`callback result ${v.rust} has no default for when the callback throws`)
  }
  // Tuples and arrays of numbers have a default (zeros) for when the callback throws.
  if ((ty.tuple || ty.array) && !JSON.stringify(ty).includes("resolved_path")) {
    const v = m.value(ctx, ty)
    if (v) return { ts: v.ts, rust: v.rust, from: (x) => `conv::ret_or(${x}, Default::default)` }
  }
  return fail(`callback result ${describe(ty)}`)
}

/** Trampolines for `fn` pointer parameters, by signature: Rust source for src/gen/tramp.rs. */
export const trampolines = new Map<string, { id: number; code: string }>()

/**
 * A `fn(&mut S, ..) -> R` parameter. A fn pointer can't hold a JavaScript function, so each
 * signature gets a table of monomorphized trampolines (`t3::<0>`, `t3::<1>`, ...) and a registry
 * of the JavaScript functions they call; passing a function takes (or reuses) a slot.
 */
function fnPointerParam(ctx: Ctx, name: string, raw: string, label: string, fp: Json): ParamPlan {
  const inputs = fp.sig.inputs.map(([, t]: [string, Json]) => t)
  const args = inputs.map((t: Json, i: number) => cbArg(ctx, t, i))
  const ret = cbRet(ctx, fp.sig.output)
  const rustRet = ret.rust.replace("&'static mut", "&mut")
  const sig = `fn(${args.map((a: CbArg) => a.rust).join(", ")}) -> ${rustRet}`
  let t = trampolines.get(sig)
  if (!t) {
    const id = trampolines.size
    const params = args.map((a: CbArg, i: number) => `c${i}: ${a.rust}`).join(", ")
    const vs = args.map((_: CbArg, i: number) => `v${i}`)
    const stateArg = args.findIndex((a: CbArg) => a.usesState && a.rust.startsWith("&mut"))
    const replace = ret.rust === "()" && stateArg >= 0 ? ` crate::state::replace_from(c${stateArg}, r);` : ""
    let body = `let h = REG${id}.with(|r| r.borrow().get(I).map(crate::js::JsRef::value)); let r = h.and_then(|h| crate::js::call(h, &[${vs.join(", ")}]));${replace} ${ret.from("r")}`
    for (let i = args.length - 1; i >= 0; i--) body = args[i]!.wrap(`c${i}`, `v${i}`, body)
    const slots = Array.from({ length: 64 }, (_, i) => `t${id}::<${i}>`).join(", ")
    const code = `thread_local! { static REG${id}: std::cell::RefCell<Vec<crate::js::JsRef>> = const { std::cell::RefCell::new(Vec::new()) }; }
fn t${id}<const I: usize>(${params}) -> ${rustRet} { crate::js::scope(|| { ${body} }) }
static T${id}: [${sig}; 64] = [${slots}];
pub fn t${id}_register(f: conv::Value) -> conv::Result<${sig}> {
    Ok(T${id}[REG${id}.with(|r| conv::register_fn(&mut r.borrow_mut(), f, 64))?])
}
`
    t = { id, code }
    trampolines.set(sig, t)
  }
  const tsArgs = args.map((a: CbArg, i: number) => `${a.tsName}${i}: ${a.ts}`).join(", ")
  return {
    name,
    ts: `(${tsArgs}) => ${ret.ts === "void" ? "void" : ret.ts}`,
    stmts: [`let ${name} = crate::gen::tramp::t${t.id}_register(${raw}).map_err(|e| conv::err(format!("{}: {}", ${label}, e.reason)))?;`],
    pass: name,
  }
}

function closureParam(ctx: Ctx, name: string, raw: string, label: string, fn: Json, wrap: (closure: string) => string): ParamPlan {
  const p = fn.args?.parenthesized
  if (!p) return fail("Fn without arguments")
  const args = p.inputs.map((t: Json, i: number) => cbArg(ctx, t, i))
  const ret = cbRet(ctx, p.output)
  const params = args.map((a: CbArg, i: number) => `c${i}: ${a.rust}`).join(", ")
  const vs = args.map((_: CbArg, i: number) => `v${i}`)
  // A handler of a primitive state (a number) can't change it in place: returning a value
  // replaces the state, where the Rust closure returns nothing.
  const stateArg = args.findIndex((a: CbArg) => a.usesState && a.rust.startsWith("&mut"))
  const replace = ret.rust === "()" && stateArg >= 0 ? ` crate::state::replace_from(c${stateArg}, r);` : ""
  let body = `let r = ${name}_h.call(&[${vs.join(", ")}]);${replace} ${ret.from("r")}`
  for (let i = args.length - 1; i >= 0; i--) body = args[i]!.wrap(`c${i}`, `v${i}`, body)
  let closure = `move |${params}| -> ${ret.rust} { crate::js::scope(|| { ${body} }) }`
  if (ret.rust.startsWith("&'static mut")) closure = `conv::hr_mut(${closure})`
  const names = args.map((a: CbArg, i: number) => (args.filter((b: CbArg) => b.tsName === a.tsName).length > 1 ? `${a.tsName}${i}` : a.tsName))
  const tsArgs = args.map((a: CbArg, i: number) => `${names[i]}: ${a.ts}`).join(", ")
  return {
    name,
    ts: `(${tsArgs}) => ${ret.ts === "void" ? (replace ? "S | void" : "void") : ret.ts}`,
    stmts: [`let ${name}_h = conv::arg::<conv::JsFn>(${raw}, ${label})?.0;`, `let ${name} = ${wrap(closure)};`],
    pass: name,
  }
}

// ── results ────────────────────────────────────────────────────────────────

export function planResult(ctx: Ctx, ty: Json | null): ResultPlan {
  const m = ctx.model
  if (!ty || (ty.tuple && ty.tuple.length === 0)) return { ts: "void", toJs: (e) => `{ ${e}; conv::Result::Ok(conv::undefined()) }` }
  if (ty.borrowed_ref) {
    const inner = ty.borrowed_ref.type
    if (inner.primitive === "str") return { ts: "string", toJs: (e) => `conv::ToJs::to_js(${e}.to_owned())` }
    if (inner.slice) {
      const v = m.value(ctx, inner.slice)
      if (!v || (v.isClass && !v.bound?.traits.has("Clone"))) return fail("returns a slice")
      return { ts: v.rust === "u8" ? "Uint8Array" : `${wrapTs(v.ts)}[]`, toJs: (e) => `conv::ToJs::to_js(${e}.to_vec())` }
    }
    if (inner.resolved_path && m.resolve(ctx.crate, inner.resolved_path).std === "Path") return { ts: "string", toJs: (e) => `conv::ToJs::to_js(${e})` }
    const v = m.value(ctx, inner)
    if (!v) return fail(`returns a reference to ${describe(inner)}`)
    if (v.isClass && !v.bound?.traits.has("Clone")) return fail(`returns a reference to non-Clone ${v.rust}`)
    return { ts: v.ts, toJs: (e) => `conv::ToJs::to_js(${e}.clone())` }
  }
  if (ty.impl_trait) {
    const it = traitBound(ty.impl_trait, "Iterator", "IntoIterator")
    const item = it?.args?.angle_bracketed?.constraints?.find((c: Json) => c.name === "Item")?.binding?.equality?.type
    if (!item) return fail("returns impl Trait")
    if (isStrRef(item)) return { ts: "string[]", toJs: (e) => `conv::ToJs::to_js(${e}.map(str::to_owned).collect::<Vec<_>>())` }
    if (!item.borrowed_ref && JSON.stringify(item).includes('"borrowed_ref"')) return fail("returns an iterator of items that borrow")
    const v = m.value(ctx, item.borrowed_ref ? item.borrowed_ref.type : item)
    if (!v) return fail("returns an iterator of unsupported items")
    return { ts: `${v.ts}[]`, toJs: (e) => item.borrowed_ref ? `conv::ToJs::to_js(${e}.cloned().collect::<Vec<_>>())` : `conv::ToJs::to_js(${e}.collect::<Vec<_>>())` }
  }
  if (ty.resolved_path) {
    const r = m.resolve(ctx.crate, ty.resolved_path)
    const a = m.args(ty.resolved_path)
    if (r.std === "Result") {
      const ok = planResult(ctx, a[0] ?? null)
      // The error's message as Rust code would print it: Display where it has one.
      const err = a[1]
      const errStd = err?.resolved_path ? m.resolve(ctx.crate, err.resolved_path) : undefined
      const display = err?.primitive === "str" || (err?.borrowed_ref?.type?.primitive === "str") || errStd?.std === "String" || errStd?.bound?.traits.has("Display")
      const fmt = display ? "{e}" : "{e:?}"
      return { ts: ok.ts, toJs: (e) => `match ${e} { Ok(v) => ${ok.toJs("v")}, Err(e) => Err(conv::err(format!("${fmt}"))) }` }
    }
    if (r.std === "Option" && a[0]?.borrowed_ref) {
      const inner = a[0].borrowed_ref.type
      if (inner.primitive === "str") return { ts: "string | null", toJs: (e) => `conv::ToJs::to_js(${e}.map(str::to_owned))` }
      const v = m.value(ctx, inner)
      if (!v || (v.isClass && !v.bound?.traits.has("Clone"))) return fail("returns Option of a reference")
      return { ts: `${v.ts} | null`, toJs: (e) => `conv::ToJs::to_js(${e}.cloned())` }
    }
  }
  const v = m.value(ctx, ty)
  if (!v) return fail(`return type ${describe(ty)}`)
  if (v.lendOnly) return fail(`returns ${v.rust}, which borrows`)
  return { ts: v.ts, toJs: (e) => `conv::ToJs::to_js(${e})` }
}

/** TS type params a signature needs (`S` when a closure receives the state). */
export function tsGenerics(...ts: string[]): string {
  return ts.some((t) => /\bS\b/.test(t)) ? "<S = any>" : ""
}

export { tsRef }
