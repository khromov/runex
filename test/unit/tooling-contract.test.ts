// Rune's tooling flags, as runex apps and the test harnesses (scripts/compare.ts, golden) use them,
// on a tiny fixture (fixtures/tooling.ts). When Rune renames or drops a flag it stops working
// silently: Rune passes an unknown flag on to the app. Each test here makes a flag change the
// output, so a flag that stops working fails. Every run is its own process: Rune exits the
// process on a bad value.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { byKey, pngSize, readTree, tempDir, texts, writeScript } from "./lib/headless.ts"
import { fixture, TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("tooling")
let n = 0
const out = (ext: string) => join(tmp, `out-${++n}.${ext}`)

/** Runs the fixture with `args` plus `--tree`, and returns the tree. */
function tree(args: string[]) {
  const path = out("json")
  const r = fixture("tooling.ts", [...args, "--tree", path])
  expect(r.code).toBe(0)
  return readTree(path)
}

describe("listings", () => {
  test("--list-scenes prints every scene, those named rune-* too, in order", () => {
    const r = fixture("tooling.ts", ["--list-scenes"])
    expect(r.code).toBe(0)
    expect(r.lines).toEqual(["a", "b", "rune-x"])
  })

  test("--list-windows prints main for a single-window app", () => {
    expect(fixture("tooling.ts", ["--list-windows"]).lines).toEqual(["main"])
  })
})

describe("flags change the output", () => {
  test("--scene a and --scene b give different trees", () => {
    expect(texts(tree(["--scene", "a"]))).toContain("scene a")
    expect(texts(tree(["--scene", "b"]))).toContain("scene b")
    expect(texts(tree(["--scene", "rune-x"]))).toContain("scene rune-x")
  })

  test("--at moves the virtual clock: a spring is closed at 0, mid-way at 0.1, open at 1", () => {
    const at = (t: string) => tree(["--at", t])
    const [t0, t1, t10] = [at("0"), at("0.1"), at("1")]
    expect([t0.t, t1.t, t10.t]).toEqual([0, 0.1, 1])
    const w = (t: typeof t0) => byKey(t, "bar")!.rect[2]
    expect(w(t0)).toBe(20)
    expect(w(t1)).toBeGreaterThan(20)
    expect(w(t1)).toBeLessThan(200)
    expect(w(t10)).toBe(200)
  })

  test("--theme light and dark differ in fill", () => {
    const dark = tree([])
    const light = tree(["--theme", "light"])
    expect(dark.dark_system).toBe(true)
    expect(light.dark_system).toBe(false)
    expect(byKey(light, "root")!.fill).not.toBe(byKey(dark, "root")!.fill)
  })

  test("--scale 1 halves the PNG's dimensions; --size sets the viewport", () => {
    const [two, one, sized] = [out("png"), out("png"), out("png")]
    expect(fixture("tooling.ts", ["--snap", two]).code).toBe(0)
    expect(fixture("tooling.ts", ["--snap", one, "--scale", "1"]).code).toBe(0)
    expect(fixture("tooling.ts", ["--snap", sized, "--size", "100x50"]).code).toBe(0)
    expect(pngSize(two)).toEqual([480, 320])
    expect(pngSize(one)).toEqual([240, 160])
    expect(pngSize(sized)).toEqual([200, 100])
  })
})

describe("the --tree dump", () => {
  test("keeps the fields the harnesses read", () => {
    const t = tree(["--scene", "a"])
    expect(t).toMatchObject({ title: "Tooling", viewport: [240, 160], scale: 2, t: 0 })
    for (const field of ["accessibility", "animating", "dark_system", "elements", "reduced_motion", "warnings"]) expect(t).toHaveProperty(field)
    const scene = byKey(t, "scene")!
    expect(scene).toMatchObject({ key: "scene", path: "root/scene", text: "scene a", role: "text" })
    expect(scene.rect).toHaveLength(4)
    expect(byKey(t, "root")!.fill).toMatch(/^#[0-9a-f]{8}$/)
  })
})

describe("--script", () => {
  test("a click presses, typed text and named keys reach on_key, a drag moves", () => {
    const script = writeScript(tmp, [
      { t: 0.1, type: "click", key: "button" },
      { t: 0.3, type: "type", text: "x" },
      { t: 0.4, type: "key", name: "Enter" },
      { t: 0.5, type: "drag", key: "pad", dx: 30, dy: 5, dur: 0.2 },
    ])
    const path = out("json")
    const r = fixture("tooling.ts", ["--script", script, "--tree", path])
    expect(r.code).toBe(0)
    expect(r.result.state).toMatchObject({ n: 1, keys: ['{"Text":"x"}', "Enter"], drag: [30, 5] })
    expect(r.result.state.drags).toBeGreaterThan(2)
    expect(texts(readTree(path))).toContain("n 1")
  })
})

describe("frames and traces", () => {
  test("--frames N --out DIR writes N frames", () => {
    const dir = join(tmp, "frames")
    expect(fixture("tooling.ts", ["--frames", "5", "--out", dir]).code).toBe(0)
    expect(readdirSync(dir).sort()).toEqual(["frame_0000.png", "frame_0001.png", "frame_0002.png", "frame_0003.png", "frame_0004.png"])
    expect(pngSize(join(dir, "frame_0004.png"))).toEqual([480, 320])
  })

  test("a normalized --trace is the same across two runs", () => {
    // Timings (`quality`) vary run to run; everything else is the virtual clock's.
    const normalize = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((line) => {
      const frame = JSON.parse(line)
      delete frame.quality
      if (Array.isArray(frame.g)) frame.g.sort()
      return JSON.stringify(frame)
    })
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "button" }, { t: 0.3, type: "drag", key: "pad", dx: 20, dy: 0 }])
    const [a, b] = [out("jsonl"), out("jsonl")]
    expect(fixture("tooling.ts", ["--script", script, "--trace", a]).code).toBe(0)
    expect(fixture("tooling.ts", ["--script", script, "--trace", b]).code).toBe(0)
    const first = normalize(a)
    expect(first.length).toBeGreaterThan(30)
    expect(JSON.parse(first[0]!)).toMatchObject({ type: "header", clock: "virtual", width: 240, height: 160 })
    expect(normalize(b)).toEqual(first)
  })
})

describe("bad and unknown arguments", () => {
  test("an unknown flag is passed on to the app and the run succeeds (recorded: a change in Rune's parser shows here)", () => {
    const path = out("json")
    const r = fixture("tooling.ts", ["--no-such-flag", "--tree", path])
    expect(r.code).toBe(0)
    expect(r.result.extra).toEqual(["--no-such-flag"])
    expect(existsSync(path)).toBe(true)
  })

  test("an unknown --scene exits 2 and names the scenes", () => {
    const r = fixture("tooling.ts", ["--scene", "nope", "--tree", out("json")])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('no scene "nope"; scenes: a, b, rune-x')
  })

  test("a malformed value exits 2 with the flag's usage", () => {
    const r = fixture("tooling.ts", ["--size", "wide", "--snap", out("png")])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain("--size is WxH")
  })
})
