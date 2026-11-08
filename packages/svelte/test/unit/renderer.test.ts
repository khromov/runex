import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { flushSync, mount, unmount } from "svelte"
import renderer, { create_root } from "../../src/renderer.ts"
import { resolve } from "../../src/build.ts"
import { dispatch, rune_method } from "../../src/events.ts"
import { reset_warnings } from "../../src/css.ts"
import Counter from "../fixtures/Counter.svelte"
import Forward from "../fixtures/Forward.svelte"
import type { ShadowNode } from "../../src/types.ts"

let warn: ReturnType<typeof spyOn>
beforeEach(() => {
  reset_warnings()
  warn = spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

function render(Component: any, props: Record<string, unknown> = {}) {
  const root = create_root()
  const anchor = renderer.createComment("")
  renderer.insert(root, anchor, null)
  const component = mount(Component, { renderer, target: root, anchor, props }) as any
  flushSync()
  return { root, component }
}

function find(n: ShadowNode, key: string): ShadowNode | null {
  for (let c = n.first; c; c = c.next) {
    if (c.kind === "element" && c.attrs.key === key) return c
    const hit = find(c, key)
    if (hit) return hit
  }
  return null
}

function text(n: ShadowNode): string {
  let out = ""
  for (let c = n.first; c; c = c.next) out += c.kind === "text" ? c.data : c.kind === "element" ? text(c) : ""
  return out
}

function keys(n: ShadowNode): string[] {
  const out: string[] = []
  for (let c = n.first; c; c = c.next) if (c.kind === "element") out.push(String(c.attrs.key ?? c.name))
  return out
}

const press = (n: ShadowNode) => dispatch(n, [...n.listeners.keys()].filter((t) => rune_method(t) === "on_press_tx"), {}, [])

describe("the shadow tree", () => {
  test("mounts elements, text and attributes as Svelte sets them", () => {
    const { root, component } = render(Counter, { start: 1 })
    const box = root.first!.kind === "comment" ? root.first!.next! : root.first!
    expect(box.name).toBe("column")
    expect(box.attrs.gap).toBe(8)
    expect(String(box.attrs.class)).toMatch(/^box svelte-/)
    expect(text(find(root, "count")!)).toBe("Count: 1")
    expect(keys(box)).toEqual(["count", "inc", "item-a", "item-b", "item-c", "hidden"])
    unmount(component)
  })

  test("events update state, and the tree follows", () => {
    let seen = 0
    const { root, component } = render(Counter, { start: 1, onchange: (n: number) => (seen = n) })
    const inc = find(root, "inc")!
    expect(rune_method("press")).toBe("on_press_tx")
    expect(rune_method("click")).toBe("on_press_tx")
    press(inc)
    expect(seen).toBe(2)
    expect(text(find(root, "count")!)).toBe("Count: 2")
    expect(find(root, "big")).not.toBeNull()
    unmount(component)
  })

  test("keyed each moves and removes the same nodes", () => {
    const { root, component } = render(Counter)
    const box = find(root, "count")!.parent!
    const b = find(root, "item-b")
    component.reverse()
    flushSync()
    expect(keys(box)).toEqual(["count", "inc", "item-c", "item-b", "item-a", "hidden"])
    expect(find(root, "item-b")).toBe(b)
    component.drop("b")
    flushSync()
    expect(keys(box)).toEqual(["count", "inc", "item-c", "item-a", "hidden"])
    unmount(component)
  })

  test("unmount empties the root but the anchor", () => {
    const { root, component } = render(Counter)
    unmount(component)
    flushSync()
    expect(keys(root)).toEqual([])
  })
})

describe("resolve", () => {
  test("class rules then style then attributes, cached until an attribute changes", () => {
    const { root, component } = render(Counter, { start: 0 })
    const box = find(root, "count")!.parent!
    const r = resolve(box)
    expect(r.direction).toBeNull()
    expect(r.ops.map(([m]) => m)).toEqual(["pt", "pr", "pb", "pl", "fill", "gap"])
    expect(resolve(box)).toBe(r)
    expect(resolve(find(root, "hidden")!).hidden).toBe(true)

    const inc = find(root, "inc")!
    expect(resolve(inc).ops.map(([m]) => m)).toEqual(["hover"])
    press(inc)
    press(inc)
    press(inc)
    // class:active turned on: the `el.active` rule applies, and the cache was dropped.
    expect(resolve(inc).ops.map(([m]) => m)).toEqual(["opacity", "hover"])
    unmount(component)
  })
})

describe("attrs={...} forwarding", () => {
  test("forwards attributes and handlers, the element's own attributes win", () => {
    let pressed = 0
    const { root, component } = render(Forward, { gap: 9, w_full: true, onpress: () => pressed++ })
    const el = find(root, "fwd")!
    expect(el.attrs.gap).toBe(2)
    expect(el.attrs.w_full).toBe(true)
    expect(el.listeners.has("press")).toBe(true)
    press(el)
    expect(pressed).toBe(1)
    expect(renderer.getAttribute(el, "w_full")).toBeNull() // Svelte's own view: only what it set
    unmount(component)
  })
})
