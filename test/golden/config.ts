// What scripts/golden.ts renders and how: per-example arguments and skips, the variants of the
// full tier, the scripted and timed cases, the masks for the few measured nondeterministic
// fields, and which platform writes the shared tree baselines. cases.ts expands it into case ids.
//
// Tiers (each includes the ones before it):
//   quick     every fixture scene and fixture-motion's moments, and per example `(none)` plus each
//             window's first scene (90 renders: about 5 s on an M3, 20 s loaded)
//   standard  every example window × (none and each scene), the fixtures, the short scripts
//             (302 cases; Linux lavapipe in Docker on 8 vCPU, loaded: about 130 s)
//   full      the variants below and the long scripts; scripts/golden.ts runs it on bun and node
//             (599 cases, 1198 renders: about 70 s on an M3; lavapipe about 15 min, mostly replays)
//
// Scripted cases replay at --scale 1 (`scriptArgs`): a headless replay draws every frame, which is
// what costs on lavapipe. Their trees are in points, so only the PNG resolution differs.
//
// A case id is `<example>/<window>/<variant>/<scene>[@<checkpoint>]`: `hello/main/base/on`,
// `hello/main/tap/_none@0.05`, `fixture-paint/main/base/gradients`. `_none` is the render
// without `--scene`. Fixtures are the apps in test/golden/fixtures/<name>.ts, named `fixture-<name>`.

export type Tier = "quick" | "standard" | "full"

/** Elements whose fields vary run to run: the fields are dropped from the tree and the element's rect is blanked in the PNG. */
export type Mask = {
  /** The element's `path` in the tree: exact, or a pattern. */
  path: string | RegExp
  /** Fields to drop (default text, rect and the animation's target and moving). */
  fields?: string[]
  /** "t>0" (default): only when the render's virtual time is past 0, which is when wall-clock values appear. */
  when?: "t>0" | "always"
  /** Blank this element's rect in the PNG instead (a fixed container, when the masked element moves with its text). */
  region?: string
  why: string
}

export type ExampleGolden = {
  /** Don't render this example; the reason shows in the report. */
  skip?: string
  /** Rune or app arguments for every listing and render. */
  args?: string[]
  /** Per-scene arguments or skips; `"(none)"` is the render without `--scene`. */
  scenes?: Record<string, { args?: string[]; skip?: string }>
  masks?: Mask[]
  env?: Record<string, string>
  /** Seconds per render (default --timeout). */
  timeout?: number
}

/** A full-tier variant: extra arguments for a chosen set of base renders. */
export type Variant = {
  /** The variant's part of the case id. */
  name: string
  args: string[]
  /**
   * Example name -> "all" its windows and scenes, or the scene names (`"(none)"` included) to
   * render. `"*"` is every example and fixture; a named entry wins over it.
   */
  examples: Record<string, "all" | string[]>
  /** Scenes to leave out of an "all", by example. */
  except?: Record<string, string[]>
}

/** A scripted or timed case: one render per checkpoint, each a fresh process. */
export type ScriptCase = {
  /** The variant's part of the case id. */
  name: string
  example: string
  window?: string
  /** Default: the render without `--scene`. */
  scene?: string
  /** A file in test/golden/scripts/ (pinned copies, so upstream edits don't move them). */
  script?: string
  args?: string[]
  /** `--at` values: seconds, or `mark:NAME` for a script mark. */
  checkpoints: string[]
  tier: Tier
  /** Also record the normalized `--trace` of the whole script (short scripts only). */
  trace?: boolean
  /** Only on these OSes (a case whose behaviour is another platform's gap, like video on Linux). */
  platforms?: NodeJS.Platform[]
  /** Seconds per render (default `scriptTimeout`). */
  timeout?: number
}

export type GoldenConfig = {
  /** The OS whose trees are the shared files; others write `<case>.<os>.jsonl` only where they differ. */
  treePrimary: NodeJS.Platform
  /** Rune's scene flag. The "all scenes identical" sanity check catches a renamed flag; changing this simulates one. */
  sceneFlag: string
  /**
   * Arguments for every scripted and timed render. Headless replays draw every frame: lavapipe
   * (8 vCPU, loaded) took 10–25 s per scripted second at 2x.
   */
  scriptArgs: string[]
  /** Seconds per scripted render, unless the case says otherwise. */
  scriptTimeout: number
  examples: Record<string, ExampleGolden>
  variants: Variant[]
  scripts: ScriptCase[]
  /** Skipped variants and cases with the reason, for the report and docs. */
  notes: string[]
}

/** Readouts of wall-clock frame timing: they show once frames have been timed (t > 0). */
const LAB_MASKS: Mask[] = [
  { path: "window/panel-wrap/panel/readout/gpu/value", region: "window/panel-wrap/panel/readout/gpu", why: "GPU frame time, wall clock" },
  { path: "window/panel-wrap/panel/readout/cpu/value", region: "window/panel-wrap/panel/readout/cpu", why: "CPU frame time, wall clock" },
]

/** Stories whose kit colours the `--kit neutral|palette` variants re-render. */
const KIT_STORIES = [
  "ui-button--all-states", "ui-icon-button--all-states", "ui-switch--states", "ui-checkbox--states", "ui-radio--states",
  "ui-text-input--states", "ui-textarea--states", "ui-select--playground", "ui-menu--basic", "ui-tooltip--simple",
  "components-card--normal", "ui-badge--appearances", "components-progress--basic", "ui-segmented-control--basic",
  "rune-markdown--basic", "rune-switch--sizes",
]

const config: GoldenConfig = {
  treePrimary: "darwin",
  sceneFlag: "--scene",
  scriptArgs: ["--scale", "1"],
  scriptTimeout: 300,
  examples: {
    "glass-card": {
      skip: "both windows set App::args([]), which replaces Rune's tooling flags: --snap opens a real window",
    },
    "video-player": {
      // At t = 0 the player still shows "Loading"; by 0.6 s the test clip has a decoded frame.
      scenes: { "(none)": { args: ["--at", "0.6"] } },
    },
    lab: { masks: LAB_MASKS, timeout: 300 },
    background: {
      masks: [{ path: "window/ticks", why: "a real background thread races the virtual clock" }],
    },
    "cursed-settings": { timeout: 300 },
    // rune-light's lit card came out with tile-shaped bands in 2 of ~65 lavapipe renders (the lit
    // image read before every tile was written). One rasterizer thread draws the tiles in order;
    // the pixels are otherwise the same at any LP_NUM_THREADS. No effect on other drivers.
    "fixture-compose": { env: { LP_NUM_THREADS: "1" } },
    // Mid-flight, where a changed spring or curve shows; the timed case below adds more moments.
    "fixture-motion": { scenes: { springs: { args: ["--at", "0.1"] }, reduced: { args: ["--at", "0.1"] } } },
  },
  variants: [
    {
      name: "light",
      args: ["--theme", "light"],
      // The compositor examples are the heaviest renders: a few scenes each.
      examples: {
        "*": "all",
        lab: ["(none)", "lamp", "gi"],
        showreel: ["word", "glass", "fire"],
        "cursed-settings": ["default", "dark", "frosted"],
      },
      // kit-gallery's index is every story at once (1.3 MB of tree); its stories are here one by one.
      except: { "kit-gallery": ["(none)"] },
    },
    {
      name: "scale1",
      args: ["--scale", "1"],
      examples: {
        hello: ["(none)", "on"],
        settings: ["(none)"],
        "kit-gallery": ["ui-button--variants", "ui-text-input--states", "rune-markdown--basic"],
        "fixture-text": "all",
      },
    },
    { name: "size-250x320", args: ["--size", "250x320"], examples: { "web-showcase": ["(none)"] } },
    { name: "size-333x300", args: ["--size", "333x300"], examples: { "web-showcase": ["(none)"] } },
    { name: "size-401x320", args: ["--size", "401x320"], examples: { "web-showcase": ["(none)"] } },
    { name: "kit-neutral", args: ["--kit", "neutral"], examples: { "kit-gallery": KIT_STORIES } },
    { name: "kit-palette", args: ["--kit", "palette"], examples: { "kit-gallery": KIT_STORIES } },
    {
      name: "reduced-motion",
      args: ["--reduced-motion"],
      examples: { "kit-gallery": ["motion-focus-modal", "motion-stagger-list", "ui-dialog--basic", "rune-rolling-text--basic"] },
    },
  ],
  scripts: [
    // tok.motion springs and rune-motion curves at fixed moments (fixtures/motion.ts starts them after frame 0).
    { name: "timed", example: "fixture-motion", scene: "springs", checkpoints: ["0.05", "0.25", "0.6"], tier: "quick" },
    { name: "timed", example: "fixture-motion", scene: "reduced", checkpoints: ["0.05", "0.25"], tier: "quick" },
    // The switch springs over 0.25 s (tok.motion.SNAPPY): mid-flight, nearly there, settled.
    { name: "tap", example: "hello", script: "hello-tap.json", checkpoints: ["0.05", "0.1", "0.2", "0.5"], tier: "standard", trace: true },
    { name: "slider", example: "settings", script: "settings-slider.json", checkpoints: ["0.25", "0.6", "1.2"], tier: "standard", trace: true },
    { name: "keycaps", example: "settings", script: "settings-keycaps.json", checkpoints: ["1.5", "2.8", "4.6", "mark:end"], tier: "full" },
    { name: "keyboard", example: "settings", script: "settings-keyboard.json", checkpoints: ["0.5", "mark:end"], tier: "standard" },
    { name: "edit", example: "todo", script: "todo.json", checkpoints: ["0.3", "mark:removed", "mark:end"], tier: "standard", trace: true },
    { name: "drags", example: "sketch", script: "sketch.json", checkpoints: ["0.4", "mark:end"], tier: "standard", trace: true },
    {
      name: "combobox", example: "kit-gallery", scene: "rune-combobox--searchable", script: "kit-gallery-combobox.json",
      checkpoints: ["0.4", "0.9", "1.3", "1.7"], tier: "standard",
    },
    {
      name: "combobox-animated-filter", example: "kit-gallery", scene: "rune-combobox--animated-filter",
      script: "kit-gallery-combobox-animated-filter.json", checkpoints: ["0.7", "1.3", "2.4"], tier: "standard",
    },
    {
      name: "selectable-text", example: "kit-gallery", scene: "rune-text--selectable-help", script: "kit-gallery-selectable-text.json",
      checkpoints: ["0.4", "mark:end"], tier: "standard",
    },
    {
      name: "help-tooltip", example: "kit-gallery", scene: "rune-text--selectable-help", script: "kit-gallery-help-tooltip.json",
      checkpoints: ["0.3", "mark:end"], tier: "standard",
    },
    {
      name: "focus-modal", example: "kit-gallery", scene: "motion-focus-modal", script: "kit-gallery-motion-focus-modal.json",
      checkpoints: ["0.55", "1.0", "2.45", "3.25", "4.2", "5.2"], tier: "full",
    },
    {
      name: "stagger-list", example: "kit-gallery", scene: "motion-stagger-list", script: "kit-gallery-motion-stagger-list.json",
      checkpoints: ["0.35", "1.6", "2.04", "2.6"], tier: "standard",
    },
    {
      name: "stagger-list-reduced", example: "kit-gallery", scene: "motion-stagger-list", script: "kit-gallery-motion-stagger-list.json",
      args: ["--reduced-motion"], checkpoints: ["0.35", "1.6"], tier: "full",
    },
    {
      name: "scroll", example: "kit-gallery", scene: "rune-scroll-bar--basic", script: "kit-gallery-scroll-bar.json",
      checkpoints: ["0.5", "1.2", "2.3", "mark:end"], tier: "standard",
    },
    { name: "drop", example: "drop-files", script: "drop-files-drop.json", checkpoints: ["0.2", "0.4", "0.6", "1.2", "1.5"], tier: "standard" },
    { name: "zoom", example: "matched", script: "matched-zoom.json", checkpoints: ["0.5", "1.0", "2.0", "3.0", "3.5"], tier: "full" },
    { name: "flashlight", example: "lab", scene: "flashlight", script: "lab-flashlight.json", checkpoints: ["0.2", "0.6", "1.2"], tier: "full", timeout: 600 },
    // Rune plays video on macOS only ("video playback isn't supported on this platform yet").
    { name: "timed", example: "video-player", checkpoints: ["1.2", "2.0"], tier: "full", platforms: ["darwin"] },
    // Upstream's demo.json up to its cmd+space: a headless run has no global-shortcut registration
    // ("script shortcut: unknown shortcut registration", Rust and TS alike), so the rest can't replay.
    { name: "demo", example: "launcher", window: "notes", script: "launcher-demo.json", checkpoints: ["0.3", "mark:end"], tier: "full" },
    { name: "showcase", example: "cursed-settings", script: "cursed-settings-showcase.json", checkpoints: ["4.0", "11.0"], tier: "full", timeout: 1200 },
  ],
  notes: [
    "Linux tree overrides (measured, test/golden/trees/**/*.linux.jsonl): kit-gallery (none) and rune-keybind--symbols (⌘⇧⌥ fall back to other fonts), launcher's launcher window (the ⌕ glyph), overlay-lab's lab window (symbol glyphs), video-player (Rune plays video on macOS only); each in base and light.",
    "playground: --playground NAME [--variant N] is not rendered: Rune turns App::playground off in release builds, and the addon is one (Rust and TS both render the plain window).",
    "hello: no --reduced-motion variant: the example has no switch for it; fixture-motion covers reduced motion with cx.reduced_motion(true).",
  ],
}

export default config
