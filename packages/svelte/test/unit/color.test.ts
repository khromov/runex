import { describe, expect, test } from "bun:test"
import { color } from "runex-js"
import { is_color, parse_color } from "../../src/color.ts"

const rgba = (c: ReturnType<typeof parse_color>) => (c ? [c.r, c.g, c.b, c.a].map((v) => Math.round(v * 1000) / 1000) : null)

describe("parse_color", () => {
  test("hex in every length agrees with Rune's own color::hex", () => {
    expect(rgba(parse_color("#1e1e2e"))).toEqual(rgba(color.hex("#1e1e2e")))
    expect(rgba(parse_color("#abc"))).toEqual(rgba(color.hex("#aabbcc")))
    expect(rgba(parse_color("#11223380"))).toEqual(rgba(color.hex("#11223380")))
    expect(rgba(parse_color("#abc8"))).toEqual(rgba(color.hex("#aabbcc88")))
  })

  test("rgb()/rgba() decode sRGB to linear like hex does", () => {
    expect(rgba(parse_color("rgb(30, 30, 46)"))).toEqual(rgba(color.hex("#1e1e2e")))
    expect(rgba(parse_color("rgb(30 30 46 / 50%)"))![3]).toBe(0.5)
    expect(rgba(parse_color("rgba(255,0,0,0.25)"))).toEqual([1, 0, 0, 0.25])
  })

  test("hsl(), named colours and transparent", () => {
    expect(rgba(parse_color("hsl(0, 100%, 50%)"))).toEqual([1, 0, 0, 1])
    expect(rgba(parse_color("white"))).toEqual([1, 1, 1, 1])
    expect(rgba(parse_color("Red"))).toEqual([1, 0, 0, 1])
    expect(parse_color("transparent")!.a).toBe(0)
  })

  test("oklch() goes through Rune's oklcha", () => {
    expect(rgba(parse_color("oklch(0.7 0.1 200)"))).toEqual(rgba(color.oklcha(0.7, 0.1, 200, 1)))
    expect(rgba(parse_color("oklch(70% 0.1 200 / 0.5)"))).toEqual(rgba(color.oklcha(0.7, 0.1, 200, 0.5)))
  })

  test("not a colour", () => {
    expect(parse_color("nope")).toBeNull()
    expect(parse_color("#12")).toBeNull()
    expect(parse_color("#zzzzzz")).toBeNull()
    expect(parse_color("rgb(1, 2)")).toBeNull()
  })

  test("is_color", () => {
    expect(is_color(color.hex("#fff"))).toBe(true)
    expect(is_color({ r: 0, g: 0, b: 0, a: 1 })).toBe(true)
    expect(is_color("#fff")).toBe(false)
    expect(is_color(null)).toBe(false)
  })
})
