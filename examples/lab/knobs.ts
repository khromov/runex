// Scenes and their knobs. Effect knobs take their range and default from the effect's typed
// params (`GlowParams::KNOBS`, …); lighting knobs are declared here.

import { color } from "runex-js"
import { ElectricParams, FireParams, GlowParams, type Knob, MotionBlurParams, PulseParams } from "runex-js/fx"

// Rust's f32 math rounds every step.
const f32 = Math.fround

export type Scene =
  | "Lamp"
  | "Flashlight"
  | "Gi"
  | "Keys"
  | "GodRays"
  | "Glow"
  | "Pulses"
  | "Electric"
  | "Fire"
  | "Motion"
  | "Lens"
  | "Extras"

export const ALL: readonly Scene[] = [
  "Lamp",
  "Flashlight",
  "Gi",
  "Keys",
  "GodRays",
  "Glow",
  "Pulses",
  "Electric",
  "Fire",
  "Motion",
  "Lens",
  "Extras",
]

function meta(self: Scene): [string, string, string] {
  switch (self) {
    case "Lamp": return ["lamp", "Lamp", "Drag the lamp. Every bubble casts a soft shadow from the analytic field."]
    case "Flashlight": return ["flashlight", "Flashlight", "Move the pointer. The torch is held low and to the right, so shadows swing."]
    case "Gi": return ["gi", "Emissive light", "Glowing elements light their neighbours. Click the record button or the progress bar."]
    case "Keys": return ["keys", "Raised keys", "Move the pointer to sweep the light. Press a key."]
    case "GodRays": return ["godrays", "God rays", "Move the pointer. The light sits behind the grid and shines through the gaps."]
    case "Glow": return ["glow", "Glow", "Click the neon card to switch it off: lights cool, never cut."]
    case "Pulses": return ["pulses", "Pulses", "Click anywhere for a ripple. Press send to ping the inbox."]
    case "Electric": return ["electric", "Electricity", "Hover the charged button."]
    case "Fire": return ["fire", "Fire", "Flames, a plasma border and heat haze over a button."]
    case "Motion": return ["motion", "Motion blur", "Drag the card and fling it. It glides on a spring with shutter blur."]
    case "Lens": return ["lens", "Liquid glass", "Drag the glass over the page. Click anywhere for a shockwave."]
    case "Extras": return ["extras", "Extras", "Shimmer, sparkles, aurora and grain."]
  }
}

// `impl Scene`: methods of an enum take it first, as runex's own enums do (`Modifier.side(m)`).
export const Scene = {
  /** `self as usize`. */
  idx(self: Scene): number {
    return ALL.indexOf(self)
  },

  /** Lit by rune-light (the others composite rune-fx layers). */
  lit(self: Scene): boolean {
    return Scene.idx(self) < 5
  },

  id(self: Scene): string { return meta(self)[0] },
  title(self: Scene): string { return meta(self)[1] },
  hint(self: Scene): string { return meta(self)[2] },
}

export type Kind =
  /** Decimal places shown. */
  | { Slider: number }
  | "Toggle"
  /** sRGB hex colours; the value is the index. */
  | { Swatch: readonly number[] }

export type KnobSpec = {
  id: string
  label: string
  min: number
  max: number
  default: number
  kind: Kind
}

export const FX_COLORS: readonly number[] = [0x22d3ee, 0x8b5cf6, 0xff5fa2, 0xff8a2a, 0x34d399, 0x60a5fa]
export const LAMP_COLORS: readonly number[] = [0xffc78c, 0xff9a4d, 0xfff3e6, 0xb3ccff, 0xff8fb0, 0x9dffd0]

function sl(id: string, label: string, min: number, max: number, default_: number, dec: number): KnobSpec {
  return { id, label, min: f32(min), max: f32(max), default: f32(default_), kind: { Slider: dec } }
}

function tg(id: string, label: string, on: boolean): KnobSpec {
  return { id, label, min: 0.0, max: 1.0, default: on ? 1.0 : 0.0, kind: "Toggle" }
}

function sw(id: string, label: string, palette: readonly number[]): KnobSpec {
  return { id, label, min: 0.0, max: palette.length - 1, default: 0.0, kind: { Swatch: palette } }
}

/** A slider over an effect's own knob: its range and default come from the typed params. */
function fx(knobs: readonly Knob[], name: string, label: string, dec: number): KnobSpec {
  const k = knobs.find((k) => k.name === name)
  if (k === undefined) throw new Error(`no knob ${name}`)
  return { id: k.name, label, min: k.min, max: k.max, default: k.default, kind: { Slider: dec } }
}

let ALL_SPECS: KnobSpec[][] | null = null

export function specs(scene: Scene): readonly KnobSpec[] {
  ALL_SPECS ??= ALL.map((s) => build(s))
  return ALL_SPECS[Scene.idx(scene)]
}

function build(scene: Scene): KnobSpec[] {
  const g = GlowParams.KNOBS
  const p = PulseParams.KNOBS
  const e = ElectricParams.KNOBS
  const f = FireParams.KNOBS
  const m = MotionBlurParams.KNOBS
  switch (scene) {
    case "Lamp": return [
      sl("height", "Lamp height", 10.0, 240.0, 40.0, 0),
      sl("radius", "Source size", 2.0, 40.0, 11.0, 0),
      sl("intensity", "Intensity", 0.0, 6.0, 2.6, 1),
      sw("color", "Colour", LAMP_COLORS),
      tg("fill", "Fill light", true),
      tg("bounce", "Bounce light (GI)", false),
    ]
    case "Flashlight": return [
      sl("beam", "Beam angle", 0.2, 1.2, 0.58, 2),
      sl("height", "Torch height", 60.0, 420.0, 260.0, 0),
      sl("radius", "Source size", 2.0, 30.0, 9.0, 0),
      sl("intensity", "Intensity", 0.0, 14.0, 7.0, 1),
      sl("ambient", "Ambient", 0.0, 0.4, 0.07, 2),
    ]
    case "Gi": return [
      tg("gi", "Global illumination", true),
      sl("strength", "GI strength", 0.0, 3.0, 1.0, 2),
      sl("air", "Air scatter", 0.0, 0.3, 0.09, 2),
      sl("bounce", "Bounce", 0.0, 1.0, 0.0, 2),
      sl("emission", "Emission", 0.0, 3.0, 1.0, 2),
      sl("ambient", "Ambient", 0.0, 1.0, 0.3, 2),
    ]
    case "Keys": return [
      sl("height", "Light height", 30.0, 400.0, 150.0, 0),
      sl("radius", "Source size", 4.0, 60.0, 26.0, 0),
      sl("bevel", "Bevel", 0.3, 2.0, 1.0, 2),
      sl("gloss", "Gloss", 0.0, 1.0, 0.85, 2),
      tg("fill", "Fill light", true),
    ]
    case "GodRays": return [
      sl("shafts", "Shafts", 0.0, 3.0, 1.5, 2),
      sl("intensity", "Intensity", 0.0, 4.0, 1.6, 2),
      sl("softness", "Softness", 0.5, 4.0, 2.2, 2),
      sl("height", "Light height", 1.0, 40.0, 4.0, 0),
    ]
    case "Glow": return [
      fx(g, "radius", "Radius", 0),
      fx(g, "intensity", "Intensity", 2),
      fx(g, "breathe", "Breathe", 2),
      fx(g, "rim_width", "Rim width", 2),
      fx(g, "hot", "Hot core", 2),
      sw("color", "Neon colour", FX_COLORS),
    ]
    case "Pulses": return [
      fx(p, "reach", "Reach", 0),
      fx(p, "width", "Ring width", 1),
      fx(p, "period", "Period", 1),
      fx(p, "count", "Rings", 0),
      fx(p, "intensity", "Intensity", 2),
      sw("color", "Colour", FX_COLORS),
    ]
    case "Electric": return [
      fx(e, "amplitude", "Amplitude", 1),
      fx(e, "frequency", "Frequency", 1),
      fx(e, "speed", "Speed", 1),
      fx(e, "glow", "Glow", 1),
      fx(e, "forks", "Forks", 2),
      sw("color", "Colour", FX_COLORS),
    ]
    case "Fire": return [
      fx(f, "height", "Flame height", 0),
      fx(f, "scale", "Scale", 0),
      fx(f, "speed", "Speed", 2),
      fx(f, "embers", "Embers", 0),
      fx(f, "intensity", "Intensity", 2),
      fx(f, "swirl", "Swirl", 2),
    ]
    case "Motion": return [
      fx(m, "shutter_angle", "Shutter angle", 0),
      sl("glide", "Glide duration", 0.3, 1.4, 0.6, 2),
      tg("smooth", "Soft shutter ends", true),
      tg("directional", "Directional fallback", false),
    ]
    case "Lens": return [
      sl("depth", "Depth", 0.0, 40.0, 16.0, 0),
      sl("bevel", "Bevel", 2.0, 40.0, 14.0, 0),
      sl("dispersion", "Dispersion", 0.0, 0.5, 0.14, 2),
      sl("magnification", "Magnification", 0.9, 1.3, 1.04, 2),
      sl("frost", "Frost", 0.0, 1.0, 0.0, 2),
      tg("crt", "CRT terminal", true),
    ]
    case "Extras": return [
      tg("shimmer", "Shimmer", true),
      tg("aurora", "Aurora", true),
      tg("grain", "Grain", true),
      tg("sparkles", "Sparkles", true),
      sl("speed", "Aurora speed", 0.0, 1.0, 0.25, 2),
    ]
  }
}

export function defaults(): number[][] {
  return ALL.map((s) => specs(s).map((k) => k.default))
}

/** Linear RGB of an sRGB hex colour. */
export function lin(hex: number): [number, number, number] {
  const f = (c: number) => color.srgb_decode(f32(c / 255.0))
  return [f((hex >>> 16) & 255), f((hex >>> 8) & 255), f(hex & 255)]
}
