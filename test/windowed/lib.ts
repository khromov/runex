// Helpers for the windowed tests (test/windowed/windowed.test.ts): when to run, how to run a
// fixture in its own process, and how to read what it left behind.
//
// Gating, decided once per `bun test` process:
//
// - RUNEX_WINDOWED=1 runs the tests and makes a window that doesn't open a failure (CI sets it).
// - RUNEX_WINDOWED=0 skips them.
// - Otherwise they run on macOS when not in CI and not over SSH, and on Linux when DISPLAY or
//   WAYLAND_DISPLAY is set, once a one-frame probe window has opened. Anything else skips every
//   test; the reason is printed once (`[windowed] every test skips: ...`) and is in each
//   skipped test's name.
//
// Other environment variables:
//
// - RUNEX_WINDOWED_RUNTIMES: the runtimes to run each fixture on (default `bun,node`).
// - RUNEX_WINDOWED_PENDING=run: run the tests listed in PENDING as ordinary tests, to check a fix.
//   Otherwise they are `test.todo`, printed as pending at the start (`bun test --todo` runs them
//   too, and fails one that passes, as a reminder to delete its entry).
import { test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { renderEnv } from "../../scripts/lib/env.ts"

export const REPO = resolve(import.meta.dir, "../..")
export const FIXTURES = join(import.meta.dir, "fixtures")
export const RUNTIMES = (process.env.RUNEX_WINDOWED_RUNTIMES ?? "bun,node").split(",").map((r) => r.trim()).filter(Boolean)
export const MAC = process.platform === "darwin"
export const LINUX = process.platform === "linux"
export const WINDOWS = process.platform === "win32"

/**
 * Windows only: how long Rune keeps presenting every refresh after a frame that drew something
 * new (`STEADY` in vendor/rune/crates/rune/src/window/draw.rs: with G-SYNC or FreeSync, a
 * window's lone presents would swing the display's refresh rate). Rust's windows do the same.
 */
export const STEADY_HOLD_MS = 1000

/** Input polling slowed to once a second: frames must then come from Rune's wakes, not from input checks. */
export const SLOW_POLL = { RUNEX_ACTIVE_MS: "1000", RUNEX_IDLE_MS: "1000" }

/**
 * Tests that fail today because of event-loop bugs being fixed elsewhere, by id. Each is run as
 * `test.todo` with its reason where `when` holds. Delete an entry once its fix has landed.
 */
export const PENDING: Record<string, { when: (runtime: string) => boolean; reason: string }> = {}

function pending(id: string | undefined, runtime: string): string | null {
  if (!id || process.env.RUNEX_WINDOWED_PENDING === "run") return null
  const p = PENDING[id]
  return p && p.when(runtime) ? p.reason : null
}

export type Run = {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  /** The fixture's `RESULT {json}` line, parsed; null if it printed none. */
  result: any
  /** Wall time from spawn to exit, and the spawn's `performance.now()` in this process. */
  ms: number
  startedAt: number
  timedOut: boolean
}

export type RunOptions = {
  env?: Record<string, string>
  /** Killed (SIGTERM, then SIGKILL) after this many ms. */
  timeoutMs?: number
  /** Extra runtime flags before the script (`--hot`). */
  runtimeArgs?: string[]
  cwd?: string
  /** Called with the process once it has started, to feed its stdin or watch its output. */
  drive?: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">, out: { stdout: string; stderr: string }) => Promise<void> | void
}

/**
 * Runs `script` (absolute, or relative to the repo) on `runtime` with `args`. The environment is
 * the test's own, without the knobs that change what a fixture draws or measures (RUNEX_PERF,
 * RUNEX_TITLEBAR and the input-poll intervals) unless `env` sets them.
 */
export async function runFixture(runtime: string, script: string, args: string[] = [], opts: RunOptions = {}): Promise<Run> {
  const env = renderEnv(opts.env, ["RUNEX_ACTIVE_MS", "RUNEX_IDLE_MS", "FIXTURE_MS"])
  const start = performance.now()
  const proc = Bun.spawn([runtime, ...(opts.runtimeArgs ?? []), script, ...args], {
    cwd: opts.cwd ?? REPO, env, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  })
  const out = { stdout: "", stderr: "" }
  const pump = async (stream: ReadableStream<Uint8Array>, key: "stdout" | "stderr") => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) out[key] += decoder.decode(chunk, { stream: true })
  }
  const reading = Promise.all([pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr")])
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref()
  }, opts.timeoutMs ?? 30000)
  try {
    if (opts.drive) await opts.drive(proc, out)
    await proc.exited
  } finally {
    clearTimeout(timeout)
  }
  await reading
  const line = out.stdout.split("\n").findLast((l) => l.startsWith("RESULT "))
  return {
    code: proc.exitCode, signal: proc.signalCode === null ? null : String(proc.signalCode), stdout: out.stdout, stderr: out.stderr,
    result: line ? JSON.parse(line.slice("RESULT ".length)) : null, ms: performance.now() - start, startedAt: start, timedOut,
  }
}

/** The fixture path for `name` (`fixtures/<name>.ts`). */
export const fixture = (name: string) => join(FIXTURES, `${name}.ts`)

/**
 * A fresh temporary directory, removed by `cleanup()`. Its real path: on GitHub's Windows runners
 * tmpdir() is an 8.3 short path (C:\Users\RUNNER~1\...), and `bun --hot` then sees the long path
 * of a module as outside the project and doesn't watch it.
 */
export function scratch(): { dir: string; cleanup: () => void } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "runex-windowed-")))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A `--native --trace` file: the display's refresh rate from its header and each frame's time, ms after the first frame. */
export function readTrace(path: string): { hz: number; frames: number[]; lines: number } {
  if (!existsSync(path)) return { hz: 0, frames: [], lines: 0 }
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "")
  const header = lines.length ? JSON.parse(lines[0]!) : {}
  const ts = lines.slice(1).map((l) => JSON.parse(l).t as number).filter((t) => Number.isFinite(t))
  const t0 = ts[0] ?? 0
  return { hz: Number(header.hz) || 0, frames: ts.map((t) => t - t0), lines: lines.length }
}

/** How many of `xs` fall in [from, to). */
export const within = (xs: number[], from: number, to: number) => xs.filter((x) => x >= from && x < to).length

/** The longest gap between consecutive `xs` that reaches into [from, to): a stall there. */
export function maxGap(xs: number[], from: number, to: number): number {
  let gap = 0
  for (let i = 1; i < xs.length; i++) if (xs[i]! >= from && xs[i - 1]! < to) gap = Math.max(gap, xs[i]! - xs[i - 1]!)
  return gap
}

/** Prints a measured number with the test output. */
export function report(label: string, data: Record<string, unknown>) {
  const parts = Object.entries(data).map(([k, v]) => `${k} ${typeof v === "number" ? Math.round(v * 10) / 10 : JSON.stringify(v)}`)
  console.log(`  [windowed] ${label}: ${parts.join(", ")}`)
}

/** What a failed fixture printed, for an assertion's message. */
export function describeRun(run: Run): string {
  const tail = (s: string) => s.split("\n").filter((l) => l.trim()).slice(-12).join("\n    ")
  return `exit ${run.code}${run.signal ? ` (${run.signal})` : ""}${run.timedOut ? " after the timeout" : ""} in ${Math.round(run.ms)} ms\n  stdout:\n    ${tail(run.stdout)}\n  stderr:\n    ${tail(run.stderr)}`
}

type Gate = { run: boolean; reason: string; error: string | null; probeMs: number | null }

function environment(): { forced: boolean; reason: string | null } {
  const flag = process.env.RUNEX_WINDOWED
  if (flag === "1") return { forced: true, reason: null }
  if (flag === "0") return { forced: false, reason: "RUNEX_WINDOWED=0" }
  if (process.env.CI) return { forced: false, reason: "in CI without RUNEX_WINDOWED=1" }
  if (MAC) {
    if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) return { forced: false, reason: "over SSH (RUNEX_WINDOWED=1 forces it)" }
    return { forced: false, reason: null }
  }
  if (LINUX) return process.env.DISPLAY || process.env.WAYLAND_DISPLAY
    ? { forced: false, reason: null }
    : { forced: false, reason: "no DISPLAY or WAYLAND_DISPLAY (run under xvfb-run, or RUNEX_WINDOWED=1 to force)" }
  return { forced: false, reason: `on ${process.platform} only with RUNEX_WINDOWED=1` }
}

/** Opens examples/hello for one frame. Null when it did; otherwise what went wrong. */
async function probe(): Promise<{ error: string | null; ms: number }> {
  const s = scratch()
  const runtime = RUNTIMES[0] ?? "bun"
  try {
    const trace = join(s.dir, "probe.jsonl")
    const run = await runFixture(runtime, "examples/hello/main.ts", ["--native", "--trace", trace, "--frames", "1"], { timeoutMs: 30000 })
    const lines = readTrace(trace).lines
    if (run.code === 0 && lines >= 2) return { error: null, ms: run.ms }
    return { error: `the probe window (examples/hello --native --frames 1) drew ${Math.max(0, lines - 1)} frames, ${describeRun(run)}`, ms: run.ms }
  } catch (error) {
    return { error: `the probe couldn't start ${runtime}: ${error instanceof Error ? error.message : error}`, ms: 0 }
  } finally {
    s.cleanup()
  }
}

let gate: Promise<Gate> | undefined

/** Whether the windowed tests run here, and if not, why (decided once per process). */
export function windowGate(): Promise<Gate> {
  gate ??= (async () => {
    const env = environment()
    if (env.reason) return { run: false, reason: env.reason, error: null, probeMs: null }
    const p = await probe()
    if (!p.error) return { run: true, reason: "", error: null, probeMs: p.ms }
    if (env.forced) return { run: true, reason: "", error: `RUNEX_WINDOWED=1, but no window opened: ${p.error}`, probeMs: p.ms }
    return { run: false, reason: `no window opened (${p.error.split("\n")[0]})`, error: null, probeMs: p.ms }
  })()
  return gate
}

/**
 * `test`, gated: skipped with the reason when windows can't open here, failing at once when
 * RUNEX_WINDOWED=1 and the probe window didn't open, and `test.todo` when `pendingId` names a
 * PENDING entry that applies to `runtime`.
 */
export function windowedTest(g: Gate, name: string, fn: () => Promise<void>, opts: { timeout?: number; runtime?: string; pending?: string } = {}) {
  const timeout = opts.timeout ?? 30000
  if (!g.run) return test.skip(`${name} [skipped: ${g.reason}]`, fn)
  const why = pending(opts.pending, opts.runtime ?? "")
  if (why) return test.todo(`${name} [pending: ${why}]`, fn, timeout)
  test(name, async () => {
    if (g.error) throw new Error(g.error)
    await fn()
  }, timeout)
}
