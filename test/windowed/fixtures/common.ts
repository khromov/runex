// Shared by the windowed fixtures. winit allows one event loop per process, so each scenario is
// its own process: it opens a real window, runs, prints one `RESULT {json}` line on stdout and
// exits. test/windowed/lib.ts runs them and parses that line.
//
// Times are `performance.now()` milliseconds. Windows open at the screen's top-left corner, out
// of the pointer's way where possible: pointer movement over a window makes Rune redraw it.
import { WindowOptions } from "runex-js"

/** Prints the scenario's result: the only line the test reads. */
export function result(data: object) {
  process.stdout.write(`RESULT ${JSON.stringify(data)}\n`)
}

export const now = () => performance.now()

/**
 * Exits with code 3 if the scenario hangs. Unref'd, so it never keeps the process alive: the
 * quit scenario checks the process exits on its own.
 */
export function deadline(ms: number) {
  const timer = setTimeout(() => {
    result({ error: `fixture timed out after ${ms} ms` })
    process.exit(3)
  }, ms)
  timer.unref()
}

/** A window at the top-left corner of the main display (physical pixels). */
export function corner(dx = 0): WindowOptions {
  return new WindowOptions({ position: [40 + dx, 80], resizable: false })
}

/** The fixture's own argument (`bun fixture.ts MODE`), before Rune's flags. */
export function mode(fallback: string): string {
  const a = process.argv[2]
  return a && !a.startsWith("--") ? a : fallback
}

/** Rune's arguments for the fixture: everything after the mode, without it. */
export function runeArgs(): string[] {
  const a = process.argv.slice(2)
  return a[0] && !a[0].startsWith("--") ? a.slice(1) : a
}

/** `xs` rounded to `digits` decimals, for compact results. */
export function round(xs: number[], digits = 1): number[] {
  const k = 10 ** digits
  return xs.map((x) => Math.round(x * k) / k)
}
