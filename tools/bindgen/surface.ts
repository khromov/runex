// The generated API as text: one sorted line per item that ts/gen declares or exports, with no
// docs and no rustdoc ids. main.ts writes it to tools/bindgen/surface.txt with the bindings, so a
// Rune bump's API change reads as a short diff; surface-diff.ts classifies two of them.
//
//   class El                                  a native class (napi), by its unique native name
//   method El.radius(r: number): this         an instance method; also `prop` and `get` (read-only)
//   static El.new(): El                       a static function; `ctor El(init: {..})` a constructor
//   const motion_Decay.IOS_FAST: motion_Decay an associated constant
//   record motion_Spring                      a plain-object struct, with `field motion_Spring.duration: number`
//   enum motion_When                          a Rust enum, with `variant motion_When.Started` and
//                                             `variant motion_Velocity.Uniform: number` (data)
//   fn knobs_layer<S = any>(k: knobs_Knobs, ..): El
//   const tok__motion__SNAPPY: motion_Spring  a constant
//   export rune/tok/motion/SNAPPY = tok__motion__SNAPPY   a public path and the item it names
//
// An item that exists on some platforms only ends in ` [cfg(..)]`. A line's key is its first
// two words (`method El.radius`); several lines can share one (overloads).
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"

/** The key of a surface line: its kind and name (`method El.radius`). */
export function surfaceKey(line: string): string {
  const m = /^(\S+) ([A-Za-z0-9_$./]+)/.exec(line)
  return m ? `${m[1]} ${m[2]}` : line
}

/** The surface of the bindings under `tsGen` (a ts/gen directory), as sorted lines. */
export function surfaceLines(tsGen: string): string[] {
  const out = new Set<string>()
  const gates = declarations(join(tsGen, "types.ts"), out)
  exportsOf(tsGen, gates, out)
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** surface.txt's content. */
export function surfaceText(tsGen: string): string {
  return surfaceLines(tsGen).join("\n") + "\n"
}

// ── types.ts ─────────────────────────────────────────────────────────────────

/** Adds the declarations' lines to `out`; returns the gates of the top-level ones by name. */
function declarations(file: string, out: Set<string>): Map<string, string> {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const text = (n: ts.Node) => flat(n.getText(sf))
  /** The `#[cfg]` the docs before `n` say it exists under (emit.ts `gatedDocs`). */
  const gateOf = (n: ts.Node) => /Only where `cfg\((.+?)\)` holds/.exec(sf.text.slice(n.getFullStart(), n.getStart(sf)))?.[1]
  const gates = new Map<string, string>()
  const add = (kind: string, name: string, sig: string, gate?: string) => {
    out.add(`${kind} ${name}${sig}${gate ? ` [cfg(${gate})]` : ""}`)
    if (gate && !name.includes(".")) gates.set(name, gate)
  }
  const nameOf = (n: ts.PropertyName) => (ts.isStringLiteral(n) || ts.isIdentifier(n) ? n.text : text(n))
  const signature = (n: ts.SignatureDeclarationBase) =>
    `${n.typeParameters ? `<${n.typeParameters.map(text).join(", ")}>` : ""}(${n.parameters.map(text).join(", ")})${n.type ? `: ${text(n.type)}` : ""}`

  // A class's gate is in the docs of its first interface; its members and statics share it.
  const classGate = new Map<string, string | undefined>()
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) && !st.name.text.endsWith("$Static") && !classGate.has(st.name.text)) classGate.set(st.name.text, gateOf(st))
  }

  for (const st of sf.statements) {
    if (!exported(st)) continue
    if (ts.isInterfaceDeclaration(st)) {
      const statics = st.name.text.endsWith("$Static")
      const owner = statics ? st.name.text.slice(0, -"$Static".length) : st.name.text
      // A trait's methods come in their own block, under the trait impl's gate.
      const blockGate = (statics ? undefined : gateOf(st)) ?? classGate.get(owner)
      for (const m of st.members) {
        const gate = gateOf(m) ?? blockGate
        if (ts.isConstructSignatureDeclaration(m)) add("ctor", owner, signature(m), gate)
        else if (ts.isMethodSignature(m)) add(statics ? "static" : "method", `${owner}.${nameOf(m.name)}`, signature(m), gate)
        else if (ts.isPropertySignature(m)) {
          const name = nameOf(m.name)
          const readonly = m.modifiers?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword)
          if (statics && name === "prototype") continue
          add(statics ? "const" : readonly ? "get" : "prop", `${owner}.${name}`, `: ${m.type ? text(m.type) : "any"}`, gate)
        }
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      // A record: a TypeScript class whose fields are the struct's.
      const owner = st.name.text
      add("record", owner, "", gateOf(st))
      for (const m of st.members) {
        const isStatic = (ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
        if (ts.isConstructorDeclaration(m)) add("ctor", owner, signature(m), gateOf(m))
        else if (ts.isPropertyDeclaration(m)) add(isStatic ? "const" : "field", `${owner}.${nameOf(m.name)}`, `: ${m.type ? text(m.type) : "any"}`, gateOf(m))
        else if (ts.isMethodDeclaration(m)) add(isStatic ? "static" : "method", `${owner}.${nameOf(m.name)}`, signature(m), gateOf(m))
        else if (ts.isGetAccessorDeclaration(m)) add("get", `${owner}.${nameOf(m.name)}`, `: ${m.type ? text(m.type) : "any"}`, gateOf(m))
      }
    } else if (ts.isTypeAliasDeclaration(st)) {
      const name = st.name.text
      const variants = variantsOf(st.type)
      if (variants) {
        add("enum", name, "", gateOf(st))
        for (const v of variants) add("variant", `${name}.${v.name}`, v.payload ? `: ${text(v.payload)}` : "", gateOf(st))
      } else add("type", name, ` = ${text(st.type)}`, gateOf(st))
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue
        const name = d.name.text
        const gate = gateOf(st) ?? classGate.get(name)
        if (d.type && ts.isTypeReferenceNode(d.type) && text(d.type.typeName) === `${name}$Static`) add("class", name, "", gate)
        else if (d.initializer && ts.isAsExpression(d.initializer) && ts.isTypeLiteralNode(d.initializer.type)) {
          // An enum's functions: `export const X = { .. } as { f: (..) => R }`.
          for (const m of d.initializer.type.members) {
            if (!ts.isPropertySignature(m) || !m.type) continue
            const fn = m.type
            add("static", `${name}.${nameOf(m.name)}`, ts.isFunctionTypeNode(fn) ? signature(fn) : `: ${text(fn)}`, gateOf(m) ?? gate)
          }
        } else if (d.type && ts.isFunctionTypeNode(d.type)) add("fn", name, signature(d.type), gate)
        else add("const", name, `: ${d.type ? text(d.type) : "any"}`, gate)
      }
    }
  }
  return gates
}

export interface NativeRef {
  /** The addon export (`El`, `__R_motion_Anim_new`, `__C_tok__motion__SNAPPY`). */
  name: string
  /** The `#[cfg]` it exists under, if any. */
  gate?: string
  /** Read behind `if ($n.X)`: absent where its gate doesn't hold, without the gate written here. */
  guarded: boolean
}

/** Every `$n.X` that types.ts reads, with the gate of the declaration that reads it. */
export function nativeRefs(file: string): NativeRef[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const gateOf = (n: ts.Node) => /Only where `cfg\((.+?)\)` holds/.exec(sf.text.slice(n.getFullStart(), n.getStart(sf)))?.[1]
  const classGate = new Map<string, string | undefined>()
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) && !st.name.text.endsWith("$Static") && !classGate.has(st.name.text)) classGate.set(st.name.text, gateOf(st))
  }
  const out = new Map<string, NativeRef>()
  const collect = (node: ts.Node, gate: string | undefined, guarded: boolean) => {
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "$n") {
        const name = n.name.text
        const prev = out.get(name)
        // Read in several places: required if any read is unguarded and ungated.
        if (!prev) out.set(name, { name, gate, guarded })
        else out.set(name, { name, gate: prev.gate && gate ? prev.gate : undefined, guarded: prev.guarded && guarded })
      }
      ts.forEachChild(n, visit)
    }
    visit(node)
  }
  for (const st of sf.statements) {
    if (ts.isIfStatement(st)) collect(st, undefined, true)
    else if (ts.isClassDeclaration(st) && st.name) {
      const g = gateOf(st)
      for (const m of st.members) collect(m, gateOf(m) ?? g, false)
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : ""
        const g = gateOf(st) ?? classGate.get(name)
        const init = d.initializer && ts.isAsExpression(d.initializer) ? d.initializer.expression : undefined
        if (init && ts.isObjectLiteralExpression(init)) for (const p of init.properties) collect(p, gateOf(p) ?? g, false)
        else collect(d, g, false)
      }
    } else collect(st, undefined, false)
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
}

function exported(st: ts.Statement): boolean {
  return ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

/** The variants of an enum's type (`"A" | { B: number }`), or undefined when it isn't one. */
function variantsOf(t: ts.TypeNode): { name: string; payload?: ts.TypeNode }[] | undefined {
  const parts = ts.isUnionTypeNode(t) ? [...t.types] : [t]
  const out: { name: string; payload?: ts.TypeNode }[] = []
  for (const p of parts) {
    if (ts.isLiteralTypeNode(p) && ts.isStringLiteral(p.literal)) out.push({ name: p.literal.text })
    else if (ts.isTypeLiteralNode(p) && p.members.length === 1) {
      const m = p.members[0]!
      if (!ts.isPropertySignature(m) || !m.type || !(ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) return undefined
      out.push({ name: m.name.text, payload: m.type })
    } else return undefined
  }
  return out
}

/** One line of source text: comments dropped, whitespace runs as one space. */
function flat(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").replace(/\s*;\s*$/, "").trim()
}

// ── module files ─────────────────────────────────────────────────────────────

/** `export rune/tok/motion/SNAPPY = tok__motion__SNAPPY` for each name a module file exports. */
function exportsOf(tsGen: string, gates: Map<string, string>, out: Set<string>) {
  for (const file of files(tsGen)) {
    const rel = relative(tsGen, file).replace(/\\/g, "/")
    if (rel === "types.ts") continue
    const mod = rel.replace(/\.ts$/, "").replace(/(^|\/)index$/, "")
    for (const m of readFileSync(file, "utf8").matchAll(/^export (type )?\{ ([^}]*) \} from /gm)) {
      for (const spec of m[2]!.split(",").map((s) => s.trim()).filter(Boolean)) {
        const [unique, local = unique] = spec.split(/\s+as\s+/)
        const gate = gates.get(unique!)
        out.add(`export ${mod}/${local} = ${unique}${m[1] ? " (type)" : ""}${gate ? ` [cfg(${gate})]` : ""}`)
      }
    }
  }
}

function files(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : n.endsWith(".ts") ? [p] : []
  })
}
