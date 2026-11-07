// Errors: what a throw in each JavaScript hook does to a headless `run()`, what a bad AppSpec or a
// wrong call says, and a snapshot of one conversion error per kind (bless a deliberate change
// with `bun test ./test/unit --update-snapshots`).
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { Anim, App, AppSpec, ClipboardImage, Color, Spring, TextStyle, el, text, type El } from "runex-js"
import { quietly, tempDir, writeScript } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("errors")
let n = 0
const tree = () => `${tmp}/tree-${++n}.json`

describe("a throw in a hook rejects run() with the original error", () => {
  const boom = (what: string) => new Error(`${what} broke`)

  test("the view", async () => {
    const error = boom("view")
    const run = App.new(AppSpec.new("View", [100, 60], () => ({}), () => { throw error })).args(["--tree", tree()]).run()
    await expect(run).rejects.toBe(error)
  })

  test("a handler run by --script", async () => {
    const view = () => el().key("b").size(50, 30).on_press(() => { throw boom("handler") })
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "b" }])
    await expect(App.new(AppSpec.new("Handler", [100, 60], () => ({}), view)).args(["--script", script, "--tree", tree()]).run()).rejects.toThrow("handler broke")
  })

  test("poll", async () => {
    const spec = { ...AppSpec.new("Poll", [100, 60], () => ({}), () => text("x")), poll: () => { throw boom("poll") } }
    await expect(App.new(spec).args(["--tree", tree()]).run()).rejects.toThrow("poll broke")
  })

  test("a scene function", async () => {
    const spec = { ...AppSpec.new("Scene", [100, 60], () => ({}), () => text("x")), scenes: [["bad", () => { throw boom("scene") }]] as [string, (s: object) => void][] }
    await expect(App.new(spec).args(["--scene", "bad", "--tree", tree()]).run()).rejects.toThrow("scene broke")
  })

  test("setup (which a headless run calls once)", async () => {
    let calls = 0
    const spec = { ...AppSpec.new("Setup", [100, 60], () => ({}), () => text("x")), setup: () => { calls++; throw boom("setup") } }
    await expect(App.new(spec).args(["--tree", tree()]).run()).rejects.toThrow("setup broke")
    expect(calls).toBe(1)
  })

  test("init and on_key", async () => {
    await expect(App.new(AppSpec.new("Init", [100, 60], () => { throw boom("init") }, () => text("x"))).args(["--tree", tree()]).run()).rejects.toThrow("init broke")
    const spec = { ...AppSpec.new("Key", [100, 60], () => ({}), () => text("x")), on_key: () => { throw boom("key") } }
    const script = writeScript(tmp, [{ t: 0.1, type: "key", name: "Enter" }])
    await expect(App.new(spec).args(["--script", script, "--tree", tree()]).run()).rejects.toThrow("key broke")
  })

  test("the first error rejects; later ones are printed with console.error", async () => {
    let calls = 0
    const view = () => el().key("b").size(50, 30).on_press(() => { throw new Error(`press ${++calls}`) })
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "b" }, { t: 0.3, type: "click", key: "b" }])
    const r = await quietly(() => App.new(AppSpec.new("Twice", [100, 60], () => ({}), view)).args(["--script", script, "--tree", tree()]).run())
    expect((r.error as Error).message).toBe("press 1")
    expect(calls).toBe(2)
    expect(r.printed.map((args) => String((args[0] as Error)?.message))).toEqual(["press 2"])
  })

  test("a view that returns something other than an El", async () => {
    const run = App.new(AppSpec.new("NotEl", [100, 60], () => ({}), () => 42 as unknown as El)).args(["--tree", tree()]).run()
    await expect(run).rejects.toThrow("the view returned something that isn't an El: expected a El")
  })
})

describe("bad specs and calls", () => {
  test("an AppSpec without a view, size or well-formed scenes says which", () => {
    const base = AppSpec.new("Spec", [100, 60], () => ({}), () => text("x"))
    expect(() => App.new({ ...base, view: undefined as any }).native).toThrow("AppSpec.view is required")
    expect(() => App.new({ ...base, size: undefined as any }).native).toThrow("AppSpec.size is required")
    expect(() => App.new({ ...base, scenes: [["only a name"]] as any }).native).toThrow("AppSpec.scenes entries are [name, (s) => void]")
    expect(() => App.new({ ...base, poll: 5 as any }).native).toThrow("AppSpec.poll must be a function")
  })

  test("an App runs once: a second run() rejects", async () => {
    const app = App.new(AppSpec.new("Once", [100, 60], () => ({}), () => text("x")))
    await app.args(["--tree", tree()]).run()
    await expect(app.run()).rejects.toThrow("this App has already started")
  })

  test("too few arguments name the first one missing; extra arguments are ignored (recorded)", () => {
    expect(() => (el() as any).size(10)).toThrow("h: expected a number")
    expect(() => (el() as any).size()).toThrow("w: expected a number")
    expect(() => (el() as any).size(10, 20, 30)).not.toThrow()
    expect(() => (TextStyle as any).new(13)).toThrow("weight: expected a number")
  })
})

describe("conversion error messages", () => {
  test("one per conversion kind (snapshot)", () => {
    const message = (f: () => unknown) => {
      try {
        f()
      } catch (e) {
        return (e as Error).message
      }
      return "(no error)"
    }
    const messages = {
      number: message(() => el().size("wide" as any, 10)),
      string: message(() => el().description(5 as any)),
      bool: message(() => el().focusable("yes" as any)),
      option: message(() => el().pin("left" as any, null, null, null)),
      array: message(() => Color.from_oklab([1, 2] as any)),
      tuple: message(() => el().strikes([[0] as any])),
      vec_element: message(() => el().strikes([[0, 1, null], ["a", 1, null]] as any)),
      duration: message(() => el().hover_delays(Infinity, 0)),
      unit_enum: message(() => el().cursor("Sideways" as any)),
      data_enum: message(() => Anim.new({ Bogus: 1 } as any)),
      enum_shape: message(() => Anim.new(5 as any)),
      enum_keys: message(() => Anim.new({ Spring: 1, Tween: 2 } as any)),
      record_field: message(() => Anim.from_Spring({ duration: 0.3 } as Spring)),
      class: message(() => el().child({} as El)),
      moved: message(() => {
        const c = text("c")
        el().child(c)
        c.key("x")
      }),
      function: message(() => el().on_press(5 as any)),
      bytes: message(() => ClipboardImage.from_png("png" as any)),
    }
    expect(messages).toMatchSnapshot()
  })
})
