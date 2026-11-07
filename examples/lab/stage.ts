// The stage: one canvas of Rune elements per scene, laid out in canvas points, plus the
// stage's pointer handling. Marks tell the compositor what each element is: which canvas it
// belongs to, its lighting material, and the effect node it anchors.

import { Color, type Drag, type El, TextStyle, type Tx, color, el, text } from "runex-js"
import { Rect } from "runex-js/fx"
import { Spring, type Vec2, deceleration, project } from "runex-js/motion"
import * as knobs from "./knobs.ts"
import { Scene } from "./knobs.ts"
import type { Lab, Shot } from "./main.ts"

const { oklch, oklcha } = color

// Rust's f32 math rounds every step.
const f32 = Math.fround
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export const CW = 780.0
export const CH = 600.0

// ---------------------------------------------------------------- marks
// Marks are u32: `>>> 0` keeps them unsigned (JavaScript's `<<` and `|` give a signed i32).

/** The stage's own background (not in any canvas). */
export const STAGE_MARK = (0xfe << 24) >>> 0

export function mk(scene: Scene, material: number, node: number): number {
  return (((Scene.idx(scene) + 1) << 24) | (node << 8) | material) >>> 0
}

export function mark_scene(m: number): Scene | null {
  const i = m >>> 24
  return i >= 1 && i <= knobs.ALL.length ? knobs.ALL[i - 1] : null
}

export function mark_material(m: number): number {
  return m & 0xff
}

export function mark_node(m: number): number {
  return (m >>> 8) & 0xff
}

/** Lighting materials (how a marked rect stands on the UI plane). */
export const mat = {
  CARD: 1,
  CHIP: 2,
  BUTTON: 3,
  KNOB: 4,
  KEY: 5,
  BODY: 6,
  SCREEN: 7,
  EMIT: 8,
  TILE: 9,
  SWITCH: 10,
  ON_CARD: 11,
  BAR: 12,
  PILL: 13,
  DIAL: 14,
  COMPOSER: 15,
  FLAT: 16,
} as const

/** Effect anchors. */
export const node = {
  LAMP: 1,
  GLOW_BUTTON: 2,
  NEON: 3,
  AURA: 4,
  GLOW_TEXT: 5,
  HOT_DOT: 6,
  RADAR: 7,
  AVATAR: 8,
  LIVE: 9,
  SEND: 10,
  INBOX: 11,
  TERMINALS: 12,
  OVERLOAD: 14,
  CHARGED: 15,
  FLAMES: 16,
  PLASMA: 17,
  DEPLOY: 18,
  CARD: 19,
  CRT: 20,
  CHROMA: 21,
  SKELETON: 22,
  THINKING: 23,
  AURORA: 24,
  PRO: 25,
  REC: 26,
  PROGRESS: 27,
  STATUS: 28,
  PAGE: 29,
  /** Keys are `KEY0 + index`. */
  KEY0: 100,
} as const

// ---------------------------------------------------------------- layout (canvas points)

type Pt = readonly [number, number]
type Circle = readonly [number, number, number]

export const LAMP_REST: Pt = [690.0, 196.0]

export const GLOW_BTN: Rect = Rect.new(70.0, 110.0, 180.0, 52.0)
export const NEON: Rect = Rect.new(320.0, 84.0, 190.0, 116.0)
export const HOT_DOT: Circle = [592.0, 132.0, 8.0]
export const AURA: Rect = Rect.new(70.0, 300.0, 360.0, 56.0)
export const GLOW_TEXT: Rect = Rect.new(496.0, 270.0, 220.0, 100.0)

export const RADAR: Circle = [110.0, 140.0, 20.0]
export const AVATAR: Circle = [290.0, 140.0, 26.0]
export const LIVE: Rect = Rect.new(430.0, 124.0, 88.0, 32.0)
export const SEND: Circle = [100.0, 390.0, 20.0]
export const INBOX: Rect = Rect.new(530.0, 332.0, 190.0, 116.0)
export const PING_DURATION = f32(0.62)

export const ARC_A: Pt = [70.0, 120.0]
export const ARC_B: Pt = [710.0, 120.0]
export const OVERLOAD: Rect = Rect.new(70.0, 230.0, 290.0, 160.0)
export const CHARGED: Rect = Rect.new(450.0, 280.0, 240.0, 60.0)

export const FLAMES: Rect = Rect.new(80.0, 320.0, 270.0, 150.0)
export const PLASMA: Rect = Rect.new(430.0, 150.0, 270.0, 66.0)
export const DEPLOY: Rect = Rect.new(475.0, 360.0, 180.0, 52.0)

export const CARD_SIZE: Pt = [156.0, 92.0]
export const CARD_REST: Pt = [312.0, 254.0]

export const LENS_SIZE: Pt = [220.0, 72.0]
export const LENS_REST: Pt = [230.0, 204.0]
export const CRT: Rect = Rect.new(40.0, 330.0, 300.0, 140.0)
export const CHROMA: Rect = Rect.new(372.0, 356.0, 360.0, 76.0)

export const SKELETON: Rect = Rect.new(40.0, 70.0, 330.0, 216.0)
export const THINKING: Rect = Rect.new(34.0, 330.0, 150.0, 44.0)
export const AURORA: Rect = Rect.new(420.0, 70.0, 310.0, 186.0)
export const PRO: Rect = Rect.new(524.0, 336.0, 104.0, 40.0)

export const REC: Circle = [390.0, 318.0, 30.0]
export const PROGRESS: Rect = Rect.new(20.0, 430.0, 740.0, 10.0)

export const KEY_COLS = 10
export const KEY_COUNT = 20

export function key_rect(i: number): Rect {
  const [r, c] = [Math.trunc(i / KEY_COLS), i % KEY_COLS]
  return Rect.new(f32(40.0 + f32(c * 71.0)), f32(300.0 + f32(r * 106.0)), 62.0, 88.0)
}

function accent_key(i: number): boolean {
  return i === 2 || i === 7 || i === 18
}

export function lens_rect(c: Pt): Rect {
  return Rect.new(f32(c[0] - f32(LENS_SIZE[0] * 0.5)), f32(c[1] - f32(LENS_SIZE[1] * 0.5)), LENS_SIZE[0], LENS_SIZE[1])
}

function inside(r: Rect, p: Pt, pad: number): boolean {
  return p[0] >= f32(r.x - pad) && p[0] <= f32(f32(r.x + r.w) + pad) && p[1] >= f32(r.y - pad) && p[1] <= f32(f32(r.y + r.h) + pad)
}

function near(c: Pt, p: Pt, r: number): boolean {
  return f32(Math.hypot(f32(c[0] - p[0]), f32(c[1] - p[1]))) <= r
}

/** Background colour behind each scene's canvas. */
export function backdrop(scene: Scene): Color {
  switch (scene) {
    case "Lamp": return oklch(0.17, 0.006, 265.0)
    case "Flashlight": return oklch(0.16, 0.005, 265.0)
    case "Gi": return oklch(0.15, 0.006, 265.0)
    case "Keys": return oklch(0.18, 0.004, 265.0)
    case "GodRays": return oklch(0.11, 0.014, 265.0)
    default: return oklch(0.145, 0.006, 265.0)
  }
}

// ---------------------------------------------------------------- input

/** Every stage gesture: lamp, keys, emitters, ripples, the card, the lens. */
export function on_stage(s: Lab, d: Drag, tx: Tx): void {
  const p: [number, number] = [f32(d.x - f32(f32(d.w - CW) * 0.5)), f32(d.y - f32(f32(d.h - CH) * 0.5))]
  const now = s.now
  const t = f32(now)
  switch (d.phase) {
    case "Down": {
      s.grab = null
      const sc = s.scene
      if (sc === "Lamp" && near(s.lamp, p, 30.0)) {
        s.grab = { Lamp: [f32(p[0] - s.lamp[0]), f32(p[1] - s.lamp[1])] }
      } else if (sc === "Keys") {
        const i = Array.from({ length: KEY_COUNT }, (_, i) => i).find((i) => inside(key_rect(i), p, 0.0))
        if (i !== undefined) {
          s.keys[i].animate_to(1.0, Spring.new(0.1, 0.0), now)
          s.grab = { Key: i }
        }
      } else if (sc === "Gi") {
        if (near([REC[0], REC[1]], p, f32(REC[2] + 20.0))) {
          s.recording = !s.recording
        } else if (inside(PROGRESS, p, 10.0)) {
          s.uploading = !s.uploading
        }
      } else if (sc === "Glow" && inside(NEON, p, 0.0)) {
        s.neon_on = !s.neon_on
      } else if (sc === "Pulses") {
        let shot: Shot
        if (near([SEND[0], SEND[1]], p, f32(SEND[2] + 4.0))) {
          shot = { kind: "Ping", at: [SEND[0], SEND[1]], t0: t }
        } else if (inside(INBOX, p, 0.0)) {
          shot = { kind: "RippleCard", at: p, t0: t }
        } else {
          shot = { kind: "Ripple", at: p, t0: t }
        }
        s.shots.prune(t, 3.0)
        s.shots.trigger(t, shot)
      } else if (sc === "Motion") {
        const c: Vec2 = s.card.sample(now)
        if (inside(Rect.new(c.x, c.y, CARD_SIZE[0], CARD_SIZE[1]), p, 6.0)) {
          s.grab = { Card: [f32(p[0] - c.x), f32(p[1] - c.y)] }
          // Catching it mid-glide holds it where it is.
          s.card.set(c)
          s.card_vt.reset()
          s.card_vt.add(now, c)
          tx.instant()
        }
      } else if (sc === "Electric" && !inside(CHARGED, p, 0.0)) {
        s.shots.prune(t, 3.0)
        s.shots.trigger(t, { kind: "Zap", at: p, t0: t } satisfies Shot)
      } else if (sc === "Extras" && inside(PRO, p, 8.0)) {
        s.shots.prune(t, 3.0)
        s.shots.trigger(t, { kind: "Sparkles", at: p, t0: t } satisfies Shot)
      } else if (sc === "Lens") {
        if (inside(lens_rect(s.lens), p, 4.0)) {
          s.grab = { Lens: [f32(p[0] - s.lens[0]), f32(p[1] - s.lens[1])] }
        } else {
          s.shots.prune(t, 3.0)
          s.shots.trigger(t, { kind: "Shockwave", at: p, t0: t } satisfies Shot)
        }
      }
      break
    }
    case "Move": {
      const g = s.grab
      if (g !== null && "Lamp" in g) {
        const o = g.Lamp
        s.lamp = [clamp(f32(p[0] - o[0]), 0.0, CW), clamp(f32(p[1] - o[1]), 0.0, CH)]
        tx.instant()
      } else if (g !== null && "Card" in g) {
        const o = g.Card
        const c: Vec2 = { x: f32(p[0] - o[0]), y: f32(p[1] - o[1]) }
        s.card.set(c)
        s.card_vt.add(now, c)
        tx.instant()
      } else if (g !== null && "Lens" in g) {
        const o = g.Lens
        s.lens = [clamp(f32(p[0] - o[0]), 0.0, CW), clamp(f32(p[1] - o[1]), 0.0, CH)]
        tx.instant()
      }
      break
    }
    case "Up": {
      const g = s.grab
      if (d.cancelled()) {
        const start = [f32(d.start_x - f32(f32(d.w - CW) * 0.5)), f32(d.start_y - f32(f32(d.h - CH) * 0.5))]
        if (g !== null && "Lamp" in g) {
          const o = g.Lamp
          s.lamp = [f32(start[0] - o[0]), f32(start[1] - o[1])]
        } else if (g !== null && "Lens" in g) {
          const o = g.Lens
          s.lens = [f32(start[0] - o[0]), f32(start[1] - o[1])]
        } else if (g !== null && "Card" in g) {
          const o = g.Card
          s.card.set({ x: f32(start[0] - o[0]), y: f32(start[1] - o[1]) })
          s.card_vt.reset()
        } else if (g !== null && "Key" in g) {
          s.keys[g.Key].animate_to(0.0, Spring.new(0.25, 0.0), now)
        }
        s.grab = null
        return
      }
      if (g !== null && "Key" in g) {
        s.keys[g.Key].animate_to(0.0, Spring.new(0.25, 0.0), now)
      } else if (g !== null && "Card" in g) {
        // Fling: project where the throw would coast to, keep it on the canvas, and
        // glide there on a zero-bounce spring that starts at the release velocity.
        const v: Vec2 = s.card_vt.velocity()
        const c: Vec2 = s.card.sample(now)
        const rate = deceleration.NORMAL
        const tx_ = clamp(project(c.x, v.x, rate), 0.0, f32(CW - CARD_SIZE[0]))
        const ty_ = clamp(project(c.y, v.y, rate), 0.0, f32(CH - CARD_SIZE[1]))
        const glide = s.k("Motion", "glide")
        s.card.release(v, { x: tx_, y: ty_ }, Spring.new(glide, 0.0), now)
        tx.instant()
      }
      s.grab = null
      break
    }
  }
}

// ---------------------------------------------------------------- view helpers

type P = {
  sc: Scene
  txt: Color
  txt2: Color
  txt3: Color
  hair: Color
  card: Color
}

function bx(x: number, y: number, w: number, h: number): El {
  return el().absolute(x, y).size(w, h)
}

function label(x: number, y: number, s: string, size: number, weight: number, c: Color): El {
  return text(s).absolute(x, y).font(TextStyle.new(size, weight)).color(c)
}

function mono(x: number, y: number, s: string, size: number, c: Color): El {
  return text(s).absolute(x, y).font(TextStyle.new(size, 500.0).mono()).color(c)
}

function r(rc: Rect): El {
  return bx(rc.x, rc.y, rc.w, rc.h)
}

function circle(c: Circle): El {
  return bx(f32(c[0] - c[2]), f32(c[1] - c[2]), f32(c[2] * 2.0), f32(c[2] * 2.0)).radius(c[2])
}

function hx(h: number): Color {
  return color.hex(`#${h.toString(16).padStart(6, "0")}`) ?? Color.BLACK
}

/** Placeholder text lines (skeleton bars). */
function lines(p: P, x: number, y: number, w: number, n: number): El[] {
  return Array.from({ length: n }, (_, i) => {
    const ww = f32(w * f32([1.0, 0.82, 0.6, 0.9][i % 4]))
    return bx(x, f32(y + f32(i * 14.0)), ww, 6.0).radius(3.0).fill(oklch(0.3, 0.008, 265.0)).mark(mk(p.sc, 0, 0))
  })
}

function fx_card(p: P, rc: Rect, radius: number, node: number): El {
  return r(rc).radius(radius)
    .fill(p.card)
    .border(0.5, p.hair)
    .shadow(8.0, 28.0, oklcha(0.0, 0.0, 0.0, 0.5))
    .mark(mk(p.sc, 0, node))
}

function caption(p: P, x: number, y: number, s: string): El {
  return label(x, y, s, 11.0, 500.0, p.txt3)
}

// ---------------------------------------------------------------- canvases

export function canvas(s: Lab, scene: Scene): El {
  const p: P = {
    sc: scene,
    txt: oklch(0.94, 0.003, 265.0),
    txt2: oklch(0.68, 0.01, 265.0),
    txt3: oklch(0.52, 0.01, 265.0),
    hair: oklcha(1.0, 0.0, 0.0, 0.07),
    card: oklch(0.225, 0.007, 265.0),
  }
  let kids: El[]
  switch (scene) {
    case "Lamp": kids = lamp(s, p); break
    case "Flashlight": kids = flashlight(p); break
    case "Gi": kids = gi(s, p); break
    case "Keys": kids = keys(p); break
    case "GodRays": kids = godrays(p); break
    case "Glow": kids = glow(s, p); break
    case "Pulses": kids = pulses(p); break
    case "Electric": kids = electric(p); break
    case "Fire": kids = fire(p); break
    case "Motion": kids = motion(s, p); break
    case "Lens": kids = lens(p); break
    case "Extras": kids = extras(p); break
  }
  return el().key(`canvas-${Scene.id(scene)}`).size(CW, CH).mark(mk(scene, 0, 0)).children(kids)
}

function lamp(s: Lab, p: P): El[] {
  const user = oklch(0.3, 0.045, 258.0)
  const user_hair = oklcha(1.0, 0.0, 0.0, 0.08)
  const card = (rc: Rect, c: Color, h: Color) => r(rc).radius(16.0).fill(c).border(1.0, h).mark(mk(p.sc, mat.CARD, 0))
  const body = (x: number, y: number, ls: string[]): El[] =>
    ls.map((l, i) => label(x, f32(y + f32(i * 21.0)), l, 14.0, 400.0, p.txt))
  const v = [
    card(Rect.new(400.0, 20.0, 360.0, 64.0), user, user_hair),
    card(Rect.new(20.0, 106.0, 500.0, 150.0), p.card, p.hair),
    card(Rect.new(500.0, 280.0, 260.0, 44.0), user, user_hair),
    card(Rect.new(20.0, 348.0, 540.0, 160.0), p.card, p.hair),
  ]
  v.push(...body(418.0, 32.0, ["what if lighting effects. like you could", "put a light and it would raytrace…"]))
  v.push(...body(
    40.0,
    122.0,
    [
      "Every Rune element is an analytic rounded rect, so the",
      "frame is already an exact distance field. A light can",
      "sphere-trace soft shadows straight through it.",
    ],
  ))
  ;["Read shader.wgsl", "Edit lib.rs", "Run bench"].forEach((chip, i) => {
    const x = f32(40.0 + [0.0, 136.0, 236.0][i])
    const w = [124.0, 88.0, 84.0][i]
    v.push(bx(x, 212.0, w, 26.0).radius(13.0).fill(oklch(0.27, 0.008, 265.0)).border(1.0, p.hair).mark(mk(p.sc, mat.CHIP, 0)))
    v.push(label(f32(x + 11.0), 217.0, chip, 12.0, 500.0, p.txt2))
  })
  v.push(...body(520.0, 292.0, ["MAKE THIS SOOO GOOOD"]))
  v.push(...body(40.0, 364.0, ["Lights are springs like everything else."]))
  v.push(bx(36.0, 396.0, 508.0, 96.0).radius(10.0).fill(oklch(0.195, 0.008, 265.0)).border(1.0, p.hair).mark(mk(p.sc, mat.ON_CARD, 0)))
  const code = oklch(0.8, 0.06, 200.0)
  ;["let lamp = Light::point(x, y, 40.0)", "    .color(WARM).intensity(2.6).radius(11.0);", "lights.render(&scene, &[lamp], target);"].forEach((l, i) => {
    v.push(mono(54.0, f32(412.0 + f32(i * 22.0)), l, 12.5, code))
  })
  v.push(r(Rect.new(20.0, 532.0, 740.0, 56.0)).radius(18.0).fill(p.card).border(1.0, oklcha(1.0, 0.0, 0.0, 0.09)).mark(mk(p.sc, mat.COMPOSER, 0)))
  v.push(label(42.0, 550.0, "Ask anything…", 14.0, 400.0, p.txt3))
  v.push(circle([728.0, 560.0, 16.0]).fill(oklch(0.72, 0.15, 255.0)).mark(mk(p.sc, mat.BUTTON, 0)))
  v.push(bx(723.0, 559.0, 10.0, 2.0).radius(1.0).fill(oklch(0.2, 0.02, 255.0)).mark(mk(p.sc, 0, 0)))
  // The lamp's handle: a ring around the bulb, which the light draws itself.
  const held = s.grab !== null && "Lamp" in s.grab
  v.push(
    circle([s.lamp[0], s.lamp[1], 15.0])
      .key("lamp")
      .border(1.0, oklcha(1.0, 0.0, 0.0, held ? 0.5 : 0.22))
      .mark(mk(p.sc, 0, node.LAMP))
      .motion(Spring.new(0.2, 0.0)),
  )
  return v
}

function flashlight(p: P): El[] {
  const accent = oklch(0.7, 0.15, 255.0)
  const v = [
    label(20.0, 6.0, "Settings", 24.0, 600.0, p.txt),
    label(20.0, 42.0, "Appearance, sound and shortcuts", 13.0, 400.0, p.txt2),
  ]
  const rows: [string, string, number][] = [
    ["Appearance", "Dark", 2],
    ["Accent", "", 3],
    ["Reduce motion", "", 1],
    ["Sound effects", "", 0],
    ["Volume", "", 4],
    ["Push to talk", "⌥ Space", 2],
    ["Auto-update", "", 1],
    ["Crash reports", "", 0],
    ["Launch at login", "", 1],
  ]
  for (let g = 0; g < 3; g++) {
    const x = f32(20.0 + f32(g * 253.0))
    const y = 84.0
    v.push(bx(x, y, 233.0, 156.0).radius(14.0).fill(p.card).border(1.0, p.hair).mark(mk(p.sc, mat.CARD, 0)))
    for (let ri = 0; ri < 3; ri++) {
      const [name, value, kind] = rows[g * 3 + ri]
      const ry = f32(y + f32(ri * 52.0))
      if (ri > 0) {
        v.push(bx(f32(x + 14.0), ry, 205.0, 1.0).fill(p.hair).mark(mk(p.sc, 0, 0)))
      }
      v.push(label(f32(x + 16.0), f32(ry + 18.0), name, 13.0, 500.0, p.txt))
      const rx = f32(f32(x + 233.0) - 16.0)
      switch (kind) {
        case 0:
        case 1: {
          const on = kind === 1
          v.push(bx(f32(rx - 40.0), f32(ry + 15.0), 40.0, 22.0).radius(11.0).fill(on ? accent : oklch(0.33, 0.006, 265.0)).mark(mk(p.sc, mat.ON_CARD, 0)))
          const kx = on ? f32(rx - 20.0) : f32(rx - 38.0)
          v.push(bx(kx, f32(ry + 17.0), 18.0, 18.0).radius(9.0).fill(oklch(0.96, 0.0, 0.0)).mark(mk(p.sc, mat.SWITCH, 0)))
          break
        }
        case 2: {
          const w = f32(14.0 + f32([...value].length * f32(7.4)))
          v.push(bx(f32(rx - w), f32(ry + 13.0), w, 26.0).radius(8.0).fill(oklch(0.3, 0.006, 265.0)).border(1.0, p.hair).mark(mk(p.sc, mat.PILL, 0)))
          v.push(label(f32(f32(rx - w) + 8.0), f32(ry + 18.0), value, 12.0, 500.0, p.txt))
          break
        }
        case 3: {
          ;[255.0, 300.0, 350.0, 40.0, 150.0].forEach((h, k) => {
            const cx = f32(f32(rx - 16.0) - f32(k * 24.0))
            v.push(bx(cx, f32(ry + 18.0), 16.0, 16.0).radius(8.0).fill(oklch(0.68, 0.15, h)).mark(mk(p.sc, mat.SWITCH, 0)))
          })
          break
        }
        default: {
          v.push(bx(f32(rx - 110.0), f32(ry + 25.0), 110.0, 4.0).radius(2.0).fill(oklch(0.33, 0.006, 265.0)).mark(mk(p.sc, mat.ON_CARD, 0)))
          v.push(bx(f32(rx - 110.0), f32(ry + 25.0), 70.0, 4.0).radius(2.0).fill(accent).mark(mk(p.sc, mat.ON_CARD, 0)))
          v.push(bx(f32(rx - 49.0), f32(ry + 18.0), 18.0, 18.0).radius(9.0).fill(oklch(0.96, 0.0, 0.0)).mark(mk(p.sc, mat.SWITCH, 0)))
        }
      }
    }
  }
  const by = 266.0
  v.push(bx(20.0, by, 739.0, 132.0).radius(14.0).fill(p.card).border(1.0, p.hair).mark(mk(p.sc, mat.CARD, 0)))
  v.push(label(40.0, by + 18.0, "Keyboard shortcuts", 15.0, 600.0, p.txt))
  v.push(label(40.0, by + 42.0, "Press a key combination to record a new shortcut.", 13.0, 400.0, p.txt2))
  ;["⌘", "⇧", "K"].forEach((k, i) => {
    const x = f32(40.0 + f32(i * 52.0))
    v.push(bx(x, by + 72.0, 44.0, 44.0).radius(10.0).fill(oklch(0.3, 0.006, 265.0)).border(1.0, p.hair).mark(mk(p.sc, mat.PILL, 0)))
    v.push(label(f32(x + 15.0), by + 84.0, k, 15.0, 600.0, p.txt))
  })
  v.push(bx(589.0, by + 78.0, 150.0, 36.0).radius(10.0).fill(accent).mark(mk(p.sc, mat.PILL, 0)))
  v.push(label(611.0, by + 87.0, "Record shortcut", 13.0, 600.0, oklch(0.18, 0.03, 255.0)))
  v.push(bx(459.0, by + 78.0, 116.0, 36.0).radius(10.0).fill(oklch(0.3, 0.006, 265.0)).border(1.0, p.hair).mark(mk(p.sc, mat.PILL, 0)))
  v.push(label(498.0, by + 87.0, "Reset", 13.0, 600.0, p.txt))
  const names = ["Microphone", "Speakers", "Camera", "Battery"]
  const subs = ["MacBook Pro", "Studio Display", "FaceTime HD", "92 %"]
  for (let i = 0; i < 4; i++) {
    const x = f32(20.0 + f32(i * 189.5))
    v.push(bx(x, 424.0, 172.0, 116.0).radius(14.0).fill(p.card).border(1.0, p.hair).mark(mk(p.sc, mat.CARD, 0)))
    v.push(label(f32(x + 16.0), 440.0, names[i], 13.0, 600.0, p.txt))
    v.push(label(f32(x + 16.0), 462.0, subs[i], 12.0, 400.0, p.txt2))
    v.push(bx(f32(x + 16.0), 502.0, 140.0, 16.0).radius(8.0).fill(oklch(0.27, 0.006, 265.0)).mark(mk(p.sc, mat.ON_CARD, 0)))
    const f = f32([0.7, 0.45, 0.0, 0.92][i])
    if (f > 0.0) {
      v.push(bx(f32(x + 16.0), 502.0, f32(140.0 * f), 16.0).radius(8.0).fill(accent).mark(mk(p.sc, mat.PILL, 0)))
    }
  }
  return v
}

function gi(s: Lab, p: P): El[] {
  const v = [
    label(20.0, 4.0, "Voice memo", 24.0, 600.0, p.txt),
    label(20.0, 40.0, "Recording · Studio Display microphone", 13.0, 400.0, p.txt2),
  ]
  const card = (rc: Rect, radius: number) => r(rc).radius(radius).fill(p.card).border(1.0, p.hair).mark(mk(p.sc, mat.CARD, 0))
  ;[["Transcript", "Live, 2 speakers"], ["Markers", "3 added"], ["Noise", "Voice isolation on"]].forEach(([t, sub], i) => {
    const y = f32(80.0 + f32(i * 110.0))
    v.push(card(Rect.new(20.0, y, 200.0, 96.0), 16.0))
    v.push(label(40.0, f32(y + 18.0), t, 14.0, 600.0, p.txt))
    v.push(label(40.0, f32(y + 42.0), sub, 13.0, 400.0, p.txt2))
  })
  v.push(card(Rect.new(240.0, 80.0, 300.0, 316.0), 20.0))
  v.push(label(262.0, 98.0, "00:42.18", 30.0, 600.0, p.txt))
  v.push(label(262.0, 140.0, s.recording ? "Recording" : "Paused", 13.0, 500.0, oklch(0.75, 0.12, 25.0)))
  for (let k = 0; k < 30; k++) {
    const sin = f32(Math.sin(f32(k * f32(0.7))))
    const cos = f32(Math.cos(f32(f32(k * f32(0.23)) + 1.0)))
    const h = f32(8.0 + f32(40.0 * Math.abs(f32(0.5 + f32(0.5 * f32(sin * cos))))))
    v.push(bx(f32(262.0 + f32(k * f32(8.6))), f32(206.0 - f32(h * 0.5)), 4.4, h).radius(2.2).fill(oklch(0.5, 0.01, 265.0)).mark(mk(p.sc, mat.BAR, 0)))
  }
  v.push(circle([REC[0], REC[1], 50.0]).fill(oklch(0.27, 0.008, 265.0)).border(1.0, p.hair).mark(mk(p.sc, mat.DIAL, 0)))
  v.push(circle(REC).fill(oklch(0.66, 0.2, 25.0)).mark(mk(p.sc, mat.EMIT, node.REC)))
  ;[["Agent finished", "Demos rendered"], ["Build passed", "ci · 1m 12s"], ["Review", "No blockers"]].forEach(([t, sub], i) => {
    const y = f32(80.0 + f32(i * 110.0))
    v.push(card(Rect.new(560.0, y, 200.0, 96.0), 16.0))
    v.push(label(598.0, f32(y + 18.0), t, 14.0, 600.0, p.txt))
    v.push(label(598.0, f32(y + 42.0), sub, 13.0, 400.0, p.txt2))
    const c = i === 0 ? oklch(0.78, 0.17, 150.0) : oklch(0.45, 0.01, 265.0)
    v.push(bx(578.0, f32(y + 22.0), 10.0, 10.0).radius(5.0).fill(c).mark(mk(p.sc, mat.EMIT, i === 0 ? node.STATUS : 0)))
  })
  v.push(r(PROGRESS).radius(5.0).fill(oklch(0.24, 0.006, 265.0)).mark(mk(p.sc, mat.FLAT, 0)))
  v.push(r(Rect.new(PROGRESS.x, PROGRESS.y, f32(PROGRESS.w * f32(0.62)), PROGRESS.h)).radius(5.0).fill(oklch(0.78, 0.13, 210.0)).mark(mk(p.sc, mat.EMIT, node.PROGRESS)))
  v.push(label(20.0, 452.0, "Uploading to OpenCode · 3 of 5 files", 12.0, 500.0, p.txt2))
  for (let i = 0; i < 5; i++) {
    const x = f32(20.0 + f32(i * 151.0))
    v.push(card(Rect.new(x, 492.0, 136.0, 90.0), 16.0))
    v.push(label(f32(x + 18.0), 510.0, ["Pause", "Marker", "Trim", "Share", "Export"][i], 13.0, 600.0, p.txt))
  }
  return v
}

function keys(p: P): El[] {
  const key = oklch(0.29, 0.004, 265.0)
  const v = [
    r(Rect.new(0.0, 0.0, CW, CH)).radius(32.0).fill(oklch(0.255, 0.004, 265.0)).border(1.0, oklcha(1.0, 0.0, 0.0, 0.05)).mark(mk(p.sc, mat.BODY, 0)),
    label(40.0, 30.0, "OP-1 Field · Control surface", 15.0, 600.0, p.txt),
    label(40.0, 54.0, "Bevels from the SDF catch the light", 12.0, 400.0, p.txt2),
  ]
  const hues = [255.0, 150.0, 60.0, 25.0]
  hues.forEach((h, i) => {
    const cx = f32(90.0 + f32(i * 116.0))
    v.push(circle([cx, 170.0, 42.0]).fill(key).mark(mk(p.sc, mat.KNOB, 0)))
    v.push(circle([cx, 140.0, 5.0]).fill(oklch(0.7, 0.14, h)).mark(mk(p.sc, mat.FLAT, 0)))
  })
  v.push(bx(530.0, 100.0, 210.0, 140.0).radius(18.0).fill(oklch(0.14, 0.01, 265.0)).mark(mk(p.sc, mat.SCREEN, 0)))
  v.push(label(554.0, 124.0, "128 BPM", 26.0, 600.0, oklch(0.85, 0.12, 150.0)))
  v.push(label(554.0, 166.0, "Pattern A · bar 12", 13.0, 400.0, oklch(0.6, 0.06, 150.0)))
  const names = ["C", "D", "E", "F", "G", "A", "B", "C", "D", "E"]
  for (let i = 0; i < KEY_COUNT; i++) {
    const rc = key_rect(i)
    const accent = accent_key(i)
    v.push(r(rc).radius(14.0).fill(accent ? oklch(0.62, 0.17, 35.0) : key).mark(mk(p.sc, mat.KEY, node.KEY0 + i)))
    v.push(label(f32(rc.x + 12.0), f32(rc.y + 12.0), names[i % KEY_COLS], 12.0, 600.0, accent ? oklch(0.2, 0.03, 35.0) : p.txt2))
  }
  return v
}

function godrays(p: P): El[] {
  const names = [
    "Inbox", "Calendar", "Notes", "Music", "Photos", "Maps", "Files", "Terminal", "Mail", "Weather", "Clock", "Books", "Home", "Wallet",
    "Health", "Code", "Notes", "Rune",
  ]
  const v = [
    label(28.0, 70.0, "Good evening", 30.0, 600.0, p.txt),
    label(28.0, 114.0, "18 apps · light from behind the grid", 14.0, 400.0, p.txt2),
  ]
  for (let i = 0; i < 18; i++) {
    const [rw, c] = [Math.trunc(i / 6), i % 6]
    const [x, y] = [f32(28.0 + f32(c * 124.0)), f32(190.0 + f32(rw * 124.0))]
    v.push(bx(x, y, 104.0, 104.0).radius(22.0).fill(oklch(0.21, 0.008, 265.0)).border(1.0, p.hair).mark(mk(p.sc, mat.TILE, 0)))
    v.push(bx(f32(x + 16.0), f32(y + 16.0), 36.0, 36.0).radius(11.0).fill(oklch(0.62, 0.12, f32(f32(i * 47.0) % 360.0))).mark(mk(p.sc, mat.FLAT, 0)))
    v.push(label(f32(x + 16.0), f32(y + 70.0), names[i], 13.0, 600.0, p.txt))
  }
  return v
}

export const GODRAY_REST: Pt = [374.0, 304.0]

function glow(s: Lab, p: P): El[] {
  const btn = GLOW_BTN
  const v = [
    r(btn).radius(f32(btn.h * 0.5)).fill(hx(0x7a5cf6)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.16)).shadow(4.0, 10.0, oklcha(0.0, 0.0, 0.0, 0.4)).mark(mk(p.sc, 0, node.GLOW_BUTTON)),
    label(f32(btn.x + 52.0), f32(btn.y + 16.0), "Generate", 15.0, 600.0, Color.WHITE),
    caption(p, btn.x, f32(btn.y + 80.0), "Soft · breathing"),
    fx_card(p, NEON, 16.0, node.NEON),
    label(f32(NEON.x + 18.0), f32(NEON.y + 20.0), "Neon", 15.0, 600.0, hx(0xe6f9ff)),
  ]
  v.push(...lines(p, f32(NEON.x + 18.0), f32(NEON.y + 50.0), 120.0, 3))
  v.push(caption(p, NEON.x, f32(f32(NEON.y + NEON.h) + 24.0), s.neon_on ? "Neon · click to switch off" : "Neon · click to switch on"))
  v.push(circle(HOT_DOT).fill(hx(0xfff3dc)).mark(mk(p.sc, 0, node.HOT_DOT)))
  v.push(label(f32(HOT_DOT[0] + 18.0), f32(HOT_DOT[1] - 9.0), "Recording", 13.0, 500.0, oklch(0.88, 0.005, 265.0)))
  v.push(caption(p, f32(HOT_DOT[0] - 10.0), f32(f32(NEON.y + NEON.h) + 24.0), "Hot core"))
  v.push(r(AURA).radius(f32(AURA.h * 0.5)).fill(oklch(0.2, 0.008, 265.0)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.08)).shadow(6.0, 14.0, oklcha(0.0, 0.0, 0.0, 0.5)).mark(mk(p.sc, 0, node.AURA)))
  v.push(label(f32(AURA.x + 26.0), f32(AURA.y + 18.0), "Ask anything…", 15.0, 400.0, oklch(0.62, 0.01, 265.0)))
  v.push(caption(p, AURA.x, f32(f32(AURA.y + AURA.h) + 24.0), "Aura · flowing spectrum"))
  v.push(text("Rune").absolute(GLOW_TEXT.x, GLOW_TEXT.y).font(TextStyle.new(76.0, 600.0)).color(hx(0xfff4e6)).mark(mk(p.sc, 0, node.GLOW_TEXT)))
  v.push(caption(p, GLOW_TEXT.x, f32(f32(AURA.y + AURA.h) + 24.0), "Mask · text bloom"))
  return v
}

function pulses(p: P): El[] {
  const v = [
    circle(RADAR).fill(hx(0xf04e5e)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.2)).mark(mk(p.sc, 0, node.RADAR)),
    bx(f32(RADAR[0] - 6.0), f32(RADAR[1] - 6.0), 12.0, 12.0).radius(3.0).fill(oklcha(1.0, 0.0, 0.0, 0.95)).mark(mk(p.sc, 0, 0)),
    caption(p, f32(RADAR[0] - 18.0), f32(RADAR[1] + 70.0), "Radar"),
    circle(AVATAR).fill(oklch(0.33, 0.012, 265.0)).border(1.0, hx(0x34d399)).mark(mk(p.sc, 0, node.AVATAR)),
    label(f32(AVATAR[0] - 10.0), f32(AVATAR[1] - 9.0), "KL", 14.0, 600.0, oklch(0.95, 0.003, 265.0)),
    caption(p, f32(AVATAR[0] - 40.0), f32(AVATAR[1] + 70.0), "Breathing halo"),
    r(LIVE).radius(f32(LIVE.h * 0.5)).fill(hx(0xe8315a)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.2)).mark(mk(p.sc, 0, node.LIVE)),
    label(f32(LIVE.x + 28.0), f32(LIVE.y + 8.0), "LIVE", 12.0, 600.0, Color.WHITE),
    caption(p, f32(LIVE.x + 10.0), f32(AVATAR[1] + 70.0), "Heartbeat"),
    fx_card(p, INBOX, 16.0, node.INBOX),
    label(f32(INBOX.x + 18.0), f32(INBOX.y + 20.0), "Inbox", 15.0, 600.0, p.txt),
  ]
  v.push(...lines(p, f32(INBOX.x + 18.0), f32(INBOX.y + 50.0), 120.0, 3))
  v.push(circle(SEND).key("send").fill(hx(0x3d7ff5)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.16)).shadow(4.0, 10.0, oklcha(0.0, 0.0, 0.0, 0.4)).mark(mk(p.sc, 0, node.SEND)))
  v.push(label(f32(SEND[0] - 6.0), f32(SEND[1] - 10.0), "→", 16.0, 600.0, Color.WHITE))
  v.push(caption(p, f32(SEND[0] - 30.0), f32(SEND[1] + 46.0), "Send · ping → ripple"))
  v.push(caption(p, 250.0, 560.0, "Click anywhere for a ripple"))
  return v
}

function electric(p: P): El[] {
  const v: El[] = []
  for (const t of [ARC_A, ARC_B]) {
    v.push(circle([t[0], t[1], 9.0]).fill(oklch(0.72, 0.01, 265.0)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.3)).mark(mk(p.sc, 0, node.TERMINALS)))
  }
  v.push(caption(p, ARC_A[0], f32(ARC_A[1] + 40.0), "Arc · click to zap"))
  v.push(fx_card(p, OVERLOAD, 18.0, node.OVERLOAD))
  v.push(label(f32(OVERLOAD.x + 22.0), f32(OVERLOAD.y + 22.0), "Overload", 16.0, 600.0, p.txt))
  v.push(...lines(p, f32(OVERLOAD.x + 22.0), f32(OVERLOAD.y + 56.0), 200.0, 4))
  v.push(caption(p, OVERLOAD.x, f32(f32(OVERLOAD.y + OVERLOAD.h) + 26.0), "Border current"))
  v.push(r(CHARGED).key("charged").radius(f32(CHARGED.h * 0.5)).fill(hx(0x1b2740)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.14)).shadow(4.0, 10.0, oklcha(0.0, 0.0, 0.0, 0.4)).mark(mk(p.sc, 0, node.CHARGED)))
  v.push(label(f32(CHARGED.x + 86.0), f32(CHARGED.y + 19.0), "Charged", 16.0, 600.0, hx(0xdbe8ff)))
  v.push(caption(p, CHARGED.x, f32(f32(CHARGED.y + CHARGED.h) + 26.0), "Hover to charge"))
  return v
}

function fire(p: P): El[] {
  const v = [
    fx_card(p, FLAMES, 18.0, node.FLAMES),
    label(f32(FLAMES.x + 22.0), f32(FLAMES.y + 24.0), "Hot take", 16.0, 600.0, hx(0xfff1e6)),
  ]
  v.push(...lines(p, f32(FLAMES.x + 22.0), f32(FLAMES.y + 58.0), 190.0, 4))
  v.push(caption(p, FLAMES.x, f32(f32(FLAMES.y + FLAMES.h) + 26.0), "Flames + embers"))
  v.push(r(PLASMA).radius(f32(PLASMA.h * 0.5)).fill(hx(0x15122a)).border(0.5, hx(0xb9a8ff).alpha(0.25)).mark(mk(p.sc, 0, node.PLASMA)))
  v.push(label(f32(PLASMA.x + 106.0), f32(PLASMA.y + 22.0), "Plasma", 16.0, 600.0, hx(0xe9e4ff)))
  v.push(caption(p, PLASMA.x, f32(f32(PLASMA.y + PLASMA.h) + 28.0), "Plasma border"))
  v.push(r(DEPLOY).radius(f32(DEPLOY.h * 0.5)).fill(hx(0xf2702a)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.16)).shadow(4.0, 10.0, oklcha(0.0, 0.0, 0.0, 0.4)).mark(mk(p.sc, 0, node.DEPLOY)))
  v.push(label(f32(DEPLOY.x + 62.0), f32(DEPLOY.y + 16.0), "Deploy", 15.0, 600.0, Color.WHITE))
  v.push(caption(p, DEPLOY.x, f32(f32(DEPLOY.y + DEPLOY.h) + 28.0), "Heat + haze"))
  return v
}

function motion(s: Lab, p: P): El[] {
  const v: El[] = []
  // A faint dot grid so travel reads.
  for (let gy = 0; gy < 11; gy++) {
    for (let gx = 0; gx < 14; gx++) {
      v.push(bx(f32(30.0 + f32(gx * 55.0)), f32(26.0 + f32(gy * 55.0)), 2.0, 2.0).radius(1.0).fill(oklcha(1.0, 0.0, 0.0, 0.07)).mark(mk(p.sc, 0, 0)))
    }
  }
  // The card sits at its target; the compositor draws it along its track (with blur in flight).
  const c: Vec2 = s.card.target()
  const m = mk(p.sc, 0, node.CARD)
  const [w, h] = [CARD_SIZE[0], CARD_SIZE[1]]
  v.push(
    bx(c.x, c.y, w, h)
      .key("card")
      .radius(14.0)
      .fill(oklch(0.25, 0.008, 265.0))
      .border(0.5, oklcha(1.0, 0.0, 0.0, 0.1))
      .shadow(4.0, 8.0, oklcha(0.0, 0.0, 0.0, 0.35))
      .mark(m)
      .child(bx(12.0, 12.0, 28.0, 28.0).radius(14.0).fill(hx(0x8462fa)))
      .child(label(50.0, 13.0, "Flight 204", 13.0, 600.0, oklch(0.96, 0.003, 265.0)))
      .child(label(50.0, 31.0, "Departing 9:41", 11.0, 400.0, oklch(0.7, 0.01, 265.0)))
      .child(bx(12.0, 66.0, f32(w - 24.0), 6.0).radius(3.0).fill(oklch(0.33, 0.008, 265.0)))
      .child(bx(12.0, 66.0, f32(f32(w - 24.0) * f32(0.62)), 6.0).radius(3.0).fill(hx(0x22c48a))),
  )
  v.push(caption(p, 300.0, 560.0, "Drag and fling the card"))
  return v
}

function lens(p: P): El[] {
  const tiles: [number, string][] = [[0x7c4ff0, "Violet"], [0xf07a2c, "Ember"], [0x22b5a4, "Lagoon"], [0xe0559c, "Orchid"]]
  const v: El[] = []
  tiles.forEach(([c, n], i) => {
    const x = f32(40.0 + f32(i * 180.0))
    v.push(bx(x, 60.0, 160.0, 80.0).radius(14.0).fill(hx(c)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.15)).mark(mk(p.sc, 0, node.PAGE)))
    v.push(label(f32(x + 14.0), 110.0, n, 14.0, 600.0, oklcha(1.0, 0.0, 0.0, 0.95)))
  })
  ;[
    "Glass bends what is behind it: the rim squeezes the page,",
    "the middle stays sharp, and colour splits only at the edge.",
    "Rune copies the backdrop once per lens and lights the rim.",
  ].forEach((l, i) => {
    v.push(label(40.0, f32(176.0 + f32(i * 24.0)), l, 15.0, 400.0, oklch(0.78, 0.01, 265.0)))
  })
  v.push(r(CRT).radius(14.0).fill(hx(0x0c1910)).mark(mk(p.sc, 0, node.CRT)))
  v.push(mono(f32(CRT.x + 18.0), f32(CRT.y + 22.0), "> rune build --release", 13.0, hx(0x4ade80)))
  v.push(mono(f32(CRT.x + 18.0), f32(CRT.y + 44.0), "  compiling rune-fx", 13.0, hx(0x86efac).alpha(0.8)))
  v.push(mono(f32(CRT.x + 18.0), f32(CRT.y + 66.0), "  finished in 1.84 s", 13.0, hx(0x86efac).alpha(0.8)))
  v.push(bx(f32(CRT.x + 18.0), f32(CRT.y + 96.0), 132.0, 14.0).radius(3.0).fill(hx(0x22c55e)).mark(mk(p.sc, 0, node.CRT)))
  v.push(text("Chromatic").absolute(f32(CHROMA.x + 8.0), f32(CHROMA.y + 6.0)).font(TextStyle.new(52.0, 600.0)).color(oklch(0.96, 0.003, 265.0)).mark(mk(p.sc, 0, node.CHROMA)))
  v.push(caption(p, 270.0, 560.0, "Drag the glass · click for a shockwave"))
  return v
}

function extras(p: P): El[] {
  const v = [fx_card(p, SKELETON, 16.0, 0)]
  const bar = oklch(0.27, 0.006, 265.0)
  const sk = mk(p.sc, 0, node.SKELETON)
  for (let i = 0; i < 3; i++) {
    const y = f32(f32(SKELETON.y + 24.0) + f32(i * 62.0))
    v.push(bx(f32(SKELETON.x + 22.0), y, 36.0, 36.0).radius(18.0).fill(bar).mark(sk))
    v.push(bx(f32(SKELETON.x + 72.0), f32(y + 5.0), f32(190.0 - f32(i * 28.0)), 11.0).radius(5.5).fill(bar).mark(sk))
    v.push(bx(f32(SKELETON.x + 72.0), f32(y + 23.0), 120.0, 9.0).radius(4.5).fill(bar).mark(sk))
  }
  v.push(caption(p, SKELETON.x, f32(f32(SKELETON.y + SKELETON.h) + 24.0), "Skeleton shimmer"))
  v.push(text("Thinking…").absolute(f32(THINKING.x + 6.0), f32(THINKING.y + 8.0)).font(TextStyle.new(22.0, 500.0)).color(oklch(0.62, 0.01, 265.0)).mark(mk(p.sc, 0, node.THINKING)))
  v.push(caption(p, f32(THINKING.x + 6.0), f32(f32(THINKING.y + THINKING.h) + 16.0), "Text sheen"))
  v.push(fx_card(p, AURORA, 18.0, node.AURORA))
  v.push(label(f32(AURORA.x + 22.0), f32(f32(AURORA.y + AURORA.h) - 40.0), "Aurora", 19.0, 600.0, oklch(0.97, 0.003, 265.0)))
  v.push(caption(p, AURORA.x, f32(f32(AURORA.y + AURORA.h) + 24.0), "Aurora + static grain"))
  v.push(r(PRO).radius(f32(PRO.h * 0.5)).fill(hx(0xe9c46a)).border(0.5, oklcha(1.0, 0.0, 0.0, 0.4)).mark(mk(p.sc, 0, node.PRO)))
  v.push(label(f32(PRO.x + 36.0), f32(PRO.y + 11.0), "PRO", 14.0, 600.0, hx(0x3b2a06)))
  v.push(caption(p, PRO.x, f32(f32(PRO.y + PRO.h) + 26.0), "Sparkles · click for a burst"))
  return v
}
