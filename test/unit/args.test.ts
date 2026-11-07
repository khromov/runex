// The process's arguments, as runex passes them on. `extra_args()` leaves out what the runtime
// put before the script (`node --no-warnings`, `bun run --smol`) and the script's path, as a Rust
// binary's arguments never have them, and runex's own `--perf` and `--titlebar`. The titlebar
// switch: `--titlebar`, `--titlebar=native` or RUNEX_TITLEBAR=native; an unknown value warns,
// once a process. Each case runs fixtures/args.ts in a process of its own, since runex reads the
// switch as it loads. test/devflow covers a `bun build --compile` binary and a `bun --hot` save.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { tempDir } from "./lib/headless.ts"
import { fixture, TIMEOUT, type Runtime } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("args")
const hasNode = spawnSync("node", ["--version"]).status === 0
const runtimes: Runtime[] = hasNode ? ["bun", "node"] : ["bun"]
let n = 0

type Args = { early: string[] | null; extra: string[]; inset: number; warnings: string[] }

/** fixtures/args.ts, headless, with the runtime's `flags` before it and `args` after. */
function run(runtime: Runtime, flags: string[], args: string[], env: Record<string, string> = {}): Args {
  const r = fixture("args.ts", ["--tree", join(tmp, `args-${++n}.json`), ...args], { runtime, runtimeArgs: flags, env })
  expect(r.code, r.stderr).toBe(0)
  return { ...r.result, warnings: r.stderr.split("\n").filter((l) => l.startsWith("runex: ")) }
}

// The runtime's own flags in each form: one, two, and Bun's `run` around one.
const FLAGS: Record<Runtime, string[][]> = {
  node: [["--no-warnings"], ["--no-warnings", "--stack-size=4000"]],
  bun: [["--smol"], ["run", "--smol"], ["--smol", "run"]],
}

describe("extra_args", () => {
  for (const rt of runtimes) {
    for (const flags of FLAGS[rt]) {
      test(`${rt} ${flags.join(" ")}: neither the flags nor the script's path, before or after the run`, () => {
        const r = run(rt, flags, ["a", "--b", "c"], { FIXTURE_EARLY: "1" })
        expect({ early: r.early, extra: r.extra }).toEqual({ early: ["a", "--b", "c"], extra: ["a", "--b", "c"] })
      })
    }

    test(`${rt}: Rune's flags and runex's --perf and --titlebar[=X] aren't the app's`, () => {
      const args = ["--perf=log", "a", "--titlebar", "--at", "0", "--titlebar=native", "b", "--perf"]
      const r = run(rt, [], args, { FIXTURE_EARLY: "1" })
      expect({ early: r.early, extra: r.extra }).toEqual({ early: ["a", "b"], extra: ["a", "b"] })
    })
  }

  test("an argument that names the script, after it, is the app's", () => {
    const script = join(import.meta.dir, "fixtures", "args.ts")
    expect(run("bun", ["--smol"], [script, "x"], { FIXTURE_EARLY: "1" }).early).toEqual([script, "x"])
  })
})

// Headless, the inset is the traffic lights' trailing edge (Rune's `Chrome::titlebar_inset`, 67 pt
// with its default frame) on every platform, and 0 for a standard titled window.
describe("the titlebar switch", () => {
  const DEFAULT = 67

  test("--titlebar, --titlebar=native and RUNEX_TITLEBAR=native give the standard titlebar", () => {
    expect(run("bun", [], []).inset).toBe(DEFAULT)
    expect(run("bun", [], ["--titlebar"]).inset).toBe(0)
    expect(run("bun", [], ["--titlebar=native"]).inset).toBe(0)
    expect(run("bun", [], [], { RUNEX_TITLEBAR: "native" }).inset).toBe(0)
  })

  test("the last flag beats the variable; an unknown value warns and keeps Rune's", () => {
    const flag = run("bun", [], ["--titlebar=nativ"], { RUNEX_TITLEBAR: "native" })
    expect(flag).toMatchObject({ inset: DEFAULT, warnings: ["runex: --titlebar=nativ isn't known (use --titlebar); keeping Rune's titlebar"] })
    expect(run("bun", [], ["--titlebar=x", "--titlebar"]).inset).toBe(0)
    const env = run("bun", [], [], { RUNEX_TITLEBAR: "1" })
    expect(env).toMatchObject({ inset: DEFAULT, warnings: ["runex: RUNEX_TITLEBAR=1 isn't known (use native); keeping Rune's titlebar"] })
  })

  // Node evaluates a module again for a new query string, as `bun --hot` does on a save (Bun's
  // import cache ignores the query; test/devflow checks a real `bun --hot` session).
  test.skipIf(!hasNode)("a second evaluation of runex's app module doesn't warn again (node)", () => {
    const r = run("node", [], [], { RUNEX_TITLEBAR: "bogus", FIXTURE_RELOAD: "1" })
    expect(r.warnings).toEqual(["runex: RUNEX_TITLEBAR=bogus isn't known (use native); keeping Rune's titlebar"])
  })
})
