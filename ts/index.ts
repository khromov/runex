// runex-js: Rune for TypeScript. The API mirrors Rust's `rune` crate, names included: everything
// under ./gen is generated from Rune's own signatures and docs (tools/bindgen).
import type * as N from "./native.js"
import type { Tx } from "./gen/types.js"

export * from "./gen/rune/index.js"
import { realpathSync } from "node:fs"
import { extname, isAbsolute, resolve } from "node:path"
import { extra_args as nativeExtraArgs } from "./gen/rune/index.js"
import { isRunexArg } from "./app.js"

/**
 * The arguments Rune didn't recognise, for the app's own flags (`rune::extra_args`). Read before
 * the app runs, they come from the process's command line, which under `bun`/`node` starts with
 * the runtime's own arguments where a Rust binary's doesn't: its flags and the script's path
 * (`node --no-warnings app.ts`, `bun run app.ts`). Those are left out, as a Rust app would see
 * them, and so are runex's own `--perf` and `--titlebar`. Under `bun --hot`, read them once the app
 * runs: before, Rune takes `--hot` on the command line for its own flag and exits.
 */
export function extra_args(): string[] {
  const args = nativeExtraArgs()
  return args.slice(runtimeArgCount(args)).filter((a) => !isRunexArg(a))
}

/**
 * How many of `args` are the runtime's: those up to and including the script's path, found among
 * the first few (the runtime's flags, Bun's `run`, the path). None when the path isn't there: in
 * a compiled binary, with `-e`, or when the arguments came from `App.args` or a host.
 */
function runtimeArgCount(args: string[]): number {
  const script = process.argv[1]
  if (!script || !isAbsolute(script)) return 0 // `-e`: argv[1] is the first argument
  const end = Math.min(args.length, process.execArgv.length + 2)
  for (let i = 0; i < end; i++) if (namesScript(args[i]!, script)) return i + 1
  return 0
}

/** Whether `arg` names `script`: as typed, without its extension (`bun app`), or through a symlink. */
function namesScript(arg: string, script: string): boolean {
  const path = resolve(arg)
  if (path === script || path + extname(script) === script) return true
  try {
    return realpathSync(path) === realpathSync(script)
  } catch {
    return false
  }
}

export { App, AppSpec, run } from "./app.js"
export { ConfiguredOverlay, OverlaySpec } from "./overlay.js"
export { WindowSpec, run_windows, run_windows_with, run_windows_with_args } from "./windows.js"
export { Binding, Live, LiveText, Tween } from "./live.js"
export { run_with } from "./compose.js"
import "./gradient.js"
export type { Compositor, EffectSlot, Frame, Lighting, Match, Plan, PlanAnchor, PlanLayer, PrimRule, PrimStyle, Route, SourceKind } from "./compose.js"
export type { LiveValue } from "./live.js"
export type { PerfMode, PerfStats } from "./perf.js"
export type { OverlayHandle } from "./native.js"
export type { Pump, Waker } from "./native.js"

/** Opens, focuses, closes and feeds a running `App` from anywhere (`rune::AppHandle`). */
export interface AppHandle<S = any> extends Omit<N.AppHandle, "update"> {
  /** Runs `f(state, tx)` before the next frame, then re-runs the view. */
  update(f: (s: S, tx: Tx) => void): void
}
