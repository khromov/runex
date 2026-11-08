// A Svelte component in a Rune window. The component mounts into a shadow tree; the app's view
// builds Rune's El tree from it every frame Rune draws. A second `render()` in the same process
// (render_hot's reload) swaps the component and keeps the window.
import { flushSync, mount, unmount } from "svelte"
import { App, AppSpec, Chrome, col, type Color, type Cx, type El, type KeyEvent, type Tx } from "runex-js"
import { root as kit_root, type Kit } from "runex-js/kit"
import renderer, { create_root } from "./renderer.ts"
import { build_children, type Ctx } from "./build.ts"
import { parse_color, is_color } from "./color.ts"
import { drain_after, invalidate, run_handler, set_handle, set_kit, take_dirty } from "./runtime.ts"
import type { AnyComponent, RunexEvent, ShadowNode } from "./types.ts"

export interface RenderOptions {
  /** The window title (default "Svelte"). */
  title?: string
  /** The first window size in points (default 800 × 600). */
  size?: [number, number]
  /** The smallest size the user can resize to (`null`: Rune's 420 × 400). */
  min_size?: [number, number] | null
  /** The component's props. */
  props?: Record<string, unknown>
  /** The root's fill, under the component: a CSS colour or a Rune `Color`. */
  background?: string | Color
  /** The kit `@runex-js/svelte/components/*` build with (default `Kit.neutral(true)`). */
  kit?: Kit | (() => Kit)
  /** Named states for `--scene name` snapshots: each runs before the first frame. */
  scenes?: [string, () => void][]
  /** Keys nothing focused handled; return true (or call `preventDefault()`) to consume one. */
  on_key?: (event: RunexEvent) => boolean | void
  /** Font files replacing the built-in Inter, and the sans and mono family names (`AppSpec`). */
  fonts?: Uint8Array[]
  families?: [string, string]
  /** Configures the `App` before it runs (`app.standard_menus()`, `app.on_close(...)`, ...). */
  app?: (app: App<Record<string, never>>) => void
  /** Rune's arguments (`--snap out.png`) instead of the process's. */
  args?: string[]
  /**
   * macOS: `"native"` (the default) is a standard titled window, the content below its titlebar.
   * `"overlay"` is Rune's own frame: the content fills the window under a transparent titlebar,
   * the traffic lights over its top-left corner, for an app that draws its own top bar (keep it
   * clear of them with `cx.titlebar_inset()` in a `<raw>`). Other platforms keep their native
   * frame either way.
   */
  titlebar?: "native" | "overlay"
  /**
   * Keep the process running after the app quits. By default it exits once the code awaiting
   * `render()` has run, so a leftover timer or connection can't keep a closed app (or a headless
   * `--snap`) alive.
   */
  keep_alive?: boolean
}

interface Host {
  root: ShadowNode
  component: Record<string, unknown> | null
  done: Promise<void>
  options: RenderOptions
}

const slots = globalThis as { __runex_svelte_host?: Host }

/** Window-level key handlers (`on_window_key`), kept across remounts. */
const window_keys = new Set<(event: RunexEvent) => boolean | void>()

/**
 * A handler for every key nothing focused consumed (Rune's `AppSpec.on_key`): shortcuts that work
 * wherever focus is. Return true or call `preventDefault()` to consume the key. Returns the unsubscribe.
 */
export function on_window_key(handler: (event: RunexEvent) => boolean | void): () => void {
  window_keys.add(handler)
  return () => window_keys.delete(handler)
}

function window_key(root: ShadowNode, e: KeyEvent, tx: Tx, own: RenderOptions["on_key"]): boolean {
  let consumed = false
  run_handler(() => {
    for (const h of own ? [own, ...window_keys] : [...window_keys]) {
      const event: RunexEvent = {
        type: "keydown",
        target: root,
        currentTarget: root,
        tx,
        args: [e, tx],
        key: e.key,
        key_event: e,
        defaultPrevented: false,
        preventDefault() {
          event.defaultPrevented = true
        },
        stopPropagation() {},
        stopImmediatePropagation() {},
      }
      if (h(event) === true || event.defaultPrevented) consumed = true
    }
  })
  return consumed
}

/** The view every app runs: the root's children, built, under one full-window column. */
function view(host: Host, cx: Cx): El {
  drain_after()
  take_dirty()
  const ctx: Ctx = { cx, layer: [], text: {} }
  let base = col().key("runex-svelte-root").w_full().h_full()
  const bg = host.options.background
  const fill = bg === undefined ? null : is_color(bg) ? bg : parse_color(bg)
  if (fill) base = base.fill(fill)
  const children = build_children(host.root, ctx)
  if (children.length > 0) base = base.children(children)
  return ctx.layer.length > 0 ? kit_root(base, ctx.layer) : base
}

function mount_into(host: Host, Component: AnyComponent, props: Record<string, unknown>) {
  // A comment anchor, so `mount` doesn't append a stray text node of its own.
  const anchor = renderer.createComment("")
  renderer.insert(host.root, anchor, null)
  host.component = mount(Component, { renderer, target: host.root, anchor, props }) as Record<string, unknown>
  flushSync()
}

/**
 * Mounts `Component` in a window and resolves when the app quits. With Rune's tooling arguments
 * (`--snap out.png`, `--tree`, `--script`, `--scene`) it renders headless instead and resolves
 * when that's done. Called again in the same process, it swaps the component into the open window.
 */
export function render(Component: AnyComponent, options: RenderOptions = {}): Promise<void> {
  const existing = slots.__runex_svelte_host
  if (options.kit) set_kit(options.kit)
  if (existing) {
    if (existing.component) {
      try {
        unmount(existing.component)
      } catch (error) {
        console.error("[runex-svelte] unmounting the previous component failed:", error)
      }
    }
    existing.root.first = existing.root.last = null
    existing.options = options
    mount_into(existing, Component, options.props ?? {})
    invalidate()
    console.log("[runex-svelte] remounted")
    return existing.done
  }

  const host: Host = { root: create_root(), component: null, done: Promise.resolve(), options }
  slots.__runex_svelte_host = host
  mount_into(host, Component, options.props ?? {})

  const spec = AppSpec.new<Record<string, never>>(options.title ?? "Svelte", options.size ?? [800, 600], () => ({}), (_s, cx) => view(host, cx))
  if (options.min_size !== undefined) spec.min_size = options.min_size
  if (options.fonts) spec.fonts = options.fonts
  if (options.families) spec.families = options.families
  if (options.scenes) spec.scenes = options.scenes.map(([name, f]) => [name, () => void run_handler(f)])
  spec.on_key = (_s, e, tx) => window_key(host.root, e, tx, host.options.on_key)

  const app = App.new(spec)
  // Before `options.app`, so its own `chrome(...)` or `titlebar(...)` wins.
  if ((options.titlebar ?? "native") === "native") app.chrome({ ...Chrome.DEFAULT, full_size_content: false } as Chrome)
  options.app?.(app)
  if (options.args) app.args(options.args)
  set_handle(app.handle())
  host.done = app.run().finally(() => {
    set_handle(null)
    if (slots.__runex_svelte_host === host) delete slots.__runex_svelte_host
    if (host.component) {
      try {
        unmount(host.component)
      } catch {}
    }
    // A macrotask later, so what awaits `render()` runs first.
    if (!host.options.keep_alive) setTimeout(() => process.exit(process.exitCode ?? 0), 0)
  })
  return host.done
}
