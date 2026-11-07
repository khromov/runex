// Idle CPU: a still window costs almost nothing. The app opens, settles (ts/loop.ts polls for
// input every 8 ms for its first 2 s of stillness, then every 16 ms), and after SETTLE + 1 s
// samples `process.cpuUsage()` over FIXTURE_MS (default 3000); then it quits.
//
//   bun test/windowed/fixtures/idle.ts
//
// RESULT: the process's CPU over the sample as a percentage of one core, and how many frames
// ran during it (a still window should draw none).
import { App, AppSpec, col, el, text, tok } from "runex-js"
import { corner, deadline, now, result } from "./common.ts"

const SAMPLE_MS = Number(process.env.FIXTURE_MS ?? 3000)
const SETTLE_MS = 3000
deadline(SETTLE_MS + SAMPLE_MS + 15000)

let polls = 0
const app = App.new({
  ...AppSpec.new<{ on: boolean }>("Idle", [320, 200], () => ({ on: false }), (s) => {
    const t = tok.theme(true)
    return col().key("root").w_full().h_full().center().gap(16).fill(t.bg)
      .child(text("Still").font(tok.type_.TITLE).color(t.text))
      .child(el().key("switch").size(38, 22).radius(11).fill(s.on ? tok.accent(0, true) : t.control_off))
  }),
  poll: () => {
    polls++
    return false
  },
})
  .window_options(corner())
  .args([])
const handle = app.handle()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
void (async () => {
  await sleep(SETTLE_MS)
  const cpu0 = process.cpuUsage()
  const t0 = now()
  const polls0 = polls
  await sleep(SAMPLE_MS)
  const cpu = process.cpuUsage(cpu0)
  const wall = now() - t0
  const pct = ((cpu.user + cpu.system) / 1000 / wall) * 100
  result({ cpuPct: Math.round(pct * 100) / 100, userMs: Math.round(cpu.user / 1000), systemMs: Math.round(cpu.system / 1000), wallMs: Math.round(wall), frames: polls - polls0 })
  handle.quit()
})()
await app.run()
