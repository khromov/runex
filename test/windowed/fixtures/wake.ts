// Wakes from JavaScript reach a resting window at once: `handle.update` and `Live.set` from
// timers. Run it with input polling slowed (RUNEX_ACTIVE_MS=1000 RUNEX_IDLE_MS=1000): the frame
// then has to come from the pump's wake hook (`Pump.set_wake`), not from the next input check.
//
//   RUNEX_ACTIVE_MS=1000 RUNEX_IDLE_MS=1000 bun test/windowed/fixtures/wake.ts
//
// Before each sample it waits for the window to rest (no frame for 200 ms). Then it updates the
// state from a timer and times the view call that follows, 3 times; then it sets a live value
// and times the frame that follows (the poll runs at the start of every frame, and a live value
// draws without re-running the view), 3 times. RESULT: the latencies in ms (null: none within
// 1.5 s) and whether the window had rested before each sample.
import { App, AppSpec, Live, col, el, oklch, text, tok } from "runex-js"
import { corner, deadline, now, result } from "./common.ts"

deadline(25000)

type S = { n: number }
const opacity = Live.new(1)
let polls = 0
let lastPoll = 0
let lastView = 0
let viewN = -1

const app = App.new({
  ...AppSpec.new<S>("Wake", [320, 160], () => ({ n: 0 }), (s) => {
    lastView = now()
    viewN = s.n
    const theme = tok.theme(true)
    return col().key("root").w_full().h_full().center().gap(8).fill(theme.bg)
      .child(text(`n = ${s.n}`).key("n").color(theme.text))
      .child(el().key("dot").size(24, 24).radius(12).fill(oklch(0.7, 0.15, 250)).live_opacity(opacity))
  }),
  poll: () => {
    polls++
    lastPoll = now()
    return false
  },
})
  .window_options(corner())
  .args([])
const handle = app.handle()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Waits until no frame has run for 200 ms, up to 3 s; whether it rested. */
async function rest(): Promise<boolean> {
  const until = now() + 3000
  while (now() < until) {
    if (lastPoll > 0 && now() - lastPoll > 200) return true
    await sleep(10)
  }
  return false
}

/** Waits for `seen()` to report a time after `since`, up to 1.5 s; the latency, or null. */
async function latency(since: number, seen: () => number): Promise<number | null> {
  while (now() - since < 1500) {
    if (seen() > since) return Math.round((seen() - since) * 10) / 10
    await sleep(1)
  }
  return null
}

const updates: (number | null)[] = []
const lives: (number | null)[] = []
const rested: boolean[] = []

void (async () => {
  for (let i = 1; i <= 3; i++) {
    rested.push(await rest())
    const t = now()
    handle.update((s: S) => { s.n = i })
    updates.push(await latency(t, () => (viewN === i ? lastView : 0)))
  }
  for (let i = 1; i <= 3; i++) {
    rested.push(await rest())
    const t = now()
    opacity.set(i % 2 ? 0.4 : 0.9)
    lives.push(await latency(t, () => lastPoll))
  }
  handle.quit()
})()
await app.run()
result({ updates, lives, rested, polls })
