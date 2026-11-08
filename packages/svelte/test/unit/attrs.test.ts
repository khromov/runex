import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { attr_op, method_for } from "../../src/attrs.ts"
import { reset_warnings } from "../../src/css.ts"

let warn: ReturnType<typeof spyOn>
beforeEach(() => {
  reset_warnings()
  warn = spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe("attribute → El method", () => {
  test("names: as written, kebab-case, HTML aliases", () => {
    expect(method_for("w_full")).toBe("w_full")
    expect(method_for("w-full")).toBe("w_full")
    expect(method_for("aria-label")).toBe("label")
    expect(method_for("tabindex")).toBe("tab_index")
    expect(method_for("title")).toBe("help")
    expect(method_for("nope")).toBeNull()
  })

  test("flags: present calls, false leaves out", () => {
    expect(attr_op("w_full", "", "el")).toEqual(["w_full", []])
    expect(attr_op("w_full", true, "el")).toEqual(["w_full", []])
    expect(attr_op("w_full", false, "el")).toBeNull()
    expect(attr_op("w_full", "false", "el")).toBeNull()
  })

  test("one argument, coerced from a static string by its type", () => {
    expect(attr_op("gap", 16, "el")).toEqual(["gap", [16]])
    expect(attr_op("gap", "16", "el")).toEqual(["gap", [16]])
    expect(attr_op("gap", "16px", "el")).toEqual(["gap", [16]])
    expect(attr_op("gap", "1rem", "el")).toEqual(["gap", [16]])
    expect(attr_op("focusable", "", "el")).toEqual(["focusable", [true]])
    expect(attr_op("disabled", false, "el")).toEqual(["disabled", [false]])
    expect(attr_op("cursor", "Pointer", "el")).toEqual(["cursor", ["Pointer"]])
    const fill = attr_op("fill", "#ffffff", "el")!
    expect(fill[0]).toBe("fill")
    expect(fill[1][0]).toMatchObject({ r: 1, g: 1, b: 1, a: 1 })
  })

  test("several arguments: an array or a string", () => {
    expect(attr_op("size", [38, 22], "el")).toEqual(["size", [38, 22]])
    expect(attr_op("size", "38 22", "el")).toEqual(["size", [38, 22]])
    expect(attr_op("size", "38, 22", "el")).toEqual(["size", [38, 22]])
    const border = attr_op("border", "1 rgb(255, 255, 255)", "el")!
    expect(border[1][0]).toBe(1)
    expect(border[1][1]).toMatchObject({ r: 1, g: 1, b: 1 })
    // `pin` takes four `number | null`: missing trailing ones are null.
    expect(attr_op("pin", [0, null], "el")).toEqual(["pin", [0, null, null, null]])
  })

  test("functions are wrapped as handlers; a state handler's return is dropped", () => {
    const op = attr_op("modal", [true, () => 42], "el")!
    expect(op[0]).toBe("modal")
    expect((op[1][1] as () => unknown)()).toBeUndefined()
    const copy = attr_op("selection_copy", () => "text", "el")!
    expect((copy[1][0] as () => unknown)()).toBe("text")
  })

  test("bad values and unknown names warn once and apply nothing", () => {
    expect(attr_op("gap", "wide", "el")).toBeUndefined()
    expect(attr_op("gap", "wide", "el")).toBeUndefined()
    expect(attr_op("size", [1], "el")).toBeUndefined()
    expect(attr_op("fill", "notacolour", "el")).toBeUndefined()
    expect(attr_op("bogus", 1, "el")).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(4)
  })
})
