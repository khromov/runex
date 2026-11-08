// What the binding generator binds, crate by crate. Everything public is bound unless it is
// denied here or its signature can't cross into JavaScript (report.md lists those).

export interface CrateConfig {
  /** The crate name as Rust spells it in paths (`rune_kit`). */
  crate: string
  /** Its package in vendor/rune (`cargo rustdoc -p`). */
  package: string
  /** Prefix for its native export names, so crates don't collide in the one addon. */
  prefix: string
  /** The TypeScript module that re-exports it (`ts/gen/<module>.ts`). */
  module: string
  /** Cargo features to document and build with. */
  features?: string[]
  /** Public modules (crate-relative, `::`-joined) to leave out entirely. */
  denyModules?: string[]
  /** Type parameters besides `S` that stand for an app or story state (`Story<P>`). */
  stateGenerics?: string[]
  /** Items to leave out: `Type`, `Type::method`, `module::function`, by public path. */
  deny?: string[]
  /**
   * Builders with a lifetime (`TabStrip<'a, S>`) bound as owned values at `'static` instead of
   * lent to callbacks only: their methods' borrowed strings are owned (`Cow`) or interned
   * (`&'a str`, leaked once per distinct string, as element roles are). By type name.
   */
  ownedLifetimes?: string[]
}

/**
 * The target the committed bindings are generated from. rustdoc documents the host it runs on,
 * and its JSON lacks what Rune declares for other targets only, so JSON from Linux or Windows
 * would drop `native_surface::macos` and `NativeSurface::push`. main.ts refuses JSON documented
 * for another target unless given `--any-target`.
 */
export const docTarget = "aarch64-apple-darwin"

/**
 * The rustdoc JSON `format_version` rustdoc.ts and gen.ts are written against (61: Rust 1.99.1).
 * A toolchain bump can change the schema; main.ts stops on any other version rather than bind
 * what it misreads.
 */
export const rustdocFormat = 61

export const crates: CrateConfig[] = [
  {
    crate: "rune_motion",
    package: "rune-motion",
    prefix: "motion_",
    module: "motion",
    denyModules: ["trace", "store", "scene", "layer", "choreo", "props", "gesture", "keyframes", "snap", "animated", "value", "clock", "prelude"],
    deny: [],
  },
  {
    crate: "rune",
    package: "rune",
    prefix: "",
    module: "rune",
    stateGenerics: ["P", "X"],
    denyModules: [
      "motion_gate", "render", "gpu_springs", "embed", "compose", "rewind",
      "accesskit", "raw_window_handle", "tooling", "runtime", "recorder", "growth::caps", "growth::pace", "prefs", "web",
    ],
    deny: [
      // Hand-written: the app, its lifetime and the state type runex owns.
      "App", "AppHandle", "AppSpec", "Pump", "Runtime", "WindowSpec", "AnyWindowSpec", "run", "run_with", "run_windows",
      "run_windows_with", "run_windows_with_args", "try_run_windows_with", "try_run_windows_with_args", "start_windows_with_args",
      "set_pump_wake", "is_headless", "Compositor", "Frame",
      "Recorder", "Recording", "FakeMicrophone", "Level", "MicPermission", "RecordFormat", "RecorderState",
      "Waker", "Live", "LiveText", "Tween", "Latest", "LayerHost", "Gpu", "Renderer", "SurfaceRenderer",
      "prewarm_gpu", "prewarm_gpu_on", "warm_gpu", "warm_gpu_with", "on_gpu", "GpuEvent", "FrameEncoded", "FrameOutcome",
      "SurfaceStats", "SurfaceCounts", "Pacing", "describe_gpu", "commit_generation", "SceneClock", "scene_clock",
      "OverlayHandle", "ConfiguredOverlay", "OverlaySpec", "Shortcut", "Tray", "TraySpec", "TrayIcon",
      "memo", "memo::memo", "memo::snapshot",
      // Hand-written: src/manual/windows.rs (the window's functions), src/manual/icons.rs (a fn pointer).
      "open_window", "windows::open_window", "text::set_icon_swap",
    ],
  },
  {
    crate: "rune_kit",
    package: "rune-kit",
    prefix: "kit_",
    module: "kit",
    features: ["markdown", "mermaid"],
    denyModules: ["css", "syntax", "diff", "notes", "mermaid", "markdown", "tree", "popover"],
    // Hand-written (src/manual/tree.rs, ts/tree.ts): the tree over the app's own node type.
    deny: ["Tree", "TreeModel", "FileNode", "FileTree", "TreeItem::file"],
    ownedLifetimes: ["TabStrip", "TabItem", "Note"],
  },
  { crate: "rune_fx", package: "rune-fx", prefix: "fx_", module: "fx" },
  { crate: "rune_light", package: "rune-light", prefix: "light_", module: "light" },
  // `panel`, as Cargo.toml builds it: without it rustdoc documents the stubs in its place.
  { crate: "rune_knobs", package: "rune-knobs", prefix: "knobs_", module: "knobs", features: ["panel"] },
  { crate: "rune_theme_opencode", package: "rune-theme-opencode", prefix: "opencode_", module: "theme_opencode" },
  // System notifications (Windows toasts; macOS only from a signed .app bundle). `on_click`'s
  // handler runs on another thread: hand-written in src/manual/notify.rs.
  { crate: "rune_notify", package: "rune-notify", prefix: "notify_", module: "notify", deny: ["on_click"] },
]
