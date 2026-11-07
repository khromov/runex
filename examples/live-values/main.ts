// Sixteen speaking rings at 60 Hz and four remote cursors at 120 Hz, bound to `Live` values: a
// background producer in the window, the same scripted values at virtual time headless (README.md).

import { AppSpec, Color, type Cx, type El, Env, Live, Spring, type Tx, type Waker, col, el, extra_args, row, run } from "runex-js"
// `rune::Runtime` (only `--bench` uses it) isn't bound yet: bench_mode looks it up at run time, so
// the module still loads without it (docs/porting.md, "Limits").
import * as rune from "runex-js"

// Rust's f32 math rounds every step.
const f32 = Math.fround

let WINDOWED = false

type State = {
  levels: number[] // [f32; 16]
  cursors: [number, number][] // [[f32; 2]; 4]
  tick: number
  live_levels: Live[] // [Live<f32>; 16]
  live_cursors: Live[] // [Live<[f32; 2]>; 4]
  rebuild: boolean
  smooth: boolean
}

function init(): State {
  const s: State = { levels: Array.from({ length: 16 }, () => 0.5), cursors: Array.from({ length: 4 }, (): [number, number] => [0.0, 0.0]), tick: 0,
    live_levels: Array.from({ length: 16 }, () => Live.new(0.5)),
    live_cursors: Array.from({ length: 4 }, () => Live.new([0.0, 0.0])),
    rebuild: extra_args().some((a: string) => a === "--rebuild"), smooth: false }
  sample(s, 0)
  return s
}

function sample(s: State, tick: number) {
  if (tick % 2 === 0) {
    for (let i = 0; i < s.levels.length; i++) {
      s.levels[i] = f32(0.5 + f32(f32(0.45) * f32(Math.sin(f32(f32(f32(tick / 120.0) * 3.0) + i)))))
    }
  }
  for (let i = 0; i < s.cursors.length; i++) {
    const t = f32(f32(tick / 120.0) + i)
    s.cursors[i] = [f32(250.0 + f32(180.0 * f32(Math.sin(t)))), f32(190.0 + f32(120.0 * f32(Math.cos(f32(t * f32(0.7))))))]
  }
  if (!s.rebuild) {
    s.live_levels.forEach((live, i) => { live.set(s.levels[i]!) })
    s.live_cursors.forEach((live, i) => { live.set(s.cursors[i]!) })
  }
}

function poll(s: State, t: number, tx: Tx): boolean {
  if (WINDOWED && !s.rebuild) return false
  const tick = Math.round(Math.min(t, 4.0) * 120.0)
  if (tick === s.tick) return false
  s.tick = tick
  sample(s, tick)
  tx.instant()
  return s.rebuild
}

function view(s: State, _: Cx): El {
  const green = new Color({ r: 0.1, g: 0.8, b: 0.4, a: 1.0 })
  let grid = col().gap(20.0).padding(40.0)
  for (let y = 0; y < 4; y++) {
    let line = row().gap(24.0)
    for (let x = 0; x < 4; x++) {
      const i = y * 4 + x
      const ring = el().key(`speaker-${i}`).size(64.0, 64.0)
        .radius(32.0).border(3.0, green)
      line = line.child(s.rebuild ? ring.opacity(s.levels[i]!) : ring.live_opacity(s.live_levels[i]!))
    }
    grid = grid.child(line)
  }
  let root = el().fill(new Color({ r: 0.018, g: 0.024, b: 0.03, a: 1.0 }))
    .size(560.0, 440.0).child(grid)
  s.cursors.forEach((p, i) => {
    const cursor = el().key(`cursor-${i}`).size(12.0, 18.0).radius(3.0).fill(green)
    let child: El
    if (s.rebuild) child = cursor.pin(p[0], p[1], null, null)
    else {
      const pinned = cursor.pin(0.0, 0.0, null, null)
      if (s.smooth) child = pinned.live_offset(s.live_cursors[i]!.smooth(Spring.new(0.16, 0.0)))
      else child = pinned.live_offset(s.live_cursors[i]!)
    }
    root = root.child(child)
  })
  return root
}

function bench_mode(rebuild: boolean) {
  // @ts-expect-error `rune::Runtime` isn't bound yet (docs/porting.md), so `--bench` stops here.
  const Runtime = rune.Runtime
  if (Runtime === undefined) throw new Error("--bench drives a headless rune::Runtime, which runex doesn't bind yet (docs/porting.md, 'Limits')")
  const medians: number[] = []
  for (let run = 0; run < 8; run++) {
    const state = init(); state.rebuild = rebuild
    const rt = Runtime.new(state, view, [560.0, 440.0], Env.new(true, 2.0))
    // Arc<AtomicUsize>: one counter the waker and this loop share.
    const wakes = { count: 0 }; const count = wakes
    rt.set_live_waker(() => { count.count += 1 })
    rt.poll = poll
    rt.frame(0.0)
    const times: number[] = []
    for (let k = 0; k < 480; k++) {
      const start = performance.now()
      rt.frame(1.0 / 120.0)
      times.push((performance.now() - start) * 1e3)
    }
    times.sort((a, b) => a - b)
    if (run > 0) medians.push(times[Math.trunc(times.length / 2)]!)
    if (run === 7 && !rebuild) {
      const wake_count = wakes.count
      let frames = 0
      for (let k = 0; k < 1200; k++) {
        sample(rt.state, 480)
        if (rt.live_pending() || rt.animating) { rt.frame(1.0 / 120.0); frames += 1 }
      }
      console.log(`METRIC simulated_wakes_per_second=${wake_count / 4.0} idle_frames=${frames} idle_wakes=${wakes.count - wake_count}`)
    }
  }
  medians.sort((a, b) => a - b)
  // `{medians:?}`: Rust's Debug prints a whole f64 with a trailing `.0`.
  const runs = `[${medians.map((m) => Number.isInteger(m) ? `${m}.0` : `${m}`).join(", ")}]`
  console.log(`METRIC ${rebuild ? "rebuild" : "live"}_cpu_us_median=${medians[3]!.toFixed(3)} runs=${runs}`)
}

/** `std::thread::sleep`, for the producer tasks below (JavaScript's threads are timers). */
function sleep(secs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000))
}

function setup(s: State, wake: Waker) {
  if (!WINDOWED) return
  if (s.rebuild) {
    void (async () => {
      for (let k = 0; k < 480; k++) { await sleep(1.0 / 120.0); wake.wake() }
    })()
    return
  }
  const levels = s.live_levels.map((level) => level.clone())
  const cursors = s.live_cursors.map((cursor) => cursor.clone())
  void (async () => {
    const start = performance.now() / 1000
    for (let tick = 1; tick <= 480; tick++) {
      await sleep(Math.max(0, start + tick / 120.0 - performance.now() / 1000))
      if (tick % 2 === 0) {
        levels.forEach((level, i) => { level.set(f32(0.5 + f32(f32(0.45) * f32(Math.sin(f32(f32(f32(tick / 120.0) * 3.0) + i)))))) })
      }
      cursors.forEach((cursor, i) => {
        const t = f32(f32(tick / 120.0) + i)
        cursor.set([f32(250.0 + f32(180.0 * f32(Math.sin(t)))), f32(190.0 + f32(120.0 * f32(Math.cos(f32(t * f32(0.7))))))])
      })
    }
  })()
}

function main() {
  const args = process.argv.slice(2)
  if (args.some((a) => a === "--bench")) { bench_mode(true); return bench_mode(false) }
  WINDOWED = !args.some((a) => ["--snap", "--trace", "--tree", "--frames", "--strip", "--first-pixels", "--list-scenes"].includes(a))
  run({
    ...AppSpec.new<State>("Live values", [560.0, 440.0], init, view),
    scenes: [["smooth", (s) => { s.smooth = true }]], setup, poll,
  })
}

main()
