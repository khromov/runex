// The rune-kit gallery: one scene per `@opencode/ui` Storybook story, in the story's id, so
// `scripts/kit-diff.py` can render both and diff them. `--kit neutral` renders the same
// components on Rune's core neutral theme instead of OpenCode's; `--kit palette` on
// `Kit::from_palette` with a near-black, off-white and red seed (a dark palette with a red accent);
// `--kit palette black` (dark) and `--kit palette warm` (light) use pure-black and
// paper seeds with ink focus rings. `--reduced-motion` renders in the runtime's reduced-motion
// mode.
//
// ```sh
// bun examples/kit-gallery/main.ts --list-scenes
// bun examples/kit-gallery/main.ts --scene ui-button--variants --snap out.png --theme dark --size 720x300
// ```
//
// Port of vendor/rune/examples/kit-gallery/src/main.rs. `layer_timing.rs` is a `#[cfg(test)]`
// module (GPU instance timing against `rune::render`), not part of the app, so it has no port.

import { AppSpec, type Cx, type El, TextEdit, col, color, extra_args, run } from "runex-js"
import { ComboboxState, Kit, type PaletteSeed, root } from "runex-js/kit"
import * as rune_theme_opencode from "runex-js/theme-opencode"
import { FAMILIES, FONTS } from "runex-js/theme-opencode"

import * as stories from "./stories.ts"

export class G {
  story: string
  /** Toggled things by key (switches, checkboxes, expanded items). */
  on: Set<string>
  /** Picked values by group key (radio groups, selects, segmented controls, tabs). */
  pick: Map<string, string>
  /** The open overlay, by key. */
  open: string | null
  edits: TextEdit[]
  combo: ComboboxState
  neutral: boolean
  palette: boolean
  /** `--reduced-motion`: the runtime's reduced-motion mode. */
  reduced: boolean

  constructor(f: {
    story: string
    on: Set<string>
    pick: Map<string, string>
    open: string | null
    edits: TextEdit[]
    combo: ComboboxState
    neutral: boolean
    palette: boolean
    reduced: boolean
  }) {
    this.story = f.story
    this.on = f.on
    this.pick = f.pick
    this.open = f.open
    this.edits = f.edits
    this.combo = f.combo
    this.neutral = f.neutral
    this.palette = f.palette
    this.reduced = f.reduced
  }

  is(key: string): boolean {
    return this.on.has(key)
  }
  flip(key: string): void {
    if (!this.on.delete(key)) {
      this.on.add(key)
    }
  }
  picked(group: string, default_: string): string {
    return this.pick.get(group) ?? default_
  }
  toggle_open(key: string): void {
    this.open = this.open === key ? null : key
  }
}

function init(): G {
  return new G({
    story: "index",
    on: new Set(),
    pick: new Map(),
    open: null,
    // `[TextEdit; 8]`'s `Default::default()`.
    edits: Array.from({ length: 8 }, () => TextEdit.default()),
    combo: ComboboxState.default(),
    neutral: extra_args().some((a) => a === "neutral"),
    palette: extra_args().some((a) => a === "palette"),
    reduced: extra_args().some((a) => a === "--reduced-motion"),
  })
}

// The `OnceLock` statics: each kit is built once, on first use.
let paletteD: Kit | null = null
let paletteL: Kit | null = null
let neutralD: Kit | null = null
let neutralL: Kit | null = null

export function kit(s: G, dark: boolean): Kit {
  if (s.palette) {
    const hex = (c: string) => color.hex(c)!
    const seed = (bg: string, fg: string, accent: string): PaletteSeed => ({ bg: hex(bg), fg: hex(fg), accent: hex(accent) })
    // `--kit palette black|warm`: pure-black and paper seeds with ink focus.
    const variant = (name: string) => extra_args().some((a) => a === name)
    const ink = (seed: PaletteSeed) => Kit.from_palette_focus(seed, "Ink")
    if (dark) {
      return (paletteD ??= variant("black")
        ? ink(seed("#000000", "#ffffff", "#ff2a2a"))
        : Kit.from_palette(seed("#0a0a0a", "#ededed", "#e5484d")))
    } else {
      return (paletteL ??= variant("warm")
        ? ink(seed("#e8e4dc", "#000000", "#d81414"))
        : Kit.from_palette(seed("#ffffff", "#171717", "#e5484d")))
    }
  }
  if (s.neutral) {
    return dark ? (neutralD ??= Kit.neutral(true)) : (neutralL ??= Kit.neutral(false))
  }
  return rune_theme_opencode.kit(dark)
}

function view(s: G, cx: Cx): El {
  if (s.reduced) {
    cx.reduced_motion(true)
  }
  const k = kit(s, cx.system_dark())
  const overlays: El[] = []
  const body = stories.render(s, k, overlays)
  // Storybook's decorator: the page colour and 24 px of padding around the story.
  return root(col().key("frame").fill(k.c.page).padding(24.0).child(body), overlays)
}

run({
  ...AppSpec.new<G>("rune-kit gallery", [720.0, 480.0], init, view),
  scenes: stories.SCENES,
  fonts: FONTS,
  families: FAMILIES,
})
