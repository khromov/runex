// A tiny app for Rune's tooling contract (test/unit/tooling-contract.test.ts): scenes "a", "b" and
// "rune-x", a bar that springs open from t = 0, a fill that follows --theme, a button and a drag
// pad for --script, and keys logged by `on_key`. Rune's arguments come from the command line:
//
//   bun test/unit/fixtures/tooling.ts --scene b --tree out.json
//
// Prints a RESULT line with the last state the view saw.
import { App, AppSpec, Spring, col, el, extra_args, row, text, tok } from "runex-js"
import { requireHeadless, result } from "../lib/spawn.ts"

type S = { scene: string; open: boolean; n: number; keys: string[]; drag: [number, number]; drags: number }

const args = process.argv.slice(2)
requireHeadless(args)
let last: S | undefined

function key(k: unknown): string {
  return typeof k === "string" ? k : JSON.stringify(k)
}

const spec = AppSpec.new<S>("Tooling", [240, 160], () => ({ scene: "none", open: false, n: 0, keys: [], drag: [0, 0], drags: 0 }), (s, cx) => {
  last = s
  const t = tok.theme(cx.system_dark())
  return col().key("root").w_full().h_full().gap(8).padding(8).fill(t.bg)
    .child(text(`scene ${s.scene}`).key("scene").color(t.text))
    .child(el().key("bar").h(8).w(s.open ? 200 : 20).fill(t.text).motion(Spring.new(0.4, 0)))
    .child(row().gap(8)
      .child(el().key("button").size(60, 24).fill(t.card).on_press((s: S) => { s.n += 1 }).child(text(`n ${s.n}`).key("count")))
      .child(el().key("pad").size(80, 40).fill(t.card).on_drag((s: S, d) => {
        s.drag = [d.dx, d.dy]
        s.drags += 1
      })))
    .child(text(`keys ${s.keys.join(" ")}`).key("keys").color(t.text))
})

await App.new({
  ...spec,
  scenes: [
    ["a", (s) => { s.scene = "a" }],
    ["b", (s) => { s.scene = "b" }],
    ["rune-x", (s) => { s.scene = "rune-x" }],
  ],
  // Opens the bar on the first frame after t = 0, so it is mid-spring at small --at times.
  poll: (s, t) => {
    if (s.open || t <= 0) return false
    s.open = true
    return true
  },
  on_key: (s, e) => {
    s.keys.push(key(e.key))
    return true
  },
}).args(args).run()

result({ state: last ?? null, extra: extra_args() })
