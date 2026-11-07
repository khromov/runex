// Every port has its Rust example and every Rust example its port, so a deleted or new upstream
// example can't silently drop out of compare (which only runs examples that exist on both sides).
// The allowlists, with reasons, are TS_ONLY and UPSTREAM_ONLY in scripts/update-rune.ts.
// `bun test ./test/static`.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { inventory, scenesIn } from "../../scripts/update-rune.ts"

const ROOT = join(import.meta.dir, "..", "..")
const RUNE = join(ROOT, "vendor", "rune")

describe("example inventory", () => {
  test.skipIf(!existsSync(join(RUNE, "examples")))("examples/ and vendor/rune/examples pair up", () => {
    const inv = inventory(ROOT, RUNE)
    expect(inv.ports.length).toBeGreaterThan(20)
    expect({ noTwin: inv.noTwin, unported: inv.unported, stale: inv.stale }).toEqual({ noTwin: [], unported: [], stale: [] })
  })

  test("scenesIn reads scene arrays, scene consts and stories!", () => {
    const src = [
      'scenes: &[("on", on), ("off", |s| s), ("with \\"quote\\"", q)],',
      "scenes: SCENES,",
      'const SCENES: &[(&str, fn(&mut S))] = &[("const-a", a)];',
      "// scenes: &[(\"commented\", c)]",
      'stories! { "rune-switch--web" => switch_web, "ui-button--sizes" => sizes }',
    ].join("\n")
    expect(scenesIn(src)).toEqual(["on", "off", 'with \\"quote\\"', "const-a", "rune-switch--web", "ui-button--sizes"])
  })
})
