// Rust's ownership as JavaScript sees it: values moved into Rust can't be used again, builders on
// classes change the instance in place, records and Clone classes keep value semantics, shared
// constants are copied on use, and dropped instances are collected without breaking later runs.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { App, AppSpec, Spring, TextStyle, col, el, row, text, tok } from "runex-js"
import { Button, Kit, Tooltip } from "runex-js/kit"
import { tempDir, texts, treeOf } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("ownership")
const MOVED = /was moved \(into a parent, or by a method that consumes it\) and can't be used again/

describe("moves", () => {
  test("an element moved into a parent can't be used again, as a child or by its builders", () => {
    const child = text("hi")
    const parent = col().child(child)
    expect(() => child.key("again")).toThrow(MOVED)
    expect(() => row().child(child)).toThrow(/child: this El was moved/)
    expect(() => parent.key("still mine")).not.toThrow()
  })

  test("a builder consumed by build() can't build again", () => {
    const k = Kit.neutral(true)
    const button = Button.new("Save")
    expect(() => button.build(k)).not.toThrow()
    expect(() => button.build(k)).toThrow(/this Button was moved/)
    expect(() => button.disabled(true)).toThrow(/this Button was moved/)
  })

  test("a class passed by value is moved: the caller's instance is spent", () => {
    const trigger = el().key("t").size(10, 10)
    Tooltip.new("tip").trigger(trigger)
    expect(() => trigger.key("x")).toThrow(/this El was moved/)
  })

  test("a failed call leaves the instance usable", () => {
    const e = el()
    expect(() => e.size("wide" as any, 10)).toThrow(/w: expected a number/)
    expect(() => e.size(10, 10).key("ok")).not.toThrow()
  })
})

describe("builders and values", () => {
  test("builders on non-Copy classes return the same instance", () => {
    const e = el()
    expect(e.key("a")).toBe(e)
    expect(e.size(10, 10).fill(tok.theme(true).bg)).toBe(e)
    const b = Button.new("Go")
    expect(b.disabled(false).help("Goes")).toBe(b)
  })

  test("Clone classes return new values from builders, and clone() is independent", () => {
    const base = TextStyle.new(13, 400)
    const tall = base.lh(20)
    expect(tall).not.toBe(base)
    expect([base.line_px(), tall.line_px()]).toEqual([Math.fround(16.25), 20])
    const copy = base.clone()
    expect(copy).not.toBe(base)
    expect(copy.size).toBe(13)
  })

  test("records are copied in and out: changing one never changes another", () => {
    const s = Spring.new(0.3, 0)
    const longer = s.with_duration(0.5)
    expect(s.duration).toBe(Math.fround(0.3))
    expect(longer.duration).toBe(0.5)
    const spread = { ...s }
    spread.duration = 9
    expect(s.duration).toBe(Math.fround(0.3))
  })

  test("shared constants are copied on use, never moved or changed", () => {
    const title = tok.type_.TITLE
    expect(tok.type_.TITLE).toBe(title) // the module keeps one instance
    const before = title.line_px()
    const wide = title.lh(40)
    expect(wide.line_px()).toBe(40)
    expect(tok.type_.TITLE.line_px()).toBe(before)
    // Used twice by value: neither use moves it.
    expect(() => col().child(text("a").font(title)).child(text("b").font(title))).not.toThrow()
    expect(tok.type_.TITLE.size).toBe(title.size)
  })

  test("record constants are plain objects, shared and not frozen: copy one before changing it", () => {
    // Recorded, not endorsed: `tok.motion.SNAPPY.duration = 1` would change it for the whole
    // process. Passing one to Rust copies it, so Rust never changes it.
    const snappy = tok.motion.SNAPPY
    expect(tok.motion.SNAPPY).toBe(snappy)
    expect(Object.isFrozen(snappy)).toBe(false)
    const before = { ...snappy }
    el().motion(snappy)
    expect({ ...tok.motion.SNAPPY }).toEqual(before)
  })
})

describe("garbage collection", () => {
  test("100k dropped elements are collected and a headless run still works", async () => {
    let kept = 0
    for (let i = 0; i < 100_000; i++) {
      const e = el().key(`k${i % 100}`).size(i % 50, 10)
      if (i % 10_000 === 0) kept += e ? 1 : 0
    }
    for (let i = 0; i < 1_000; i++) col().child(text(`t${i}`)).child(el())
    if (typeof Bun !== "undefined") Bun.gc(true)
    expect(kept).toBe(10)
    const tree = await treeOf(App.new(AppSpec.new("After GC", [120, 60], () => ({}), () => col().key("root").child(text("still here")))), [], tmp)
    expect(texts(tree)).toEqual(["still here"])
  })
})
