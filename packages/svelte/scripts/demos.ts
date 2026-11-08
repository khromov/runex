// `bun run demo [names...]`: opens the examples one after another (close a window for the next).
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const all = readdirSync(join(ROOT, "examples")).sort()
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : all
for (const name of names) {
  if (!all.includes(name)) throw new Error(`no example ${name} (have: ${all.join(", ")})`)
  console.log(`\n▶ ${name}`)
  Bun.spawnSync(["node", join(ROOT, "bin/runex-svelte.js"), "--bun", join(ROOT, "examples", name, "main.ts")], { stdio: ["inherit", "inherit", "inherit"] })
}
