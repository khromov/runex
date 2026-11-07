// Rune Lab: rune-light and rune-fx composited live inside Rune's renderer, with knobs.

import { readFileSync } from "node:fs"
import { App, AppSpec, type KeyEvent, type Modifier, type Tx } from "runex-js"
import { OneShots } from "runex-js/fx"
import { Animated, Spring, VelocityTracker } from "runex-js/motion"
import { LabGfx } from "./gfx.ts"
import * as knobs from "./knobs.ts"
import { ALL, Scene, specs } from "./knobs.ts"
import * as stage from "./stage.ts"
import * as ui from "./ui.ts"

/** What the pointer is holding on the stage. */
export type Grab =
  | { Lamp: [number, number] }
  | { Card: [number, number] }
  | { Lens: [number, number] }
  | { Key: number }

export type ShotKind =
  /** A ripple across the whole canvas. */
  | "Ripple"
  /** A ripple confined to the inbox card. */
  | "RippleCard"
  /** The send button's ping to the inbox (which ripples on arrival). */
  | "Ping"
  | "Shockwave"
  /** A lightning strike from the nearer electrode to the click. */
  | "Zap"
  /** A burst of sparkles off the PRO badge. */
  | "Sparkles"

export type Shot = {
  kind: ShotKind
  /** Canvas points. */
  at: [number, number]
  t0: number
}

export type Perf = {
  cpu_ms: number
  gpu_ms: number | null
  draws: number
  live: boolean
}

export const Perf = {
  default: (): Perf => ({ cpu_ms: 0.0, gpu_ms: null, draws: 0, live: false }),
}

type LabFields = {
  scene: Scene
  reduced: boolean
  vals: number[][]
  now: number
  perf: Perf
  lamp: [number, number]
  keys: Animated[]
  recording: boolean
  uploading: boolean
  neon_on: boolean
  shots: OneShots
  card: Animated
  card_vt: VelocityTracker
  lens: [number, number]
  grab: Grab | null
}

export class Lab {
  declare scene: Scene
  declare reduced: boolean
  declare vals: number[][]
  /** Rune's animation clock at the last drawn frame (handlers stamp one-shots with it). */
  declare now: number
  declare perf: Perf
  declare lamp: [number, number]
  /** `Vec<Animated<f32>>`. */
  declare keys: Animated[]
  declare recording: boolean
  declare uploading: boolean
  declare neon_on: boolean
  /** Taps, pings and shockwaves: each overlaps the ones still running (a bounded pool). `OneShots<Shot>`. */
  declare shots: OneShots
  /** The motion card's top-left in canvas points. `Animated<Vec2>`. */
  declare card: Animated
  /** `VelocityTracker<Vec2>`. */
  declare card_vt: VelocityTracker
  declare lens: [number, number]
  declare grab: Grab | null

  constructor(init: LabFields) {
    Object.assign(this, init)
  }

  static new(): Lab {
    return new Lab({
      scene: "Lamp",
      reduced: false,
      vals: knobs.defaults(),
      now: 0.0,
      perf: Perf.default(),
      lamp: [...stage.LAMP_REST],
      keys: Array.from({ length: stage.KEY_COUNT }, () => Animated.new(0.0)),
      recording: true,
      uploading: true,
      neon_on: true,
      shots: OneShots.new(8),
      card: Animated.new({ x: stage.CARD_REST[0], y: stage.CARD_REST[1] }),
      card_vt: VelocityTracker.new(),
      lens: [...stage.LENS_REST],
      grab: null,
    })
  }

  /** The current value of `scene`'s knob `id`. */
  k(scene: Scene, id: string): number {
    const i = specs(scene).findIndex((k) => k.id === id)
    if (i === -1) throw new Error(`no knob ${id} in ${scene}`)
    return this.vals[Scene.idx(scene)][i]
  }

  on(scene: Scene, id: string): boolean {
    return this.k(scene, id) > 0.5
  }

  select(scene: Scene): void {
    if (this.scene !== scene) {
      this.scene = scene
      this.grab = null
    }
  }
}

function on_key(s: Lab, e: KeyEvent, _tx: Tx): boolean {
  const i = Scene.idx(s.scene)
  const key = e.key
  if (key === "Up") {
    s.select(ALL[(i + ALL.length - 1) % ALL.length])
  } else if (key === "Down") {
    s.select(ALL[(i + 1) % ALL.length])
  } else if (typeof key === "object" && "Modifier" in key && s.scene === "Keys") {
    // Modifier keys alone play the bottom row of the Keys scene, each side its own key.
    const { modifier, pressed } = key.Modifier
    const k = modifier_pad(modifier)
    if (k === null) return false
    const [to, spring] = pressed ? [1.0, Spring.new(0.1, 0.0)] : [0.0, Spring.new(0.25, 0.0)]
    s.keys[k].animate_to(to, spring, s.now)
  } else {
    return false
  }
  return true
}

function modifier_pad(modifier: Modifier): number | null {
  const row = stage.KEY_COLS
  let n: number
  switch (modifier) {
    case "ShiftLeft": n = 0; break
    case "Fn": n = 1; break
    case "ControlLeft": n = 2; break
    case "AltLeft": n = 3; break
    case "SuperLeft": n = 4; break
    case "SuperRight": n = 5; break
    case "AltRight": n = 6; break
    case "ControlRight": n = 7; break
    case "ShiftRight": n = 9; break
    default: return null
  }
  return row + n
}

/** A throw already in flight at t = 0, for snapshots without a script. */
function thrown(s: Lab): void {
  s.scene = "Motion"
  s.card.set({ x: -60.0, y: 300.0 })
  s.card.release({ x: 2400.0, y: -900.0 }, { x: 470.0, y: 160.0 }, Spring.new(0.6, 0.0), 0.0)
}

const app = App.new({
  ...AppSpec.new<Lab>("Rune Lab", [1320.0, 800.0], Lab.new, ui.view),
  min_size: [1080.0, 640.0],
  scenes: [
    ["lamp", (s) => { s.scene = "Lamp" }],
    ["flashlight", (s) => { s.scene = "Flashlight" }],
    ["gi", (s) => { s.scene = "Gi" }],
    ["keys", (s) => { s.scene = "Keys" }],
    ["godrays", (s) => { s.scene = "GodRays" }],
    ["glow", (s) => { s.scene = "Glow" }],
    ["pulses", (s) => { s.scene = "Pulses" }],
    ["electric", (s) => { s.scene = "Electric" }],
    ["fire", (s) => { s.scene = "Fire" }],
    ["motion", (s) => { s.scene = "Motion" }],
    ["lens", (s) => { s.scene = "Lens" }],
    ["lens-frost", (s) => {
      s.scene = "Lens"
      const i = specs("Lens").findIndex((k) => k.id === "frost")
      if (i === -1) throw new Error("called `Option::unwrap()` on a `None` value")
      s.vals[Scene.idx("Lens")][i] = 1.0
    }],
    ["extras", (s) => { s.scene = "Extras" }],
    ["motion-thrown", thrown],
    ["fire-reduced", (s) => {
      s.scene = "Fire"
      s.reduced = true
    }],
  ],
  fonts: [
    readFileSync(new URL("./assets/Inter-Regular.ttf", import.meta.url)),
    readFileSync(new URL("./assets/Inter-Medium.ttf", import.meta.url)),
    readFileSync(new URL("./assets/Inter-SemiBold.ttf", import.meta.url)),
    readFileSync(new URL("./assets/IBMPlexMono-Medium.ttf", import.meta.url)),
  ],
  families: ["Inter", "IBM Plex Mono"],
  on_key,
})
  .compositor(new LabGfx())
  .modifier_keys()
app.run()
