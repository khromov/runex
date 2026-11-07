// Frames a poll asks for, with nobody touching the window.
//
//   bun test/windowed/fixtures/poll-frames.ts wake|nowake|still [Rune's flags: --native --trace t.jsonl]
//
// `wake`: the poll calls `tx.wake_after(0)` on every frame, as an animation stepped from the frame
// clock does, so the window draws at the display's rate until it quits. `nowake`: the poll
// returns true without asking, like examples/shapes; Rune then draws nothing more once launch
// settles ("an idle window draws nothing"), and the Rust original behaves the same. `still`: the
// same poll, but the picture stays as it is (the state keeps `t` at 0). On Windows Rune keeps
// presenting for a second after a frame that drew something new (draw.rs's steady hold), and
// `nowake`'s picture moves on every frame, so there it never rests; `still` rests once the hold
// ends.
//
// The view is shapes' kind: a canvas drawn from `t` in a box of fixed size. A view whose layout
// changes every frame (a text that counts) keeps Rune drawing by itself, poll or no poll.
//
// It quits through its handle FIXTURE_MS (default 2500) after the first poll. RESULT: every
// poll's time (ms after the first) and the view's call count.
import { App, AppSpec, Shape, canvas, col, tok } from "runex-js"
import { corner, deadline, mode, now, result, round, runeArgs } from "./common.ts"

const which = mode("wake")
const RUN_MS = Number(process.env.FIXTURE_MS ?? 2500)
deadline(RUN_MS + 15000)

type S = { t: number }
const polls: number[] = []
let views = 0

function wave(t: number): Shape {
  const points = Array.from({ length: 64 }, (_, i) => [i * 4, 40 + 30 * Math.sin(i * 0.2 + t * 4)])
  return Shape.new().stroke(points, 2, tok.accent(0, true)).view_box(252, 80)
}

const app = App.new({
  ...AppSpec.new<S>("Poll frames", [320, 160], () => ({ t: 0 }), (s) => {
    views++
    return col().key("root").w_full().h_full().center().fill(tok.theme(true).bg).child(canvas(wave(s.t)).key("wave").size(252, 80))
  }),
  poll: (s, t, tx) => {
    if (polls.length === 0) setTimeout(() => handle.quit(), RUN_MS)
    polls.push(now())
    if (which === "wake") tx.wake_after(0)
    if (which !== "still") s.t = t
    return true
  },
})
  .window_options(corner())
  .args(runeArgs())
const handle = app.handle()
await app.run()
const t0 = polls[0] ?? 0
result({ mode: which, polls: round(polls.map((t) => t - t0)), views })
