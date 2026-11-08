import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { compile_svelte, RENDERER_MODULE } from "../../src/compile.ts"

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

let warn: ReturnType<typeof spyOn>
beforeEach(() => (warn = spyOn(console, "warn").mockImplementation(() => {})))
afterEach(() => warn.mockRestore())

describe("compile_svelte", () => {
  test("imports the renderer and registers the <style> rules under the scope class", () => {
    const code = compile_svelte(fixture("Counter.svelte"))
    expect(code).toContain(`from ${JSON.stringify(RENDERER_MODULE)}`)
    const m = /\$define_styles\("(svelte-[\w-]+)", (\[.*\])\);/.exec(code)!
    expect(m).not.toBeNull()
    const rules = JSON.parse(m[2]!)
    // Weakest first: a tag, a class, then a tag with a class; :hover kept as pseudo.
    expect(rules.map((r: any) => [r.classes.length, r.tag, r.pseudo])).toEqual([
      [0, "el", "hover"],
      [1, null, null],
      [1, "el", null],
    ])
    expect(rules[1].decls).toEqual([["padding", "4px 8px"], ["background", "#000"]])
  })

  test("refuses selectors Rune can't match, naming the file", () => {
    compile_svelte(fixture("Counter.svelte"))
    const messages: string[] = warn.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m) => m.includes("Counter.svelte") && m.includes(".box :global(.x)"))).toBe(true)
  })

  test("carries render_hot's cache-buster to child components only", () => {
    const code = compile_svelte(fixture("Parent.svelte"), "?v=3")
    expect(code).toContain('"./Child.svelte?v=3"')
    expect(code).not.toContain("svelte/internal/client?v=3")
  })
})
