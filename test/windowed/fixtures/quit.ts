// Quitting: `handle.quit()` from a timer ends the event loop, `run()` resolves (the pump's tick
// returned -2), the code after it runs, and the process then exits by itself, with no timer or
// handle left to keep it alive. Nothing here calls `process.exit`.
//
//   bun test/windowed/fixtures/quit.ts
//
// RESULT (printed after `run()` resolves): when it quit and when `run()` resolved, in ms after
// launch, and whether the pump reports it exited.
import { App, AppSpec, col, text, tok } from "runex-js"
import { corner, deadline, now, result } from "./common.ts"

const QUIT_MS = Number(process.env.FIXTURE_MS ?? 1000)
deadline(QUIT_MS + 15000)

const app = App.new(AppSpec.new("Quit", [320, 160], () => ({}), () => {
  const t = tok.theme(true)
  return col().key("root").w_full().h_full().center().fill(t.bg).child(text("Quits in a second").color(t.text))
}))
  .window_options(corner())
  .args([])
const handle = app.handle()
let quitAt = 0
setTimeout(() => {
  quitAt = now()
  handle.quit()
}, QUIT_MS)
await app.run()
result({ quitAt: Math.round(quitAt), resolvedAt: Math.round(now()), afterRun: true })
