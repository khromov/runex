// Live values (`rune::Live`, `LiveText`, `Binding`, `Tween`, `El.live_*`): values other code changes
// and bound elements follow without re-running the view.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { App, AppSpec, Binding, Live, LiveText, Spring, Tween, col, el, oklch, text, tok, type Tx } from "runex-js"
import { byKey, tempDir, texts, treeOf, writeScript } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("live")
const KIND = /kind/

describe("Live", () => {
  test("keeps the kind of its first value: a number, [x, y], [a, b, c, d] or a Color", () => {
    expect(Live.new(0.5).get()).toBe(0.5)
    expect(Live.new([1, 2]).get()).toEqual([1, 2])
    expect(Live.new([1, 2, 3, 4]).get()).toEqual([1, 2, 3, 4])
    const c = oklch(0.6, 0.1, 30)
    const color = Live.new(c).get()
    expect(color).toMatchObject({ r: c.r, g: c.g, b: c.b, a: 1 })
    expect(() => Live.new("text" as any)).toThrow()
  })

  test("set returns whether the value changed, and a value of another kind throws", () => {
    const v = Live.new(0.5)
    expect(v.set(0.5)).toBe(false)
    expect(v.set(0.75)).toBe(true)
    expect(v.set(0.75)).toBe(false)
    expect(v.snap(0.25)).toBe(true)
    expect(v.get()).toBe(0.25)
    expect(() => v.set([1, 2] as any)).toThrow(KIND)
    expect(() => Live.new([1, 2]).set(1)).toThrow(KIND)
    expect(() => Live.new(oklch(0.5, 0.1, 0)).set([1, 2, 3, 4])).toThrow(KIND)
  })

  test("clone() shares the value", () => {
    const v = Live.new(1)
    const w = v.clone()
    v.set(2)
    expect(w.get()).toBe(2)
    const label = LiveText.new("a")
    const other = label.clone()
    expect(label.set("a")).toBe(false)
    expect(label.set("b")).toBe(true)
    expect(other.get()).toBe("b")
  })

  test("smooth gives a Binding, Tween.linear a Tween; a binding is used once", () => {
    const smoothed = Live.new(0.5).smooth(Spring.new(0.3, 0))
    expect(smoothed).toBeInstanceOf(Binding)
    const rested = smoothed.rest(Spring.new(0.5, 0))
    expect(rested).toBeInstanceOf(Binding)
    expect(() => smoothed.rest(Spring.new(0.5, 0))).toThrow("this Binding was already used")
    const tween = Tween.linear(0, 1, 0.5)
    expect(tween).toBeInstanceOf(Tween)
    expect(() => el().live_opacity(rested).live_scale(tween)).not.toThrow()
    expect(() => el().live_opacity(rested)).toThrow("this Binding was already used")
  })

  test("bindings check the kind of the property they bind", () => {
    expect(() => el().live_offset(Live.new([0, 0]).smooth(Spring.new(0.2, 0)))).not.toThrow()
    expect(() => el().live_fill(Live.new(oklch(0.5, 0.1, 30)))).not.toThrow()
    expect(() => el().live_rect(Live.new([0, 0, 10, 10]))).not.toThrow()
    expect(() => el().live_fill(Live.new(0.5))).toThrow(KIND)
    expect(() => el().live_offset(Live.new(0.5))).toThrow(KIND)
    expect(() => el().live_text(Live.new(0.5) as any)).toThrow()
  })
})

describe("headless", () => {
  test("a Live set before the run shows in the tree's opacity and fill", async () => {
    const opacity = Live.new(1)
    const fill = Live.new(oklch(0.5, 0.1, 30))
    opacity.set(0.25)
    fill.set(tok.theme(true).text)
    const label = LiveText.new("before")
    label.set("after")
    const view = () => col().key("root").w_full().h_full()
      .child(el().key("box").size(40, 40).fill(oklch(0.5, 0.1, 30)).live_opacity(opacity).live_fill(fill))
      .child(text("").key("label").live_text(label))
    const tree = await treeOf(App.new(AppSpec.new("Live", [100, 80], () => ({}), view)), [], tmp)
    const box = byKey(tree, "box")!
    expect(box.opacity).toBe(0.25)
    const reference = await treeOf(App.new(AppSpec.new("Ref", [100, 80], () => ({}), () => col().key("root").child(el().key("box").size(40, 40).fill(tok.theme(true).text)))), [], tmp)
    expect(box.fill).toBe(byKey(reference, "box")!.fill)
    expect(JSON.stringify(tree)).toContain("after")
  })

  test("a Live set from a handler changes the tree without re-running the view", async () => {
    const opacity = Live.new(1)
    let views = 0
    const view = () => {
      views++
      return col().key("root").w_full().h_full()
        .child(el().key("box").size(40, 40).fill(tok.theme(true).text).live_opacity(opacity))
        .child(el().key("press").size(40, 20).on_press_tx((_s: object, tx: Tx) => {
          opacity.set(0.5)
          tx.live_only()
        }))
    }
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "press" }])
    const tree = await treeOf(App.new(AppSpec.new("LiveOnly", [100, 80], () => ({}), view)), ["--script", script, "--at", "0.5"], tmp)
    expect(byKey(tree, "box")!.opacity).toBe(0.5)
    // The view ran for the first frame only: the press changed nothing it reads.
    expect(views).toBe(1)
  })

  test("a state change does re-run the view (the counter above counts views)", async () => {
    let views = 0
    const view = (s: { n: number }) => {
      views++
      return col().key("root").child(el().key("press").size(40, 20).on_press((s: { n: number }) => { s.n++ }).child(text(`n ${s.n}`)))
    }
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "press" }])
    const tree = await treeOf(App.new(AppSpec.new("Rerun", [100, 80], () => ({ n: 0 }), view)), ["--script", script, "--at", "0.5"], tmp)
    expect(texts(tree)).toEqual(["n 1"])
    expect(views).toBe(2)
  })
})
