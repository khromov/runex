// `bun run vendor`: moves vendor/ to the head of Svelte's custom-renderer PR. pkg.svelte.dev drops
// a build once a force-push removes its commit (the PR is rebased on every update), so the build
// this package runs on lives in the repo, and is bundled into the npm package.
//
// After it: `bun run test` (typecheck, unit, golden, pack) and `bun run test:windowed`.
import { execSync } from "node:child_process"
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const PR = 18511
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const VENDOR = join(ROOT, "vendor")

async function get(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`)
  return res
}

const sha = process.argv[2] ?? ((await (await get(`https://api.github.com/repos/sveltejs/svelte/pulls/${PR}`)).json()) as { head: { sha: string } }).head.sha
const short = sha.slice(0, 7)
const current = readdirSync(VENDOR).find((f) => f.endsWith(`-${short}.tgz`))
if (current) {
  console.log(`vendor/${current} is already ${sha}`)
  process.exit(0)
}

const { version } = (await (await get(`https://raw.githubusercontent.com/sveltejs/svelte/${sha}/packages/svelte/package.json`)).json()) as { version: string }
const tarball = await (await get(`https://pkg.svelte.dev/svelte/c/${sha}`)).arrayBuffer()
for (const f of readdirSync(VENDOR)) if (f.endsWith(".tgz")) rmSync(join(VENDOR, f))
const name = `svelte-${version}-${short}.tgz`
writeFileSync(join(VENDOR, name), Buffer.from(tarball))

const manifest = join(ROOT, "package.json")
const json = JSON.parse(readFileSync(manifest, "utf8"))
json.dependencies.svelte = `file:vendor/${name}`
writeFileSync(manifest, JSON.stringify(json, null, 2) + "\n")
execSync("bun install", { cwd: join(ROOT, "../.."), stdio: "inherit" })
console.log(`\nsvelte ${version} @ ${sha} -> vendor/${name}\nnow run: bun run test && bun run test:windowed`)
