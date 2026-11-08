// `rune::tooling`: what a headless run (`--snap`, `--tree`, `--script`, `--video`) was asked to
// do, for an app to read.
import native from "./native.js"
import type * as N from "./native.js"

/** The headless run this process is rendering: its script, timing and output (`rune::tooling::HeadlessRun`). */
export type HeadlessRun = N.HeadlessRun

/** Where a `--desktop` run drew one window from time `t` on (`rune::tooling::WindowFrame`). */
export interface WindowFrame {
  t: number
  key: string
  /** x, y, width, height in output points (script coordinates). */
  frame: [number, number, number, number]
  visible: boolean
  /** The key window, which script keys reach. */
  focused: boolean
}

/**
 * The headless run this process is rendering, or `null` in a window. Set before the app's state
 * is created, so `init`, views and handlers can read it; a `run_windows` factory runs too early
 * to see it.
 */
export const headless_run: () => HeadlessRun | null = native.headless_run
