// The golden baselines' quick tier on bun: every fixture scene, and each example's `(none)` and
// first scene, checked against test/golden (trees, this platform's PNG hashes, listings), with
// RUNEX_PERF and RUNEX_TITLEBAR exported, which the renders must not inherit. On a
// failure, out/golden/ has the diffs, summary.md and proposed/; scripts/golden.ts --help says how
// to bless. A second test proves the "all scenes identical" sanity check still fires: it renders
// one fixture with Rune's scene flag renamed, which Rune then ignores. Two more check the path a
// copy without .git takes (scripts/golden-linux.sh's Docker run): `--export-images` fills a cache
// from the golden-images branch, and a failing case there still gets expected.png and diff.png
// from that cache.
//
//   bun test test/golden.test.ts
//   RUNEX_GOLDEN_PLATFORM=KEY   another platform's manifest (default os-arch-backend)
//   RUNEX_GOLDEN_NO_PNG=1       trees only (a platform without a manifest yet)
import { expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { type GoldenReport, runGolden } from "../scripts/golden.ts"
import { ImageStore } from "../scripts/golden/store.ts"
import { maskPng, sha256 } from "../scripts/lib/png.ts"
import { GOLDEN } from "./golden/cases.ts"
import config from "./golden/config.ts"

const SECONDS = 1000
const png = process.env.RUNEX_GOLDEN_NO_PNG !== "1"

/** One line per failure, so a failing expect shows what broke. */
function failures(r: GoldenReport): string[] {
  return [
    ...r.errors.map((e) => `error: ${e}`),
    ...r.sanity.map((s) => `sanity: ${s}`),
    ...r.listings.filter((l) => l.status !== "same").map((l) => `listing ${l.example}: ${l.changes.join("; ")}`),
    ...r.cases.filter((c) => c.status !== "pass").map((c) => `${c.status} ${c.id} [${c.runtime}]: tree ${c.tree}, png ${c.png}${c.reason ? `: ${c.reason}` : ""}${c.error ? `: ${c.error}` : ""}`),
    ...r.traces.filter((t) => t.status !== "pass").map((t) => `trace ${t.status} ${t.id}`),
  ]
}

// With RUNEX_PERF and RUNEX_TITLEBAR exported, as a shell might: both change what a render draws
// (the perf overlay; the titlebar inset), so this also checks that the renders golden.ts starts
// leave them out (scripts/lib/env.ts).
test("golden quick tier matches test/golden, with RUNEX_PERF=1 and RUNEX_TITLEBAR=native exported", async () => {
  const saved = { RUNEX_PERF: process.env.RUNEX_PERF, RUNEX_TITLEBAR: process.env.RUNEX_TITLEBAR }
  Object.assign(process.env, { RUNEX_PERF: "1", RUNEX_TITLEBAR: "native" })
  try {
    const report = await runGolden({ tier: "quick", runtimes: ["bun"], png, log: () => {} })
    if (!report.ok) console.error(`golden: see out/golden/summary.md; bless with bun scripts/golden.ts --update after review`)
    expect(failures(report)).toEqual([])
    expect(report.cases.length).toBeGreaterThan(50)
  } finally {
    restoreEnv(saved)
  }
}, 300 * SECONDS)

test("an ignored --scene trips the all-scenes-identical check", async () => {
  const out = mkdtempSync(join(tmpdir(), "runex-golden-sanity-"))
  try {
    const report = await runGolden({
      tier: "quick", runtimes: ["bun"], png: false, filters: ["fixture-layout"], out, log: () => {},
      config: { ...config, sceneFlag: "--golden-renamed-scene" },
    })
    expect(report.sanity).toContainEqual(expect.stringContaining("fixture-layout/main/base: all 6 scenes render identically"))
    expect(report.exit).toBe(1)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}, 120 * SECONDS)

test("a copy without .git reads the expected images golden.ts --export-images copied", () => {
  const tmp = mkdtempSync(join(tmpdir(), "runex-golden-store-"))
  const env = { cache: process.env.RUNEX_GOLDEN_CACHE, ceiling: process.env.GIT_CEILING_DIRECTORIES }
  try {
    // The checkout: a repository with two images in its golden-images branch.
    const repo = join(tmp, "repo")
    mkdirSync(repo)
    expect(Bun.spawnSync(["git", "init", "-q", repo]).exitCode).toBe(0)
    const store = new ImageStore(repo, () => {})
    store.add([
      { platform: "test-plat", hash: "aa11", png: Buffer.from("png a") },
      { platform: "test-plat", hash: "rgba:bb22", png: Buffer.from("png b") },
    ])
    const cache = join(tmp, "images")
    expect(store.export("test-plat", ["aa11", "rgba:bb22", "aa11", "cc33"], cache)).toEqual({ copied: 2, present: 0, missing: ["cc33"] })
    expect(readFileSync(join(cache, "test-plat", "rgba-bb22.png"), "utf8")).toBe("png b")
    expect(store.export("test-plat", ["aa11"], cache)).toEqual({ copied: 0, present: 1, missing: [] })

    // The copy: no repository (nor one above it), only the cache.
    const copy = join(tmp, "copy")
    mkdirSync(copy)
    process.env.GIT_CEILING_DIRECTORIES = tmp
    process.env.RUNEX_GOLDEN_CACHE = cache
    const bare = new ImageStore(copy, () => {})
    expect(bare.available()).toBe(false)
    expect(bare.get("test-plat", "aa11", { fetch: true })?.toString()).toBe("png a")
    expect(bare.get("test-plat", "cc33", { fetch: true })).toBeUndefined()
  } finally {
    restoreEnv({ RUNEX_GOLDEN_CACHE: env.cache, GIT_CEILING_DIRECTORIES: env.ceiling })
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a failure without a repository gets expected.png and diff.png from the cache", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "runex-golden-nogit-"))
  const env = { cache: process.env.RUNEX_GOLDEN_CACHE, gitDir: process.env.GIT_DIR }
  const id = "fixture-layout/main/base/flex"
  try {
    // Baselines for one case: its listing and tree, and a manifest whose hash no render has.
    const golden = join(tmp, "golden")
    for (const p of ["listings/fixture-layout.txt", ...["", ".darwin", ".linux", ".win32"].map((os) => `trees/${id}${os}.jsonl`)]) {
      if (!existsSync(join(GOLDEN, p))) continue
      mkdirSync(dirname(join(golden, p)), { recursive: true })
      copyFileSync(join(GOLDEN, p), join(golden, p))
    }
    mkdirSync(join(golden, "png"))
    const manifest = (hash: string) =>
      writeFileSync(join(golden, "png", "test-plat.json"), JSON.stringify({ platform: "test-plat", env: {}, cases: { [id]: hash } }))
    manifest("0".repeat(64))
    // As in golden-linux.sh's Docker copy: no repository, so no golden-images branch; a cache.
    process.env.GIT_DIR = join(tmp, "no-repository")
    process.env.RUNEX_GOLDEN_CACHE = join(tmp, "cache")
    const run = (out: string) => runGolden({ tier: "quick", runtimes: ["bun"], platform: "test-plat", golden, filters: [id], out: join(tmp, out), log: () => {} })

    const first = await run("out1")
    expect(first.cases.map((c) => [c.id, c.status, c.tree, c.png])).toEqual([[id, "fail", "same", "changed"]])
    expect(first.notes).toContainEqual(expect.stringContaining("no git repository here"))
    expect(existsSync(join(tmp, "out1", id, "expected.png"))).toBe(false)

    // The expected image, in the cache: the render with its top-left corner blanked.
    const expectedPng = maskPng(readFileSync(join(tmp, "out1", id, "actual.png")), [[0, 0, 10, 10]], 2).png
    const hash = sha256(expectedPng)
    mkdirSync(join(tmp, "cache", "test-plat"), { recursive: true })
    writeFileSync(join(tmp, "cache", "test-plat", `${hash}.png`), expectedPng)
    manifest(hash)
    const second = await run("out2")
    expect(second.cases.map((c) => [c.status, c.png])).toEqual([["fail", "changed"]])
    expect(readFileSync(join(tmp, "out2", id, "expected.png")).equals(expectedPng)).toBe(true)
    expect(existsSync(join(tmp, "out2", id, "diff.png"))).toBe(true)
    expect(second.cases[0]!.reason).toContain("px differ")
  } finally {
    restoreEnv({ RUNEX_GOLDEN_CACHE: env.cache, GIT_DIR: env.gitDir })
    rmSync(tmp, { recursive: true, force: true })
  }
}, 120 * SECONDS)

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}
