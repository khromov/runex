// Dev-workflow smoke tests: a single executable from `bun build --compile`, a `vite build` bundle,
// the Vite dev server's re-render on save, and `bun --hot`'s. All headless (`--snap`), all in
// temporary copies of the examples with the package and Vite linked in (lib.ts), so nothing is
// written to the repo. Each PNG is compared with a same-run `bun examples/<x>/main.ts --snap`,
// which keeps the checks independent of the platform's pixels.
//
//   bun test ./test/devflow
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PKG, REPO, VITE, exec, pngHash, repoFootprint, start, tempApp, waitPng } from "./lib.ts"

const report = (label: string, data: Record<string, unknown>) =>
  console.log(`  [devflow] ${label}: ${Object.entries(data).map(([k, v]) => `${k} ${typeof v === "number" ? Math.round(v) : JSON.stringify(v)}`).join(", ")}`)

const footprint = repoFootprint()
afterAll(() => {
  expect(repoFootprint()).toEqual(footprint)
})

/** `bun examples/<name>/main.ts --snap ... --scene on` into `dir`; the PNG's hash. */
async function reference(name: string, dir: string): Promise<string> {
  const out = join(dir, `${name}-reference.png`)
  const run = await exec(["bun", `examples/${name}/main.ts`, "--snap", out, "--scene", "on"])
  expect(run.code, run.stderr).toBe(0)
  return pngHash(out)!
}

describe("bun build --compile", () => {
  test("the single executable renders hello like bun does", async () => {
    const app = tempApp(["examples/hello/main.ts"])
    try {
      const ref = await reference("hello", app.dir)
      const bin = join(app.dir, "hello")
      const build = await exec(["bun", "build", "--compile", "main.ts", "--outfile", bin], { cwd: app.dir, timeoutMs: 60000 })
      expect(build.code, build.stderr).toBe(0)
      const size = statSync(bin).size
      const out = join(app.dir, "compiled.png")
      // Elsewhere than the build directory, so the binary can't lean on its node_modules.
      const run = await exec([bin, "--snap", out, "--scene", "on"], { cwd: REPO })
      report("bun build --compile", { buildMs: build.ms, sizeMB: size / 1e6, runMs: run.ms })
      expect(run.code, run.stderr).toBe(0)
      expect(pngHash(out)).toBe(ref)
      rmSync(bin)
    } finally {
      app.cleanup()
    }
  }, 60000)

  // A compiled binary's command line has no runtime flags or script path to leave out; BUN_OPTIONS
  // puts `--smol` in process.execArgv but not on that command line.
  test("the single executable's extra_args are its own arguments, before and after the run", async () => {
    const app = tempApp(["test/unit/fixtures/args.ts"])
    try {
      const bin = join(app.dir, "args")
      const build = await exec(["bun", "build", "--compile", "args.ts", "--outfile", bin], { cwd: app.dir, timeoutMs: 60000 })
      expect(build.code, build.stderr).toBe(0)
      const run = await exec([bin, "--tree", join(app.dir, "args.json"), "a", "--titlebar", "--b"], { cwd: REPO, env: { FIXTURE_EARLY: "1", BUN_OPTIONS: "--smol" } })
      expect(run.code, run.stderr).toBe(0)
      const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "))
      expect(JSON.parse(line?.slice("RESULT ".length) ?? "null")).toEqual({ early: ["a", "--b"], extra: ["a", "--b"], inset: 0 })
      rmSync(bin)
    } finally {
      app.cleanup()
    }
  }, 60000)
})

describe("vite", () => {
  const files = ["examples/vite/main.ts", "examples/vite/label.ts", "examples/vite/vite.config.ts"]
  let ref = ""
  let refDir: { dir: string; cleanup: () => void }
  beforeAll(async () => {
    refDir = tempApp([])
    ref = await reference("vite", refDir.dir)
  })
  afterAll(() => refDir.cleanup())

  test(`vite build bundles the app for node, keeping ${PKG} external`, async () => {
    const app = tempApp(files)
    try {
      const build = await exec(["node", VITE, "build"], { cwd: app.dir, timeoutMs: 60000 })
      expect(build.code, build.stdout + build.stderr).toBe(0)
      const dist = join(app.dir, "dist")
      const bundle = readFileSync(join(dist, "main.mjs"), "utf8")
      const names = readdirSync(dist, { recursive: true }).map(String)
      report("vite build", { ms: build.ms, files: names, bundleKB: bundle.length / 1000 })
      // A bare import of the package by its package.json name, resolved at run time.
      expect(bundle).toMatch(new RegExp(`(from|import)\\s*\\(?\\s*["']${PKG.replace(/[-/]/g, "\\$&")}["']`))
      // Nothing of the package or its addon inlined.
      expect(names.filter((n) => n.endsWith(".node"))).toEqual([])
      expect(bundle).not.toContain(".node")
      expect(bundle).not.toContain("__register_record")
      expect(bundle.length).toBeLessThan(50000)
      const out = join(app.dir, "bundle.png")
      const run = await exec(["node", join(dist, "main.mjs"), "--snap", out, "--scene", "on"], { cwd: app.dir })
      expect(run.code, run.stderr).toBe(0)
      expect(pngHash(out)).toBe(ref)
    } finally {
      app.cleanup()
    }
  }, 60000)

  test("the dev server re-renders on a save and back on its revert (vite -- --snap)", async () => {
    const app = tempApp(files)
    const out = join(app.dir, "dev.png")
    const port = String(20000 + Math.floor(Math.random() * 20000))
    const server = start(["node", VITE, "--port", port, "--", "--snap", out, "--scene", "on"], { cwd: app.dir })
    try {
      const first = await waitPng(out, () => true, 20000)
      expect(first.hash, server.out.text).toBe(ref)
      const changed = await edited(join(app.dir, "label.ts"), out, first.hash!)
      report("vite dev server", { firstMs: first.ms, ...changed })
      expect(changed.editMs).toBeLessThan(5000)
      expect(changed.revertMs).toBeLessThan(5000)
      expect(server.out.text).not.toContain("failed to load")
    } finally {
      await server.stop()
      app.cleanup()
    }
  }, 60000)

  // An unknown RUNEX_TITLEBAR keeps Rune's titlebar, so the PNGs still match; Bun evaluates runex
  // again on each save, and the warning must not come back with it.
  test("bun --hot re-renders headless on a save and back on its revert, warning once", async () => {
    const app = tempApp(files)
    const out = join(app.dir, "hot.png")
    const session = start(["bun", "--hot", "main.ts", "--snap", out, "--scene", "on"], { cwd: app.dir, env: { RUNEX_TITLEBAR: "bogus" } })
    try {
      const first = await waitPng(out, () => true, 20000)
      expect(first.hash, session.out.text).toBe(ref)
      const changed = await edited(join(app.dir, "label.ts"), out, first.hash!)
      report("bun --hot", { firstMs: first.ms, ...changed })
      expect(changed.editMs).toBeLessThan(5000)
      expect(changed.revertMs).toBeLessThan(5000)
      expect(session.out.text.split("\n").filter((l) => l.includes("RUNEX_TITLEBAR=bogus isn't known"))).toHaveLength(1)
    } finally {
      await session.stop()
      app.cleanup()
    }
  }, 60000)
})

/**
 * Saves a changed caption into `label` (in place, as an editor does) and waits for `png` to
 * change from `original`, then restores the file and waits for `png` to return to it. Each wait
 * gives up after 5 s (reported as 5000+).
 */
async function edited(label: string, png: string, original: string): Promise<{ editMs: number; revertMs: number }> {
  const source = readFileSync(label, "utf8")
  const edit = source.replace('"Lights on"', '"Lamps on, edited"')
  expect(edit).not.toBe(source)
  // Let the watcher settle on the files it just loaded.
  await Bun.sleep(300)
  writeFileSync(label, edit)
  const a = await waitPng(png, (h) => h !== original, 5000)
  writeFileSync(label, source)
  const b = await waitPng(png, (h) => h === original, 5000)
  return { editMs: a.hash ? a.ms : 5000 + a.ms, revertMs: b.hash ? b.ms : 5000 + b.ms }
}

// The repo copy of the example must be what the temporary copies started from.
test("the vite example still has the caption these tests edit", () => {
  expect(existsSync(join(REPO, "examples/vite/label.ts"))).toBe(true)
  expect(readFileSync(join(REPO, "examples/vite/label.ts"), "utf8")).toContain('"Lights on"')
})
