// Event-loop tests: real windows driven through runex's JavaScript pump (ts/loop.ts, the Pump in
// src/app.rs, Rune's patched event loop). Headless runs (`--snap`, `--tree`) return before the
// pump starts, so nothing else covers this path.
//
//   bun test ./test/windowed                     # on a Mac with a display, or Linux with DISPLAY
//   RUNEX_WINDOWED=1 xvfb-run -a -s "-screen 0 1920x1080x24" bun test ./test/windowed
//
// Linux in Docker: scripts/linux-docker.sh's image has no X server, so the command installs Xvfb
// and the X client libraries winit loads before running the tests (about 20 s):
//
//   scripts/linux-docker.sh run bash -c 'apt-get update -qq && apt-get install -y -qq \
//     --no-install-recommends xvfb xauth libxkbcommon-x11-0 libxcursor1 libxi6 libxrandr2 \
//     libx11-xcb1 >/dev/null && RUNEX_WINDOWED=1 xvfb-run -a -s "-screen 0 1920x1080x24" \
//     bun test ./test/windowed'
//
// Every scenario is a fixture in its own process (winit allows one event loop per process),
// run on each runtime in RUNEX_WINDOWED_RUNTIMES (default bun,node); see lib.ts for the gating.
// Windows open at the screen's top-left corner for a few seconds and close themselves; moving
// the pointer over one makes Rune redraw it, which can disturb the frame counts. Measured
// numbers (frame rates, latencies, CPU) print as `[windowed]` lines.
//
// Frame expectations come from the display: the trace header's refresh rate. macOS paces frames
// with a display link (Rune draws 120 frames a second on a 60 Hz MacBook Air panel, in Rust as in
// the port); elsewhere a poll asking for frames gets about one per 60 Hz frame. The thresholds
// are lower bounds a quarter of that, at least the counts the test plan names.
import { describe, expect } from "bun:test"
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MAC, PENDING, REPO, RUNTIMES, SLOW_POLL, STEADY_HOLD_MS, WINDOWS, describeRun, fixture, maxGap, readTrace, report, runFixture, scratch, windowGate, windowedTest, within } from "./lib.ts"

const gate = await windowGate()
if (!gate.run) console.log(`  [windowed] every test skips: ${gate.reason}`)
else if (gate.error) console.log(`  [windowed] ${gate.error}`)
else {
  report("probe window", { ms: gate.probeMs })
  for (const [id, p] of Object.entries(PENDING)) {
    const on = RUNTIMES.filter((rt) => p.when(rt))
    if (on.length && process.env.RUNEX_WINDOWED_PENDING !== "run") console.log(`  [windowed] pending (test.todo) on ${on.join(",")}: ${id}: ${p.reason}`)
  }
}

/** The fewest frames to expect over `ms` from a display at `hz`: a quarter of its rate, at least `floor`. */
const needed = (hz: number, ms: number, floor: number) => Math.max(floor, Math.ceil((hz || 60) * (ms / 1000) * 0.25))

describe("smoke", () => {
  for (const rt of RUNTIMES) {
    windowedTest(gate, `examples/hello --native --frames 30 draws 30 frames and exits (${rt})`, async () => {
      const s = scratch()
      try {
        const trace = join(s.dir, "hello.jsonl")
        const run = await runFixture(rt, "examples/hello/main.ts", ["--native", "--trace", trace, "--frames", "30"], { timeoutMs: 20000 })
        const t = readTrace(trace)
        report(`hello 30 frames (${rt})`, { ms: run.ms, lines: t.lines, hz: t.hz, frameSpanMs: t.frames.at(-1) ?? 0 })
        expect(run.code, describeRun(run)).toBe(0)
        expect(t.lines).toBe(31)
      } finally {
        s.cleanup()
      }
    }, { runtime: rt })
  }
})

describe("poll-driven frames without input", () => {
  // A trace with a frame count keeps redrawing until it has them: this is the pump delivering
  // Rune's own frame requests, with nobody touching the window.
  for (const [label, env] of [["", {}], [", input polling slowed", SLOW_POLL]] as const) {
    for (const rt of RUNTIMES) {
      windowedTest(gate, `examples/shapes --native --frames 60 finishes in under 10 s${label} (${rt})`, async () => {
        const s = scratch()
        try {
          const trace = join(s.dir, "shapes.jsonl")
          const run = await runFixture(rt, "examples/shapes/main.ts", ["--native", "--trace", trace, "--frames", "60"], { env, timeoutMs: 15000 })
          const t = readTrace(trace)
          report(`shapes 60 frames${label} (${rt})`, { ms: run.ms, lines: t.lines, hz: t.hz })
          expect(run.code, describeRun(run)).toBe(0)
          expect(t.lines).toBe(61)
          expect(run.ms).toBeLessThan(10000)
        } finally {
          s.cleanup()
        }
      }, { runtime: rt })
    }
  }

  // The poll asks for the next frame (`tx.wake_after(0)`): the window animates at the display's
  // rate. Measured over [300, 2300) ms after the first poll, past launch.
  const FROM = 300
  const TO = 2300
  for (const [label, env, pend] of [["", {}, [] as string[]], [", input polling slowed", SLOW_POLL, [] as string[]]] as const) {
    for (const rt of RUNTIMES) {
      const applies = pend.find((id) => PENDING[id]?.when(rt))
      windowedTest(gate, `a poll calling wake_after(0) draws at the display's rate${label} (${rt})`, async () => {
        const s = scratch()
        try {
          const trace = join(s.dir, "wake.jsonl")
          const run = await runFixture(rt, fixture("poll-frames"), ["wake", "--native", "--trace", trace], { env: { ...env, FIXTURE_MS: String(TO + 200) }, timeoutMs: 20000 })
          expect(run.code, describeRun(run)).toBe(0)
          const t = readTrace(trace)
          const polls: number[] = run.result.polls
          const need = needed(t.hz, TO - FROM, 30)
          const got = { polls: within(polls, FROM, TO), frames: within(t.frames, FROM, TO), pollGapMs: maxGap(polls, FROM, TO), frameGapMs: maxGap(t.frames, FROM, TO) }
          report(`poll with wake_after(0)${label} (${rt})`, { ...got, need, hz: t.hz, fps: got.frames / ((TO - FROM) / 1000) })
          expect(got.polls).toBeGreaterThanOrEqual(need)
          expect(got.frames).toBeGreaterThanOrEqual(need)
          // A stall after launch (frames waiting for an input check) shows as one long gap.
          expect(got.pollGapMs).toBeLessThan(250)
        } finally {
          s.cleanup()
        }
      }, { runtime: rt, pending: applies })
    }
  }

  // The poll returns true without asking for frames, as examples/shapes' does: Rune draws the
  // launch frames and then nothing ("an idle window draws nothing"). Rust's shapes draws 3
  // frames in its first 0.1 s and then none, so the port must not draw more.
  //
  // Windows differs, in Rust as in the port: after a frame that draws something new, Rune keeps
  // presenting every refresh for STEADY_HOLD_MS (lib.ts), and each of those frames polls. A poll
  // that moves the picture (`nowake`, and shapes) holds the window again on every frame, so it
  // never rests: on the windows-11-arm runner (WARP, rendering on the CPU) Rust's shapes and the
  // port's both drew 5 to 9 frames a second from 1 s to 4 s, each of them held. There the fixture runs `still` (the poll
  // returns true and the picture stays), which rests once launch's hold has ended (Rust's hello
  // drew its last frame at 0.7 s), and the window is measured from then.
  for (const rt of RUNTIMES) {
    windowedTest(gate, `a poll returning true without wake_after stops drawing after launch (${rt})`, async () => {
      const s = scratch()
      try {
        const trace = join(s.dir, "nowake.jsonl")
        const [mode, from, to] = WINDOWS ? ["still", STEADY_HOLD_MS + 600, STEADY_HOLD_MS + 1900] : ["nowake", 1000, 2300]
        const run = await runFixture(rt, fixture("poll-frames"), [mode, "--native", "--trace", trace], { env: { FIXTURE_MS: String(to) }, timeoutMs: 20000 })
        expect(run.code, describeRun(run)).toBe(0)
        const t = readTrace(trace)
        const polls: number[] = run.result.polls
        const got = { framesTotal: t.frames.length, lateFrames: within(t.frames, from, to), latePolls: within(polls, from, to) }
        report(`poll without wake_after, ${mode} (${rt})`, { ...got, from, to, hz: t.hz })
        expect(got.lateFrames).toBeLessThanOrEqual(2)
        expect(got.latePolls).toBeLessThanOrEqual(2)
        // Launch's frames; on Windows also the hold's, at the display's rate.
        expect(got.framesTotal).toBeLessThanOrEqual(12 + (WINDOWS ? Math.ceil((t.hz || 60) * (STEADY_HOLD_MS / 1000) * 1.5) : 0))
      } finally {
        s.cleanup()
      }
    }, { runtime: rt })
  }
})

describe("wakes", () => {
  // With input polling at 1000 ms, a frame within 150 ms can only come from the wake hook.
  for (const rt of RUNTIMES) {
    windowedTest(gate, `handle.update and Live.set from timers draw within 150 ms, input polling slowed (${rt})`, async () => {
      const run = await runFixture(rt, fixture("wake"), [], { env: SLOW_POLL, timeoutMs: 25000 })
      expect(run.code, describeRun(run)).toBe(0)
      const r = run.result
      report(`wake latency ms (${rt})`, { update: r.updates, live: r.lives })
      expect(r.rested).toEqual([true, true, true, true, true, true])
      for (const ms of [...r.updates, ...r.lives]) {
        expect(ms).not.toBeNull()
        expect(ms).toBeLessThan(150)
      }
    }, { runtime: rt })
  }

  // examples/background's ticker updates the app once a second through its handle; the window
  // draws each tick while otherwise idle. RUNEX_PERF=log prints a line for each second it drew,
  // the first with the first frame: from there the test waits 3.8 s (3 or 4 ticks), then types
  // `quit`. A tick that stops drawing stays stopped, so a longer wait catches it more often.
  for (const rt of RUNTIMES) {
    windowedTest(gate, `examples/background draws its ticks while idle; RUNEX_PERF=log prints each second (${rt})`, async () => {
      const s = scratch()
      try {
        const trace = join(s.dir, "background.jsonl")
        const run = await runFixture(rt, "examples/background/main.ts", ["--open", "--native", "--trace", trace], {
          env: { ...SLOW_POLL, RUNEX_PERF: "log" },
          timeoutMs: 25000,
          drive: async (proc, out) => {
            const until = performance.now() + 15000
            while (!out.stderr.includes("runex perf") && performance.now() < until && proc.exitCode === null) await Bun.sleep(20)
            await Bun.sleep(3800)
            proc.stdin.write("quit\n")
            await proc.stdin.end()
          },
        })
        const t = readTrace(trace)
        const ticks = t.frames.filter((f) => f >= 500)
        const spaced = ticks.filter((f, i) => i === 0 || f - ticks[i - 1]! > 500).length
        const perf = run.stderr.split("\n").filter((l) => l.startsWith("runex perf"))
        const restMs = maxGap(t.frames, 500, Infinity)
        report(`background ticks (${rt})`, WINDOWS
          ? { frames: t.frames.length, lastMs: t.frames.at(-1) ?? 0, longestRestMs: restMs, perfLines: perf.length }
          : { frames: t.frames.map(Math.round), perfLines: perf.length })
        expect(run.code, describeRun(run)).toBe(0)
        if (WINDOWS) {
          // Each tick holds the window presenting for STEADY_HOLD_MS, and the next tick comes as
          // the hold ends, so the window draws without a rest from launch until it quits, in Rust
          // as in the port (on the runner both drew 24 to 26 frames a second throughout). A tick
          // that stopped drawing would end the frames a hold later: the third tick (about 3 s)
          // holds them until quit (about 3.8 s; 3815 to 3862 ms in 8 runner runs), while without
          // it they'd end near 3 s.
          expect(restMs).toBeLessThan(500)
          expect(t.frames.at(-1) ?? 0).toBeGreaterThanOrEqual(3400)
          // And it's the ticks that draw: a tick rebuilds the view, a held frame doesn't, so the
          // perf lines' view calls (`view N ms × C/s`) count launch's view plus each tick.
          const views = perf.reduce((n, l) => n + Number(/view [\d.]+ ms × (\d+)\/s/.exec(l)?.[1] ?? 0), 0)
          expect(views).toBeGreaterThanOrEqual(2)
        } else {
          expect(spaced).toBeGreaterThanOrEqual(3)
        }
        expect(perf.length).toBeGreaterThanOrEqual(2)
      } finally {
        s.cleanup()
      }
    }, { runtime: rt })
  }
})

describe("quit", () => {
  for (const rt of RUNTIMES) {
    windowedTest(gate, `handle.quit() resolves run(), the code after it runs, and the process exits by itself (${rt})`, async () => {
      const run = await runFixture(rt, fixture("quit"), [], { timeoutMs: 15000 })
      expect(run.code, describeRun(run)).toBe(0)
      const r = run.result
      expect(r?.afterRun).toBe(true)
      // The child's clock starts about when it was spawned.
      const exitAfterRun = run.ms - r.resolvedAt
      report(`quit (${rt})`, { resolveMs: r.resolvedAt - r.quitAt, exitAfterRunMs: exitAfterRun })
      expect(r.resolvedAt - r.quitAt).toBeLessThan(1000)
      expect(exitAfterRun).toBeLessThan(3000)
    }, { runtime: rt })
  }
})

describe("on_stats", () => {
  // The documented keys: PerfStats in ts/perf.ts (none found fails the test below, not the file).
  const body = readFileSync(join(REPO, "ts/perf.ts"), "utf8").match(/interface PerfStats \{([\s\S]*?)\n\}/)?.[1] ?? ""
  const documented = [...body.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]!)
  for (const rt of RUNTIMES) {
    windowedTest(gate, `an animating window gets stats each second with the documented keys, a resting one at most one (${rt})`, async () => {
      const run = await runFixture(rt, fixture("stats"), ["none"], { timeoutMs: 25000 })
      expect(run.code, describeRun(run)).toBe(0)
      const r = run.result
      const stats: { phase: string; at: number; stats: Record<string, unknown> }[] = r.stats
      const animating = stats.filter((s) => s.phase === "animating")
      const settled = stats.filter((s) => s.phase === "resting" && s.at > r.animateMs + 1000)
      report(`on_stats (${rt})`, { animating: animating.map((s) => s.stats.fps), resting: stats.filter((s) => s.phase === "resting").map((s) => s.stats.fps) })
      expect(animating.length).toBeGreaterThanOrEqual(2)
      expect(animating.filter((s) => (s.stats.fps as number) > 0).length).toBeGreaterThanOrEqual(2)
      expect(settled.length).toBeLessThanOrEqual(1)
      expect(documented.length).toBeGreaterThan(10)
      for (const s of stats) expect(Object.keys(s.stats).sort()).toEqual(expect.arrayContaining(documented))
    }, { runtime: rt })
  }
})

describe("RUNEX_PERF=log", () => {
  // The variable alone (no `App.perf`) turns the log on: a line a second while the window draws.
  for (const rt of RUNTIMES) {
    windowedTest(gate, `RUNEX_PERF=log prints a line a second while the window draws (${rt})`, async () => {
      const run = await runFixture(rt, fixture("stats"), ["env"], { env: { RUNEX_PERF: "log" }, timeoutMs: 20000 })
      expect(run.code, describeRun(run)).toBe(0)
      const lines = run.stderr.split("\n").filter((l) => l.startsWith("runex perf [main]"))
      report(`RUNEX_PERF=log (${rt})`, { lines: lines.length, first: lines[1]?.slice(0, 40) ?? null })
      expect(lines.length).toBeGreaterThanOrEqual(2)
      expect(lines.slice(1).some((l) => /\b[1-9]\d* fps/.test(l))).toBe(true)
    }, { runtime: rt })
  }
})

describe("idle CPU", () => {
  // macOS peeks at AppKit's queue instead of turning the loop while idle (src/idle.rs);
  // elsewhere every input check turns it, so the gate is looser.
  const limit = MAC ? 15 : 30
  for (const rt of RUNTIMES) {
    windowedTest(gate, `a still window uses at most ${limit}% of a core after settling (${rt})`, async () => {
      const run = await runFixture(rt, fixture("idle"), [], { timeoutMs: 25000 })
      expect(run.code, describeRun(run)).toBe(0)
      const r = run.result
      report(`idle CPU (${rt})`, { cpuPct: r.cpuPct, userMs: r.userMs, systemMs: r.systemMs, sampleMs: r.wallMs, framesDuringSample: r.frames })
      expect(r.cpuPct).toBeLessThanOrEqual(limit)
    }, { runtime: rt })
  }
})

describe("multi-window", () => {
  for (const rt of RUNTIMES) {
    windowedTest(gate, `run_windows: both windows are created and set up, closing one keeps the other, quit resolves (${rt})`, async () => {
      const run = await runFixture(rt, fixture("windows"), [], { timeoutMs: 20000 })
      expect(run.code, describeRun(run)).toBe(0)
      const r = run.result
      report(`multi-window (${rt})`, { events: r.events, ms: r.ms })
      expect(r.events).toEqual(expect.arrayContaining(["setup a", "setup b", "created a", "created b", "on_close a"]))
      expect(r.events.at(-1)).toBe("resolved")
      expect(r.events.indexOf("on_close a")).toBeLessThan(r.events.indexOf("update b"))
      expect(r.bViewAfterClose).toBe(true)
    }, { runtime: rt })
  }
})

describe("overlay", () => {
  for (const rt of RUNTIMES) {
    windowedTest(gate, `a configured overlay is created, shows, draws and hides without a failure (${rt})`, async () => {
      const run = await runFixture(rt, fixture("overlay"), [], { timeoutMs: 20000 })
      expect(run.code, describeRun(run)).toBe(0)
      const [before, shown, hidden] = run.result.steps
      report(`overlay (${rt})`, { shown, hidden })
      for (const step of run.result.steps) expect(step.failure).toBeNull()
      expect(before.created).toBe(0)
      expect(shown.availability).toBe("Available")
      expect(shown.created).toBeGreaterThanOrEqual(1)
      expect(shown.overlayPolls).toBeGreaterThanOrEqual(1)
      expect(hidden.overlayPolls - shown.overlayPolls).toBeLessThanOrEqual(1)
      // A macOS window number (CGWindowID) exists once the panel does; elsewhere there is none.
      if (MAC) expect(shown.window).toBe(true)
    }, { runtime: rt })
  }
})

describe("bun --hot", () => {
  if (!RUNTIMES.includes("bun")) return
  windowedTest(gate, "a saved edit swaps the new view into the open window, keeps the count and retitles it (bun)", async () => {
    const s = scratch()
    try {
      // A temporary app: main.ts (the counter) and common.ts, with runex-js linked to this repo. Its
      // package.json makes the directory the project, whose files `bun --hot` watches.
      writeFileSync(join(s.dir, "package.json"), JSON.stringify({ name: "hot-counter", private: true, type: "module" }))
      mkdirSync(join(s.dir, "node_modules"))
      symlinkSync(REPO, join(s.dir, "node_modules", "runex-js"), "dir")
      cpSync(fixture("hot-counter"), join(s.dir, "main.ts"))
      cpSync(fixture("common"), join(s.dir, "common.ts"))
      const main = join(s.dir, "main.ts")
      let editedAt = 0
      const run = await runFixture("bun", main, [], {
        cwd: s.dir,
        runtimeArgs: ["--hot"],
        timeoutMs: 20000,
        drive: async (proc, out) => {
          const until = performance.now() + 10000
          while (!out.stdout.includes("READY") && performance.now() < until && proc.exitCode === null) await Bun.sleep(20)
          // In place, as an editor saves; Bun re-evaluates the module.
          writeFileSync(main, readFileSync(main, "utf8").replace('const LABEL = "first"', 'const LABEL = "second"').replace('const TITLE = "Hot counter"', 'const TITLE = "Hot counter 2"'))
          editedAt = performance.now()
        },
      })
      const views = run.stdout.split("\n").filter((l) => l.startsWith("VIEW ")).map((l) => JSON.parse(l.slice(5)))
      const before = views.filter((v) => v.gen === 1).at(-1)
      const after = views.find((v) => v.gen === 2)
      report("bun --hot swap", { countBefore: before?.count, countAfter: after?.count, title: run.result?.titles, editToExitMs: run.startedAt + run.ms - editedAt })
      expect(run.code, describeRun(run)).toBe(0)
      expect(after?.label).toBe("second")
      expect(after.count).toBeGreaterThanOrEqual(3)
      expect(after.count).toBeGreaterThanOrEqual(before.count)
      expect(run.result.hot).toBe(true)
      expect(run.result.titles).toEqual(["Hot counter 2"])
    } finally {
      s.cleanup()
    }
  }, { runtime: "bun" })
})
