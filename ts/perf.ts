// The performance overlay's numbers, as `App.perf(mode, on_stats)` hands them to JavaScript:
// one object a second, built in Rust from samples it keeps itself (nothing crosses per frame).

/** Where the overlay's numbers go: drawn in the window, logged to stderr, both, or neither. */
export type PerfMode = "overlay" | "log" | "overlay,log" | "none"

/** One second of a window's frames. Times are milliseconds, averaged over drawn frames. */
export interface PerfStats {
  /** The window's key (`"main"` for a single-window app). */
  window: string
  /** Frames drawn in the last second. */
  fps: number
  /** Of those, frames that followed input (pointer moves, clicks, keys, wheel): hover redraws, not animation. */
  input_frames_per_s: number
  /** Time between drawn frames (rests over 250 ms left out): average, 95th percentile, max. */
  frame_ms: number
  frame_p95_ms: number
  frame_max_ms: number
  /** A frame's work, update plus encode, and its worst. */
  work_ms: number
  work_max_ms: number
  /** Work split by where it ran: Rune itself (Rust: events, layout, motion, paint, encode)... */
  rune_ms: number
  /** ...calls from JavaScript into Rust (the bindings, and the Rune work they do)... */
  bindings_ms: number
  /** ...and the app's JavaScript (views, handlers, poll, a compositor's plan), bindings excluded. */
  js_ms: number
  /** Rune's phases: the update (events, poll, the view, layout, paint) and the encode. */
  update_ms: number
  encode_ms: number
  /** The JavaScript view call alone, and how often it ran. */
  view_ms: number
  views_per_s: number
  unchanged_per_s: number
  skipped_per_s: number
  /** Presented frames and the pacing mode, when the platform reports them. */
  presents_per_s: number | null
  pacing: string | null
  /** Turns of Rune's loop from JavaScript: average time, ticks a second, ticks that turned it, share of the thread. */
  loop_ms: number
  ticks_per_s: number
  turns_per_s: number
  loop_busy_pct: number
  /** The process's physical footprint; null where Rune's procwatch can't read it (all but macOS). */
  memory_mb: number | null
}
