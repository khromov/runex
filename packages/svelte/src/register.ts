// Node's loader: `node --import @runex-js/svelte/register` (the bin passes it), installed before
// the entry module resolves. It compiles `.svelte` and `.svelte.ts` files and pins every `svelte`
// import to the custom-renderer build bundled with this package.
import { registerHooks, stripTypeScriptTypes } from "node:module"
import { fileURLToPath } from "node:url"
import { compile_module, compile_svelte, WRONG_SVELTE } from "./compile.ts"

export { RENDERER_MODULE } from "./compile.ts"

const decode = (source: string | ArrayBuffer | NodeJS.TypedArray) => (typeof source === "string" ? source : new TextDecoder().decode(source))

registerHooks({
  // svelte is bundled inside this package, so a consumer's compiled component must resolve
  // `svelte` from here, or two runtimes would meet.
  resolve(specifier, context, nextResolve) {
    if (!/^svelte(\/|$)/.test(specifier)) return nextResolve(specifier, context)
    return nextResolve(specifier, { ...context, parentURL: import.meta.url })
  },

  load(url, context, nextLoad) {
    if (/\.svelte\.[jt]s(\?|$)/.test(url)) {
      const file = new URL(url)
      file.search = ""
      const path = fileURLToPath(file)
      let source: string | undefined
      if (path.endsWith(".ts")) {
        const loaded = nextLoad(url, context)
        source = decode(loaded.source ?? "")
        if (loaded.format === "module-typescript") source = stripTypeScriptTypes(source)
      }
      return { format: "module", shortCircuit: true, source: compile_module(path, source) }
    }
    if (!/\.svelte(\?|$)/.test(url)) return nextLoad(url, context)
    // render_hot busts Node's module cache with `?v=N`, which lands in the URL's search.
    const file = new URL(url)
    const query = file.search
    file.search = ""
    return { format: "module", shortCircuit: true, source: compile_svelte(fileURLToPath(file), query) }
  },
})

try {
  import.meta.resolve("svelte/renderer")
} catch {
  throw new Error(WRONG_SVELTE)
}
