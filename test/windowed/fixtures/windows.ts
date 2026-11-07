// Several windows from one factory (`run_windows`): both windows' `on_created` run and both
// setups run; closing one window programmatically leaves the other running; quitting resolves
// `run_windows`.
//
//   bun test/windowed/fixtures/windows.ts
//
// Window `a` closes itself (its `WindowHandle.close()`) once both exist; window `b` is then
// updated from a timer and must re-run its view; then `b`'s handle quits. RESULT: the order of
// events, and whether `b` drew after `a` closed.
import { App, AppSpec, type WindowHandle, WindowSpec, col, run_windows_with_args, text, tok } from "runex-js"
import { corner, deadline, now, result } from "./common.ts"

deadline(20000)

type S = { name: string; n: number }
const events: string[] = []
const created = new Map<string, WindowHandle>()
let bViewAfterClose = false
let aClosed = false

function spec(name: string): AppSpec<S> {
  return {
    ...AppSpec.new<S>(`Window ${name}`, [260, 140], () => ({ name, n: 0 }), (s) => {
      if (s.name === "b" && aClosed && s.n > 0) bViewAfterClose = true
      const t = tok.theme(true)
      return col().key("root").w_full().h_full().center().fill(t.bg).child(text(`${s.name}: ${s.n}`).key("label").color(t.text))
    }),
    setup: (s) => { events.push(`setup ${s.name}`) },
  }
}

const a = App.new(spec("a")).window_options(corner()).on_close(() => {
  events.push("on_close a")
  aClosed = true
})
const b = App.new(spec("b")).window_options(corner(320))
const bHandle = b.handle()

function both() {
  if (created.size < 2) return
  setTimeout(() => {
    events.push("close a")
    created.get("a")!.close()
    setTimeout(() => {
      events.push("update b")
      bHandle.update((s: S) => { s.n += 1 })
      setTimeout(() => {
        events.push("quit")
        bHandle.quit()
      }, 400)
    }, 400)
  }, 300)
}

const started = now()
await run_windows_with_args({ accessory: false }, [], () => [
  WindowSpec.from_app("a", a).on_created((w) => { events.push("created a"); created.set("a", w); both() }),
  WindowSpec.from_app("b", b).on_created((w) => { events.push("created b"); created.set("b", w); both() }),
])
events.push("resolved")
result({ events, bViewAfterClose, ms: Math.round(now() - started) })
