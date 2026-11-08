// What a run tells the app about itself: `App.on_frame_encoded`'s reports (headless runs report
// every frame on their virtual clock, as Rune does), `instant_now()`'s clock, `tooling.headless_run()`,
// `App.on_modifiers` under a script's `hold`, and `open_window` in a headless run.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { App, AppSpec, type FrameEncoded, WindowSpec, col, instant_now, open_window, text, tooling } from "runex-js"
import { tempDir, treeOf, writeScript } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("frames")

const spec = () => AppSpec.new("Frames", [200, 100], () => ({ mods: [] as string[] }), () => col().child(text("x")))

describe("App.on_frame_encoded", () => {
  test("a headless run reports each frame as Drawn, in order, on instant_now()'s clock", async () => {
    const start = instant_now()
    const seen: { seq: number; outcome: string; window: string | null; hz: number | null; started: number | null; at: number; update: number | null; encode: number | null }[] = []
    const app = App.new(spec()).on_frame_encoded((f: FrameEncoded) => {
      seen.push({ seq: f.seq(), outcome: f.outcome(), window: f.window(), hz: f.refresh_hz(), started: f.started(), at: f.at(), update: f.update_ms(), encode: f.encode_ms() })
    })
    await treeOf(app, ["--at", "0.1", "--fps", "30"], tmp)
    // Frames 0 to 3 at 30 fps, as Rune's own test of the hook counts them.
    expect(seen.map((f) => f.seq)).toEqual([0, 1, 2, 3])
    for (const f of seen) {
      expect(f.outcome).toBe("Drawn")
      expect(f.window).toBe("main")
      expect(f.hz).toBe(30)
      expect(f.started).not.toBeNull()
      expect(f.started!).toBeGreaterThanOrEqual(start)
      expect(f.at).toBeGreaterThanOrEqual(f.started!)
      expect(f.update!).toBeGreaterThanOrEqual(0)
      expect(f.encode!).toBeGreaterThanOrEqual(0)
    }
    expect(instant_now()).toBeGreaterThanOrEqual(seen.at(-1)!.at)
  })

  test("it shares Rune's one hook with the performance overlay: both see every frame", async () => {
    let frames = 0
    let stats = 0
    const app = App.new(spec()).on_frame_encoded(() => { frames++ }).perf("none", () => { stats++ })
    await treeOf(app, ["--at", "0.05", "--fps", "60"], tmp)
    expect(frames).toBe(4)
    expect(stats).toBe(1)
  })

  test("a WindowSpec reports its own frames", async () => {
    let frames = 0
    const w = WindowSpec.new("main", spec()).on_frame_encoded(() => { frames++ })
    await treeOf(App.new(spec()), [], tmp) // the app run alone: no reports for the spec
    expect(frames).toBe(0)
    expect(typeof w.on_frame_encoded).toBe("function")
  })
})

describe("tooling.headless_run", () => {
  // Before a process's first run it's null; Rune keeps the last run after it ends, and the tests
  // in this process have run others, so only what a run reads is checked here.
  test("inside a run: its timing, size and script", async () => {
    const script = writeScript(tmp, [{ t: 0.05, type: "mark", name: "end" }])
    let seen: unknown = null
    const app = App.new(AppSpec.new("Run", [320, 200], () => ({}), () => {
      const r = tooling.headless_run()
      seen ??= r && { fps: r.fps(), size: r.size(), scale: r.scale(), script: r.script(), marks: r.marks(), mark: r.mark("end"), end: r.end(), frames: r.frames() }
      return text("run")
    }))
    await treeOf(app, ["--script", script, "--at", "mark:end", "--fps", "60", "--scale", "1"], tmp)
    expect(seen).toEqual({ fps: 60, size: [320, 200], scale: 1, script, marks: [["end", 0.05]], mark: 0.05, end: 0.05, frames: 0 })
  })
})

describe("App.on_modifiers", () => {
  test("a script's hold reaches it with the held modifiers, and its release with none", async () => {
    const script = writeScript(tmp, [
      { t: 0.05, hold: "alt" },
      { t: 0.15, hold: "" },
      { t: 0.25, type: "mark", name: "end" },
    ])
    const changes: { alt: boolean; shift: boolean }[] = []
    const app = App.new(spec()).on_modifiers((_s, mods) => { changes.push({ alt: mods.alt, shift: mods.shift }) })
    await treeOf(app, ["--script", script, "--at", "mark:end"], tmp)
    expect(changes).toEqual([{ alt: true, shift: false }, { alt: false, shift: false }])
  })
})

describe("open_window", () => {
  test("a headless run opens nothing and hands back the window's handle", async () => {
    const opened: string[] = []
    const app = App.new(AppSpec.new("Open", [200, 100], () => ({ opened: false }), (s: { opened: boolean }) => {
      if (!s.opened) {
        s.opened = true
        opened.push(open_window(WindowSpec.new("second", spec())).key())
      }
      return text("one")
    }))
    const tree = await treeOf(app, [], tmp)
    expect(opened).toEqual(["second"])
    expect(tree.title).toBe("Open")
  })
})
