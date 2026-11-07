// A counter for the `bun --hot` swap. The test copies this file and common.ts into a temporary
// directory (with node_modules/runex-js linked to the repo), runs `bun --hot main.ts`, waits for
// READY, then rewrites the LABEL and TITLE lines below. Bun re-evaluates the module in place and
// its `run()` swaps the new view into the open window (ts/app.ts): the count must carry on, the
// view must show the new label, and the app must take the new title. The new generation then
// quits, which under `bun --hot` ends the process.
//
// Lines on stdout: `READY`, then `VIEW {gen, label, count}` whenever the view's output changes,
// then `RESULT {...}` from the generation that quits.
import { App, AppSpec, col, text, tok } from "runex-js"
import { corner, deadline, result } from "./common.ts"

const LABEL = "first"
const TITLE = "Hot counter"

type S = { count: number }
const G = globalThis as { __hot_gen?: number; __hot_ticker?: boolean; __hot_last?: string; __hot_quitting?: boolean }
const gen = (G.__hot_gen = (G.__hot_gen ?? 0) + 1)
if (gen === 1) deadline(20000)

function view(s: S) {
  const line = JSON.stringify({ gen, label: LABEL, count: s.count })
  if (line !== G.__hot_last) {
    G.__hot_last = line
    process.stdout.write(`VIEW ${line}\n`)
  }
  if (gen > 1 && !G.__hot_quitting) {
    G.__hot_quitting = true
    setTimeout(() => {
      const registry = (globalThis as { __runex_apps?: Map<string, unknown> }).__runex_apps
      result({ gen, label: LABEL, count: s.count, titles: [...(registry?.keys() ?? [])], hot: process.execArgv.includes("--hot") })
      app.handle().quit()
    }, 200)
  }
  const t = tok.theme(true)
  return col().key("root").w_full().h_full().center().fill(t.bg).child(text(`${LABEL}: ${s.count}`).key("label").color(t.text))
}

const app = App.new(AppSpec.new<S>(TITLE, [260, 140], () => ({ count: 0 }), view)).window_options(corner()).args([])

// Side effects at the top level run again on every save; this one is guarded to run once.
if (!G.__hot_ticker) {
  G.__hot_ticker = true
  const handle = app.handle()
  const ticker = setInterval(() => {
    handle.update((s: S) => {
      s.count += 1
      if (s.count === 3) process.stdout.write("READY\n")
    })
  }, 150)
  ticker.unref()
}

// Not awaited, as in examples/hello: Bun re-evaluates a module on save only once its evaluation
// has finished, and a top-level `await app.run()` never finishes while the window is open.
void app.run()
