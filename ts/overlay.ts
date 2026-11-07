// Overlays: windows above other apps (`rune::OverlaySpec`, `ConfiguredOverlay`). Plain data, as
// Rust's literals are; `App.overlay(spec, state)` opens one and returns its `OverlayHandle`.
import type { Align, Cx, El, KeyEvent, OverlayOptions, ScreenEdge, Story, Tx } from "./gen/types.js"
import type { Waker } from "./native.js"
import type { Compositor } from "./compose.js"

/** Where an overlay sits, how big it is, whether it takes clicks, and its view (`rune::OverlaySpec`). */
export class OverlaySpec<T> {
  /** The window title, or the layer-shell namespace on Wayland. */
  name: string
  /** In points. */
  size: [number, number]
  edge: ScreenEdge = "Top"
  /** Distance from the edge, in points. */
  margin = 0
  /** Along the edge: centred, or at the start or end `inset` points in. */
  align: Align = "Center"
  inset = 0
  /** Clicks reach the view; otherwise they pass through. */
  interactive = false
  /** The overlay's view. Its root should have no fill: what it leaves clear stays transparent. */
  view: (s: T, cx: Cx) => El

  constructor(init: { name: string; size: [number, number]; view: (s: T, cx: Cx) => El; edge?: ScreenEdge; margin?: number; align?: Align; inset?: number; interactive?: boolean }) {
    this.name = init.name
    this.size = init.size
    this.view = init.view
    Object.assign(this, init)
  }

  /** At the top edge, centred, click-through (`OverlaySpec::new`). */
  static new<T>(name: string, size: [number, number], view: (s: T, cx: Cx) => El): OverlaySpec<T> {
    return new OverlaySpec({ name, size, view })
  }

  /** This spec with platform options and hooks to set (`OverlaySpec::options`). */
  options(options: OverlayOptions): ConfiguredOverlay<T> {
    return new ConfiguredOverlay(this, options)
  }
}

/** An overlay with its options and hooks (`rune::ConfiguredOverlay`). */
export class ConfiguredOverlay<T> {
  #hooks: Record<string, unknown> = {}
  constructor(readonly spec: OverlaySpec<T>, readonly opts: OverlayOptions | null = null) {}

  static from<T>(spec: OverlaySpec<T> | ConfiguredOverlay<T>): ConfiguredOverlay<T> {
    return spec instanceof ConfiguredOverlay ? spec : new ConfiguredOverlay(spec)
  }

  #set(name: string, value: unknown): this {
    this.#hooks[name] = value
    return this
  }

  on_focus(f: (s: T, focused: boolean, tx: Tx) => void): this { return this.#set("on_focus", f) }
  srgb_blend(enabled: boolean): this { return this.#set("srgb_blend", enabled) }
  poll(f: (s: T, t: number, tx: Tx) => boolean): this { return this.#set("poll", f) }
  on_key(f: (s: T, e: KeyEvent, tx: Tx) => boolean): this { return this.#set("on_key", f) }
  modifier_keys(): this { return this.#set("modifier_keys", true) }
  setup(f: (s: T, waker: Waker) => void): this { return this.#set("setup", f) }
  on_created(f: (created: unknown) => void): this { return this.#set("on_created", f) }
  animate_reveal(): this { return this.#set("animate_reveal", true) }
  release_gpu_when_hidden(): this { return this.#set("release_after", 0) }
  /** Releases the GPU surface `after` seconds hidden. */
  release_gpu_after(after: number): this { return this.#set("release_after", after) }
  macos_level(level: number): this { return this.#set("macos_level", level) }
  /** Draws every overlay frame through `compositor` (`ConfiguredOverlay::compositor`; see ts/compose.ts). */
  compositor(compositor: Compositor<T>): this { return this.#set("compositor", compositor) }

  /** The object the native side reads. */
  toNative(): object {
    return { spec: this.spec, options: this.opts, ...this.#hooks }
  }
}

declare module "./gen/types.js" {
  interface Story$Static {
    /** An overlay's view at its size, in a dashed frame over the stage, with a state `init` makes (`Story::overlay`). */
    overlay<P>(name: string, spec: OverlaySpec<P>, init: () => P): Story
  }
}
