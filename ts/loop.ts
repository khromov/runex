// Turns a started app's event loop from JavaScript's own.
//
// Rune runs on the main thread, as JavaScript does, so the event loop can't block there.
// Instead the loop is pumped: each tick dispatches what the OS and Rune have queued, then says
// when it next needs a turn: at once when the turn asked for a redraw that only the next turn
// delivers (a frame asking for the next one, on Linux and Windows), as Rust's own loop would.
// Rune's own wakes (display-link frames, handle updates, timers on other threads) call back at
// once; OS input can't, so the app checks for it every `ACTIVE_MS` while in use and every
// `IDLE_MS` once it has been still for `SETTLE_MS`. A check that finds nothing is cheap: the
// native side peeks at the OS queue and turns the loop only when needed.
import type { Pump } from "./native.js"

const ACTIVE_MS = Number(process.env.RUNEX_ACTIVE_MS ?? 8)
const IDLE_MS = Number(process.env.RUNEX_IDLE_MS ?? 16)
const SETTLE_MS = 2000

export function drive(pump: Pump): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let immediate: ReturnType<typeof setImmediate> | undefined
    let done = false

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer)
      if (immediate !== undefined) clearImmediate(immediate)
      timer = immediate = undefined
    }
    const schedule = (ms: number) => {
      if (done) return
      clear()
      if (ms <= 0) immediate = setImmediate(turn)
      else timer = setTimeout(turn, ms)
    }
    function turn() {
      timer = immediate = undefined
      let next: number
      try {
        next = pump.tick()
      } catch (error) {
        console.error(error)
        next = -1
      }
      if (next === -2) {
        done = true
        clear()
        resolve()
        return
      }
      const poll = pump.idle_ms < SETTLE_MS ? ACTIVE_MS : IDLE_MS
      schedule(next < 0 ? poll : Math.min(next, poll))
    }

    pump.set_wake(() => schedule(0))
    turn()
  })
}
