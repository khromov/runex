// The renderer's process-wide state: whether the tree changed since Rune last built it, how to
// ask Rune for a frame, the `<style>` rules components registered, the kit, and `run_handler`,
// which every callback Rune makes into Svelte code goes through.
import { flushSync } from "svelte"
import type { AppHandle } from "runex-js"
import { Kit } from "runex-js/kit"
import type { StyleRule } from "./style-rules.ts"

/** Set by every change to the tree; `view()` clears it when it builds. */
let dirty = false
let scheduled = false
let handle: AppHandle | null = null

/**
 * The tree changed. Inside a Rune callback the frame that follows rebuilds anyway; anywhere else
 * (a timer, a fetch, an effect) a microtask asks Rune for one, once per burst of changes.
 */
export function invalidate() {
  dirty = true
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    if (dirty && handle) handle.refresh()
  })
}

/** `view()` is building from the tree now: what changed so far is in this frame. */
export function take_dirty(): boolean {
  const was = dirty
  dirty = false
  return was
}

export function set_handle(h: AppHandle | null) {
  handle = h
}

export function get_handle(): AppHandle | null {
  return handle
}

let depth = 0

/**
 * Runs a callback Rune made into Svelte code (an event handler, a kit callback): a throw is
 * reported rather than aborting Rune's frame, and Svelte's effects are flushed before Rune
 * builds the next view, so what the handler changed is in it.
 */
export function run_handler<T>(f: () => T): T | undefined {
  depth++
  try {
    return f()
  } catch (error) {
    console.error("[runex-svelte] handler failed:", error)
    return undefined
  } finally {
    depth--
    if (depth === 0) {
      try {
        flushSync()
      } catch (error) {
        console.error("[runex-svelte] effects after a handler failed:", error)
      }
    }
  }
}

const after = new Set<() => void>()

/**
 * Runs `f` once Rune is done with the current turn: before the next view is built, or in a
 * microtask, whichever comes first. For code that reads what Rune just changed in place (a
 * `TextEdit` after `on_edit`), which a headless run's synchronous script never yields for.
 */
export function after_turn(f: () => void) {
  if (after.size === 0) queueMicrotask(drain_after)
  after.add(f)
}

/** Runs what `after_turn` queued; `view()` calls it before it builds. */
export function drain_after() {
  if (after.size === 0) return
  const fs = [...after]
  after.clear()
  for (const f of fs) run_handler(f)
}

/** Wraps `f` with `run_handler`, keeping its signature. */
export function handler<A extends unknown[], R>(f: (...args: A) => R): (...args: A) => R {
  return (...args: A) => run_handler(() => f(...args)) as R
}

/** scope class → that component's `<style>` rules, weakest first (see compile.ts). */
export const stylesheets = new Map<string, StyleRule[]>()

/** Runs at import time, from the call compile.ts appends to every component with a `<style>`. */
export function define_styles(scope: string, rules: StyleRule[]) {
  stylesheets.set(scope, rules)
  invalidate()
}

let kit: Kit | null = null
let kit_factory: (() => Kit) | null = null

/** The kit kit components build with: `render`'s `kit` option, or `Kit.neutral(true)`. */
export function get_kit(): Kit {
  return (kit ??= kit_factory ? kit_factory() : Kit.neutral(true))
}

/** Replaces the kit (a theme switch); the next frame builds with it. */
export function set_kit(next: Kit | (() => Kit)) {
  if (typeof next === "function") {
    kit_factory = next
    kit = null
  } else {
    kit = next
  }
  invalidate()
}
