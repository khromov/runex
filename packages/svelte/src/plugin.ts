// Bun's loader: `bun --preload @runex-js/svelte/plugin` (the bin passes it). Bun has no
// `module.registerHooks`, so this is a runtime `Bun.plugin`: it compiles `.svelte` and
// `.svelte.ts` files and pins every `svelte` import to the build bundled with this package.
import { plugin, type OnLoadArgs, type OnLoadResult, type PluginBuilder } from "bun"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { compile_module, compile_svelte, WRONG_SVELTE } from "./compile.ts"

export { RENDERER_MODULE } from "./compile.ts"

// `compileModule` does not strip types, so a `.svelte.ts` goes through Bun's transpiler first.
const transpiler = new Bun.Transpiler({ loader: "ts" })

export function load_svelte(args: OnLoadArgs): OnLoadResult {
  const path = args.path.replace(/\?.*$/, "")
  return { contents: compile_svelte(path, args.path.slice(path.length)), loader: "js" }
}

export function load_module(args: OnLoadArgs): OnLoadResult {
  const path = args.path.replace(/\?.*$/, "")
  const source = path.endsWith(".ts") ? transpiler.transformSync(readFileSync(path, "utf8")) : undefined
  return { contents: compile_module(path, source), loader: "js" }
}

/**
 * A runtime `onResolve` never sees a bare specifier, so each of svelte's entry points becomes a
 * virtual module re-exporting the copy that resolves from here: the instance the renderer imports.
 */
function pin_svelte(build: PluginBuilder) {
  let manifest: { exports: Record<string, string | Record<string, string>> }
  try {
    manifest = JSON.parse(readFileSync(Bun.resolveSync("svelte/package.json", import.meta.dir), "utf8"))
    Bun.resolveSync("svelte/renderer", import.meta.dir)
  } catch {
    throw new Error(WRONG_SVELTE)
  }
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (typeof target === "string" || Object.keys(target).every((condition) => condition === "types")) continue
    const specifier = key === "." ? "svelte" : `svelte/${key.slice(2)}`
    build.module(specifier, () => ({
      contents: `export * from ${JSON.stringify(Bun.resolveSync(specifier, import.meta.dir))};`,
      loader: "js",
    }))
  }
}

/** render_hot's reload: Bun keys ES modules by path, and re-evaluates one dropped from `require.cache`. */
function invalidate_svelte() {
  const cache = createRequire(import.meta.url).cache
  for (const key of Object.keys(cache)) {
    if (key.endsWith(".svelte") && !key.includes("node_modules")) delete cache[key]
  }
}

;(globalThis as Record<symbol, unknown>)[Symbol.for("runex-svelte.invalidate")] = invalidate_svelte

plugin({
  name: "runex-svelte",
  setup(build) {
    pin_svelte(build)
    build.onLoad({ filter: /\.svelte\.[jt]s(\?.*)?$/ }, load_module)
    build.onLoad({ filter: /\.svelte(\?.*)?$/ }, load_svelte)
  },
})
