// About twenty binding checks that run the same on Bun and Node: conversions, moves, live values,
// kit builds and headless runs. node.test.ts runs them in Bun and, through fixtures/node-smoke.ts,
// in Node, and compares the two. Each check returns a plain value (or throws); `smoke` returns
// `{ name: { ok, value } | { ok: false, error } }`.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Anim, App, AppSpec, ClipboardImage, Live, LiveText, Spring, TextStyle, col, color, el, oklch, text, tok, type El } from "runex-js"
import { Button, Kit, Tooltip } from "runex-js/kit"

type Check = (dir: string) => unknown

const error = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    return (e as Error).message
  }
  return null
}

function pngSize(path: string): [number, number] {
  const png = readFileSync(path)
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

function treeTexts(path: string): string[] {
  const tree = JSON.parse(readFileSync(path, "utf8")) as { elements: { text?: string }[] }
  return tree.elements.flatMap((e) => (typeof e.text === "string" ? [e.text] : []))
}

const CHECKS: Record<string, Check> = {
  "Color record": () => {
    const c = oklch(0.5, 0.1, 250)
    return { keys: Object.keys(c).sort(), half: c.alpha(0.5).a, still: c.a, hex: c.hex(), bad: color.hex("nope") }
  },
  "Spring record methods": () => {
    const s = Spring.new(0.3, 0)
    return { instance: s instanceof Spring, duration: s.duration, omega: s.omega() }
  },
  "TextStyle builders": () => {
    const base = TextStyle.new(13, 400)
    return { tall: base.lh(20).line_px(), base: base.line_px() }
  },
  "tok constants": () => ({ snappy: { ...tok.motion.SNAPPY }, title: tok.type_.TITLE.size, bg: tok.theme(true).bg.hex(), accent: tok.ACCENT_NAMES }),
  "a moved El": () => {
    const child = text("hi")
    col().child(child)
    return error(() => child.key("again"))
  },
  "argument errors": () => ({ number: error(() => el().size("wide" as any, 10)), variant: error(() => el().cursor("Sideways" as any)), arity: error(() => (el() as any).size(10)) }),
  "data-variant enums": () => ({ tween: Anim.new({ Tween: { duration: 0.2, easing: "Linear" } }).curve, bad: error(() => Anim.new({ Bogus: 1 } as any)) }),
  "unsigned wrap": () => [-1, 3.7, 70000, NaN].map((n) => (Anim.new({ Tween: { duration: 0.2, easing: { Steps: [n, "End"] } } }).curve as any).Tween.easing.Steps[0]),
  "record literal errors": () => error(() => Anim.from_Spring({ duration: 0.3 } as Spring)),
  "&mut Vec write-back": () => {
    const layer: El[] = [text("kept")]
    Tooltip.new("tip").trigger(el().size(10, 10)).label("hi").open(true).build(Kit.neutral(true), layer)
    return layer.length
  },
  "kit build": () => error(() => col().child(Button.new("Save").build(Kit.neutral(true)))),
  "Live kinds": () => {
    const v = Live.new(0.5)
    const label = LiveText.new("a")
    return { same: v.set(0.5), changed: v.set(0.75), get: v.get(), vec: Live.new([1, 2]).get(), kind: error(() => v.set([1, 2] as any)), text: [label.set("b"), label.get()] }
  },
  "Live bindings": () => error(() => el().live_opacity(Live.new(1).smooth(Spring.new(0.3, 0))).live_fill(Live.new(oklch(0.5, 0.1, 30)))),
}

const RUNS: Record<string, (dir: string) => Promise<unknown>> = {
  "headless --snap with a scene": async (dir) => {
    type S = { n: number }
    const png = join(dir, "smoke-snap.png")
    const tree = join(dir, "smoke-snap.json")
    const view = (s: S) => col().w_full().h_full().center().fill(tok.theme(true).bg).child(text(`n = ${s.n}`).color(tok.theme(true).text))
    await App.new({ ...AppSpec.new<S>("Smoke", [160, 90], () => ({ n: 1 }), view), scenes: [["two", (s) => { s.n = 2 }]] }).args(["--scene", "two", "--snap", png, "--tree", tree]).run()
    return { size: pngSize(png), texts: treeTexts(tree) }
  },
  "bytes in and out": async (dir) => {
    const png = join(dir, "smoke-bytes.png")
    await App.new(AppSpec.new("Bytes", [20, 10], () => ({}), () => el().w_full().h_full().fill(oklch(0.5, 0.1, 30)))).args(["--snap", png]).run()
    const bytes = readFileSync(png)
    const image = ClipboardImage.from_png(bytes)!
    return { buffer: image.size(), array: ClipboardImage.from_png([...bytes] as any)!.size(), back: image.png() instanceof Uint8Array }
  },
  "a scripted handler returns a new state": async (dir) => {
    const script = join(dir, "smoke-click.json")
    const tree = join(dir, "smoke-click.json.tree")
    writeFileSync(script, JSON.stringify({ events: [{ t: 0.1, type: "click", key: "n" }] }))
    await App.new(AppSpec.new<number>("Counter", [120, 80], () => 1, (n) => el().key("n").size(60, 30).on_press((n: number) => n + 1).child(text(`n=${n}`)))).args(["--script", script, "--at", "0.5", "--tree", tree]).run()
    return treeTexts(tree)
  },
  "a throwing view rejects run()": async (dir) => {
    try {
      await App.new(AppSpec.new("Throws", [100, 60], () => ({}), () => { throw new Error("view broke") })).args(["--tree", join(dir, "smoke-throw.json")]).run()
      return "resolved"
    } catch (e) {
      return (e as Error).message
    }
  },
}

export async function smoke(dir: string): Promise<Record<string, { ok: true; value: unknown } | { ok: false; error: string }>> {
  const out: Record<string, { ok: true; value: unknown } | { ok: false; error: string }> = {}
  for (const [name, check] of Object.entries(CHECKS)) {
    try {
      out[name] = { ok: true, value: check(dir) }
    } catch (e) {
      out[name] = { ok: false, error: String((e as Error)?.stack ?? e) }
    }
  }
  for (const [name, run] of Object.entries(RUNS)) {
    try {
      out[name] = { ok: true, value: await run(dir) }
    } catch (e) {
      out[name] = { ok: false, error: String((e as Error)?.stack ?? e) }
    }
  }
  return out
}
