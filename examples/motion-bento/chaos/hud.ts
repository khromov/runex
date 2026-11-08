// The stress HUD's numbers, shared so both builds show the same thing: the last `GRAPH`
// frames' build times against the 120 Hz and 60 Hz budgets, a big readout, and frame rate.
//
// Live, the HUD reads the frames the meter has seen, and its frame rate and misses are the
// window's. Replaying (`--hud-from`), it reads a measured run's per-frame CSV by show time, so a
// capture run, whose own frames the capture slows, shows what the clean run measured at the same
// moment; its frame rate is then what that CPU cost allows at 120 Hz, nothing presented.
//
// Port of vendor/rune/examples/motion-bento/chaos/src/hud.rs. f32 values are rounded to f32
// after every step (`F`).

import { readFileSync } from "node:fs"
import { as_u32, as_usize, fixed, fmax, parse_f32, partition_point, round, total_cmp } from "./fmt.ts"
import type { Meter } from "./meter.ts"

const F = Math.fround

export const BUDGET_120 = F(1000.0 / 120.0)
export const BUDGET_60 = F(1000.0 / 60.0)
/** Frames in the graph. */
export const GRAPH = 120
/** The graph's top, in ms. */
export const GRAPH_MAX = 40.0
/** Frames the big readout takes the median of. */
const READOUT = 15

/** A measured run's frames: show time and build ms, by show time. */
export class Replay {
  #samples: [number, number][]

  private constructor(samples: [number, number][]) {
    this.#samples = samples
  }

  /** Reads `Meter.frames_csv` output. */
  static load(path: string): { Ok: Replay } | { Err: string } {
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch (e) {
      return { Err: `${path}: ${(e as Error).message}` }
    }
    const samples: [number, number][] = []
    // `str::lines`: split at `\n`, drop one `\r` before it, and no empty line after a final `\n`.
    const lines = text.split("\n")
    if (lines.at(-1) === "") lines.pop()
    for (const raw of lines.slice(1)) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
      const f = line.split(",")
      if (f.length < 3) continue
      const t = parse_f32(f[0]!)
      const ms = parse_f32(f[2]!)
      if (t !== null && ms !== null && Number.isFinite(t)) {
        samples.push([t, ms])
      }
    }
    samples.sort((a, b) => total_cmp(a[0], b[0]))
    return { Ok: new Replay(samples) }
  }

  /** The frames at or before show time `t`. */
  until(t: number): [number, number][] {
    const at = F(F(t) + F(1e-4))
    return this.#samples.slice(0, partition_point(this.#samples, (s) => s[0] <= at))
  }
}

/** 0 within the 120 Hz budget, 1 within 60 Hz, 2 over. */
export function grade(ms: number): number {
  if (ms <= BUDGET_120) {
    return 0
  } else if (ms <= BUDGET_60) {
    return 1
  } else {
    return 2
  }
}

function pct(v: number[], p: number): number {
  if (v.length === 0) {
    return 0.0
  }
  v.sort(total_cmp)
  return v[as_usize(round(F(F(v.length - 1) * F(p))))]!
}

export class Readout {
  /** Oldest first, at most `GRAPH`. */
  graph: number[] = []
  /** The median of the last few frames. */
  ms = 0.0
  p95 = 0.0
  fps = 0.0
  /** Refreshes missed: live, all run; replayed, in the last second. */
  missed = 0
  source = ""

  static default(): Readout {
    return new Readout()
  }

  static #of(samples: Iterable<[number, number]>): Readout {
    const all = [...samples].map((s) => s[1])
    const graph = all.slice(Math.max(all.length - GRAPH, 0))
    const out = Readout.default()
    out.graph = graph
    out.ms = pct(graph.slice(Math.max(graph.length - READOUT, 0)), 0.5)
    out.p95 = pct([...graph], 0.95)
    return out
  }

  /** From a measured run: the frame rate this CPU cost allows at 120 Hz. */
  static replay(r: Replay, t: number): Readout {
    const out = Readout.#of(r.until(t))
    const refreshes = out.graph.reduce((sum, ms) => sum + as_u32(fmax(Math.ceil(F(ms / BUDGET_120)), 1.0)), 0)
    out.missed = Math.max(refreshes - out.graph.length, 0)
    out.fps = refreshes > 0 ? F(F(120.0 * out.graph.length) / F(refreshes)) : 0.0
    out.source = "measured headless · live pending"
    return out
  }

  static live(m: Meter): Readout {
    const out = Readout.#of(m.tail(GRAPH))
    const recent = m.recent()
    out.fps = F(recent.fps)
    out.missed = recent.dropped
    out.source = "live window"
    return out
  }

  big(): string {
    return `${fixed(this.ms, 1)} ms`
  }

  detail(): string {
    return `build + layout + paint · p95 ${fixed(this.p95, 1)}`
  }

  rate(): string {
    if (this.source === "live window") {
      return `${fixed(this.fps, 0)} fps · missed ${this.missed}`
    } else {
      return `≈ ${fixed(this.fps, 0)} fps at 120 Hz · ${this.missed} missed / s`
    }
  }
}

// The Rust module's `#[cfg(test)] mod tests` is `cargo test` code, not part of the app
// (docs/porting.md, Limits).
