// The fx/light compositor (ts/compose.ts, src/manual/compose/): what a compositor's `render` gets
// in its Frame, which plans the native side accepts, rejects or ignores, and that a plan changes
// the picture. Pixels differ by GPU, so PNGs are only compared with each other in one run.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { App, AppSpec, col, el, run_with, tok, type Compositor, type EffectSlot, type Frame, type Plan, type PrimRule } from "runex-js"
import { Fx, GlowParams, OneShots, Shape } from "runex-js/fx"
import { Light, Settings } from "runex-js/light"
import { quietly, snapOf, tempDir, treeOf } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("compose")
const CARD = 7
const G = globalThis as { __runex_host?: { args?: string[] } }

afterEach(() => {
  delete G.__runex_host
})

/** A window with one card: an effect slot (mark CARD) for "ui" plans, a marked rect for "hdr" ones. */
const spec = (title = "Compose") => AppSpec.new<{ n: number }>(title, [200, 120], () => ({ n: 1 }), () => {
  const t = tok.theme(true)
  return col().key("root").w_full().h_full().padding(20).fill(t.bg)
    .child(el().key("card").size(120, 60).radius(12).fill(t.text).mark(CARD).effect(CARD).effect_data([1, 2, 3, 4]))
})

/** A "ui" compositor drawing a glow on every effect slot. */
const glow = (): Compositor => ({
  render(f) {
    const layers = f.slots().map((s) => {
      const [x, y, w, h] = s.rect.map((v) => v / s.scale)
      return { layer: Fx.on(Fx.glow(GlowParams.default()), Shape.rounded(x!, y!, w!, h!, 12)).at(f.t), at: { slot: s.index } }
    })
    return { layers }
  },
})

const png = async (app: ReturnType<typeof App.new>, args: string[] = []) => readFileSync((await snapOf(app, args, tmp)).png)

describe("the Frame", () => {
  test("run_with renders headless through the compositor (with a host's arguments)", async () => {
    let frames = 0
    const tree = `${tmp}/run-with.json`
    G.__runex_host = { args: ["--tree", tree] }
    await run_with(spec("RunWith"), { render: () => { frames++ } })
    expect(frames).toBeGreaterThan(0)
    expect(readFileSync(tree, "utf8")).toContain('"card"')
  })

  test("viewport, size and scale follow --size and --scale; state, clock and slots are this frame's", async () => {
    const seen: Record<string, unknown>[] = []
    let slots: EffectSlot[] = []
    const c: Compositor<{ n: number }> = {
      render(f: Frame<{ n: number }>) {
        slots = f.slots()
        seen.push({ viewport: f.viewport, size: f.size, scale: f.env.scale, t: f.t, n: f.state.n, card: f.presented("card"), none: f.presented("nope"), format: typeof f.format, pointer: f.pointer(), instances: f.instance_count > 0 })
      },
    }
    await treeOf(App.new(spec()).compositor(c), ["--size", "300x150", "--scale", "1"], tmp)
    expect(seen[0]).toMatchObject({ viewport: [300, 150], size: [300, 150], scale: 1, t: 0, n: 1, card: [[20, 20, 120, 60], 1], none: null, format: "string", pointer: null, instances: true })
    await treeOf(App.new(spec()).compositor(c), ["--at", "0.5"], tmp)
    expect(seen.at(-1)).toMatchObject({ viewport: [200, 120], size: [400, 240], scale: 2 })
    expect(seen.at(-1)!.t as number).toBeCloseTo(0.5, 9) // 30 frames of 1/60 s
    // Effect slots are in device pixels.
    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ mark: CARD, data: [1, 2, 3, 4], rect: [40, 40, 240, 120], scale: 2, backdrop: false })
    expect(Object.keys(slots[0]!).sort()).toEqual(["backdrop", "clip", "data", "effect", "fade", "index", "mark", "radii", "rect", "scale"])
  })

  test("a frame kept after render has returned can't be read", async () => {
    let kept: Frame | undefined
    await treeOf(App.new(spec()).compositor({ render: (f) => { kept = f } }), [], tmp)
    expect(() => kept!.viewport).toThrow("this frame was lent to a compositor's render, which has returned")
  })
})

describe("plans", () => {
  test('a "ui" plan changes the picture; an empty plan draws what no compositor does', async () => {
    const plain = await png(App.new(spec()))
    const empty = await png(App.new(spec()).compositor({ render: () => ({ layers: [] }) }))
    const glowing = await png(App.new(spec()).compositor(glow()))
    expect(empty.equals(plain)).toBe(true)
    expect(glowing.equals(plain)).toBe(false)
  })

  test('"hdr" routes match a mark alone or [value, mask]: draw "none" hides what matches', async () => {
    const hdr = (plan: Plan): Compositor => ({ pipeline: "hdr", render: () => plan })
    const base = await png(App.new(spec()).compositor(hdr({})))
    const hidden = await png(App.new(spec()).compositor(hdr({ routes: [{ match: CARD, draw: "none" }] })))
    const masked = await png(App.new(spec()).compositor(hdr({ routes: [{ match: [CARD | 0x100, 0xff], draw: "none" }] })))
    const other = await png(App.new(spec()).compositor(hdr({ routes: [{ match: CARD + 1, draw: "none" }] })))
    expect(hidden.equals(base)).toBe(false)
    expect(masked.equals(hidden)).toBe(true)
    expect(other.equals(base)).toBe(true)
  })

  test("lighting: lights, settings, prim rules (style null leaves a rect flat) and anchors", async () => {
    const lit = (prims: PrimRule[]) => App.new(spec()).compositor({
      pipeline: "hdr",
      render: (f) => ({
        routes: [{ match: [0, 0], lit: true }],
        lighting: { lights: [Light.point(100 * f.env.scale, 10 * f.env.scale, 300 * f.env.scale).intensity(3)], settings: new Settings(), alpha: 1, at: "top", prims },
      }),
    })
    const flat = await png(lit([{ match: CARD, style: null }]))
    const raised = await png(lit([{ match: CARD, style: { raised: 12, bevel: [6, 2], gloss: [0.5, 0.4] } }]))
    expect(flat.length).toBeGreaterThan(0)
    expect(raised.equals(flat)).toBe(false)
  })

  test("OneShots: a bounded pool of overlapping one-shot effects", () => {
    const pool = OneShots.new(2)
    pool.trigger(0, "a")
    pool.trigger(0.1, { tap: 1 })
    pool.trigger(0.2, "c") // over capacity: the oldest fades out over 0.16 s instead of being cut
    const live = pool.live(0.25, 1)
    expect(live.map(([shot]) => shot.data)).toEqual(["a", { tap: 1 }, "c"])
    expect(live.map(([shot]) => shot.t0)).toEqual([0, Math.fround(0.1), Math.fround(0.2)])
    expect(live[0]![1]).toBeGreaterThan(0)
    expect(live[0]![1]).toBeLessThan(1)
    expect(live.slice(1).map(([, k]) => k)).toEqual([1, 1])
    expect(new Set(live.map(([shot]) => shot.seed)).size).toBe(3)
    expect(pool.live(0.5, 1).map(([shot]) => shot.data)).toEqual([{ tap: 1 }, "c"])
    expect(pool.is_animating(0.25, 1)).toBe(true)
    pool.prune(5, 1)
    expect(pool.is_animating(5, 1)).toBe(false)
    expect(pool.live(5, 1)).toEqual([])
    pool.trigger(6, "d")
    pool.clear()
    expect(pool.live(6, 1)).toEqual([])
  })
})

describe("bad compositors and plans", () => {
  test("a compositor without render, or with an unknown pipeline, is refused when attached", () => {
    expect(() => App.new(spec()).compositor({} as Compositor).native).toThrow("a compositor needs a render(frame) method")
    expect(() => App.new(spec()).compositor(5 as any).native).toThrow("a compositor is an object with a render(frame) method")
    expect(() => App.new(spec()).compositor({ pipeline: "gl" as any, render: () => {} }).native).toThrow('Compositor.pipeline: "ui" or "hdr", not "gl"')
  })

  const bad = async (pipeline: "ui" | "hdr", plan: unknown) => {
    const { error } = await quietly(() => App.new(spec()).compositor({ pipeline, render: () => plan as Plan }).args(["--tree", `${tmp}/bad.json`]).run())
    return error === undefined ? "(resolved)" : (error as Error).message
  }

  test("an invalid plan rejects run() saying what is wrong", async () => {
    const layer = Fx.on(Fx.glow(GlowParams.default()), Shape.rounded(0, 0, 10, 10, 2))
    expect(await bad("ui", { layers: [{ layer, at: { under: CARD } }] })).toContain('the "ui" pipeline draws layers at effect slots: anchor them with { slot: index }')
    expect(await bad("ui", { routes: [{ match: CARD }] })).toContain('routes, sources, lighting, flatten_layers and clip need the "hdr" pipeline')
    expect(await bad("hdr", { layers: [{ layer, at: { slot: 0 } }] })).toContain('the "hdr" pipeline anchors layers with "top", { under } or { over }, not { slot }')
    expect(await bad("hdr", { layers: [{ layer, at: { sideways: CARD } }] })).toContain('an anchor is "top", { slot }, { under } or { over }, not { sideways }')
    expect(await bad("hdr", { routes: [{ match: CARD, draw: 0 }] })).toContain("a route draws into a source slot the plan doesn't declare (it has 0 sources)")
    expect(await bad("hdr", { routes: [{ match: [1, 2, 3] }] })).toContain("a Match is a mark or [value, mask]")
    expect(await bad("hdr", { routes: [{ match: 1.5 }] })).toContain("expected a 32-bit integer, got 1.5")
    expect(await bad("hdr", { sources: ["texture"] })).toContain('a source is "layer" or "mask", not "texture"')
    expect(await bad("hdr", 5)).toContain("a plan is an object ({ layers, animating, ... })")
    expect(await bad("ui", null)).toBe("(resolved)") // no plan: the frame draws with no layers
  })

  test("a throw in render rejects run() with it", async () => {
    const error = new Error("render broke")
    const r = await quietly(() => App.new(spec()).compositor({ render: () => { throw error } }).args(["--tree", `${tmp}/throw.json`]).run())
    expect(r.error).toBe(error)
  })
})
