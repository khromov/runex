// Compares two API surfaces (tools/bindgen/surface.txt, written by main.ts) and sorts the
// differences into what breaks code written against OLD and what only adds.
//
//   bun tools/bindgen/surface-diff.ts OLD NEW [--fail-breaking] [--json FILE]
//
// OLD and NEW are surface.txt files, or directories holding tools/bindgen/surface.txt (a
// `bindgen --out` tree, or a repo checkout). Removed: a key (`method El.radius`) only in OLD.
// Changed: a key in both whose lines differ (a signature, a type, a platform gate). Added: a key
// only in NEW. A rename shows as Removed plus Added. Exit 1 on Removed or Changed with
// --fail-breaking, else 0; 2 when a file can't be read. --json writes the result for scripts.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { surfaceKey } from "./surface.ts"

export interface SurfaceDiff {
  removed: string[]
  /** Old and new lines of a key whose lines differ. */
  changed: { key: string; old: string[]; new: string[] }[]
  added: string[]
  /** Lines per kind (`class`, `method`, ..), old and new. */
  counts: Record<string, [number, number]>
}

/** The difference between two surface.txt contents. */
export function diffSurface(oldText: string, newText: string): SurfaceDiff {
  const [a, b] = [byKey(oldText), byKey(newText)]
  const out: SurfaceDiff = { removed: [], changed: [], added: [], counts: {} }
  for (const [key, lines] of a) {
    const now = b.get(key)
    if (!now) out.removed.push(...lines)
    else if (lines.join("\n") !== now.join("\n")) out.changed.push({ key, old: lines, new: now })
  }
  for (const [key, lines] of b) if (!a.has(key)) out.added.push(...lines)
  for (const [i, text] of [oldText, newText].entries()) {
    for (const line of lines(text)) {
      const kind = line.split(" ", 1)[0]!
      out.counts[kind] ??= [0, 0]
      out.counts[kind][i]++
    }
  }
  return out
}

/** A readable report: counts, then Removed, Changed and Added, each item on its own line. */
export function formatSurfaceDiff(d: SurfaceDiff, max = Infinity): string {
  const counts = Object.entries(d.counts)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([k, [o, n]]) => (o === n ? `${k} ${o}` : `${k} ${o} -> ${n}`))
    .join(", ")
  const out = [`surface: ${counts}`]
  const list = (title: string, items: string[], count = items.length) => {
    out.push(`${title} (${count})`)
    for (const l of items.slice(0, max)) out.push(`  ${l}`)
    if (items.length > max) out.push(`  ... ${items.length - max} more`)
  }
  list("Removed, breaking", d.removed)
  list("Changed, breaking", d.changed.flatMap((c) => [...c.old.map((l) => `- ${l}`), ...c.new.map((l) => `+ ${l}`)]), d.changed.length)
  list("Added", d.added)
  return out.join("\n")
}

export function breaking(d: SurfaceDiff): boolean {
  return d.removed.length > 0 || d.changed.length > 0
}

function lines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim())
}

function byKey(text: string): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const l of lines(text)) {
    const k = surfaceKey(l)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(l)
  }
  return m
}

function read(path: string): string {
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "tools", "bindgen", "surface.txt") : path
  try {
    return readFileSync(file, "utf8")
  } catch (e) {
    console.error(`surface-diff: can't read ${file}: ${(e as Error).message}`)
    process.exit(2)
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const jsonAt = args.indexOf("--json")
  const json = jsonAt >= 0 ? args[jsonAt + 1] : undefined
  const files = args.filter((a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1))
  if (files.length !== 2 || (jsonAt >= 0 && !json)) {
    console.error("usage: bun tools/bindgen/surface-diff.ts OLD NEW [--fail-breaking] [--json FILE]")
    process.exit(2)
  }
  const d = diffSurface(read(files[0]!), read(files[1]!))
  console.log(formatSurfaceDiff(d))
  if (json) writeFileSync(json, JSON.stringify(d, null, 2) + "\n")
  process.exit(args.includes("--fail-breaking") && breaking(d) ? 1 : 0)
}
