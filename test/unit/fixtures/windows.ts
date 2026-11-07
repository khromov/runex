// A two-window app (`run_windows`): window "a" from an `App` with an overlay, window "b" from an
// `AppSpec`, each with its own state and scenes. Rune's arguments come from the command line, e.g.
//
//   bun test/unit/fixtures/windows.ts --window b --tree out.json
//
// Prints a RESULT line: the texts of the --tree dump (when one was asked for), the displays the
// factory saw, and which hooks ran.
import { existsSync, readFileSync } from "node:fs"
import { App, AppSpec, OverlaySpec, WindowSpec, col, run_windows_with_args, text } from "runex-js"
import { requireHeadless, result } from "../lib/spawn.ts"

type S = { label: string }
const args = process.argv.slice(2)
requireHeadless(args)
const calls = { displays: -1, factory: 0, created: [] as string[], ready: [] as string[], setup: [] as string[], init: [] as string[] }
const view = (s: S) => col().key("root").child(text(s.label).key("label"))

await run_windows_with_args({ accessory: false }, args, (displays) => {
  calls.factory++
  calls.displays = displays.length
  const a = App.new({
    ...AppSpec.new<S>("A", [120, 80], () => (calls.init.push("a"), { label: "aye" }), view),
    scenes: [["loud", (s) => { s.label = "AYE" }]],
    setup: () => { calls.setup.push("a") },
  })
  a.overlay(OverlaySpec.new<number>("hud", [100, 30], (n) => text(`hud ${n}`).key("hud")), 0)
  return [
    WindowSpec.from_app("a", a.native).on_created(() => { calls.created.push("a") }).on_ready(() => { calls.ready.push("a") }),
    WindowSpec.new("b", {
      ...AppSpec.new<S>("B", [140, 90], () => (calls.init.push("b"), { label: "bee" }), view),
      scenes: [["quiet", (s) => { s.label = "b" }], ["calm", (s) => { s.label = "bee." }]],
      setup: () => { calls.setup.push("b") },
    }).on_created(() => { calls.created.push("b") }).on_ready(() => { calls.ready.push("b") }),
  ]
})

const i = args.indexOf("--tree")
const tree = i >= 0 && existsSync(args[i + 1]!) ? JSON.parse(readFileSync(args[i + 1]!, "utf8")) : null
result({ ...calls, texts: tree ? tree.elements.flatMap((e: { text?: string }) => (e.text === undefined ? [] : [e.text])) : null, title: tree?.title ?? null })
