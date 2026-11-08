// Real windows (macOS/Windows desktops; skipped where there is no display or RUNEX_WINDOWED=0):
// state changed outside any Rune handler reaches the window, and render_hot remounts on save.
import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { render_env } from "../env.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const APPS = fileURLToPath(new URL("./apps", import.meta.url))
const windowed = process.env.RUNEX_WINDOWED === "1" || (process.env.RUNEX_WINDOWED !== "0" && (process.platform === "darwin" || process.platform === "win32" || !!process.env.DISPLAY))

async function run(args: string[], during?: (output: () => string) => Promise<void>): Promise<string> {
  const proc = Bun.spawn(["node", join(ROOT, "bin/runex-svelte.js"), ...args], { cwd: ROOT, env: render_env(), stdout: "pipe", stderr: "pipe" })
  let out = ""
  const read = (async () => {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    for (let r = await reader.read(); !r.done; r = await reader.read()) out += decoder.decode(r.value)
  })()
  const timer = setTimeout(() => proc.kill(), 30_000)
  if (during) await during(() => out)
  await proc.exited
  await read
  clearTimeout(timer)
  return out + (await new Response(proc.stderr).text())
}

const frames = (out: string) => out.split("\n").filter((l) => l.startsWith("frame ")).map((l) => l.slice(6))

describe.if(windowed)("windowed", () => {
  for (const runtime of ["--bun", "--node"]) {
    test(`timer updates reach the window, and the app quits (${runtime})`, async () => {
      const out = await run([runtime, join(APPS, "ticker.ts")])
      const seen = frames(out)
      for (let n = 0; n <= 5; n++) expect(seen).toContain(`tick:${n}`)
      expect(out).toContain("quit")
    })
  }

  test("render_hot remounts on save and keeps the window", async () => {
    // Inside the package, so the copy resolves `@runex-js/svelte` as an app's own component does.
    mkdirSync(join(ROOT, ".tmp"), { recursive: true })
    const dir = mkdtempSync(join(ROOT, ".tmp", "hot-"))
    const file = join(dir, "Ticker.svelte")
    copyFileSync(join(APPS, "Ticker.svelte"), file)
    const out = await run(["--bun", join(APPS, "ticker.ts"), file], async (output) => {
      for (let i = 0; i < 100 && !output().includes("frame tick:1"); i++) await Bun.sleep(20)
      writeFileSync(file, readFileSync(file, "utf8").replace('label = "tick"', 'label = "edited"'))
    })
    expect(out).toContain("[runex-svelte] remounted")
    // The remount runs the component fresh: its own count restarts, under the new label.
    expect(frames(out).some((f) => f.startsWith("edited:"))).toBe(true)
    expect(out).toContain("quit")
  })
})
