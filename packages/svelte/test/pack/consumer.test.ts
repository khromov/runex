// The published packages as an app gets them. `create-runex-svelte` scaffolds the starter into a
// temporary directory; the packed @runex-js/svelte (with its bundled svelte) and runex-js (with
// the built addon beside it, where native.cjs looks first) are extracted into its node_modules,
// and the dev tools are linked from the repo. Then, as an app would: tsc and svelte-check pass on
// the starter as shipped, and it renders headless on Bun and Node, byte-identical to the repo's
// own render of the starter, and a scripted press reaches its Svelte state.
//
//   bun run test:pack
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { addonFile, cleanup, pack as pack_runex, run, sha256, tempDir } from "../../../../test/pack/lib.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const REPO = join(ROOT, "../..")
let app = ""
let packed = ""

function extract(tarball: string, into: string) {
  mkdirSync(into, { recursive: true })
  run("tar", ["xzf", tarball, "-C", into, "--strip-components=1"], { cwd: into })
}

/** Links a dev tool from the package's own node_modules (Bun's isolated layout: a symlink into the store). */
function link(name: string) {
  const to = join(app, "node_modules", ...name.split("/"))
  mkdirSync(join(to, ".."), { recursive: true })
  symlinkSync(join(ROOT, "node_modules", ...name.split("/")), to, "junction")
}

beforeAll(() => {
  const dir = tempDir("svelte-consumer")
  run(process.execPath, [join(ROOT, "scripts/publish.ts"), "pack", dir], { cwd: ROOT })
  packed = join(dir, readdirSync(dir).find((f) => f.endsWith(".tgz"))!)

  app = join(dir, "my-app")
  run("node", [join(REPO, "packages/create-runex-svelte/index.js"), app], { cwd: dir })
  extract(packed, join(app, "node_modules/@runex-js/svelte"))
  extract(pack_runex().tarball, join(app, "node_modules/runex-js"))
  copyFileSync(join(REPO, addonFile()!), join(app, "node_modules/runex-js", addonFile()!))
  for (const name of ["acorn", "typescript", "svelte-check", "@types/node"]) link(name)
  mkdirSync(join(app, "node_modules/.bin"), { recursive: true })
}, 240_000)

afterAll(() => cleanup())

describe("a scaffolded app on the packed packages", () => {
  test("the scaffolder named the app and pinned this release", () => {
    const json = JSON.parse(readFileSync(join(app, "package.json"), "utf8"))
    expect(json.name).toBe("my-app")
    expect(json.dependencies["@runex-js/svelte"]).toBe(`^${JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version}`)
    expect(readFileSync(join(app, "app.ts"), "utf8")).toContain('title: "my-app"')
  })

  test("the bundled svelte is the custom-renderer build", () => {
    const svelte = JSON.parse(readFileSync(join(app, "node_modules/@runex-js/svelte/node_modules/svelte/package.json"), "utf8"))
    expect(svelte.exports["./renderer"]).toBeDefined()
  })

  test("tsc and svelte-check pass on the starter", () => {
    run("node", [join(app, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.json"], { cwd: app })
    const out = run("node", [join(app, "node_modules/svelte-check/bin/svelte-check"), "--tsconfig", "./tsconfig.json", "--diagnostic-sources", "js,svelte", "--fail-on-warnings", "--output", "human"], { cwd: app })
    expect(out).toContain("0 errors and 0 warnings")
  }, 120_000)

  for (const runtime of ["--bun", "--node"]) {
    test(`renders like the repo's starter, and a press counts (${runtime})`, () => {
      const bin = join(app, "node_modules/@runex-js/svelte/bin/runex-svelte.js")
      // The starter has its own package.json, so the repo renders a copy inside this package,
      // where `@runex-js/svelte` resolves to src/.
      const repo_png = join(app, `repo${runtime}.png`)
      const copy = join(ROOT, ".tmp", `starter-${process.pid}`)
      mkdirSync(copy, { recursive: true })
      for (const f of ["App.svelte", "app.ts"]) copyFileSync(join(ROOT, "starter", f), join(copy, f))
      run("node", [join(ROOT, "bin/runex-svelte.js"), runtime, join(copy, "app.ts"), "--snap", repo_png], { cwd: ROOT })
      // The window title is the only difference, and a headless snap doesn't draw it.
      const log = run("node", [bin, runtime, "app.ts", "--snap", `app${runtime}.png`], { cwd: app })
      expect(log.split("\n").filter((l) => l && !l.startsWith("rune:"))).toEqual([])
      expect(sha256(join(app, `app${runtime}.png`))).toBe(sha256(repo_png))

      writeFileSync(join(app, "press.json"), JSON.stringify([{ t: 0.1, key: "plus" }, { t: 0.3, key: "plus" }, { t: 0.5, key: "minus" }]))
      run("node", [bin, runtime, "app.ts", "--script", "press.json", "--tree", `tree${runtime}.json`], { cwd: app })
      expect(readFileSync(join(app, `tree${runtime}.json`), "utf8")).toContain('"name": "1"')
    }, 60_000)
  }
})
