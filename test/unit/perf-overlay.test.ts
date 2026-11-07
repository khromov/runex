// The performance overlay's pointer behaviour, layout and cost to the app's view, headless:
// Rune's `--script` taps elements by key and resizes the window, and `--tree` dumps every
// element's rect, hover and inert state.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { App, AppSpec, TextEdit, col, el, oklch, text, text_input, tok } from "runex-js"
import { byKey, tempDir, treeOf, writeScript, type Tree } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("perf-overlay")

type Rect = [number, number, number, number]
type S = { n: number }

// The app is one button that fills the window, under the panel: it counts presses and lights
// under the pointer.
const spec = (size: [number, number]) =>
  AppSpec.new<S>("Perf overlay", size, () => ({ n: 0 }), (s) =>
    col()
      .key("root")
      .w_full()
      .h_full()
      .child(
        el()
          .key("under")
          .w_full()
          .h_full()
          .hover(oklch(0.5, 0.1, 250))
          .on_press((s: S) => { s.n += 1 })
          .child(text(`n=${s.n}`).key("count")),
      ),
  )

/** Runs the app headless with the overlay and `events`, and returns its tree at `at` seconds. */
async function run(size: [number, number], events: object[], at = 1.4) {
  const tree = await treeOf(App.new(spec(size)).perf("overlay"), ["--script", writeScript(tmp, events), "--at", String(at)], tmp)
  const key = (k: string) => byKey(tree, k)
  return {
    tree,
    key,
    count: () => key("count")?.text,
    hovered: (k: string) => ((key(k)?.hover as number | undefined) ?? 0) > 0,
  }
}

const inside = ([x, y, w, h]: Rect, [vw, vh]: [number, number]) => x >= 0 && y >= 0 && x + w <= vw && y + h <= vh
const overlaps = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

/** How far the open explanation's text runs past its box's padding (0 when it all shows). */
function cut(tree: Tree): number {
  const box = byKey(tree, "runex-perf-explanation")!
  const lines = tree.elements.filter((e) => e.path.startsWith(`${box.path}/`) && e.role === "text")
  const bottom = Math.max(...lines.map((e) => e.rect[1] + e.rect[3]))
  return Math.max(0, bottom - (box.rect[1] + box.rect[3] - 8))
}

const TOPICS = ["frame", "work", "rune", "bindings", "js", "history", "phases", "update", "view", "encode", "presents", "loop"]

describe("perf overlay", () => {
  test("by default the panel lets presses and hover through to the app beneath", async () => {
    const t = await run([800, 600], [
      { t: 0.2, type: "tap", key: "runex-perf-encode" }, // a number on the panel, over the app
      { t: 0.5, type: "move", key: "runex-perf-work" },
    ])
    expect(t.key("runex-perf-work")?.inert).toBe(true)
    expect(t.count()).toBe("n=1")
    expect(t.hovered("under")).toBe(true)
    expect(t.hovered("runex-perf-work")).toBe(false)
    expect(t.key("runex-perf-explanation")).toBeUndefined()
  })

  test("the ? button turns explain mode on and off, and its press stays the panel's", async () => {
    const on = await run([800, 600], [{ t: 0.1, type: "tap", key: "runex-perf-explain" }])
    expect(on.key("runex-perf-work")?.inert).toBe(false)
    expect(on.key("runex-perf-hint")).toBeDefined()
    expect(on.key("under")?.inert).toBe(true) // the panel is a modal: the app takes no input
    expect(on.count()).toBe("n=0")
    // Focus moves to the modal, which says what the mode is.
    expect(on.key("runex-perf-modal")?.label).toContain("explain mode")
    const off = await run([800, 600], [
      { t: 0.1, type: "tap", key: "runex-perf-explain" },
      { t: 0.6, type: "tap", key: "runex-perf-explain" },
    ])
    expect(off.key("runex-perf-work")?.inert).toBe(true)
    expect(off.key("runex-perf-hint")).toBeUndefined()
    expect(off.key("under")?.inert).toBe(false)
    expect(off.count()).toBe("n=0")
  })

  test("in explain mode a press on a number explains it and reaches nothing beneath", async () => {
    const t = await run([800, 600], [
      { t: 0.1, type: "tap", key: "runex-perf-explain" },
      { t: 0.6, type: "tap", key: "runex-perf-encode" },
    ])
    expect(t.key("runex-perf-explanation")?.label).toBe("encode")
    expect(t.count()).toBe("n=0")
    expect(t.hovered("runex-perf-encode")).toBe(true)
    expect(t.hovered("under")).toBe(false)
    // Beside the panel, not over it.
    expect(overlaps(t.key("runex-perf-explanation")!.rect, t.key("runex-perf")!.rect)).toBe(false)
  })

  test("a click outside the panel or Esc leaves explain mode, and the click reaches nothing", async () => {
    const click = await run([800, 600], [
      { t: 0.1, type: "tap", key: "runex-perf-explain" },
      { t: 0.6, type: "tap", key: "runex-perf-update" },
      { t: 1.0, type: "tap", x: 100, y: 400 },
    ], 1.6)
    expect(click.key("runex-perf-explanation")).toBeUndefined()
    expect(click.key("runex-perf-work")?.inert).toBe(true)
    expect(click.count()).toBe("n=0")
    const esc = await run([800, 600], [
      { t: 0.1, type: "tap", key: "runex-perf-explain" },
      { t: 0.6, type: "key", name: "Escape" },
    ])
    expect(esc.key("runex-perf-hint")).toBeUndefined()
    expect(esc.key("runex-perf-work")?.inert).toBe(true)
  })

  test("explain mode holds the app's keyboard focus and gives it back", async () => {
    type F = { field: TextEdit }
    const script = writeScript(tmp, [
      { t: 0.1, type: "tap", key: "field" },
      { t: 0.3, type: "type", text: "ab" },
      { t: 0.6, type: "tap", key: "runex-perf-explain" },
      { t: 1.2, type: "type", text: "zz" }, // explain mode: not the field's
      { t: 1.4, type: "key", name: "Escape" },
      { t: 1.8, type: "type", text: "cd" },
    ])
    const spec = AppSpec.new<F>("Perf overlay", [800, 600], () => ({ field: TextEdit.default() }), (s) =>
      col().w_full().h_full().padding(40).child(text_input(s.field, tok.type_.BODY).key("field").w(300).on_edit((s: F) => s.field)))
    const tree = await treeOf(App.new(spec).perf("overlay"), ["--script", script, "--at", "2.4"], tmp)
    const field = byKey(tree, "field")!
    expect(field.text).toBe("abcd")
    expect(field.focused).toBe(true)
  })

  test("every explanation shows whole in hello's 320x200 window", async () => {
    const size: [number, number] = [320, 200]
    for (const topic of TOPICS) {
      // The panel is taller than the window: scroll it to the lower numbers first.
      const deep = ["update", "view", "encode", "presents", "loop"].includes(topic)
      const t = await run(size, [
        { t: 0.1, type: "tap", key: "runex-perf-explain" },
        ...(deep ? [{ t: 0.4, type: "wheel", key: "runex-perf-frame", dy: -300 }] : []),
        { t: 0.8, type: "tap", key: `runex-perf-${topic}` },
      ], 1.6)
      const explanation = t.key("runex-perf-explanation")
      expect(explanation?.label).toBe(t.key(`runex-perf-${topic}`)?.label)
      expect(inside(explanation!.rect, size)).toBe(true)
      expect({ topic, cut: cut(t.tree) }).toEqual({ topic, cut: 0 })
      // It starts under the panel's buttons, so `?` still leaves explain mode (and a macOS
      // titlebar's buttons drawn over the content stay clear).
      expect(overlaps(explanation!.rect, t.key("runex-perf-explain")!.rect)).toBe(false)
      // The panel stays inside the window too, its numbers scrolling.
      expect(inside(t.key("runex-perf")!.rect, size)).toBe(true)
    }
  }, TIMEOUT * 2)

  test("an explanation sits beside the panel, under its number or at the top, and shows whole", async () => {
    for (const [size, topic] of [
      [[480, 260], "runex-perf-encode"], // room beside, too short to sit level with the number
      [[480, 260], "runex-perf-loop"],
      [[420, 400], "runex-perf-history"], // no room beside: under or over the number
      [[420, 400], "runex-perf-loop"],
      [[1000, 700], "runex-perf-presents"], // beside, level with the number
    ] as [[number, number], string][]) {
      const t = await run(size, [
        { t: 0.1, type: "tap", key: "runex-perf-explain" },
        { t: 0.8, type: "tap", key: topic },
      ], 1.6)
      const explanation = t.key("runex-perf-explanation")!
      expect(explanation.label).toBe(t.key(topic)?.label)
      expect(inside(explanation.rect, size)).toBe(true)
      expect({ size, topic, cut: cut(t.tree) }).toEqual({ size, topic, cut: 0 })
      expect(inside(t.key("runex-perf")!.rect, size)).toBe(true)
      if (size[0] >= 480) expect(overlaps(explanation.rect, t.key("runex-perf")!.rect)).toBe(false)
    }
  })

  test("a small window starts folded; the fold button folds and unfolds", async () => {
    const small = await run([320, 200], [])
    expect(small.key("runex-perf-work")).toBeUndefined()
    const [, , w, h] = small.key("runex-perf")!.rect
    expect(w).toBeLessThan(200)
    expect(h).toBeLessThan(40)
    const button = small.key("runex-perf-collapse")!.rect
    expect(Math.min(button[2], button[3])).toBeGreaterThanOrEqual(20)
    const unfolded = await run([320, 200], [{ t: 0.1, type: "tap", key: "runex-perf-collapse" }])
    expect(unfolded.key("runex-perf-work")?.inert).toBe(true)
    expect(unfolded.count()).toBe("n=0")
    // Unfolded in a short window, the panel ends inside it.
    expect(inside(unfolded.key("runex-perf")!.rect, [320, 200])).toBe(true)
    const large = await run([800, 600], [])
    expect(large.key("runex-perf-work")).toBeDefined()
    // FRAME's numbers end where the other groups' do.
    expect(large.key("runex-perf-frame")!.rect[2]).toBe(large.key("runex-perf-work")!.rect[2])
    const folded = await run([800, 600], [{ t: 0.1, type: "tap", key: "runex-perf-collapse" }])
    expect(folded.key("runex-perf-work")).toBeUndefined()
    expect(folded.count()).toBe("n=0")
  })

  test("a resize re-runs the app's view only when it crosses the folding size", async () => {
    /** The app's view runs over `events`, with the overlay less without it (which gets the resizes alone). */
    async function extra(size: [number, number], events: { type: string }[]) {
      const views = async (perf: boolean) => {
        let runs = 0
        const spec = AppSpec.new<{}>("Views", size, () => ({}), () => {
          runs += 1
          return col().key("root").w_full().h_full().child(text("app"))
        })
        const app = perf ? App.new(spec).perf("overlay") : App.new(spec)
        await treeOf(app, ["--script", writeScript(tmp, perf ? events : events.filter((e) => e.type === "resize")), "--at", "2"], tmp)
        return runs
      }
      return (await views(true)) - (await views(false))
    }
    const resize = (dh: number, t = 0.2) => ({ t, type: "resize", dw: 0, dh, dur: 1.2 })
    const press = (key: string) => ({ t: 0.1, type: "tap", key })
    // Opening reads the window's size: one run more. A resize that crosses nothing adds none, in
    // a large window or in a short one where the panel stays folded.
    expect(await extra([800, 700], [resize(-100)])).toBe(1)
    expect(await extra([400, 290], [resize(-100)])).toBe(1)
    // Crossing the folding size, either way, adds one.
    expect(await extra([800, 600], [resize(-200)])).toBe(2)
    expect(await extra([800, 400], [resize(200)])).toBe(2)
    // Once the fold button chose, the size decides nothing: the press is the one run more.
    expect(await extra([800, 600], [press("runex-perf-collapse"), resize(-200, 0.3)])).toBe(2)
    // Unfolded or in explain mode, a short window caps the panel through layout.
    expect(await extra([400, 290], [press("runex-perf-collapse"), resize(-100, 0.3)])).toBe(2)
    expect(await extra([400, 290], [press("runex-perf-explain"), resize(-100, 0.3)])).toBe(2)
    // An open explanation moves only where its place changes: two presses, no resize step.
    const open = [press("runex-perf-explain"), { ...press("runex-perf-history"), t: 0.2 }]
    expect(await extra([420, 500], [...open, resize(-100, 0.4)])).toBe(3) // under its number
    expect(await extra([900, 700], [...open, resize(-100, 0.4)])).toBe(3) // beside the panel
  }, TIMEOUT * 2)
})
