// Multi-window apps (`run_windows`, `WindowSpec`, `--window`). The runs use fixtures/windows.ts in
// its own process: winit allows one event loop per process, Rune prints listings to stdout and
// exits on a bad `--window`, and window state depends on how many apps the process registered
// (see the last test).
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { App, AppSpec, WindowSpec, text } from "runex-js"
import { pngSize, tempDir } from "./lib/headless.ts"
import { fixture, TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("windows")
let n = 0
const out = (ext: string) => join(tmp, `out-${++n}.${ext}`)

// Runs fixtures/windows.ts with `args` (plus `--tree` unless it lists), once per distinct `args`:
// several tests read the same run.
const runs = new Map<string, ReturnType<typeof fixture>>()
function windows(...args: string[]) {
  const key = args.join(" ")
  if (!runs.has(key)) runs.set(key, fixture("windows.ts", args.some((a) => a.startsWith("--list-")) ? args : [...args, "--tree", out("json")]))
  return runs.get(key)!
}

describe("headless multi-window runs", () => {
  test("--list-windows prints the factory's keys in order", () => {
    const r = windows("--list-windows")
    expect(r.code).toBe(0)
    expect(r.lines).toEqual(["a", "b"])
  })

  test("--list-scenes lists the scenes of the window --window picks (the first by default)", () => {
    expect(windows("--window", "a", "--list-scenes").lines).toEqual(["loud"])
    expect(windows("--window", "b", "--list-scenes").lines).toEqual(["quiet", "calm"])
    expect(windows("--list-scenes").lines).toEqual(["loud"])
  })

  test("--window a and --window b each render their own state, size and scenes", () => {
    const a = windows("--window", "a")
    const b = windows("--window", "b")
    expect([a.code, b.code]).toEqual([0, 0])
    expect(a.result).toMatchObject({ texts: ["aye"], title: "A" })
    expect(b.result).toMatchObject({ texts: ["bee"], title: "B" })
    expect(windows("--window", "a", "--scene", "loud").result.texts).toEqual(["AYE"])
    expect(windows("--window", "b", "--scene", "calm").result.texts).toEqual(["bee."])
    const png = out("png")
    expect(fixture("windows.ts", ["--window", "b", "--snap", png]).code).toBe(0)
    expect(pngSize(png)).toEqual([280, 180])
  })

  test("without --window, the first window renders", () => {
    expect(windows().result.texts).toEqual(["aye"])
  })

  test("an unknown --window exits 2 and says how to list them", () => {
    const r = windows("--window", "zz")
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('no window "zz"; use --list-windows')
  })

  test("a scene the picked window lacks exits 2 and names that window's scenes", () => {
    const r = windows("--window", "b", "--scene", "loud")
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('no scene "loud"; scenes: quiet, calm')
  })

  test("the factory runs once and sees one virtual display", () => {
    const r = windows("--window", "b")
    expect(r.result).toMatchObject({ factory: 1, displays: 1 })
  })

  test("headless, on_created and on_ready never run; only the picked window's init and setup do", () => {
    // Documented, so a change in Rune shows here: the native window never exists headless.
    const a = windows("--window", "a")
    expect(a.result).toMatchObject({ created: [], ready: [], init: ["a"], setup: ["a"] })
    const b = windows("--window", "b")
    expect(b.result).toMatchObject({ created: [], ready: [], init: ["b"], setup: ["b"] })
    expect(windows("--list-windows").result).toMatchObject({ created: [], init: [], setup: [] })
  })

  test("the windows render alike on node", () => {
    const r = fixture("windows.ts", ["--window", "b", "--tree", out("json")], { runtime: "node" })
    expect(r.code).toBe(0)
    expect(r.result).toMatchObject({ texts: ["bee"], displays: 1 })
  })

  // Known bug (src/state.rs): `INITS` has 64 entries and `register` falls back to entry 0 past
  // them, so after 64 apps in one process a `WindowSpec.new` window starts from the first app's
  // state. It matters in long-lived processes (a test runner, hot reload). Remove `.failing` once
  // it is fixed.
  test.failing("a WindowSpec.new window keeps its own init after 64 apps in the process (known bug: it gets app 0's)", () => {
    expect(fixture("init-table.ts", ["10", "--window", "b", "--tree", out("json")]).result.texts).toEqual(["bee"])
    expect(fixture("init-table.ts", ["70", "--window", "b", "--tree", out("json")]).result.texts).toEqual(["bee"])
  })
})

describe("WindowSpec", () => {
  test("has its key, chains builders on itself, and boxed() is the same window", () => {
    const w = WindowSpec.new("k", AppSpec.new("K", [100, 60], () => ({}), () => text("k")))
    expect(w.key).toBe("k")
    expect(w.state({}).tab_visits_controls(true).srgb_blend(false)).toBe(w)
    expect(w.boxed()).toBe(w)
  })

  test("from_app takes the App: the App can't build again", () => {
    const app = App.new(AppSpec.new("Taken", [100, 60], () => ({}), () => text("t")))
    const w = WindowSpec.from_app("taken", app.native)
    expect(w.key).toBe("taken")
    expect(() => app.native.keep_running()).toThrow(/already started|moved into a WindowSpec/)
    expect(() => WindowSpec.from_app("again", app.native)).toThrow(/already started|moved into a WindowSpec/)
  })
})
