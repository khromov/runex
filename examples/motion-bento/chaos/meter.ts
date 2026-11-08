// The frame meter both builds feed, one call per drawn frame, so their numbers mean the same.
//
// It keeps each frame's start time, its CPU work (whatever span the build can time: see each
// build's README) and, where a build can split it out, the part that builds the frame: view,
// layout and paint, without the GPU encode. From those it derives frame-start intervals, missed frames (an interval over
// 1.5 refresh periods) and percentiles, and it samples the process's CPU time and memory from
// procwatch.
//
// Port of vendor/rune/examples/motion-bento/chaos/src/meter.rs. Instants are seconds on runex's
// `instant_now()` clock, the one `FrameEncoded` reports. Rust reads CPU time through libc
// (`clock_gettime(CLOCK_THREAD_CPUTIME_ID)`, `getrusage`) and procwatch; here it comes from
// `process.threadCpuUsage()` and `process.cpuUsage()` (NaN, as in Rust, where a read fails).
// procwatch's memory has no binding: the resident size is `process.memoryUsage().rss`, and the
// physical footprint, which nothing in Node or Bun reads, is 0, as procwatch leaves it where it
// can't read it (every platform but macOS).

import { writeFileSync } from "node:fs"
import { instant_now } from "runex-js"
import { as_usize, fixed, partition_point, round, total_cmp } from "./fmt.ts"

const F = Math.fround

type Frame = {
  /** Seconds since the meter started. */
  start: number
  work_ms: number
  /** NaN when the build can't split it out. */
  build_ms: number
  /** The show time and load the app tagged the frame with (`Meter.tag`). */
  show: number
  load: number
  /**
   * CPU time since the frame before: this thread's, and the whole process's. Unlike the
   * spans above, a busy machine that preempts the app doesn't add to them.
   */
  cpu_ms: number
  proc_ms: number
}

/** An interval longer than this is the window resting, not a slow frame. */
const IDLE_GAP = 0.1

export type Summary = {
  frames: number
  seconds: number
  fps: number
  interval_ms: [number, number, number, number]
  work_ms: [number, number, number, number]
  /** View, layout and paint only; `null` when no frame reported it. */
  build_ms: [number, number, number, number] | null
  /** Intervals over 1.5 refresh periods. */
  late: number
  /** Refreshes those late intervals skipped. */
  dropped: number
  idle_gaps: number
  cpu_percent: number
  footprint_mb: number
  footprint_peak_mb: number
  resident_mb: number
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0.0
  }
  const i = as_usize(round((sorted.length - 1) * p))
  return sorted[i]!
}

/** p50, p95, p99 and max of `v`. */
function spread(v: number[]): [number, number, number, number] {
  v.sort(total_cmp)
  return [pct(v, 0.5), pct(v, 0.95), pct(v, 0.99), v.at(-1) ?? 0.0]
}

/** procwatch's `snapshot().cpu_s`: the process's CPU seconds, user and system; 0 where it can't be read. */
function cpu_seconds(): number {
  try {
    const u = process.cpuUsage()
    return u.user * 1e-6 + u.system * 1e-6
  } catch {
    return 0.0
  }
}

/** This thread's CPU seconds, and the process's (user and system), cheaply enough for every frame. */
function cpu_now(): [number, number] {
  let thread = NaN
  try {
    const u = process.threadCpuUsage?.()
    if (u) thread = u.user * 1e-6 + u.system * 1e-6
  } catch {
    thread = NaN
  }
  let proc = NaN
  try {
    const u = process.cpuUsage()
    proc = u.user * 1e-6 + u.system * 1e-6
  } catch {
    proc = NaN
  }
  return [thread, proc]
}

/** procwatch's `usage()`: the physical footprint (unreadable here) and the resident size, `null` where unread. */
function usage(): { footprint: number | null; resident: number | null } {
  let resident: number | null = null
  try {
    resident = process.memoryUsage.rss()
  } catch {
    resident = null
  }
  return { footprint: null, resident }
}

export class Meter {
  #framework: string
  #refresh_hz: number
  #t0: number
  #cpu0: number
  #frames: Frame[] = []
  #footprint_peak = 0
  #footprint_last = 0
  #footprint_at = -1.0
  #resident_last = 0
  /** Seconds since the meter started that bound what `Meter.summary` counts. */
  #window: [number, number] | null = null
  #extra: [string, string][] = []
  #tag: [number, number] = [NaN, 0]
  /** Thread and process CPU seconds at the last frame. */
  #cpu_last: [number, number]

  private constructor(framework: string, refresh_hz: number) {
    this.#framework = framework
    this.#refresh_hz = refresh_hz
    this.#t0 = instant_now()
    this.#cpu0 = cpu_seconds()
    this.#cpu_last = cpu_now()
  }

  static new(framework: string, refresh_hz: number): Meter {
    const m = new Meter(framework, refresh_hz)
    m.#sample_memory(0.0)
    return m
  }

  set_refresh(hz: number): void {
    if (hz > 1.0) {
      this.#refresh_hz = hz
    }
  }

  refresh_hz(): number {
    return this.#refresh_hz
  }

  /** Seconds since the meter started. */
  now(): number {
    return Math.max(instant_now() - this.#t0, 0.0)
  }

  seconds_at(at: number): number {
    return Math.max(at - this.#t0, 0.0)
  }

  /** Restarts the CPU count from here, and counts only frames from now on. */
  begin(): void {
    const now = this.now()
    this.#cpu0 = cpu_seconds()
    this.#window = [now, Infinity]
  }

  /** Stops counting frames from here. */
  end(): void {
    const now = this.now()
    if (this.#window !== null) {
      this.#window = [this.#window[0], now]
    }
  }

  /** Adds a line to the JSON (a build's version, how it timed work). */
  note(key: string, value: string): void {
    this.#extra.push([key, value])
  }

  /** One drawn frame that started at `start` and took `work_ms` of CPU. */
  frame(start: number, work_ms: number): void {
    this.#push(start, work_ms, NaN)
  }

  /** One drawn frame whose `work_ms` includes `build_ms` of view, layout and paint. */
  frame_with_build(start: number, work_ms: number, build_ms: number): void {
    this.#push(start, work_ms, F(build_ms))
  }

  /** Tags the frames reported from here with the show time and load they drew. */
  tag(show: number, load: number): void {
    this.#tag = [F(show), load >>> 0]
  }

  #push(start: number, work_ms: number, build_ms: number): void {
    const s = this.seconds_at(start)
    const [show, load] = this.#tag
    const cpu = cpu_now()
    const [cpu_ms, proc_ms] = [F((cpu[0] - this.#cpu_last[0]) * 1000.0), F((cpu[1] - this.#cpu_last[1]) * 1000.0)]
    this.#cpu_last = cpu
    this.#frames.push({ start: s, work_ms: F(work_ms), build_ms, show, load, cpu_ms, proc_ms })
    if (s - this.#footprint_at >= 0.5) {
      this.#sample_memory(s)
    }
  }

  #sample_memory(at: number): void {
    const u = usage()
    this.#footprint_last = u.footprint ?? 0
    this.#resident_last = u.resident ?? 0
    this.#footprint_peak = Math.max(this.#footprint_peak, this.#footprint_last)
    this.#footprint_at = at
  }

  #counted(): Frame[] {
    if (this.#window === null) return this.#frames
    const [from, to] = this.#window
    const a = partition_point(this.#frames, (f) => f.start < from)
    const b = partition_point(this.#frames, (f) => f.start <= to)
    return this.#frames.slice(a, Math.max(a, b))
  }

  #summarise(frames: Frame[], seconds: number, cpu_s: number): Summary {
    const period = 1.0 / this.#refresh_hz
    const intervals: number[] = []
    let [late, dropped, idle_gaps] = [0, 0, 0]
    for (let i = 0; i + 1 < frames.length; i++) {
      const iv = frames[i + 1]!.start - frames[i]!.start
      if (iv > IDLE_GAP) {
        idle_gaps += 1
        continue
      }
      intervals.push(iv * 1000.0)
      if (iv > 1.5 * period) {
        late += 1
        dropped += Math.max(as_usize(round(iv / period)) - 1, 0)
      }
    }
    const mb = (b: number) => b / 1_048_576.0
    const builds = frames.filter((f) => !Number.isNaN(f.build_ms)).map((f) => f.build_ms)
    return {
      frames: frames.length,
      seconds,
      fps: seconds > 0.0 ? frames.length / seconds : 0.0,
      interval_ms: spread(intervals),
      work_ms: spread(frames.map((f) => f.work_ms)),
      build_ms: builds.length !== 0 ? spread(builds) : null,
      late,
      dropped,
      idle_gaps,
      cpu_percent: seconds > 0.0 ? (100.0 * cpu_s) / seconds : 0.0,
      footprint_mb: mb(this.#footprint_last),
      footprint_peak_mb: mb(this.#footprint_peak),
      resident_mb: mb(this.#resident_last),
    }
  }

  /** The whole counted window. Reads the process's CPU time, so call it once at the end. */
  summary(): Summary {
    const now = this.now()
    this.#sample_memory(now)
    const [from, to] = this.#window ?? [0.0, now]
    const seconds = Math.min(to, now) - from
    const cpu = cpu_seconds() - this.#cpu0
    return this.#summarise(this.#counted(), seconds, cpu)
  }

  /** The last second, for the HUD. CPU% there is left at 0: reading it costs a thread walk. */
  recent(): Summary {
    const now = this.now()
    const a = partition_point(this.#frames, (f) => f.start < now - 1.0)
    const s = this.#summarise(this.#frames.slice(a), 1.0, 0.0)
    const total = this.#summarise(this.#counted(), 1.0, 0.0)
    s.late = total.late
    s.dropped = total.dropped
    return s
  }

  /** Short HUD lines. */
  hud(): [string, string, string, string] {
    const s = this.recent()
    return [
      `${this.#framework} · ${fixed(this.#refresh_hz, 0)} Hz display`,
      `${fixed(s.fps, 0)} fps · interval p95 ${fixed(s.interval_ms[1], 1)} ms`,
      `work p50 ${fixed(s.work_ms[0], 2)} · p95 ${fixed(s.work_ms[1], 2)} ms`,
      `missed ${s.dropped} · ${fixed(s.footprint_mb, 0)} MB`,
    ]
  }

  /** The summary as JSON, with the build's notes. */
  json(): string {
    const s = this.summary()
    const arr = (v: number[]) => `{"p50": ${fixed(v[0]!, 3)}, "p95": ${fixed(v[1]!, 3)}, "p99": ${fixed(v[2]!, 3)}, "max": ${fixed(v[3]!, 3)}}`
    let out = "{\n"
    out += `  "framework": "${this.#framework}",\n`
    out += `  "refresh_hz": ${fixed(this.#refresh_hz, 2)},\n`
    out += `  "seconds": ${fixed(s.seconds, 3)},\n`
    out += `  "frames": ${s.frames},\n`
    out += `  "fps": ${fixed(s.fps, 2)},\n`
    out += `  "interval_ms": ${arr(s.interval_ms)},\n`
    out += `  "work_ms": ${arr(s.work_ms)},\n`
    if (s.build_ms !== null) {
      out += `  "build_ms": ${arr(s.build_ms)},\n`
    }
    out += `  "late_intervals": ${s.late},\n`
    out += `  "dropped_frames": ${s.dropped},\n`
    out += `  "idle_gaps": ${s.idle_gaps},\n`
    out += `  "cpu_percent": ${fixed(s.cpu_percent, 2)},\n`
    out += `  "footprint_mb": ${fixed(s.footprint_mb, 2)},\n`
    out += `  "footprint_peak_mb": ${fixed(s.footprint_peak_mb, 2)},\n`
    out += `  "resident_mb": ${fixed(s.resident_mb, 2)}`
    for (const [k, v] of this.#extra) {
      out += `,\n  "${k}": "${v.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`
    }
    out += "\n}\n"
    return out
  }

  /** The last `n` frames' show time and build time (work where the build can't split it). */
  *tail(n: number): IterableIterator<[number, number]> {
    for (const f of this.#frames.slice(Math.max(this.#frames.length - n, 0))) {
      yield [f.show, Number.isNaN(f.build_ms) ? f.work_ms : f.build_ms]
    }
  }

  /**
   * Every frame as CSV, one line each: `show_s,load,build_ms,work_ms,start_s,cpu_ms,proc_ms`
   * (`cpu_ms` and `proc_ms` are the CPU time since the frame before, thread and process).
   */
  frames_csv(): string {
    let out = "show_s,load,build_ms,work_ms,start_s,cpu_ms,proc_ms\n"
    for (const f of this.#frames) {
      out += `${fixed(f.show, 4)},${f.load},${fixed(f.build_ms, 4)},${fixed(f.work_ms, 4)},${fixed(f.start, 4)},${fixed(f.cpu_ms, 4)},${fixed(f.proc_ms, 4)}\n`
    }
    return out
  }

  write(path: string): void {
    const json = this.json()
    writeFileSync(path, json)
  }
}

// The Rust module's `#[cfg(test)] mod tests` is `cargo test` code, not part of the app
// (docs/porting.md, Limits).
