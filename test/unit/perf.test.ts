// The performance overlay's switches: `--perf[=MODE]`, `RUNEX_PERF` and `App.perf`, through
// fixtures/perf.ts (each run its own process, since the mode is read at start). Headless runs
// draw one frame here, which Rune reports to `on_frame_encoded` as a window's frames, so one stats
// call arrives; test/windowed checks the stats and log lines a real window sends each second.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "./lib/headless.ts"
import { fixture, TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("perf")
let n = 0

function perf(args: string[], env: Record<string, string | undefined> = {}) {
  const r = fixture("perf.ts", [...args, "--tree", join(tmp, `perf-${++n}.json`)], { env })
  expect(r.code).toBe(0)
  return r.result as { overlay: boolean; rune_extra: string[]; extra: string[]; stats: number }
}

describe("mode resolution", () => {
  test("RUNEX_PERF: 1 and overlay,log draw the overlay; log and empty don't", () => {
    expect(perf([], { RUNEX_PERF: "1" }).overlay).toBe(true)
    expect(perf([], { RUNEX_PERF: "overlay,log" }).overlay).toBe(true)
    expect(perf([], { RUNEX_PERF: "log" }).overlay).toBe(false)
    expect(perf([], { RUNEX_PERF: "" }).overlay).toBe(false)
    expect(perf([]).overlay).toBe(false)
  })

  test("--perf draws it, --perf=log doesn't, and the flag beats the environment", () => {
    expect(perf(["--perf"]).overlay).toBe(true)
    expect(perf(["--perf=overlay"]).overlay).toBe(true)
    expect(perf(["--perf=log"]).overlay).toBe(false)
    expect(perf(["--perf=log"], { RUNEX_PERF: "1" }).overlay).toBe(false)
    expect(perf(["--perf"], { RUNEX_PERF: "log" }).overlay).toBe(true)
  })

  test("App.perf with a stats callback beats RUNEX_PERF; perf('none') alone leaves it on (recorded)", () => {
    expect(perf([], { RUNEX_PERF: "1", FIXTURE_APP_PERF: "none", FIXTURE_STATS: "1" }).overlay).toBe(false)
    expect(perf([], { RUNEX_PERF: "1", FIXTURE_APP_PERF: "none" }).overlay).toBe(true)
    expect(perf([], { FIXTURE_APP_PERF: "overlay" }).overlay).toBe(true)
  })

  test("a headless run reports its frames to the stats callback, as Rune reports them to on_frame_encoded", () => {
    // One drawn frame (--tree renders frame 0): the first report, which needs no wait.
    expect(perf([], { FIXTURE_APP_PERF: "none", FIXTURE_STATS: "1" }).stats).toBe(1)
    expect(perf([], { FIXTURE_APP_PERF: "none" }).stats).toBe(0)
  })
})

describe("arguments", () => {
  test("--perf flags never reach Rune or extra_args(); the app's own flags do", () => {
    const r = perf(["--perf", "--mine"])
    expect(r.rune_extra).toEqual(["--mine"])
    expect(r.extra).toEqual(["--mine"])
    expect(perf(["--perf=overlay,log"]).rune_extra).toEqual([])
  })
})

describe("PerfStats", () => {
  test("the keys the declaration promises (snapshot)", () => {
    // Read from the shipped declaration (test/windowed checks the delivered object has these keys).
    const dts = readFileSync(fileURLToPath(import.meta.resolve("runex-js")).replace(/index\.js$/, "perf.d.ts"), "utf8")
    const body = dts.slice(dts.indexOf("export interface PerfStats"))
    const keys = [...body.slice(0, body.indexOf("\n}")).matchAll(/^\s+(\w+): /gm)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(10)
    expect(keys).toMatchSnapshot()
  })
})
