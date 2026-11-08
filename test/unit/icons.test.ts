// Icons Rust hands out by `&'static` reference (a theme's catalogs, file-type badges) and the
// icon swap (`set_icon_swap`), which draws one icon in place of another in every window.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { App, AppSpec, col, el, icon, set_icon_swap } from "runex-js"
import { file_icon } from "runex-js/kit"
import { file_icons, icons, tree_icons } from "runex-js/theme-opencode"
import { snapOf, tempDir } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("icons")

describe("&'static icons", () => {
  test("functions and catalogs return the theme's own icons", () => {
    expect(file_icons.file("index.ts").name).toBeString()
    expect(file_icons.folder("src", true).name).not.toBe(file_icons.folder("src", false).name)
    expect(file_icons.all().length).toBeGreaterThan(10)
    expect(icons.ALL.map((i) => i.name)).toContain("plus")
    expect(tree_icons.all().every((t) => typeof t.icon().name === "string" && typeof t.token() === "string")).toBe(true)
    expect(tree_icons.CHEVRON.name).toBe(icons.OUTLINE_CHEVRON_RIGHT.name)
    expect(file_icon("main.rs").name).toBeString()
  })

  test("an Rc<str> parameter takes a string (El.hover_group_shared)", () => {
    expect(() => el().hover_group_shared("rows")).not.toThrow()
  })
})

describe("set_icon_swap", () => {
  const view = (glyph: typeof icons.PLUS) => () => col().padding(8).child(icon(glyph, 24))
  const png = async (glyph: typeof icons.PLUS) => readFileSync((await snapOf(App.new(AppSpec.new("Swap", [60, 60], () => ({}), view(glyph))), [], tmp)).png)

  test("draws the icon the swap names in place of another, and itself again after null", async () => {
    const plus = await png(icons.PLUS)
    const check = await png(icons.CHECK)
    expect(plus.equals(check)).toBe(false)
    try {
      set_icon_swap((i) => (i.name === icons.PLUS.name ? icons.CHECK : null))
      expect((await png(icons.PLUS)).equals(check)).toBe(true)
    } finally {
      set_icon_swap(null)
    }
    expect((await png(icons.PLUS)).equals(plus)).toBe(true)
  })
})
