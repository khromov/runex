// Element-tree helpers shared by scripts/compare.ts and scripts/golden.ts: a field-by-field diff
// of two `--tree` dumps with readable paths, and the normalized JSONL form golden baselines use.
//
//   const r = compareTrees("rust.json", "port.json", [], 8)
//   for (const d of r.diffs) console.log(`${d.path}: ${d.rust} -> ${d.ts}`)
//   // elements[3]<#0/switch>.rect[0]: 141 -> 140
//
// Normalized JSONL (normalizeTree): line 1 holds the top-level fields except `elements` and
// `accessibility`; then one line per element in document order; then one line per accessibility
// node, depth first, each starting with its position ({"a11y":"0/1/0",...}). Keys are sorted, so
// the text depends only on the values. Masks drop fields of chosen elements (and the matching
// accessibility nodes) before the text is made.

import { readFileSync } from "node:fs"

export type TreeDiff = { path: string; rust: unknown; ts: unknown }
export type TreeResult = { identical: boolean; count: number; diffs: TreeDiff[] }

function ignored(path: string, ignore: (string | RegExp)[]): boolean {
  return ignore.some((p) => (typeof p === "string" ? path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`) : p.test(path)))
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function label(v: unknown): string | undefined {
  if (!isObject(v)) return undefined
  if (typeof v.path === "string") return v.path
  if (typeof v.key === "string") return v.key
  if (typeof v.a11y === "string") return `a11y ${v.a11y}`
  return undefined
}

/**
 * Walks both trees side by side. `plain` is the path ignore rules match (`elements[3].rect[0]`);
 * `shown` adds each element's path or key (`elements[3]<#0/switch>.rect[0]`) for the report.
 */
export function diffTree(a: unknown, b: unknown, plain: string, shown: string, ignore: (string | RegExp)[], out: TreeResult, max: number): void {
  if (ignored(plain, ignore)) return
  const add = (rust: unknown, ts: unknown) => {
    out.count++
    if (out.diffs.length < max) out.diffs.push({ path: shown || "(root)", rust, ts })
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) add(`${a.length} items`, `${b.length} items`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const tag = label(a[i]) ?? label(b[i])
      diffTree(a[i], b[i], `${plain}[${i}]`, `${shown}[${i}]${tag ? `<${tag}>` : ""}`, ignore, out, max)
    }
    return
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const k of keys) {
      const p = plain ? `${plain}.${k}` : k
      const s = shown ? `${shown}.${k}` : k
      if (!(k in a)) { if (!ignored(p, ignore)) { out.count++; if (out.diffs.length < max) out.diffs.push({ path: s, rust: undefined, ts: b[k] }) } }
      else if (!(k in b)) { if (!ignored(p, ignore)) { out.count++; if (out.diffs.length < max) out.diffs.push({ path: s, rust: a[k], ts: undefined }) } }
      else diffTree(a[k], b[k], p, s, ignore, out, max)
    }
    return
  }
  if (a !== b) add(a, b)
}

export function compareTreeValues(a: unknown, b: unknown, ignore: (string | RegExp)[], max: number): TreeResult {
  const out: TreeResult = { identical: true, count: 0, diffs: [] }
  diffTree(a, b, "", "", ignore, out, max)
  out.identical = out.count === 0
  return out
}

export function compareTrees(rustFile: string, tsFile: string, ignore: (string | RegExp)[], max: number): TreeResult {
  return compareTreeValues(JSON.parse(readFileSync(rustFile, "utf8")), JSON.parse(readFileSync(tsFile, "utf8")), ignore, max)
}

// -------------------------------------------------------------------------------------------
// Normalized JSONL

/** Element fields to drop from the elements whose `path` matches, and the matching a11y nodes. */
export type TreeMask = { path: string | RegExp; fields: string[] }

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  return v
}

const matches = (p: string | RegExp, path: string) => (typeof p === "string" ? p === path : p.test(path))

/** The elements a mask set hides: their index and rect (points). */
export function maskedElements(tree: any, masks: TreeMask[]): { index: number; rect?: [number, number, number, number]; fields: string[] }[] {
  if (!masks.length || !Array.isArray(tree?.elements)) return []
  const out: { index: number; rect?: [number, number, number, number]; fields: string[] }[] = []
  tree.elements.forEach((e: any, index: number) => {
    const hit = masks.filter((m) => typeof e?.path === "string" && matches(m.path, e.path))
    if (hit.length) out.push({ index, rect: Array.isArray(e.rect) ? e.rect : undefined, fields: [...new Set(hit.flatMap((m) => m.fields))] })
  })
  return out
}

/** Accessibility bounds are the element's rect rounded to 0.1 pt. */
const near = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => typeof v === "number" && Math.abs(v - (b[i] as number)) <= 0.11)

/** A `--tree` dump as normalized JSONL (see the header). */
export function normalizeTree(tree: any, masks: TreeMask[] = []): string {
  const hidden = maskedElements(tree, masks)
  const elements: any[] = Array.isArray(tree.elements) ? tree.elements.map((e: any) => ({ ...e })) : []
  // Accessibility nodes that show a masked element: its bounds (to 0.1 pt) and its text as name.
  const a11yHidden: { rect: number[]; name: unknown }[] = []
  for (const h of hidden) {
    const e = elements[h.index]
    if (h.rect) a11yHidden.push({ rect: h.rect, name: e.text ?? e.label })
    for (const f of h.fields) delete e[f]
  }
  const top: Record<string, unknown> = { ...tree }
  delete top.elements
  delete top.accessibility
  const lines = [JSON.stringify(sortKeys(top))]
  for (const e of elements) lines.push(JSON.stringify(sortKeys(e)))
  const walk = (node: any, at: string) => {
    if (!isObject(node)) return
    const { children, ...rest } = node as Record<string, unknown>
    const hide = a11yHidden.find((h) => near(rest.bounds, h.rect) && rest.name === h.name)
    if (hide) { delete rest.name; delete rest.bounds; delete rest.value }
    lines.push(JSON.stringify({ a11y: at, ...(sortKeys(rest) as object) }))
    if (Array.isArray(children)) children.forEach((c, i) => walk(c, `${at}/${i}`))
  }
  if (tree.accessibility) walk(tree.accessibility, "0")
  return `${lines.join("\n")}\n`
}

/** Normalized JSONL back into `{ ...top, elements: [...], a11y: [...] }`, for path diffs. */
export function parseNormalized(text: string): Record<string, unknown> {
  const lines = text.split("\n").filter(Boolean)
  const out: Record<string, unknown> = lines.length ? JSON.parse(lines[0]!) : {}
  const elements: unknown[] = [], a11y: unknown[] = []
  for (const l of lines.slice(1)) {
    const v = JSON.parse(l)
    if (isObject(v) && typeof v.a11y === "string") a11y.push(v)
    else elements.push(v)
  }
  return { ...out, elements, a11y }
}

/** The field a diff path is about: `elements[3]<x>.rect[0]` -> `rect`, `a11y[2]<..>.bounds[1]` -> `a11y.bounds`. */
export function diffField(path: string): string {
  const m = /^(elements|a11y)\[\d+\](?:<[^>]*>)?(?:\.([^.[]+))?/.exec(path)
  if (m) return m[1] === "a11y" ? `a11y.${m[2] ?? "(node)"}` : m[2] ?? "(element)"
  return path.replace(/\[.*$/, "").split(".")[0]!
}

export type FieldSummary = { field: string; kind: "added" | "removed" | "changed"; count: number }

/** Diffs grouped by field and kind: "rect changed 41 times", "new field x in 12 elements". */
export function summarizeDiffs(diffs: TreeDiff[]): FieldSummary[] {
  const by = new Map<string, FieldSummary>()
  for (const d of diffs) {
    const kind = d.rust === undefined ? "added" : d.ts === undefined ? "removed" : "changed"
    const field = diffField(d.path)
    const k = `${field}\0${kind}`
    const s = by.get(k) ?? { field, kind, count: 0 }
    s.count++
    by.set(k, s)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.field.localeCompare(b.field))
}
