#!/usr/bin/env node
// @ts-check
/**
 * `runex-svelte [--bun|--node] [runtime flags] <entry> [args]`: runs the entry with the export
 * conditions Svelte's custom renderer needs and the `.svelte` loader installed. Bun when launched
 * by Bun (`bun run`, `bunx`) or given `--bun`, Node otherwise (or with `--node`). Arguments after
 * the entry go to the app, Rune's tooling flags included (`--snap out.png`, `--tree`, `--scene`).
 */

import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const at = args.findIndex((arg) => !arg.startsWith("--"))
if (at === -1) {
  console.error("usage: runex-svelte [--bun|--node] [runtime flags] <entry.ts> [args]")
  process.exit(2)
}

const flags = args.slice(0, at)
const entry = resolve(args[at] ?? "")
const rest = args.slice(at + 1)

const bun =
  !flags.includes("--node") &&
  (flags.includes("--bun") || process.versions.bun != null || (process.env.npm_config_user_agent ?? "").startsWith("bun/"))

const conditions = ["--conditions", "custom-renderer", "--conditions", "development"]
// The loader strips `.svelte.ts` types with `module.stripTypeScriptTypes`, which Node flags as experimental.
const quiet = bun ? [] : ["--disable-warning=ExperimentalWarning"]
// Through the package's own exports: src/*.ts in the repo, lib/*.js once packed.
const loader = bun
  ? ["--preload", fileURLToPath(import.meta.resolve("@runex-js/svelte/plugin"))]
  : ["--import", import.meta.resolve("@runex-js/svelte/register")]

// Launched by Bun, this process is the runtime; from Node, `bun` is whatever PATH has, which on
// Windows is a shim only a shell can run.
const runtime = bun ? (process.versions.bun ? process.execPath : "bun") : process.execPath
const shell = runtime === "bun" && process.platform === "win32"
// cmd.exe receives one string, so each argument is quoted by hand or a path with a space splits.
const quote = (/** @type {string} */ arg) => (shell ? `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"` : arg)

const own = new Set(["--bun", "--node"])
const child = spawn(runtime, [...flags.filter((f) => !own.has(f)), ...quiet, ...conditions, ...loader, entry, ...rest].map(quote), {
  stdio: "inherit",
  shell,
})

const stop = () => child.kill()
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
