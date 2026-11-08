#!/usr/bin/env bun
// Removes what runex's builds and tests leave on disk, all of it regenerable:
//
//   bun run clean                  out/, runex's temp folders, target/ and vendor/rune/target
//   bun run clean --outputs-only   out/ and the temp folders; keep the cargo builds
//   bun run clean --docker         also scripts/linux-docker.sh clean (volumes, image, out/linux)
//
// The installed addon (runex.<platform>.node), dist/ and node_modules stay, so examples and tests
// still run; the next cargo build starts cold (the debug addon takes a few minutes, compare's Rust
// examples longer). Prints what each removal freed.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const args = process.argv.slice(2)
for (const a of args) {
  if (!["--outputs-only", "--docker"].includes(a)) {
    console.error(`clean: unknown option ${a} (--outputs-only, --docker)`)
    process.exit(2)
  }
}

/** Bytes under `path` (du's count, so hard links and sparse files count once). */
function size(path: string): number {
  const r = spawnSync("du", ["-sk", path], { encoding: "utf8" })
  return r.status === 0 ? Number(r.stdout.split(/\s/)[0]) * 1024 : 0
}

function human(bytes: number): string {
  return bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : `${(bytes / (1 << 20)).toFixed(0)} MB`
}

let total = 0
function remove(path: string, label = relative(ROOT, path) || path) {
  if (!existsSync(path)) return
  const bytes = size(path)
  rmSync(path, { recursive: true, force: true })
  total += bytes
  console.log(`removed ${label} (${human(bytes)})`)
}

remove(join(ROOT, "out"))

// Scratch folders the tools and tests make (mkdtemp): a crashed or killed run can leave them.
const tmp = tmpdir()
const scratch = readdirSync(tmp).filter((n) => /^(runex-|update-rune-)/.test(n) && statSync(join(tmp, n)).isDirectory())
let scratchBytes = 0
for (const n of scratch) {
  scratchBytes += size(join(tmp, n))
  rmSync(join(tmp, n), { recursive: true, force: true })
}
if (scratch.length) {
  total += scratchBytes
  console.log(`removed ${scratch.length} temp folder${scratch.length === 1 ? "" : "s"} in ${tmp} (${human(scratchBytes)})`)
}

if (!args.includes("--outputs-only")) {
  remove(join(ROOT, "target"))
  remove(join(ROOT, "vendor", "rune", "target"))
}

if (args.includes("--docker")) {
  const r = spawnSync(join(ROOT, "scripts", "linux-docker.sh"), ["clean"], { stdio: "inherit" })
  if (r.status !== 0) console.error(`clean: scripts/linux-docker.sh clean exited ${r.status}`)
}

console.log(`clean: ${human(total)} freed${args.includes("--docker") ? " (Docker's not counted)" : ""}`)
