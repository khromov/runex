// rune_kit's shell: `TabStrip` and `TabItem`, builders that borrow strings in Rust (bound owned:
// tools/bindgen's `ownedLifetimes`), with the shell module's enums, records and drag state.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { App, AppSpec, col } from "runex-js"
import { Kit, TabStrip, WindowTitlebar, shell } from "runex-js/kit"
import { icons } from "runex-js/theme-opencode"
import { byKey, tempDir, treeOf, writeScript } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("tabs")

type S = { active: string; drag: shell.TabDragState; closed: string[] }

function app(orientation: shell.TabOrientation) {
  return App.new(AppSpec.new("Tabs", [640, 200], (): S => ({ active: "b", drag: shell.TabDragState.new(), closed: [] }), (s: S) => {
    const k = Kit.neutral(true)
    const tabs = ["a", "b", "c"].map((id, i) =>
      shell.TabItem.new(id, `Tab ${id}`).icon(icons.FOLDER).closable(true).status(i === 2 ? "Busy" : null).subtitle(`sub ${id}`),
    )
    return col().w_full().h_full().padding(16).child(
      TabStrip.new("tabs", orientation)
        .tabs(tabs)
        .active(s.active)
        .drag_state(s.drag, (s: S) => s.drag)
        .overflow(shell.TabOverflow.HORIZONTAL_DEFAULT)
        .on_select((s: S, id) => { s.active = id })
        .on_close((s: S, id) => { s.closed.push(id) })
        .build(k),
    )
  }))
}

describe("TabStrip", () => {
  test("builds a tab per item, keyed t-<id>, in both orientations", async () => {
    for (const o of ["Horizontal", "Vertical"] as const) {
      const tree = await treeOf(app(o), [], tmp)
      for (const id of ["a", "b", "c"]) expect(byKey(tree, `t-${id}`)).toBeDefined()
    }
  })

  test("a tap selects a tab through on_select", async () => {
    const script = writeScript(tmp, [{ t: 0.05, type: "tap", key: "t-c" }, { t: 0.5, type: "mark", name: "end" }])
    const before = await treeOf(app("Horizontal"), [], tmp)
    const after = await treeOf(app("Horizontal"), ["--script", script, "--at", "mark:end"], tmp)
    expect(JSON.stringify(byKey(after, "t-c"))).not.toBe(JSON.stringify(byKey(before, "t-c")))
  })

  test("shell's enums, records and constants", () => {
    expect(shell.TabOverflow.density_for(40)).toBe("IconOnly")
    expect(shell.TabOverflow.density_for(200)).toBe("Full")
    const spec = new shell.TearOutSpec({ detach_distance: 30, reattach_distance: 12 })
    expect(spec.detach_distance).toBe(30)
    const drag = shell.TabDragState.new()
    expect(drag.dragging()).toBeNull()
    expect(drag.torn_out()).toBe(false)
    expect(typeof WindowTitlebar.from_insets).toBe("function")
  })
})
