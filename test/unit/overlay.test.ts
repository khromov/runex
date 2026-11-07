// Overlays (`OverlaySpec`, `ConfiguredOverlay`, `App.overlay`, `Story.overlay`): plain data the
// native side reads when the overlay is added. Headless runs render the app's window only.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { App, AppSpec, ConfiguredOverlay, OverlayOptions, OverlaySpec, Story, col, text } from "runex-js"
import { snapOf, tempDir, texts, treeOf } from "./lib/headless.ts"
import { fixture, TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("overlay")
const hud = () => OverlaySpec.new<number>("hud", [120, 30], (n) => text(`hud ${n}`).key("hud"))
const app = (title: string) => App.new(AppSpec.new(title, [160, 90], () => ({}), () => col().key("root").child(text("app"))))

describe("specs", () => {
  test("OverlaySpec.new has Rust's defaults: top edge, centred, click-through", () => {
    expect(hud()).toMatchObject({ name: "hud", size: [120, 30], edge: "Top", margin: 0, align: "Center", inset: 0, interactive: false })
    const custom = new OverlaySpec<number>({ name: "side", size: [40, 200], view: () => text("s"), edge: "Bottom", align: "End", inset: 12, interactive: true })
    expect(custom).toMatchObject({ edge: "Bottom", align: "End", inset: 12, interactive: true, margin: 0 })
  })

  test("options() gives a ConfiguredOverlay whose hooks chain and reach the native object", () => {
    const poll = () => false
    const options = new OverlayOptions({ follow_pointer: true })
    const c = hud().options(options).poll(poll).modifier_keys().animate_reveal().release_gpu_after(2).macos_level(3)
    expect(c).toBeInstanceOf(ConfiguredOverlay)
    expect(c.toNative()).toMatchObject({ spec: { name: "hud" }, options, poll, modifier_keys: true, animate_reveal: true, release_after: 2, macos_level: 3 })
    expect(ConfiguredOverlay.from(c)).toBe(c)
    expect(ConfiguredOverlay.from(hud())).toBeInstanceOf(ConfiguredOverlay)
  })

  test("App.overlay builds an overlay from a spec or a configured one and returns its handle", () => {
    const a = app("Overlay")
    const handle = a.overlay(hud(), 0)
    expect(typeof handle.show).toBe("function")
    expect(typeof handle.hide).toBe("function")
    const configured = a.overlay(hud().options(new OverlayOptions({ follow_pointer: true, prewarm: false })).on_key(() => false).setup(() => {}), 1)
    expect(typeof configured.fade_in).toBe("function")
  })

  test("Story.overlay frames an overlay's view", () => {
    expect(() => Story.overlay("hud story", hud(), () => 3)).not.toThrow()
  })
})

describe("errors", () => {
  test("an invalid size, edge or missing view says which field", () => {
    const a = app("Bad overlay")
    const bad = (patch: object) => () => a.overlay(Object.assign(hud(), patch), 0)
    expect(bad({ size: [120] })).toThrow("OverlaySpec.size: expected a 2-item array, got 1")
    expect(bad({ size: "big" })).toThrow("OverlaySpec.size: expected an array")
    expect(bad({ edge: "Middle" })).toThrow('OverlaySpec.edge: "Middle" isn\'t a ScreenEdge variant')
    expect(bad({ view: null })).toThrow("OverlaySpec.view is required")
    expect(bad({ interactive: "yes" })).toThrow("OverlaySpec.interactive")
  })

  test("an invalid OverlayOptions is dropped silently (recorded: src/manual/overlay.rs reads it with .ok())", () => {
    // The overlay is added without its options; an error naming the field would be better.
    const a = app("Bad options")
    expect(() => a.overlay(hud().options(new OverlayOptions({ level: "Sky" as any })), 0)).not.toThrow()
  })
})

describe("headless", () => {
  test("overlays are absent from --tree and --snap (recorded: the app's window renders alone)", async () => {
    const a = app("With overlay")
    a.overlay(hud(), 7)
    const tree = await treeOf(a, [], tmp)
    expect(texts(tree)).toEqual(["app"])
    expect(JSON.stringify(tree)).not.toContain("hud")
    const withOverlay = app("Snap")
    withOverlay.overlay(hud(), 7)
    const [on, off] = [await snapOf(withOverlay, [], tmp), await snapOf(app("Snap"), [], tmp)]
    expect(readFileSync(on.png).equals(readFileSync(off.png))).toBe(true)
  })

  test("an overlay on an App that becomes a WindowSpec.from_app window builds and runs", () => {
    const r = fixture("windows.ts", ["--window", "a", "--tree", `${tmp}/from-app.json`])
    expect(r.code).toBe(0)
    expect(r.result.texts).toEqual(["aye"])
  })
})
