// The bento's logical state and the actions that change it.
//
// An `Action` carries only indices. Whatever randomness an action needs (a fader's new level,
// the puck's next spot) comes from that tile's own `Rng` inside the model, so two builds that
// apply the same actions in the same order hold the same state, whatever they draw.
//
// Port of vendor/rune/examples/motion-bento/chaos/src/model.rs. f32 fields are rounded to f32
// after every step (`F`), as Rust computes them.

import { fixed } from "./fmt.ts"
import { Rng } from "./rng.ts"

const F = Math.fround

export const SCENES = ["Focus", "Relax", "Away", "Night"] as const
export const LIGHTS = ["Studio", "Desk lamp", "Hallway", "Porch"] as const
export const FADERS = ["Kick", "Bass", "Keys", "Vox", "FX"] as const
export const SCENE_NOTES = [
  "Cool, bright light. Notifications held.",
  "Warm light and something slow playing.",
  "Lights off, cameras armed, heat eased.",
  "Dim amber light. Quiet hours.",
] as const
export const DOCK = ["Energy", "Genres", "Orb", "Transfers", "Visitors"] as const
/** Each dock tile's key. */
export const DOCK_KEYS = ["energy", "chips", "orb", "transfers", "visitors"] as const
export const CHIPS = ["Ambient", "Lo-fi", "Jazz", "Rain", "Synth", "Piano", "Cafe", "Forest"] as const
/** Chips shown while the chip tile is collapsed. */
export const CHIPS_FOLDED = 4
export const TRACKS: readonly (readonly [string, string])[] = [
  ["Night Drive", "Lumen"],
  ["Paper Moons", "Hollow Coast"],
  ["Glasshouse", "Ines Varga"],
  ["Slow Orbit", "Kites"],
  ["Low Tide", "Marlowe"],
  ["Afterglow", "Sable Youth"],
  ["Neon Rain", "Oda"],
  ["Soft Static", "Fen"],
]
export const QUEUE_LEN = 4
export const FEED_KINDS = [
  "Front door unlocked",
  "Motion in the hallway",
  "Washer finished",
  "Package delivered",
  "Living room at 21°",
  "Garage closed",
  "Doorbell rang",
  "Air purifier on",
] as const
export const FEED_LEN = 4
export const FILES = ["mix-final.wav", "photos-oct.zip", "backup.tar"] as const
export const ENERGY_BARS = 7
/** Recent visitor arrivals the visitors tile charts. */
export const VISITS = 12
/** The most visitors one arrival brings. */
export const VISIT_MAX = 48
export const TEMP_MIN = 16.0
export const TEMP_MAX = 28.0

/** Rust's `enum Action`: unit variants as strings, the others `{ Variant: index }` (a `u8`). */
export type Action =
  | { Scene: number }
  | "TempUp"
  | "TempDown"
  | { Light: number }
  | { Fader: number }
  | "Puck"
  | "Queue"
  | "Feed"
  | { Focus: number }
  | "Energy"
  | "ChipsMore"
  | { Chip: number }
  | "Orb"
  | { Transfer: number }
  | "Visitors"

export const Action = {
  /**
   * The key of the element a person would tap for this action. Both builds key their elements
   * this way, and the Rune script taps them.
   */
  key(a: Action): string {
    if (typeof a === "string") {
      switch (a) {
        case "TempUp": return "thermo/up"
        case "TempDown": return "thermo/down"
        case "Puck": return "xy/pad"
        case "Queue": return "queue/head/skip"
        case "Feed": return "feed/head/test"
        case "Energy": return "energy/bars"
        case "ChipsMore": return "chips/head/more"
        case "Orb": return "orb/orb"
        case "Visitors": return "visitors/count"
      }
    }
    if ("Scene" in a) return `scene/seg${a.Scene}`
    if ("Light" in a) return `lights/light${a.Light}`
    if ("Fader" in a) return `mixer/fader${a.Fader}`
    if ("Focus" in a) return `${DOCK_KEYS[a.Focus % DOCK_KEYS.length]}/head`
    if ("Chip" in a) return `chips/chip${a.Chip}`
    return `transfers/row${a.Transfer}`
  },
}

export type FeedItem = {
  /** Unique for the run: the element's identity. */
  id: number
  kind: number
  /** Minutes past the hour, for the time label. */
  minute: number
}

export type Card = {
  id: number
  track: number
}

/** One arrival of visitors: a bar in the visitors chart. */
export type Visit = {
  id: number
  count: number
}

export type Orb = {
  /** 0..1 of the largest size. */
  size: number
  /** OKLCH hue in degrees. */
  hue: number
  /** Corner radius as a fraction of the side: 0.5 is a circle. */
  round: number
  /** Degrees, always growing so the spring turns one way. */
  turn: number
}

const R_FADER = 0
const R_PUCK = 1
const R_QUEUE = 2
const R_FEED = 3
const R_ENERGY = 4
const R_ORB = 5
const R_TRANSFER = 6
const R_VISITORS = 7

export class Model {
  /** Actions applied so far: the header's counter. */
  events = 0
  scene = 0
  temp = 21.5
  lights: boolean[] = [true, false, true, false]
  faders: number[] = [0.72, 0.58, 0.44, 0.66, 0.3].map(F)
  /** The XY pad's puck, 0..1 on each axis. */
  puck: [number, number] = [F(0.62), F(0.38)]
  /** Front card first. */
  queue: Card[] = []
  /** Newest first. */
  feed: FeedItem[] = []
  /** Which dock tile is wide. */
  focus = 0
  energy: number[] = [0.42, 0.55, 0.38, 0.7, 0.62, 0.48, 0.8].map(F)
  /** Tenths of a kWh, so both builds print the same digits. */
  kwh_tenths = 128
  chips_open = false
  chips: boolean[] = [true, false, true, false, false, false, false, false]
  orb: Orb = { size: F(0.8), hue: 245.0, round: 0.5, turn: 0.0 }
  transfers: number[] = [0.35, 0.7, 0.12].map(F)
  visitors = 1284
  /** Oldest first. */
  visits: Visit[] = []
  #next_id = 0
  #minute = 2
  #rng: Rng[]

  private constructor(rng: Rng[]) {
    this.#rng = rng
  }

  static new(seed: bigint): Model {
    const rng = Array.from({ length: 8 }, (_, i) => Rng.new(BigInt.asUintN(64, seed * 0x2545_f491_4f6c_dd1dn) ^ BigInt(i + 1)))
    const m = new Model(rng)
    for (let track = 0; track < QUEUE_LEN; track++) {
      const id = m.#id()
      m.queue.push({ id, track })
    }
    for (const count of [12, 18, 9, 22, 30, 26, 14, 19, 33, 28, 21, 17]) {
      const id = m.#id()
      m.visits.push({ id, count })
    }
    for (const kind of [2, 0, 5]) {
      const id = m.#id()
      m.#minute += 3
      m.feed.unshift({ id, kind, minute: m.#minute })
    }
    return m
  }

  #id(): number {
    this.#next_id += 1
    return this.#next_id
  }

  chips_shown(): number {
    return this.chips_open ? CHIPS.length : CHIPS_FOLDED
  }

  energy_kwh(): string {
    return `${Math.trunc(this.kwh_tenths / 10)}.${this.kwh_tenths % 10}`
  }

  temp_label(): string {
    return `${fixed(this.temp, 1)}°`
  }

  /** 0..1 around the thermostat's ring. */
  temp_fraction(): number {
    return F(F(this.temp - TEMP_MIN) / F(TEMP_MAX - TEMP_MIN))
  }

  apply(action: Action): void {
    this.events += 1
    if (typeof action === "string") {
      switch (action) {
        case "TempUp":
          this.temp = Math.min(F(this.temp + 0.5), TEMP_MAX)
          break
        case "TempDown":
          this.temp = Math.max(F(this.temp - 0.5), TEMP_MIN)
          break
        case "Puck": {
          const r = this.#rng[R_PUCK]!
          this.puck = [r.rangef(0.08, 0.92), r.rangef(0.1, 0.9)]
          break
        }
        case "Queue": {
          this.queue.shift()
          const last = this.queue.at(-1)?.track ?? 0
          const track = (last + 1 + this.#rng[R_QUEUE]!.below(TRACKS.length - 1)) % TRACKS.length
          const id = this.#id()
          this.queue.push({ id, track })
          break
        }
        case "Feed": {
          const r = this.#rng[R_FEED]!
          const kind = r.below(FEED_KINDS.length)
          this.#minute = (this.#minute + 1 + r.below(4)) % 60
          const id = this.#id()
          this.feed.unshift({ id, kind, minute: this.#minute })
          this.feed.length = Math.min(this.feed.length, FEED_LEN)
          break
        }
        case "Energy": {
          const r = this.#rng[R_ENERGY]!
          for (let i = 0; i < this.energy.length; i++) {
            this.energy[i] = r.rangef(0.15, 1.0)
          }
          this.kwh_tenths += 3 + r.below(23)
          break
        }
        case "ChipsMore":
          this.chips_open = !this.chips_open
          break
        case "Orb": {
          const r = this.#rng[R_ORB]!
          // Fields in Rust's order: each draws from the rng.
          const size = r.rangef(0.55, 1.0)
          const hue = F(F(this.orb.hue + r.rangef(40.0, 140.0)) % 360.0)
          const round = [0.5, F(0.32), F(0.22)][r.below(3)]!
          const turn = F(this.orb.turn + [45.0, 90.0, 135.0][r.below(3)]!)
          this.orb = { size, hue, round, turn }
          break
        }
        case "Visitors": {
          const count = 1 + this.#rng[R_VISITORS]!.below(VISIT_MAX)
          this.visitors += count
          const id = this.#id()
          this.visits.shift()
          this.visits.push({ id, count })
          break
        }
      }
      return
    }
    if ("Scene" in action) {
      this.scene = action.Scene % SCENES.length
    } else if ("Light" in action) {
      const i = action.Light % 4
      this.lights[i] = !this.lights[i]
    } else if ("Fader" in action) {
      const r = this.#rng[R_FADER]!
      const i = action.Fader % FADERS.length
      const f = this.faders[i]!
      // Move far enough to see.
      let next = r.rangef(0.12, 0.96)
      if (Math.abs(F(next - f)) < F(0.2)) {
        next = f > 0.5 ? F(f - F(0.35)) : F(f + F(0.35))
      }
      this.faders[i] = next
    } else if ("Focus" in action) {
      this.focus = action.Focus % DOCK.length
    } else if ("Chip" in action) {
      const i = action.Chip % CHIPS.length
      this.chips[i] = !this.chips[i]
    } else {
      const step = this.#rng[R_TRANSFER]!.rangef(0.15, 0.4)
      const i = action.Transfer % 3
      const t = this.transfers[i]!
      this.transfers[i] = t >= 1.0 ? 0.0 : Math.min(F(t + step), 1.0)
    }
  }
}

// The Rust module's `#[cfg(test)] mod tests` is `cargo test` code, not part of the app
// (docs/porting.md, Limits).
