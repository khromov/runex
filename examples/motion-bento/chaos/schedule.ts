// The chaos schedule: a seeded list of timed actions, quiet stretches broken by bursts.
//
// The schedule plays the actions against its own `Model` as it picks them, so every action is
// one a person could take at that moment (a chip that's showing, a scene that isn't already on).
//
// Port of vendor/rune/examples/motion-bento/chaos/src/schedule.rs.

import type { Config } from "./config.ts"
import { display, fixed } from "./fmt.ts"
import { Action, CHIPS, DOCK, FADERS, Model, SCENES } from "./model.ts"
import { Rng } from "./rng.ts"

/** Chaos starts once the first frames have settled. */
export const START = 0.6
/**
 * A Rune script taps this long before the event's time and lifts at it, so the action lands at
 * `t` in a recording.
 */
export const TAP_LEAD = 0.01

export type Event = {
  t: number
  action: Action
}

// Relative odds per kind of action.
const KINDS = [5, 4, 4, 9, 12, 8, 6, 8, 6, 6, 3, 8, 6, 8, 6] as const

function pick(rng: Rng, m: Model): Action {
  // `as u8`: every index here is below 256.
  const other = (rng: Rng, n: number, current: number) => (current + 1 + rng.below(n - 1)) % n
  switch (rng.weighted(KINDS)) {
    case 0: return { Scene: other(rng, SCENES.length, m.scene) }
    case 1: return "TempUp"
    case 2: return "TempDown"
    case 3: return { Light: rng.below(4) }
    case 4: return { Fader: rng.below(FADERS.length) }
    case 5: return "Puck"
    case 6: return "Queue"
    case 7: return "Feed"
    case 8: return { Focus: other(rng, DOCK.length, m.focus) }
    case 9: return "Energy"
    case 10: return "ChipsMore"
    case 11: return { Chip: rng.below(Math.min(m.chips_shown(), CHIPS.length)) }
    case 12: return "Orb"
    case 13: return { Transfer: rng.below(3) }
    default: return "Visitors"
  }
}

/** The run's actions in time order, from `START` to `config.duration`. */
export function schedule(config: Config): Event[] {
  const rng = Rng.new(config.seed)
  const model = Model.new(config.seed)
  const events: Event[] = []
  const [lo, hi] = config.gap()
  let t = START
  let next_burst = START + rng.range(1.2, 2.2)
  while (t < config.duration) {
    const action = pick(rng, model)
    model.apply(action)
    events.push({ t, action })
    if (t >= next_burst) {
      // A burst: 6–12 actions 30–60 ms apart, then a breath.
      const n = 6 + rng.below(7)
      for (let i = 0; i < n; i++) {
        t += rng.range(0.03, 0.06)
        if (t >= config.duration) {
          break
        }
        const action = pick(rng, model)
        model.apply(action)
        events.push({ t, action })
      }
      t += rng.range(0.35, 0.6)
      next_burst = t + rng.range(2.0, 3.0)
    } else {
      t += rng.range(lo, hi)
    }
  }
  return events
}

/**
 * The schedule as a Rune headless script: one tap per action at its key, and an `end` mark a
 * second after the last so the springs settle on camera.
 */
export function script_json(config: Config): string {
  let out = "{\"events\": [\n"
  for (const e of schedule(config)) {
    out += `  {"t": ${fixed(e.t - TAP_LEAD, 4)}, "type": "tap", "key": "${Action.key(e.action)}", "hold": ${display(TAP_LEAD)}},\n`
  }
  out += `  {"t": ${fixed(config.duration + 1.0, 4)}, "type": "mark", "name": "end"}\n]}\n`
  return out
}

/** Plays a schedule against a clock: hands back each action once its time has come. */
export class Player {
  #events: Event[]
  #next = 0

  private constructor(events: Event[]) {
    this.#events = events
  }

  static new(config: Config): Player {
    return new Player(schedule(config))
  }

  /** The actions due by `t` seconds that haven't been handed out yet. */
  due(t: number): Action[] {
    const start = this.#next
    while (this.#next < this.#events.length && this.#events[this.#next]!.t <= t) {
      this.#next += 1
    }
    return this.#events.slice(start, this.#next).map((e) => e.action)
  }

  done(): boolean {
    return this.#next === this.#events.length
  }

  /** The time of the next action, if any. */
  next_at(): number | null {
    return this.#events[this.#next]?.t ?? null
  }

  len(): number {
    return this.#events.length
  }

  is_empty(): boolean {
    return this.#events.length === 0
  }
}

// The Rust module's `#[cfg(test)] mod tests` is `cargo test` code, not part of the app
// (docs/porting.md, Limits).
