// The flags both builds share. Each build strips these and keeps the rest for its framework.
//
// Port of vendor/rune/examples/motion-bento/chaos/src/config.rs. Numbers parse as Rust's
// `str::parse` does (fmt.ts), so a flag Rust rejects is rejected here with the same message.

import { display, parse_f64, parse_u64, parse_usize } from "./fmt.ts"
import { Load } from "./stress.ts"

export class Config {
  /** Names one chaos schedule (and the random choices each action makes). */
  seed: bigint = 1n
  /** Seconds of chaos. The window quits a second after it ends, writing metrics if asked. */
  duration = 20.0
  /** Scales how often things happen: 2 is twice the events. */
  intensity = 1.0
  /** Where to write the frame meter's JSON when the run ends. */
  metrics: string | null = null
  /** Show the frame meter over the window from the start (H toggles it). */
  hud = false
  /** Write the schedule as a Rune script and exit. */
  emit_script: string | null = null
  /** A named look or spring tuning (`look::Variant`). */
  variant = "default"
  /** Keep the window open after the schedule ends instead of quitting. */
  stay = false
  /** Stress mode (`--load N` or `--ramp A:B`): the wall of controls instead of the bento. */
  load: Load | null = null
  /** Where to write every frame's show time, load and times as CSV when the run ends. */
  frames: string | null = null
  /** Draw the stress HUD from this measured run's frames CSV instead of this run's own. */
  hud_from: string | null = null

  static default(): Config {
    return new Config()
  }

  /**
   * Takes the bento's own flags out of `args` (the program name first) and returns them with the
   * rest. `--duration` is read and also kept, since Rune's headless runs use it for video length.
   */
  static parse(args: Iterable<string>): { Ok: [Config, string[]] } | { Err: string } {
    try {
      return { Ok: parse(args) }
    } catch (e) {
      if (e instanceof Bad) return { Err: e.message }
      throw e
    }
  }

  /** The seconds between events on a quiet stretch, before intensity. */
  gap(): [number, number] {
    return [0.1 / this.intensity, 0.3 / this.intensity]
  }
}

/** A flag `Config.parse` rejects: its `Err`, as Rust's `?` returns it. */
class Bad extends Error {}

function parse(input: Iterable<string>): [Config, string[]] {
  const config = Config.default()
  const rest: string[] = []
  const args = input[Symbol.iterator]()
  let [fixed, ramp, hold, timed]: [number | null, string | null, number, boolean] = [null, null, 2.5, false]
  const value = (flag: string, next: IteratorResult<string>): string => {
    if (next.done) throw new Bad(`${flag} needs a value`)
    return next.value
  }
  const number = <T>(parse: (v: string) => T | null, flag: string, v: string): T => {
    const n = parse(v)
    if (n === null) throw new Bad(`${flag}: not a number: ${v}`)
    return n
  }
  for (let next = args.next(); !next.done; next = args.next()) {
    const arg = next.value
    const eq = arg.indexOf("=")
    const [flag, inline] = eq !== -1 && arg.slice(0, eq).startsWith("--") ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, null]
    const take = (): string => (inline !== null ? inline : value(flag, args.next()))
    switch (flag) {
      case "--seed":
        config.seed = number(parse_u64, flag, take())
        break
      case "--intensity":
        config.intensity = number(parse_f64, flag, take())
        if (!(config.intensity > 0.0)) {
          throw new Bad("--intensity must be above 0")
        }
        break
      case "--duration": {
        const v = take()
        if (v !== "auto") {
          config.duration = number(parse_f64, flag, v)
        }
        timed = true
        rest.push("--duration")
        rest.push(v)
        break
      }
      case "--metrics":
        config.metrics = take()
        break
      case "--emit-script":
        config.emit_script = take()
        break
      case "--variant":
        config.variant = take()
        break
      case "--load":
        fixed = Math.max(number(parse_usize, flag, take()), 1)
        break
      case "--ramp":
        ramp = take()
        break
      case "--hold":
        hold = number(parse_f64, flag, take())
        break
      case "--frames":
        config.frames = take()
        break
      case "--hud-from":
        config.hud_from = take()
        config.hud = true
        break
      case "--hud":
        config.hud = true
        break
      case "--stay":
        config.stay = true
        break
      default:
        rest.push(arg)
    }
  }
  if (fixed !== null && ramp !== null) {
    throw new Bad("--load and --ramp: pick one")
  } else if (fixed !== null) {
    config.load = Load.Fixed(fixed)
  } else if (ramp !== null) {
    const r = Load.parse_ramp(ramp, hold)
    if ("Err" in r) throw new Bad(r.Err)
    config.load = r.Ok
  }
  // A ramp runs as long as its levels, unless told otherwise; Rune's headless runs read it too.
  const d = config.load?.duration() ?? null
  if (!timed && d !== null) {
    config.duration = d
    rest.push("--duration")
    rest.push(display(d))
  }
  return [config, rest]
}

// The Rust module's `#[cfg(test)] mod tests` is `cargo test` code, not part of the app
// (docs/porting.md, Limits).
