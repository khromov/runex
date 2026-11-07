// `App.perf(mode, on_stats)` delivers a window's numbers once a second while it draws, and stops
// when it rests. The poll animates (`tx.wake_after(0)`) for ANIMATE_MS, then stops asking; the
// fixture counts stats in each phase.
//
//   bun test/windowed/fixtures/stats.ts [none|log]     # the perf mode; `log` also prints a line a second
//   RUNEX_PERF=log bun test/windowed/fixtures/stats.ts env   # no `App.perf`: the variable alone, briefer
//
// RESULT: every stats object with the phase it arrived in and its time (ms after the first poll).
import { App, AppSpec, Shape, canvas, col, tok } from "runex-js"
import type { PerfStats } from "runex-js"
import { corner, deadline, mode, now, result } from "./common.ts"

const perfMode = mode("none") as "none" | "log" | "env"
const ANIMATE_MS = 2500
const REST_MS = perfMode === "env" ? 300 : 2500
deadline(ANIMATE_MS + REST_MS + 15000)

let t0 = 0
let animating = true
const stats: { phase: string; at: number; stats: PerfStats }[] = []

function wave(t: number): Shape {
  const points = Array.from({ length: 64 }, (_, i) => [i * 4, 40 + 30 * Math.sin(i * 0.2 + t * 4)])
  return Shape.new().stroke(points, 2, tok.accent(0, true)).view_box(252, 80)
}

let app = App.new({
  ...AppSpec.new<{ t: number }>("Stats", [320, 160], () => ({ t: 0 }), (s) =>
    col().key("root").w_full().h_full().center().fill(tok.theme(true).bg).child(canvas(wave(s.t)).key("wave").size(252, 80))),
  poll: (s, t, tx) => {
    if (t0 === 0) {
      t0 = now()
      setTimeout(() => { animating = false }, ANIMATE_MS)
      setTimeout(() => handle.quit(), ANIMATE_MS + REST_MS)
    }
    if (!animating) return false
    tx.wake_after(0)
    s.t = t
    return true
  },
})
  .window_options(corner())
  .args([])
if (perfMode !== "env") app = app.perf(perfMode, (s) => stats.push({ phase: animating ? "animating" : "resting", at: Math.round(now() - t0), stats: s }))
const handle = app.handle()
await app.run()
result({ mode: perfMode, animateMs: ANIMATE_MS, restMs: REST_MS, stats })
