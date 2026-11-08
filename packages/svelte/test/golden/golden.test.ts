// Golden baselines: every example, scene and script rendered headless through the real bin, on
// Bun and on Node. The `--tree` output (Rune's accessibility tree: roles, names, bounds, keys) is
// committed under trees/ and must match on every platform; PNG hashes are per platform
// (png/<platform>.json) and checked where a manifest exists. Bless with `bun run golden:update`
// after reading the diff. `bun test ./test/golden -t hello` runs one example.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { render_env } from "../env.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const HERE = fileURLToPath(new URL(".", import.meta.url))
const BIN = join(ROOT, "bin/runex-svelte.js")
const UPDATE = process.env.RUNEX_SVELTE_UPDATE === "1"
// CI's macOS runner draws through a paravirtual GPU, so it names its own (absent) manifest.
const PLATFORM = process.env.RUNEX_SVELTE_GOLDEN_PLATFORM || `${process.platform}-${process.arch}`
const OUT = join(tmpdir(), `runex-svelte-golden-${process.pid}`)
mkdirSync(OUT, { recursive: true })

type Case = { id: string; example: string; scene?: string; script?: string }

export const CASES: Case[] = [
  { id: "hello", example: "hello" },
  { id: "hello--on", example: "hello", scene: "on" },
  { id: "hello--click", example: "hello", script: "hello-click.json" },
  { id: "todo", example: "todo" },
  { id: "todo--all-done", example: "todo", scene: "all-done" },
  { id: "todo--empty", example: "todo", scene: "empty" },
  { id: "todo--script", example: "todo", script: "todo.json" },
  { id: "kit", example: "kit" },
  { id: "kit--dialog", example: "kit", scene: "dialog" },
  { id: "kit--select", example: "kit", scene: "select" },
  { id: "kit--script", example: "kit", script: "kit.json" },
  { id: "styles", example: "styles" },
  { id: "styles--light", example: "styles", scene: "light" },
  { id: "styles--script", example: "styles", script: "styles.json" },
]

/** Renders one case; returns the tree text and the PNG's sha256. */
export function render(c: Case, runtime: "bun" | "node"): { tree: string; png: string; log: string } {
  const base = join(OUT, `${c.id}-${runtime}`)
  const args = [BIN, `--${runtime}`, join(ROOT, "examples", c.example, "main.ts"), "--tree", `${base}.json`, "--snap", `${base}.png`]
  if (c.scene) args.push("--scene", c.scene)
  if (c.script) args.push("--script", join(HERE, "scripts", c.script))
  const run = Bun.spawnSync(["node", ...args], { cwd: ROOT, env: render_env(), stdout: "pipe", stderr: "pipe" })
  const log = (run.stdout.toString() + run.stderr.toString()).split("\n").filter((l) => l && !l.startsWith("rune:")).join("\n")
  if (run.exitCode !== 0 || !existsSync(`${base}.png`)) throw new Error(`${c.id} on ${runtime} failed (exit ${run.exitCode}):\n${log}`)
  const tree = readFileSync(`${base}.json`, "utf8")
  const png = createHash("sha256").update(readFileSync(`${base}.png`)).digest("hex")
  return { tree, png, log }
}

const tree_path = (id: string) => join(HERE, "trees", `${id}.json`)
const manifest_path = join(HERE, "png", `${PLATFORM}.json`)
const manifest: Record<string, string> = existsSync(manifest_path) ? JSON.parse(readFileSync(manifest_path, "utf8")) : {}
const blessed: Record<string, string> = {}

describe("golden", () => {
  for (const c of CASES) {
    test(c.id, () => {
      const bun = render(c, "bun")
      const node = render(c, "node")
      // A warning in a golden render is a regression in an example or the renderer.
      expect(bun.log).toBe("")
      // The same app on both runtimes draws the same pixels and the same tree.
      expect(node.tree).toBe(bun.tree)
      expect(node.png).toBe(bun.png)

      if (UPDATE) {
        mkdirSync(join(HERE, "trees"), { recursive: true })
        writeFileSync(tree_path(c.id), bun.tree.endsWith("\n") ? bun.tree : bun.tree + "\n")
        blessed[c.id] = bun.png
        return
      }
      if (!existsSync(tree_path(c.id))) throw new Error(`no baseline for ${c.id}: run \`bun run golden:update\` and read the new tree`)
      expect(bun.tree.trimEnd()).toBe(readFileSync(tree_path(c.id), "utf8").trimEnd())
      if (manifest[c.id]) expect(bun.png).toBe(manifest[c.id]!)
    })
  }

  test.if(UPDATE)("write the PNG manifest", () => {
    mkdirSync(join(HERE, "png"), { recursive: true })
    writeFileSync(manifest_path, JSON.stringify(Object.fromEntries(Object.entries(blessed).sort()), null, 2) + "\n")
  })
})

describe("parity with runex", () => {
  // runex's examples/hello is a line-by-line port of Rune's Rust example; the Svelte one says the
  // same thing in markup and CSS, so it must draw the same pixels.
  test.each([[undefined], ["on"]])("examples/hello scene %p matches runex's own port", (scene) => {
    const repo = join(ROOT, "../..")
    const base = join(OUT, `parity-${scene ?? "default"}`)
    const args = [join(repo, "examples/hello/main.ts"), "--snap", `${base}-runex.png`, ...(scene ? ["--scene", scene] : [])]
    const run = Bun.spawnSync(["bun", ...args], { cwd: repo, env: render_env(), stdout: "pipe", stderr: "pipe" })
    expect(run.exitCode).toBe(0)
    const ours = render({ id: `parity-${scene ?? "default"}`, example: "hello", scene }, "bun")
    expect(ours.png).toBe(createHash("sha256").update(readFileSync(`${base}-runex.png`)).digest("hex"))
  })
})
