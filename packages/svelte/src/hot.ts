// render_hot: an in-process reload. It watches the entry's directory and, when a `.svelte` file
// changes, imports the root component again (with a `?v=N` cache-buster that compile.ts carries
// to its children) and remounts it into the same window. One Svelte runtime lives for the whole
// process, so the old tree unmounts properly; `bun --hot` would re-evaluate that runtime, so don't
// combine the two. `.svelte.ts` modules load once, which is what keeps their state across reloads.
import { watch } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { render, type RenderOptions } from "./render.ts"
import type { AnyComponent } from "./types.ts"

const INVALIDATE = Symbol.for("runex-svelte.invalidate")

async function import_fresh(url: URL, version: number): Promise<Record<string, unknown>> {
  ;(globalThis as Record<symbol, (() => void) | undefined>)[INVALIDATE]?.()
  return import(`${url.href}?v=${version}`)
}

/** What a change to `file` calls for: modules load once per process, so a `.ts` edit needs a restart. */
export function on_change(file: string): "remount" | "restart" | null {
  if (/(^|[\\/])node_modules[\\/]/.test(file)) return null
  if (/\.[cm]?[jt]s$/.test(file)) return "restart"
  return file.endsWith(".svelte") ? "remount" : null
}

/**
 * Renders the component `entry` exports by default (a path or a `file:` URL, usually
 * `new URL("./App.svelte", import.meta.url)`) and remounts it on every save of a `.svelte` file
 * under its directory. Headless runs (`--snap`, `--tree`, `--script`) render once and don't watch.
 */
export async function render_hot(entry: string | URL, options: RenderOptions = {}): Promise<void> {
  const url = entry instanceof URL ? entry : pathToFileURL(entry)
  const path = fileURLToPath(url)
  let version = 0
  const load = async () => (await import_fresh(url, ++version)).default as AnyComponent

  const done = render(await load(), options)
  if (headless(options.args ?? process.argv.slice(2))) return done

  let timer: ReturnType<typeof setTimeout> | undefined
  const stale = new Set<string>()
  const watcher = watch(dirname(path), { recursive: true }, (_event, file) => {
    if (!file) return
    const change = on_change(file)
    if (change === "restart") {
      if (!stale.has(file)) {
        stale.add(file)
        console.warn(`[runex-svelte] ${file} changed: modules load once per process, restart to pick it up`)
      }
      return
    }
    if (change !== "remount") return
    // Editors write in bursts; coalesce them.
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        void render(await load(), options)
      } catch (error) {
        console.error("[runex-svelte] reload failed:", (error as Error).message)
      }
    }, 60)
  })
  return done.finally(() => {
    clearTimeout(timer)
    watcher.close()
  })
}

/** Rune's tooling flags render once, headless, and exit. */
function headless(args: string[]): boolean {
  return args.some((a) => /^--(snap|tree|script|video|frames|html|trace|trace-all|strip|list-scenes|list-windows|help)(=|$)/.test(a))
}
