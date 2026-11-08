// @ts-check
// `prepack`: copies the starter (packages/svelte/starter, the one source of truth) into template/,
// which is what the published scaffolder copies from.
import { cpSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const from = fileURLToPath(new URL("../svelte/starter", import.meta.url))
const to = fileURLToPath(new URL("./template", import.meta.url))
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true, filter: (src) => !/node_modules|\.png$|package-lock\.json|bun\.lock/.test(src) })
console.log("template/ synced from packages/svelte/starter")
