// Cursed Settings: a believable settings window where every control does exactly what its
// label says. The Firewall switch builds a wall of fire, the electric fence electrifies the
// perimeter, Dark mode turns the lights off. Effects come from rune-fx and rune-light, drawn
// inside Rune's frame through the compositor hook (`gfx.rs`); `gags.ts` decides what burns.
//
// Port of vendor/rune/examples/cursed-settings/src/main.rs. `ui.rs`, `icons.rs` and `gags.rs`
// are `ui.ts`, `icons.ts` and `gags.ts`; `gfx.rs` (the wgpu compositor) is ported separately.

import { AppSpec, TextEdit, type Tx, extra_args, run_with } from "runex-js"
import * as rune_theme_opencode from "runex-js/theme-opencode"

import * as gags from "./gags.ts"
import { Gfx } from "./gfx.ts"
import * as ui from "./ui.ts"

export type Page = "General" | "Appearance" | "Network" | "Security" | "Accessibility" | "Developer"

export const PAGES: Page[] = ["General", "Appearance", "Network", "Security", "Accessibility", "Developer"]

export const Page = {
  meta(self: Page): [string, string] {
    switch (self) {
      case "General":
        return ["General", "general"]
      case "Appearance":
        return ["Appearance", "appearance"]
      case "Network":
        return ["Network", "network"]
      case "Security":
        return ["Security", "security"]
      case "Accessibility":
        return ["Accessibility", "accessibility"]
      case "Developer":
        return ["Developer", "developer"]
    }
  },
  title(self: Page): string {
    return Page.meta(self)[0]
  },
  id(self: Page): string {
    return Page.meta(self)[1]
  },
}

export const APPEARANCES: string[] = ["Light", "Dark", "Auto"]
export const HAPTICS: string[] = ["Off", "Light", "Strong"]

/** Every setting, at its default. */
export type Prefs = {
  launch_at_login: boolean
  fast_startup: boolean
  spotlight: boolean
  auto_update: boolean
  /** 0 Light, 1 Dark, 2 Auto. */
  appearance: number
  brightness: number
  firewall: boolean
  stealth: boolean
  static_ip: boolean
  fence: boolean
  lock_on_sleep: boolean
  contrast: boolean
  reduce_transparency: boolean
  reduce_motion: boolean
  /** 0 Off, 1 Light, 2 Strong. */
  haptics: number
  hot_reload: boolean
  flushed: boolean
}

export const Prefs = {
  default(): Prefs {
    return {
      launch_at_login: true,
      fast_startup: false,
      spotlight: false,
      auto_update: true,
      appearance: 2,
      brightness: 1.0,
      firewall: false,
      stealth: false,
      static_ip: false,
      fence: false,
      lock_on_sleep: true,
      contrast: false,
      reduce_transparency: false,
      reduce_motion: false,
      haptics: 1,
      hot_reload: false,
      flushed: false,
    }
  },
}

export class Cursed {
  page: Page
  p: Prefs
  search: TextEdit
  ip: TextEdit
  /** Presses so far; the compositor turns new ones into haptic feedback at the pointer. */
  taps: number
  /** Flush requested by the button; the compositor stamps `flush_t0` on its clock. */
  flush_requested: boolean
  flush_t0: number | null
  /** When the restore-defaults toast goes away (compositor clock). */
  toast_until: number | null
  /** The compositor's clock at the last frame. */
  now: number
  /** Demo recordings draw a pointer (`--cursor`). */
  show_cursor: boolean
  cursor: [number, number] | null

  private constructor(f: {
    page: Page
    p: Prefs
    search: TextEdit
    ip: TextEdit
    taps: number
    flush_requested: boolean
    flush_t0: number | null
    toast_until: number | null
    now: number
    show_cursor: boolean
    cursor: [number, number] | null
  }) {
    this.page = f.page
    this.p = f.p
    this.search = f.search
    this.ip = f.ip
    this.taps = f.taps
    this.flush_requested = f.flush_requested
    this.flush_t0 = f.flush_t0
    this.toast_until = f.toast_until
    this.now = f.now
    this.show_cursor = f.show_cursor
    this.cursor = f.cursor
  }

  static new(): Cursed {
    return new Cursed({
      page: "General",
      p: Prefs.default(),
      search: TextEdit.default(),
      ip: TextEdit.new("192.168.1.42"),
      taps: 0,
      flush_requested: false,
      flush_t0: null,
      toast_until: null,
      now: 0.0,
      show_cursor: extra_args().some((a) => a === "--cursor"),
      cursor: null,
    })
  }

  /** Everything back to its default, calmly: each gag cools down on its own envelope. */
  restore(): void {
    this.p = Prefs.default()
    this.flush_t0 = null
    this.toast_until = this.now + 4.5
  }
}

/** While the toast shows or the cache drains, time moves state forward on its own. */
function poll(s: Cursed, _clock: number, _tx: Tx): boolean {
  let changed = false
  if (s.toast_until !== null && s.now >= s.toast_until) {
    s.toast_until = null
    changed = true
  }
  if (
    s.flush_t0 !== null &&
    Math.fround(s.now) >= Math.fround(s.flush_t0 + gags.FLUSH_SECONDS) &&
    !s.p.flushed
  ) {
    s.p.flushed = true
    changed = true
  }
  return changed
}

function page(p: Page): (s: Cursed) => void {
  return (s) => {
    s.page = p
  }
}

const spec: AppSpec<Cursed> = {
  ...AppSpec.new<Cursed>("Settings", [960.0, 660.0], Cursed.new, ui.view),
  min_size: [860.0, 600.0],
  scenes: [
    ["default", (_) => {}],
    ["general", (s) => page("General")(s)],
    ["appearance", (s) => page("Appearance")(s)],
    ["network", (s) => page("Network")(s)],
    ["security", (s) => page("Security")(s)],
    ["accessibility", (s) => page("Accessibility")(s)],
    ["developer", (s) => page("Developer")(s)],
    ["fire", (s) => {
      s.page = "Network"
      s.p.firewall = true
      s.p.static_ip = true
    }],
    ["fence", (s) => {
      s.page = "Security"
      s.p.fence = true
    }],
    ["dark", (s) => {
      s.page = "Appearance"
      s.p.appearance = 1
    }],
    ["spotlight", (s) => {
      s.p.spotlight = true
    }],
    ["contrast", (s) => {
      s.page = "Accessibility"
      s.p.contrast = true
    }],
    ["frosted", (s) => {
      s.page = "Accessibility"
      s.p.reduce_transparency = true
    }],
    ["hot", (s) => {
      s.page = "Developer"
      s.p.hot_reload = true
    }],
    ["flushed", (s) => {
      s.page = "Developer"
      s.p.flushed = true
    }],
    ["reduced-fire", (s) => {
      s.page = "Network"
      s.p.firewall = true
      s.p.reduce_motion = true
    }],
  ],
  fonts: rune_theme_opencode.FONTS,
  families: rune_theme_opencode.FAMILIES,
  setup: null,
  poll: poll,
  on_key: null,
}

run_with(spec, new Gfx())
