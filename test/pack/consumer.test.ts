// The published package as a consumer installs it. The tarball from lib.ts's pack() is extracted
// into a temporary project's node_modules, with the built addon beside it (where native.cjs looks
// first) and vite and @types/node linked from the repo.
//
// - tsc (strict, NodeNext, skipLibCheck off) checks a file that imports every entry point and uses
//   their main types: the shipped declarations must type-check on their own.
// - node imports every entry point.
// - node and bun render examples/hello headless from the consumer. Each PNG must be byte-identical
//   to the repo's own render on the same runtime.
//
//   bun test ./test/pack/consumer.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { addonFile, cleanup, entries, pack, pkg, ROOT, run, tempDir } from "./lib.ts"

let dir = ""
let out = ""

/** Links the repo's node_modules/<name> into the consumer (a junction on Windows: no admin needed). */
function link(name: string) {
  const to = join(dir, "node_modules", ...name.split("/"))
  mkdirSync(join(to, ".."), { recursive: true })
  symlinkSync(join(ROOT, "node_modules", ...name.split("/")), to, "junction")
}

// Uses each entry point. A value or type an entry stops exporting fails tsc here, by name.
const CONSUMER_TS = `
import { AppSpec, Live, WindowSpec, col, el, run, run_windows, text, tok, type Compositor, type Cx, type El, type Frame, type LiveValue, type PerfStats } from "${pkg.name}"
import { Button, type Kit } from "${pkg.name}/kit"
import { Fx, run_with, type Plan } from "${pkg.name}/fx"
import { Light, type Settings } from "${pkg.name}/light"
import { Knobs, type Knob } from "${pkg.name}/knobs"
import { Animated, Spring, type Vec2 } from "${pkg.name}/motion"
import { FAMILIES, FONTS, icons } from "${pkg.name}/theme-opencode"
import runex, { type RunexOptions } from "${pkg.name}/vite"
import type { Plugin } from "vite"

type State = { on: boolean }

function view(s: State, _: Cx): El {
  const t = tok.theme(true)
  const knob = el().key("knob").size(18, 18).radius(9).fill(t.knob).absolute(s.on ? 18 : 2, 2)
  const sw = el().key("switch").role("switch").label("Lights").checked(s.on).focusable(true).size(38, 22).radius(11)
    .fill(s.on ? tok.accent(0, true) : t.control_off)
    .motion(tok.motion.SNAPPY)
    .on_press((s: State) => { s.on = !s.on })
    .child(knob)
  return col().w_full().h_full().center().gap(16).fill(t.bg).child(text(s.on ? "on" : "off").font(tok.type_.TITLE).color(t.text)).child(sw)
}

export const spec = AppSpec.new<State>("Consumer", [320, 200], () => ({ on: false }), view)
const options: RunexOptions = { entry: "./main.ts" }
export const plugin: Plugin = runex(options)
export const values = { run, run_windows, WindowSpec, Live, Button, Fx, run_with, Light, Knobs, Animated, Spring, FAMILIES, FONTS, icons }
export type Types = [Compositor, Frame, PerfStats, LiveValue, Kit, Plan, Settings, Knob, Vec2]
`

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    module: "NodeNext",
    moduleResolution: "NodeNext",
    target: "ES2023",
    lib: ["ES2023"],
    types: ["node"],
    skipLibCheck: false,
    noEmit: true,
  },
  include: ["consumer.ts"],
}

beforeAll(() => {
  const addon = addonFile()
  if (!addon || !existsSync(join(ROOT, addon))) {
    throw new Error(`no ${addon ?? `addon for ${process.platform}-${process.arch}`} in the repo: build it first (bun run build:native, or scripts/dev-install.sh)`)
  }
  const { tarball } = pack()
  dir = tempDir("consumer")
  out = tempDir("consumer-out")
  const installed = join(dir, "node_modules", ...pkg.name.split("/"))
  mkdirSync(installed, { recursive: true })
  run("tar", ["-xzf", tarball, "-C", installed, "--strip-components", "1"], { cwd: dir })
  copyFileSync(join(ROOT, addon), join(installed, addon))
  link("vite")
  link("@types/node")
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }, null, 2))
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2))
  writeFileSync(join(dir, "consumer.ts"), CONSUMER_TS)
  const imports = entries().map((e) => `${JSON.stringify(e.specifier)}: Object.keys(await import(${JSON.stringify(e.specifier)})).length`)
  writeFileSync(join(dir, "consumer.mjs"), `console.log(JSON.stringify({ ${imports.join(", ")} }))\n`)
  copyFileSync(join(ROOT, "examples", "hello", "main.ts"), join(dir, "hello.ts"))
}, 120_000)
afterAll(cleanup)

describe(`a project that installs ${pkg.name}`, () => {
  test("type-checks against the shipped declarations (strict, NodeNext, skipLibCheck off)", () => {
    const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc")
    const r = spawnSync("node", [tsc, "-p", join(dir, "tsconfig.json")], { cwd: dir, encoding: "utf8" })
    expect(r.stdout + r.stderr).toBe("")
    expect(r.status).toBe(0)
  }, 60_000)

  test("imports every entry point under node", () => {
    const counts = JSON.parse(run("node", ["consumer.mjs"], { cwd: dir })) as Record<string, number>
    expect(Object.keys(counts)).toEqual(entries().map((e) => e.specifier))
    expect(Object.entries(counts).filter(([, n]) => n === 0)).toEqual([])
  }, 60_000)

  for (const runtime of ["node", "bun"]) {
    test(`renders examples/hello headless under ${runtime}, byte-identical to the repo's render`, () => {
      const args = ["--snap", "", "--scene", "on"]
      args[1] = join(out, `consumer-${runtime}.png`)
      run(runtime, ["hello.ts", ...args], { cwd: dir })
      args[1] = join(out, `repo-${runtime}.png`)
      run(runtime, [join("examples", "hello", "main.ts"), ...args], { cwd: ROOT })
      const consumer = readFileSync(join(out, `consumer-${runtime}.png`))
      expect(consumer.subarray(1, 4).toString()).toBe("PNG")
      expect(consumer.equals(readFileSync(join(out, `repo-${runtime}.png`)))).toBe(true)
    }, 60_000)
  }
})
