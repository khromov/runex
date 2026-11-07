// `runex-js/vite`: a Vite plugin that runs a runex app from the dev server's own process.
//
// `vite` imports the app's entry through a runnable server environment (a `ModuleRunner`), so the
// window opens from Vite's process, Node's or Bun's. The plugin makes the entry accept its own
// updates: saving it, or any module it imports, re-runs it, and its `run` swaps the new view and
// hooks into the open window (`App.run`'s hot reload), state kept. Errors are logged; the window
// keeps its last good code until a save that loads.
//
// `vite build` bundles the entry for Node (`dist/<entry>.mjs`), with `runex-js` and its native
// addon left external.
import path from "node:path"
import { createRunnableDevEnvironment, isRunnableDevEnvironment, normalizePath, type Plugin, type ViteDevServer } from "vite"
import type { Host } from "./app.js"

export type RunexOptions = {
  /** The module that calls `run`, relative to Vite's root. */
  entry: string
  /**
   * Rune's arguments (`--snap out.png`, `--scene on`, ...). By default, whatever follows `--` on
   * Vite's command line: `vite -- --snap out.png` re-renders `out.png` on every save.
   */
  args?: string[]
  /** The Vite environment the app runs in (default `"runex"`). */
  environment?: string
}

/** What follows `--` on the command line. */
function cliArgs(): string[] {
  const i = process.argv.indexOf("--")
  return i < 0 ? [] : process.argv.slice(i + 1)
}

function setHost(host: Host) {
  ;(globalThis as { __runex_host?: Host }).__runex_host = host
}

export function runex(options: RunexOptions): Plugin {
  const name = options.environment ?? "runex"
  let entry = ""
  let serving = false
  // Whether the entry has loaded since the last failure. Until it has, a save retries from scratch:
  // a module that failed to load isn't in the HMR graph yet.
  let loaded = false
  let load = async () => {}

  return {
    name: "runex",

    config(config, { command }) {
      serving = command === "serve"
      entry = normalizePath(path.resolve(config.root ?? process.cwd(), options.entry))
      const chunk = path.basename(entry).replace(/\.[^.]+$/, "")
      return {
        // No index.html: the dev server serves no pages.
        appType: config.appType ?? "custom",
        environments: {
          [name]: {
            consumer: "server",
            // One copy of `runex-js`, loaded by the runtime itself: its native addon can't be
            // bundled or evaluated twice, and its registry must outlive the modules that re-run.
            resolve: { external: ["runex-js"] },
            dev: {
              createEnvironment: (environment, resolved) => createRunnableDevEnvironment(environment, resolved, { hot: true }),
            },
            build: {
              rollupOptions: { input: { [chunk]: entry }, output: { entryFileNames: "[name].mjs" } },
            },
          },
        },
        // `vite build` builds the app's environment, not a client bundle.
        builder: config.builder ?? {
          buildApp: async (builder) => {
            await builder.build(builder.environments[name]!)
          },
        },
      }
    },

    configureServer(server: ViteDevServer) {
      const environment = server.environments[name]
      if (!environment || !isRunnableDevEnvironment(environment)) {
        throw new Error(`runex: Vite's "${name}" environment isn't runnable; was it configured elsewhere?`)
      }
      const logger = server.config.logger
      setHost({
        args: options.args ?? cliArgs(),
        hot: true,
        // Rune's event loop can't start twice in a process, so closing the window ends the session.
        quit: () => {
          logger.info("runex: the app quit; stopping Vite", { timestamp: true })
          void server.close().finally(() => process.exit(0))
        },
      })
      load = async () => {
        loaded = false
        // A module that failed to evaluate keeps its error in the runner's cache.
        environment.runner.evaluatedModules.clear()
        try {
          await environment.runner.import(entry)
          loaded = true
        } catch (error) {
          const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
          logger.error(`runex: ${options.entry} failed to load; save a fix to retry\n${detail}`, { timestamp: true })
        }
      }
      // After Vite's banner, so the app's output follows it.
      if (server.httpServer) server.httpServer.once("listening", () => void load())
      else void load()
    },

    hotUpdate() {
      if (this.environment.name !== name || loaded) return
      void load()
      // The retry replaces Vite's own update, which would find no boundary to apply it to.
      return []
    },

    transform(code, id) {
      if (!serving || this.environment.name !== name || normalizePath(id.split("?")[0]!) !== entry) return
      // The entry accepts its own updates, and those of every module it imports that doesn't:
      // re-running it re-runs `run`, which swaps the new view into the open window.
      return { code: `${code}\nif (import.meta.hot) import.meta.hot.accept()\n`, map: null }
    },
  }
}

export default runex
