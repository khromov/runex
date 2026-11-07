// The binding layer at a glance: records, classes, enums, modules, live values and headless runs.
// The other files in test/unit go deeper into each; this one is the quick tour. Run with
// `bun test ./test/unit`.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync } from "node:fs"
import { App, AppSpec, Live, LiveText, Spring, TextStyle, col, color, el, oklch, row, text, tok } from "runex-js"
import { Button, Kit } from "runex-js/kit"
import { pngSize, snapOf, tempDir, texts, treeOf, writeScript } from "./lib/headless.ts"
import { fixture, TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("api")

describe("records", () => {
  test("Color is a plain object with Rust's fields and methods", () => {
    const c = oklch(0.5, 0.1, 250)
    expect(Object.keys(c).sort()).toEqual(["a", "b", "g", "r"])
    expect(c.a).toBe(1)
    const half = c.alpha(0.5)
    expect(half.a).toBe(0.5)
    expect(c.a).toBe(1) // value semantics: alpha() returns a new colour
    expect(color.hex("#ff0000")).toMatchObject({ r: 1, g: 0, b: 0, a: 1 })
    expect(color.hex("not a colour")).toBeNull()
  })

  test("struct literals and spreads work where Rust takes a record", () => {
    const shadow = { x: 0, y: 2, blur: 8, spread: 0, color: oklch(0, 0, 0).alpha(0.3), inset: false }
    expect(() => el().box_shadow(shadow)).not.toThrow()
    const spring = Spring.new(0.3, 0)
    expect({ ...spring }).toMatchObject({ duration: expect.any(Number), bounce: 0 })
  })
})

describe("classes", () => {
  test("Clone builders return new values; TextStyle chains like Rust", () => {
    const base = TextStyle.new(13, 400)
    const tall = base.lh(20)
    expect(tall.line_px()).toBe(20)
    expect(base.line_px()).toBeCloseTo(16.25)
  })

  test("an El moved into a parent can't be used again", () => {
    const child = text("hi")
    col().child(child)
    expect(() => child.key("again")).toThrow(/moved/)
  })

  test("wrong argument types name the parameter", () => {
    expect(() => el().size("wide" as any, 10)).toThrow(/w: expected a number/)
    expect(() => el().cursor("Sideways" as any)).toThrow(/Sideways/)
  })

  test("kit components build from the generated bindings", () => {
    const k = Kit.neutral(true)
    expect(() => row().child(Button.new("Save").build(k))).not.toThrow()
  })
})

describe("enums and modules", () => {
  test("unit variants are strings, modules are namespaces", () => {
    expect(() => row().child(el().cursor("Pointer"))).not.toThrow()
    expect(tok.motion.SNAPPY).toMatchObject({ duration: expect.any(Number) })
    expect(tok.type_.TITLE.line_px()).toBeGreaterThan(0)
  })
})

describe("live values", () => {
  test("Live keeps the kind of its first value", () => {
    const opacity = Live.new(0.5)
    expect(opacity.get()).toBe(0.5)
    expect(opacity.set(0.75)).toBe(true)
    expect(opacity.get()).toBe(0.75)
    expect(() => opacity.set([1, 2] as any)).toThrow(/kind/)
    const offset = Live.new([1, 2])
    expect(offset.get()).toEqual([1, 2])
    const label = LiveText.new("a")
    expect(label.set("b")).toBe(true)
    expect(label.get()).toBe("b")
    expect(() => el().live_opacity(opacity).live_offset(offset.smooth(Spring.new(0.3, 0)))).not.toThrow()
  })

  test("live values bind without re-running the view", () => {
    const fill = Live.new(oklch(0.5, 0.1, 30))
    expect(() => el().live_fill(fill.smooth(Spring.new(0.2, 0)))).not.toThrow()
    expect(() => el().live_fill(Live.new(0.5))).toThrow(/kind/)
  })
})

describe("headless runs", () => {
  test("--snap renders the view with its scene applied, at 2x", async () => {
    type S = { n: number }
    const view = (s: S) => col().w_full().h_full().center().fill(tok.theme(true).bg).child(text(`n = ${s.n}`).color(tok.theme(true).text))
    const app = App.new({ ...AppSpec.new<S>("Test", [160, 90], () => ({ n: 1 }), view), scenes: [["two", (s) => { s.n = 2 }]] })
    const { png, tree } = await snapOf(app, ["--scene", "two"], tmp)
    expect(existsSync(png)).toBe(true)
    expect(pngSize(png)).toEqual([320, 180])
    expect(texts(tree)).toEqual(["n = 2"])
    expect(tree.scale).toBe(2)
  })

  test("--tree reports the element tree", async () => {
    const tree = await treeOf(App.new(AppSpec.new("Tree", [100, 60], () => ({}), () => col().key("root").child(text("leaf").key("leaf")))), [], tmp)
    expect(tree.elements.map((e) => e.key)).toEqual(["root", "leaf"])
    expect(texts(tree)).toEqual(["leaf"])
  })

  test("a throwing view is reported, not swallowed", async () => {
    const run = App.new(AppSpec.new("Throws", [100, 60], () => ({}), () => {
      throw new Error("view broke")
    }))
      .args(["--snap", `${tmp}/throw.png`])
      .run()
    await expect(run).rejects.toThrow("view broke")
  })

  test("run_windows renders the window --window picks, each with its own state", () => {
    // In its own process: winit allows one event loop per process, and Rune prints the listing.
    expect(fixture("windows.ts", ["--list-windows"]).lines).toEqual(["a", "b"])
    const b = fixture("windows.ts", ["--window", "b", "--tree", `${tmp}/windows-b.json`])
    expect(b.code).toBe(0)
    expect(b.result.texts).toEqual(["bee"])
    expect(b.result.displays).toBe(1)
    const a = fixture("windows.ts", ["--window", "a", "--snap", `${tmp}/windows-a.png`, "--tree", `${tmp}/windows-a.json`])
    expect(a.code).toBe(0)
    expect(a.result.texts).toEqual(["aye"]) // window a carries an overlay; it isn't drawn into the snapshot
    expect(pngSize(`${tmp}/windows-a.png`)).toEqual([240, 160])
  })

  test("a handler may return a new primitive state", async () => {
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "n" }])
    const app = App.new(AppSpec.new<number>("Counter", [120, 80], () => 1, (n) => el().key("n").size(60, 30).on_press((n: number) => n + 1).child(text(`n=${n}`))))
    const tree = await treeOf(app, ["--script", script, "--at", "0.5"], tmp)
    expect(texts(tree)).toEqual(["n=2"])
  })

  test("the perf overlay draws in the view's root when it's on", async () => {
    const spec = () => AppSpec.new("Perf", [400, 240], () => ({}), () => col().key("root").w_full().h_full().child(text("app")))
    const on = await treeOf(App.new(spec()).perf("overlay"), [], tmp)
    const off = await treeOf(App.new(spec()), [], tmp)
    expect(JSON.stringify(on)).toContain("runex-perf")
    expect(JSON.stringify(off)).not.toContain("runex-perf")
  })

  test("a stats callback alone measures without drawing, and isn't called headless", async () => {
    // Stats arrive once a second from a window's frames; a headless run draws one frame, so the
    // callback never runs here (test/windowed checks delivery).
    let calls = 0
    const tree = await treeOf(App.new(AppSpec.new("Perf", [200, 120], () => ({}), () => text("app"))).perf("none", () => { calls++ }), [], tmp)
    expect(JSON.stringify(tree)).not.toContain("runex-perf")
    expect(texts(tree)).toEqual(["app"])
    expect(calls).toBe(0)
  })
})
