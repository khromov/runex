// What there is to render: the Rust examples, their TypeScript ports, and each app's windows
// and scenes from Rune's own listings (`--list-windows`, then `--list-scenes` per window).
//
//   const { windows, scenes } = await listApp(tsCommand(portPath("kit-gallery"), "bun"), ROOT)
//
// Rune prints its own log lines ("rune: ...") on stderr, so stdout is the listing and nothing
// else: every non-empty line is a window or scene. kit-gallery has 28 scenes named `rune-*`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { type Exec, exec, failure, ROOT, RUNE } from "./proc.ts"

/** The label (and config key) of the render without `--scene`. */
export const NO_SCENE = "(none)"

/** The non-empty, trimmed stdout lines of a listing. */
export function listingLines(stdout: string): string[] {
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean)
}

/** Every Rust example: the directories in vendor/rune/examples with a Cargo.toml. */
export function rustExamples(): string[] {
  const dir = join(RUNE, "examples")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, "Cargo.toml"))).sort()
}

export function portPath(name: string): string {
  return join(ROOT, "examples", name, "main.ts")
}

/** Every ported example: examples/<name>/main.ts with a Rust counterpart. */
export function portedExamples(): string[] {
  const rust = new Set(rustExamples())
  const dir = join(ROOT, "examples")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => rust.has(n) && existsSync(portPath(n))).sort()
}

/** A file name for a scene or window: `_none` for the render without `--scene`. */
export function fileStem(scene: string): string {
  return scene === NO_SCENE ? "_none" : scene.replace(/[^\w.@+-]+/g, "_")
}

export type Listing = { windows: string[]; scenes: Record<string, string[]> }

/**
 * Lists an app's windows and each window's scenes by running `cmd` with Rune's listing flags
 * (and `--window KEY` when there are several). `args` go to every listing. Returns the listing,
 * or the first failure.
 */
export async function listApp(cmd: string[], cwd: string, args: string[] = [], env?: Record<string, string>, timeoutS = 60):
  Promise<{ listing?: Listing; error?: string }> {
  const run = (extra: string[]): Promise<Exec> => exec([...cmd, ...extra, ...args], cwd, env, timeoutS)
  const w = await run(["--list-windows"])
  if (w.code !== 0 || w.timedOut) return { error: `--list-windows failed: ${failure(w, timeoutS)}` }
  const windows = listingLines(w.stdout)
  if (!windows.length) return { error: "--list-windows printed nothing" }
  const multi = windows.length > 1
  const scenes: Record<string, string[]> = {}
  const results = await Promise.all(windows.map((win) => run([...(multi ? ["--window", win] : []), "--list-scenes"])))
  for (const [i, win] of windows.entries()) {
    const r = results[i]!
    if (r.code !== 0 || r.timedOut) return { error: `${multi ? `${win} ` : ""}--list-scenes failed: ${failure(r, timeoutS)}` }
    scenes[win] = listingLines(r.stdout)
  }
  return { listing: { windows, scenes } }
}

/** A listing as text, one window per line and its scenes indented under it. */
export function formatListing(l: Listing): string {
  return l.windows.map((w) => [w, ...(l.scenes[w] ?? []).map((s) => `  ${s}`)].join("\n")).join("\n") + "\n"
}

export function parseListing(text: string): Listing {
  const out: Listing = { windows: [], scenes: {} }
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue
    if (line.startsWith("  ")) {
      const w = out.windows.at(-1)
      if (w) out.scenes[w]!.push(line.trim())
    } else {
      out.windows.push(line.trim())
      out.scenes[line.trim()] = []
    }
  }
  return out
}

/** What changed between two listings, as readable lines ("main: new scenes: a, b"). */
export function listingChanges(before: Listing, after: Listing): string[] {
  const out: string[] = []
  const added = after.windows.filter((w) => !before.windows.includes(w))
  const removed = before.windows.filter((w) => !after.windows.includes(w))
  if (added.length) out.push(`new windows: ${added.join(", ")}`)
  if (removed.length) out.push(`removed windows: ${removed.join(", ")}`)
  if (!added.length && !removed.length && before.windows.join("\n") !== after.windows.join("\n")) {
    out.push(`window order changed: ${before.windows.join(", ")} -> ${after.windows.join(", ")}`)
  }
  for (const w of after.windows.filter((w) => before.windows.includes(w))) {
    const a = before.scenes[w] ?? [], b = after.scenes[w] ?? []
    const prefix = after.windows.length > 1 ? `${w}: ` : ""
    const newS = b.filter((s) => !a.includes(s)), gone = a.filter((s) => !b.includes(s))
    if (newS.length) out.push(`${prefix}new scenes: ${newS.join(", ")}`)
    if (gone.length) out.push(`${prefix}removed scenes: ${gone.join(", ")}`)
    if (!newS.length && !gone.length && a.join("\n") !== b.join("\n")) out.push(`${prefix}scene order changed`)
  }
  return out
}

// -------------------------------------------------------------------------------------------
// Scenes from source (compare's fallback when the Rust `--list-scenes` fails)

function rsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? rsFiles(p) : n.endsWith(".rs") ? [p] : []
  })
}

/** The text between the `[` at `open` and its matching `]`, skipping strings and comments. */
function bracketBody(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === "\\") i++
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
    } else if (c === "'" && src[i + 2] === "'") {
      i += 2
    } else if (c === "[") depth++
    else if (c === "]" && --depth === 0) return src.slice(open + 1, i)
  }
  return src.slice(open + 1)
}

/** The scene names in an example's Rust source: `scenes: &[("name", ..), ..]` or `scenes: CONST`. */
export function scenesFromSource(name: string): string[] {
  const src = rsFiles(join(RUNE, "examples", name, "src")).map((f) => readFileSync(f, "utf8")).join("\n")
  const names: string[] = []
  for (const m of src.matchAll(/\bscenes\s*:\s*(?:(&\s*\[)|([A-Za-z_][\w:]*))/g)) {
    let body: string | undefined
    if (m[1]) body = bracketBody(src, m.index! + m[0].length - 1)
    else {
      const ident = m[2]!.split("::").pop()!
      const def = new RegExp(`\\b(?:const|static)\\s+${ident}\\s*:[^=]*=\\s*&?\\s*\\[`).exec(src)
      if (def) body = bracketBody(src, def.index + def[0].length - 1)
    }
    for (const s of body?.matchAll(/\(\s*"((?:[^"\\]|\\.)*)"\s*,/g) ?? []) if (!names.includes(s[1]!)) names.push(s[1]!)
  }
  return names
}
