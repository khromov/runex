// Motion bento: a 1440×900 control center whose twelve tiles all move at once, driven by a
// seeded chaos schedule. The same schedule drives the GPUI build of the same window, so the two
// can be watched and measured side by side. See vendor/rune/examples/motion-bento/README.md.
//
// ```sh
// bun examples/motion-bento/main.ts --seed 7 --duration 30 --intensity 1.5 --hud
// bun examples/motion-bento/main.ts --seed 7 --duration 8 --emit-script chaos.json
// bun examples/motion-bento/main.ts --seed 7 --ramp 32:1024 --frames ramp.csv --snap end.png --at 29.6
// ```
//
// Port of vendor/rune/examples/motion-bento/src/main.rs; chaos/ is the `motion-bento-chaos`
// crate. `src/tests.rs` is a `#[cfg(test)]` module driving a headless `rune::Runtime`, which
// runex doesn't bind (docs/porting.md, Limits), so it has no port.

import { writeFileSync } from "node:fs"
import { App, AppSpec, type Cx, type El, type KeyEvent, Live, type Tx, col, el, row, spacer, text, tooling } from "runex-js"
import { Kit, RollingText } from "runex-js/kit"
import { Readout, Replay } from "./chaos/hud.ts"
import { Springs, color, grid } from "./chaos/look.ts"
import { Action, Config, Meter, Model, Player, script_json } from "./chaos/lib.ts"
import { SCENES } from "./chaos/model.ts"
import { START } from "./chaos/schedule.ts"
import { Wall } from "./chaos/stress.ts"
import * as dock from "./dock.ts"
import * as stress from "./stress.ts"
import { c, caption, font, nums, spring } from "./style.ts"
import * as tiles_mid from "./tiles_mid.ts"
import * as tiles_top from "./tiles_top.ts"

let CONFIG: Config | null = null

let METER: Meter | null = null

export function config(): Config {
  return (CONFIG ??= Config.default())
}

export class State {
  m: Model
  springs: Springs
  /** The thermostat ring's drawn span, smoothed by its spring. */
  ring: Live
  k: Kit
  /** Plays the schedule from `poll`; `null` when a script's taps drive the window instead. */
  player: Player | null
  hud: boolean
  hud_lines: [string, string, string, string]
  hud_at: number
  begun: boolean
  ended: boolean
  written: boolean
  /** Stress mode's wall, its show time, and the HUD's source and numbers. */
  wall: Wall | null
  t: number
  replay: Replay | null
  readout: Readout | null

  private constructor(f: Omit<State, "act" | "write_metrics">) {
    this.m = f.m
    this.springs = f.springs
    this.ring = f.ring
    this.k = f.k
    this.player = f.player
    this.hud = f.hud
    this.hud_lines = f.hud_lines
    this.hud_at = f.hud_at
    this.begun = f.begun
    this.ended = f.ended
    this.written = f.written
    this.wall = f.wall
    this.t = f.t
    this.replay = f.replay
    this.readout = f.readout
  }

  static new(): State {
    const cfg = config()
    const scripted = tooling.headless_run()?.script() != null
    const m = Model.new(cfg.seed)
    const k = Kit.neutral(true)
    // `k.c` reads the palette out of the kit, so the change is written back.
    const palette = k.c
    palette.bg_accent = c(color.ACCENT)
    k.c = palette
    return new State({
      ring: Live.new([0.0, m.temp_fraction()]),
      m,
      springs: Springs.variant(cfg.variant),
      k,
      player: !scripted && cfg.load === null ? Player.new(cfg) : null,
      hud: cfg.hud,
      hud_lines: ["", "", "", ""],
      hud_at: -Infinity,
      begun: false,
      ended: false,
      written: false,
      wall: cfg.load !== null ? Wall.new(cfg.seed) : null,
      t: 0.0,
      replay: cfg.hud_from !== null ? replay(cfg.hud_from) : null,
      readout: null,
    })
  }

  act(action: Action): void {
    this.m.apply(action)
    this.ring.set([0.0, this.m.temp_fraction()])
  }

  write_metrics(): void {
    if (this.written) {
      return
    }
    this.written = true
    const m = METER
    if (m === null) return
    m.end()
    const frames = config().frames
    if (frames !== null) {
      try {
        writeFileSync(frames, m.frames_csv())
      } catch (e) {
        console.error(`motion-bento: writing ${frames}: ${(e as Error).message}`)
      }
    }
    const metrics = config().metrics
    if (metrics !== null) {
      try {
        m.write(metrics)
      } catch (e) {
        console.error(`motion-bento: writing ${metrics}: ${(e as Error).message}`)
      }
    }
  }
}

/** `Replay::load(p).unwrap_or_else(|e| panic!("--hud-from: {e}"))`. */
function replay(path: string): Replay {
  const r = Replay.load(path)
  if ("Err" in r) throw new Error(`--hud-from: ${r.Err}`)
  return r.Ok
}

function poll(s: State, t: number, tx: Tx): boolean {
  const cfg = config()
  let changed = false
  if (s.player !== null) {
    const p = s.player
    const due = p.due(t)
    const next = p.next_at()
    if (next !== null) {
      tx.wake_after(Math.max(next - t, 0.0))
    }
    for (const a of due) {
      s.act(a)
      changed = true
    }
  }
  if (s.wall !== null && cfg.load !== null) {
    const n = cfg.load.at(t)
    s.wall.update(t, n)
    s.t = t
    METER?.tag(t, n)
    if (s.hud) {
      s.readout = s.replay !== null ? Readout.replay(s.replay, t) : METER !== null ? Readout.live(METER) : null
    }
    tx.wake_after(0.0)
    changed = true
  }
  if (!s.begun && t >= START) {
    s.begun = true
    METER?.begin()
  }
  if (!s.ended && t >= cfg.duration) {
    s.ended = true
    METER?.end()
  }
  // Not `rune::is_headless()`: it reads the process's arguments, where `--variant` is ours.
  const headless = tooling.headless_run() !== null
  if (!headless && !cfg.stay) {
    if (t >= cfg.duration + 1.0) {
      s.write_metrics()
      tx.quit()
    } else if (s.ended || t >= cfg.duration) {
      const left = cfg.duration + 1.0 - t
      tx.wake_after(Number.isNaN(left) ? 0.0 : Math.max(left, 0.0))
    }
  }
  if (headless && t >= cfg.duration + 1.0) {
    s.write_metrics()
  }
  if (s.hud && s.wall === null && !headless && t - s.hud_at >= 0.25) {
    s.hud_at = t
    if (METER !== null) {
      const lines = METER.hud()
      changed ||= lines.some((l, i) => l !== s.hud_lines[i])
      s.hud_lines = lines
    }
    tx.wake_after(0.25)
  }
  return changed
}

function on_key(s: State, e: KeyEvent, _tx: Tx): boolean {
  const key = e.key
  if (typeof key === "object" && "Text" in key && (key.Text === "h" || key.Text === "H")) {
    s.hud = !s.hud
    s.readout = null
    s.hud_at = -Infinity
    return true
  }
  return false
}

function on_close(s: State, _tx: Tx): void {
  s.write_metrics()
}

function header(s: State): El {
  const k = s.k
  const mood = color.SCENE[s.m.scene]!
  const scene = row()
    .h(34.0)
    .px(14.0)
    .gap(8.0)
    .radius(17.0)
    .center_y()
    .fill(c(color.TILE))
    .border(1.0, c(color.EDGE))
    .motion(spring(s.springs.layout))
    .child(el().size(10.0, 10.0).radius(5.0).fill(c(mood)).motion(spring(s.springs.morph)))
    .child(RollingText.new("head-scene", SCENES[s.m.scene]!).value(s.m.scene).font(font(13.0, 560.0)).color(c(color.TEXT)).build(k))
  const events = row()
    .gap(6.0)
    .center_y()
    .child(RollingText.new("events", String(s.m.events)).value(s.m.events).font(nums(13.0, 600.0)).color(c(color.TEXT)).build(k))
    .child(caption("events"))
  return row()
    .w_full()
    .h(grid.HEADER)
    .center_y()
    .gap(16.0)
    .child(
      col()
        .gap(2.0)
        .child(text("Studio").font(font(24.0, 680.0)).color(c(color.TEXT)))
        .child(caption("Control center · Friday evening")),
    )
    .child(spacer())
    .child(events)
    .child(scene)
}

function hud(s: State): El {
  let lines = col()
    .key("hud")
    .absolute(grid.WIDTH - grid.PAD - 300.0, 12.0)
    .w(300.0)
    .padding(12.0)
    .gap(3.0)
    .radius(12.0)
    .fill(c(color.BG.alpha(0.92)))
    .border(1.0, c(color.ACCENT.alpha(0.4)))
    .raise()
  for (const l of s.hud_lines) {
    lines = lines.child(text(l).font(nums(11.0, 500.0).mono()).color(c(color.TEXT_2)))
  }
  return lines
}

function view(s: State, _: Cx): El {
  if (s.wall !== null) {
    return stress.view(s, s.wall)
  }
  const k = s.k
  let root = col()
    .w(grid.WIDTH)
    .h(grid.HEIGHT)
    .px(grid.PAD)
    .pb(grid.PAD)
    .pt(grid.PAD - 8.0)
    .gap(grid.GAP)
    .fill(c(color.BG))
    .motion(spring(s.springs.layout))
    .child(header(s))
    .child(row().h(grid.ROW1).gap(grid.GAP).child(tiles_top.scenes(s, k)).child(tiles_top.thermostat(s, k)).child(tiles_top.lights(s, k)))
    .child(
      row()
        .h(grid.ROW2)
        .gap(grid.GAP)
        .child(tiles_mid.mixer(s, k))
        .child(tiles_mid.xy(s, k))
        .child(tiles_mid.queue(s, k))
        .child(tiles_mid.feed(s, k)),
    )
    .child(dock.dock(s, k))
  if (s.hud) {
    root = root.child(hud(s))
  }
  return root
}

// `fn main`. `Config::parse(std::env::args())`: the program name, then the script's arguments.
const parsed = Config.parse([process.argv[1] ?? "motion-bento", ...process.argv.slice(2)])
if ("Err" in parsed) {
  console.error(`motion-bento: ${parsed.Err}`)
  process.exit(2)
}
const [cfg, rest] = parsed.Ok
if (cfg.emit_script !== null) {
  try {
    writeFileSync(cfg.emit_script, script_json(cfg))
  } catch (e) {
    throw new Error(`writing ${cfg.emit_script}: ${(e as Error).message}`)
  }
} else {
  if (CONFIG === null) CONFIG = cfg
  const meter = Meter.new("rune", 120.0)
  meter.note("work", "update_ms + encode_ms: events, poll, view, layout, paint, upload and encode, to submit")
  meter.note("build", "update_ms: events, poll, view, layout and paint")
  meter.note("variant", config().variant)
  meter.note("seed", String(config().seed))
  METER = meter
  const spec = {
    ...AppSpec.new<State>("Motion bento", [grid.WIDTH, grid.HEIGHT], State.new, view),
    poll,
    on_key,
    min_size: [grid.WIDTH, grid.HEIGHT] as [number, number],
  }
  App.new(spec)
    .args(rest.slice(1))
    .on_close(on_close)
    .on_frame_encoded((f) => {
      const start = f.started()
      if (f.outcome() !== "Drawn" || start === null) return
      const build = f.update_ms() ?? 0.0
      const work = build + (f.encode_ms() ?? 0.0)
      if (METER !== null) {
        const hz = f.refresh_hz()
        if (hz !== null) {
          METER.set_refresh(hz)
        }
        METER.frame_with_build(start, work, build)
      }
    })
    .run()
}
