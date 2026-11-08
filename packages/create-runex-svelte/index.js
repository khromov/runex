#!/usr/bin/env node
// @ts-check
/**
 * `npm create runex-svelte [directory]`: copies the starter into `directory` and pins the
 * @runex-js/svelte release this scaffolder was published with.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
// Published, the starter sits in template/; in the repo it is read from packages/svelte/starter.
const template = [join(here, "template"), join(here, "../svelte/starter")].find((dir) => existsSync(join(dir, "App.svelte")))
if (!template) throw new Error("create-runex-svelte: the starter template is missing")

const SKIP = new Set(["node_modules", "package-lock.json", "bun.lock", "pnpm-lock.yaml", "yarn.lock", "app.png"])

const argv = process.argv.slice(2)
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("usage: npm create runex-svelte@latest [directory]")
  process.exit(0)
}
let arg = argv.find((a) => !a.startsWith("-"))
if (!arg && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  arg = (await rl.question("Project directory (runex-svelte-app): ")).trim() || undefined
  rl.close()
}
const target = resolve(arg ?? "runex-svelte-app")
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`${target} exists and is not empty`)
  process.exit(1)
}

cpSync(template, target, { recursive: true, filter: (src) => !SKIP.has(basename(src)) })

const own = JSON.parse(readFileSync(join(here, "package.json"), "utf8"))
const manifest = join(target, "package.json")
const json = JSON.parse(readFileSync(manifest, "utf8"))
// npm refuses a name that starts with `.`, `_` or `-`.
json.name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+/, "") || "runex-svelte-app"
json.dependencies["@runex-js/svelte"] = `^${own.version}`
writeFileSync(manifest, JSON.stringify(json, null, 2) + "\n")
const app = join(target, "app.ts")
writeFileSync(app, readFileSync(app, "utf8").replace("runex-svelte starter", json.name))
// npm strips .gitignore from published tarballs, so the scaffolder writes it.
writeFileSync(join(target, ".gitignore"), "node_modules\n*.png\n.DS_Store\n")

const agent = process.env.npm_config_user_agent?.split("/")[0] ?? "npm"
const pm = ["bun", "pnpm", "yarn"].includes(agent) ? agent : "npm"
const cd = relative(process.cwd(), target) || "."
const script = (/** @type {string} */ name) => (pm === "npm" && name === "start" ? "npm start" : `${pm} run ${name}`)
console.log(`
Created ${cd}. Next:

  cd ${cd}
  ${pm} install
  ${script("start").padEnd(16)}# opens the window; edit App.svelte to hot-reload
  ${script("snap").padEnd(16)}# renders one frame headless to app.png
`)
