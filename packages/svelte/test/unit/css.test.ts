import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { generation, length, merge, parse_declarations, reset_vars, reset_warnings, set_vars, substitute, translate, type Declarations } from "../../src/css.ts"

let warn: ReturnType<typeof spyOn>
beforeEach(() => {
  reset_warnings()
  reset_vars()
  warn = spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

const decls = (css: string): Declarations => {
  const d: Declarations = new Map()
  merge(d, parse_declarations(css))
  return d
}
const ops = (css: string) => translate(decls(css)).ops
/** Colours as rounded arrays, so ops compare as plain data. */
const plain = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(plain) : v && typeof v === "object" && "r" in v ? [(v as any).r, (v as any).g, (v as any).b, (v as any).a].map((x: number) => Math.round(x * 1000) / 1000) : v

describe("parse_declarations", () => {
  test("splits at top-level semicolons, lowercases names, strips !important and comments", () => {
    expect(parse_declarations("Color: red; background: rgb(1, 2, 3) !important; /* x: y */ gap:4px;;")).toEqual([
      ["color", "red"],
      ["background", "rgb(1, 2, 3)"],
      ["gap", "4px"],
    ])
  })
})

describe("merge", () => {
  test("later wins, and a shorthand clears the longhands before it", () => {
    const d = decls("padding-left: 4px; padding: 8px; color: red; color: blue")
    expect([...d]).toEqual([
      ["padding", "8px"],
      ["color", "blue"],
    ])
  })
})

describe("translate", () => {
  test("lengths: px, rem, bare numbers", () => {
    expect(length("12px")).toBe(12)
    expect(length("1.5rem")).toBe(24)
    expect(length("0")).toBe(0)
    expect(length("50%")).toBeNull()
    expect(length("2em")).toBeNull()
  })

  test("sizes", () => {
    expect(ops("width: 100%; height: 40px; min-width: 10px; max-height: 2rem")).toEqual([
      ["w_full", []],
      ["h", [40]],
      ["min_w", [10]],
      ["max_h", [32]],
    ])
    expect(ops("width: 25%")).toEqual([["w_frac", [0.25]]])
  })

  test("box shorthands expand in CSS order", () => {
    expect(ops("padding: 12px")).toEqual([["padding", [12]]])
    expect(ops("padding: 1px 2px 3px 4px")).toEqual([["pt", [1]], ["pr", [2]], ["pb", [3]], ["pl", [4]]])
    expect(ops("padding: 0 12px")).toEqual([["pt", [0]], ["pr", [12]], ["pb", [0]], ["pl", [12]]])
    expect(ops("margin: 4px 8px")).toEqual([["mt", [4]], ["mr", [8]], ["mb", [4]], ["ml", [8]]])
    expect(ops("padding-left: 3px; margin-top: 2px")).toEqual([["pl", [3]], ["mt", [2]]])
  })

  test("flexbox", () => {
    const t = translate(decls("display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 8px 4px; flex: 1; flex-wrap: wrap; align-self: end"))
    expect(t.direction).toBe("col")
    expect(t.ops).toEqual([["items_center", []], ["justify_between", []], ["gaps", [8, 4]], ["grow", [1]], ["shrink", []], ["flex_wrap", []], ["self_end", []]])
  })

  test("display: none hides", () => {
    expect(translate(decls("display: none")).hidden).toBe(true)
  })

  test("fill, gradient, border, radius, shadow, opacity", () => {
    expect(plain(ops("background: #ff0000"))).toEqual([["fill", [[1, 0, 0, 1]]]])
    const g = ops("background: linear-gradient(to right, #000, #fff)")
    expect(g[0]![0]).toBe("linear_gradient")
    expect(g[0]![1][0]).toBeCloseTo(Math.PI / 2)
    expect(plain(g[0]![1][1])).toEqual([[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]])
    expect(plain(ops("border: 1px solid #fff"))).toEqual([["border", [1, [1, 1, 1, 1]]]])
    expect(plain(ops("border-width: 2px; border-color: black"))).toEqual([["border", [2, [0, 0, 0, 1]]]])
    expect(ops("border-radius: 6px")).toEqual([["radius", [6]]])
    expect(ops("border-radius: 1px 2px 3px 4px")).toEqual([["corners", [[1, 2, 3, 4]]]])
    expect(ops("border-radius: 50%")).toEqual([["radius", [1e4]]])
    const s = ops("box-shadow: 0 2px 8px rgba(0,0,0,0.5)")[0]!
    expect(s[0]).toBe("box_shadow")
    expect({ ...(s[1][0] as object), color: undefined }).toMatchObject({ x: 0, y: 2, blur: 8, spread: 0, inset: false })
    expect(ops("opacity: 0.5; opacity: 40%")).toEqual([["opacity", [0.4]]])
  })

  test("text properties are inherited props, not ops", () => {
    const t = translate(decls("color: white; font-size: 20px; font-weight: bold; line-height: 1.5; letter-spacing: 0.1em; font-family: 'Fira Code', monospace; font-style: italic; text-align: center"))
    expect(t.ops).toEqual([])
    expect(plain(t.text.color)).toEqual([1, 1, 1, 1])
    expect({ ...t.text, color: undefined }).toEqual({ color: undefined, size: 20, weight: 700, line_factor: 1.5, tracking_em: 0.1, family: "'Fira Code', monospace", italic: true, align: "Center" })
  })

  test("positioning", () => {
    expect(ops("position: absolute; left: 4px; top: 8px")).toEqual([["absolute", [4, 8]]])
    expect(ops("position: absolute; right: 0; bottom: 10px")).toEqual([["pin", [null, null, 0, 10]]])
    expect(ops("position: relative; left: 3px")).toEqual([["offset", [3, 0]]])
  })

  test("overflow, cursor, transform, filters, text shaping", () => {
    expect(ops("overflow: auto")).toEqual([["scroll", [{ stick_bottom: false }]]])
    expect(ops("overflow-x: scroll")).toEqual([["scroll_x", []]])
    expect(ops("cursor: pointer")).toEqual([["cursor", ["Pointer"]]])
    const t = ops("transform: scale(1.5) rotate(90deg) translate(2px, 3px)")
    expect(t[0]).toEqual(["scale", [1.5]])
    expect(t[1]![1][0]).toBeCloseTo(Math.PI / 2)
    expect(t[2]).toEqual(["offset", [2, 3]])
    expect(ops("filter: blur(4px); backdrop-filter: blur(8px)")).toEqual([["blur", [4]], ["backdrop_blur", [8]]])
    expect(ops("text-overflow: ellipsis; text-transform: uppercase; white-space: normal")).toEqual([["truncate", []], ["text_case", ["Uppercase"]], ["wrap", []]])
  })

  test(":hover and :active backgrounds become hover() and press()", () => {
    const hover = decls("background: #fff")
    const active = decls("background: #000; transform: scale(0.97)")
    const t = translate(new Map(), { hover, active })
    expect(plain(t.ops)).toEqual([["hover", [[1, 1, 1, 1]]], ["press", [[0, 0, 0, 1]]], ["press_scale", [0.97]]])
  })

  test("what Rune can't do is dropped with one warning", () => {
    expect(ops("transition: all 0.2s; transition: all 0.3s; height: 50%; float: left")).toEqual([])
    expect(warn.mock.calls.length).toBe(3)
    expect(String(warn.mock.calls[0]![0])).toContain("motion")
  })
})

describe("css variables", () => {
  test("substitute with values, fallbacks and nesting", () => {
    set_vars({ surface: "#111", gap: "8px", alias: "var(--gap)" })
    expect(substitute("var(--surface)")).toBe("#111")
    expect(substitute("var(--missing, 4px)")).toBe("4px")
    expect(substitute("var(--alias)")).toBe("8px")
    expect(substitute("var(--missing, rgb(1, 2, 3))")).toBe("rgb(1, 2, 3)")
    expect(substitute("var(--nothing)")).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test("set_vars bumps the generation only when something changed", () => {
    const g = generation
    expect(set_vars({ a: "1" })).toBe(true)
    expect(set_vars({ "--a": "1" })).toBe(false)
    expect(set_vars({ a: null })).toBe(true)
    expect(generation).toBe(g + 2)
  })

  test("a declaration whose var is undefined is dropped, the rest stay", () => {
    expect(ops("gap: var(--nope); width: var(--w, 10px)")).toEqual([["w", [10]]])
  })
})
