// `.svelte` to JavaScript for this renderer. `experimental.customRenderer` makes the compiler emit
// `import $renderer from "@runex-js/svelte/renderer"` into every component; `<style>` blocks,
// which a custom renderer gets back as scoped CSS rather than injected, become a
// `define_styles(scope, rules)` call keyed by the `svelte-<hash>` class the compiler stamps on
// every element a selector matches.
import { readFileSync } from "node:fs"
import { Parser, type Node as AcornNode } from "acorn"
import { compile, compileModule, type AST } from "svelte/compiler"
import { parse_declarations } from "./css.ts"
import type { Pseudo, StyleRule } from "./style-rules.ts"

/**
 * The specifier baked into every component, which must resolve from the `.svelte` file's own
 * location; `RUNEX_SVELTE_RENDERER` overrides it (an absolute path) for components outside a
 * project that depends on this package.
 */
export const RENDERER_MODULE = process.env.RUNEX_SVELTE_RENDERER || "@runex-js/svelte/renderer"

/** The registry's svelte has the same version number as the custom-renderer build this package bundles. */
export const WRONG_SVELTE =
  "[runex-svelte] svelte resolved to a build without the custom-renderer API. @runex-js/svelte bundles the build it needs: remove svelte from your own dependencies and reinstall."

/** The only nodes that carry a module specifier; a string that merely looks like one does not. */
const SPECIFIER_NODES = new Set(["ImportDeclaration", "ImportExpression", "ExportAllDeclaration", "ExportNamedDeclaration"])

type SpecifierNode = AcornNode & { source?: (AcornNode & { type: string; value: unknown }) | null }

/** The same JS, with every relative child `.svelte` specifier carrying render_hot's `?v=N`. */
function bust_child_specifiers(code: string, query: string): string {
  const closing_quotes: number[] = []
  function scan(node: AcornNode) {
    const source = SPECIFIER_NODES.has(node.type) ? (node as SpecifierNode).source : undefined
    if (source?.type === "Literal") {
      const value = String(source.value)
      // A bare specifier can't carry a query (Node refuses `pkg/x.svelte?v=1`), and a package's
      // component isn't what is being edited anyway.
      if (value.endsWith(".svelte") && /^(\.|\/|file:)/.test(value)) closing_quotes.push(source.end - 1)
    }
    for (const key in node) {
      const child = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(child)) {
        for (const item of child) if ((item as AcornNode | null)?.type) scan(item as AcornNode)
      } else if ((child as AcornNode | null)?.type) scan(child as AcornNode)
    }
  }
  scan(Parser.parse(code, { ecmaVersion: "latest", sourceType: "module" }))
  let out = code
  for (const at of closing_quotes.sort((a, b) => b - a)) out = out.slice(0, at) + query + out.slice(at)
  return out
}

const PSEUDOS = new Map<string, Pseudo>([
  ["hover", "hover"],
  ["active", "active"],
])

/** One compound selector: classes, at most one tag, and `:hover` or `:active`. */
function compile_selector(complex: AST.CSS.ComplexSelector): Omit<StyleRule, "decls"> | null {
  if (complex.children.length !== 1 || complex.children[0]!.combinator) return null
  const classes: string[] = []
  let tag: string | null = null
  let pseudo: Pseudo = null
  for (const s of complex.children[0]!.selectors) {
    if (s.type === "ClassSelector") classes.push(s.name)
    else if (s.type === "TypeSelector" && tag === null) tag = s.name
    else if (s.type === "PseudoClassSelector" && s.args === null && pseudo === null && PSEUDOS.has(s.name)) pseudo = PSEUDOS.get(s.name) ?? null
    else return null
  }
  return classes.length === 0 && tag === null ? null : { classes, tag, pseudo }
}

/** Weakest first (tags under classes, then source order), so later ones win when merged. */
export function extract_rules(css: AST.CSS.StyleSheet, source: string, path: string): StyleRule[] {
  const rules: StyleRule[] = []
  const refuse = (text: string) =>
    console.warn(`[runex-svelte] ${path}: \`${text}\` has no Rune equivalent: only class and tag selectors, with :hover/:active, reach Rune`)
  for (const node of css.children) {
    if (node.type !== "Rule") {
      refuse(`@${node.name} ${node.prelude}`.trim())
      continue
    }
    const text: string[] = []
    for (const child of node.block.children) {
      if (child.type === "Declaration") text.push(`${child.property}: ${child.value}`)
      else refuse(source.slice(child.start, child.end).split("{")[0]!.trim() + " { … } (nested)")
    }
    const decls = parse_declarations(text.join("; "))
    for (const complex of node.prelude.children) {
      const selector = compile_selector(complex)
      if (selector === null) refuse(source.slice(complex.start, complex.end))
      else rules.push({ ...selector, decls })
    }
  }
  return rules.sort((a, b) => weight(a) - weight(b))
}

const weight = (rule: StyleRule) => rule.classes.length * 2 + (rule.tag === null ? 0 : 1)

/** Compiles the `.svelte` file at `path` to client JS; `query` is render_hot's `?v=N`, if any. */
export function compile_svelte(path: string, query?: string): string {
  const source = readFileSync(path, "utf8")
  let scope = null as string | null
  const { js, warnings, ast } = compile(source, {
    filename: path,
    generate: "client",
    runes: true,
    modernAst: true,
    // The class the compiler stamps on every element a selector matches: the sheet's key at runtime.
    cssHash: (args) => (scope = `svelte-${args.hash(args.css)}`),
    // async: a `pending`/`failed` snippet in a <svelte:boundary> crashes the compiler without it.
    experimental: { customRenderer: RENDERER_MODULE, async: true },
  })
  for (const warning of warnings) {
    if (warning.code.startsWith("a11y_")) continue // DOM accessibility advice; Rune's roles are attributes
    console.warn(`[runex-svelte] ${path}: ${warning.message}`)
  }
  let code = js.code
  if (scope !== null && ast.css) {
    const rules = extract_rules(ast.css as AST.CSS.StyleSheet, source, path)
    if (rules.length > 0) {
      code += `\nimport { define_styles as $define_styles } from ${JSON.stringify(RENDERER_MODULE)};\n`
      code += `$define_styles(${JSON.stringify(scope)}, ${JSON.stringify(rules)});\n`
    }
  }
  return query ? bust_child_specifiers(code, query) : code
}

/**
 * A `.svelte.ts`/`.svelte.js` module: runes, no template, so no renderer and no cache-buster. It
 * loads once per process, which is what lets its state outlive a hot remount. `source` is passed
 * in when a loader already stripped the types, since `compileModule` does not.
 */
export function compile_module(path: string, source: string = readFileSync(path, "utf8")): string {
  const { js, warnings } = compileModule(source, { filename: path, generate: "client" })
  for (const warning of warnings) console.warn(`[runex-svelte] ${path}: ${warning.message}`)
  return js.code
}
