// Conversions between JavaScript and Rust values (src/conv.rs, and the shapes tools/bindgen maps
// onto it): numbers, Option, arrays and tuples, Duration, bytes, paths, enums, records, `impl
// Into`, `&mut Vec`, Deref, From, lent arguments, `&mut T` callbacks and fn-pointer trampolines.
// Each test asserts what the binding does today, error text included, so a change shows here.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  Anim, App, AppSpec, ClipboardImage, Color, Curve, Image, ImageCache, KeyEvent, Play, Spring, TextEdit, TextStyle, Tx, col, dirs, el, oklch, text, text_input, tok,
  type Cx, type El, type Waker,
} from "runex-js"
import { Kit, Tooltip } from "runex-js/kit"
import { byKey, quietly, snapOf, tempDir, texts, treeOf, writeScript } from "./lib/headless.ts"
import { fixture, TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("conv")

/** A u16 through Rust and back: the step count of `Easing::Steps(u16, StepPosition)`. */
function u16(n: number): number {
  const anim = Anim.new({ Tween: { duration: 0.2, easing: { Steps: [n, "End"] } } })
  return (anim.curve as { Tween: { easing: { Steps: [number, string] } } }).Tween.easing.Steps[0]
}

describe("numbers", () => {
  test("f32 parameters round as f32 does: the tree shows the rounded value", async () => {
    expect(Spring.new(0.1, 0).duration).toBe(Math.fround(0.1))
    expect(TextStyle.new(13.1, 400).size).toBe(Math.fround(13.1))
    // 2^24 + 1 has no f32: the element's width lands on 2^24.
    const tree = await treeOf(App.new(AppSpec.new("F32", [100, 60], () => ({}), () => col().key("root").child(el().key("wide").absolute(0, 0).size(16777217, 10)))), [], tmp)
    expect(byKey(tree, "wide")!.rect[2]).toBe(16777216)
  })

  test("unsigned integers: negatives wrap like `x >>> 0`, fractions truncate, out of range saturates", () => {
    expect(u16(3)).toBe(3)
    expect(u16(3.7)).toBe(3)
    expect(u16(-1)).toBe(65535)
    expect(u16(-70000)).toBe(61072) // -70000 mod 2^16
    expect(u16(70000)).toBe(65535)
    expect(u16(-1.5)).toBe(0)
    expect(u16(NaN)).toBe(0)
    expect(u16(Infinity)).toBe(65535)
    expect(u16(-Infinity)).toBe(0)
    // A u64 field: -1 is 2^64 - 1, read back as the nearest double.
    expect(Anim.from_Anim({ ...Anim.new("Instant"), token: -1 }).token).toBe(2 ** 64)
  })

  test("a usize index wraps the same way (tok.accent cycles through 6 accents)", () => {
    const accent = (i: number) => tok.accent(i, true)
    expect(accent(-1)).toEqual(accent(3)) // (2^64 - 1) mod 6
    expect(accent(2.7)).toEqual(accent(2))
    expect(accent(NaN)).toEqual(accent(0))
  })

  test("a non-number names the parameter", () => {
    expect(() => TextStyle.new(13, "400" as any)).toThrow("weight: expected a number")
    expect(() => el().size(10, null as any)).toThrow("h: expected a number")
  })
})

describe("Option", () => {
  test("null and undefined both mean None, and trailing optionals can be left out", async () => {
    // TypeScript asks for all four; JavaScript may leave trailing optionals out.
    const pin = el as () => El & { pin(...edges: (number | null | undefined)[]): El }
    const view = () => col().key("root").w_full().h_full()
      .child(pin().key("a").pin(10, 20).size(5, 5))
      .child(pin().key("b").pin(10, 20, null, undefined).size(5, 5))
      .child(el().key("c").pin(null, null, 10, 20).size(5, 5))
    const tree = await treeOf(App.new(AppSpec.new("Option", [100, 60], () => ({}), view)), [], tmp)
    expect(byKey(tree, "a")!.rect).toEqual([10, 20, 5, 5])
    expect(byKey(tree, "b")!.rect).toEqual([10, 20, 5, 5])
    expect(byKey(tree, "c")!.rect).toEqual([85, 35, 5, 5]) // right 10, bottom 20
  })

  test("a None result is null", () => {
    expect(el().link_url()).toBeNull()
  })
})

describe("arrays and tuples", () => {
  test("a fixed array of the wrong length names the parameter and both lengths", () => {
    expect(Color.from_oklab([0.5, 0.1, 0.1, 1]).a).toBe(1)
    expect(() => Color.from_oklab([0.5, 0.1, 0.1])).toThrow("arg0: expected 4 items, got 3")
  })

  test("a tuple of the wrong length names the parameter and the element", () => {
    expect(() => el().strikes([[0, 1, null]])).not.toThrow()
    expect(() => el().strikes([[0] as any])).toThrow("strikes: [0]: expected a 3-item array, got 1")
    expect(() => el().strikes("x" as any)).toThrow("strikes: expected an array")
  })
})

describe("Duration", () => {
  // `hover_delays(enter, leave)` takes Durations: `true` arrives once the pointer rests `enter`.
  const hovered = async (enter: number, at: number) => {
    type S = { over: boolean }
    const view = (s: S) => col().key("root").w_full().h_full()
      .child(el().key("target").size(60, 40).hover_delays(enter, 0).on_hover_change((s: S, over: boolean) => { s.over = over }).child(text(s.over ? "in" : "out")))
    const script = writeScript(tmp, [{ t: 0.1, type: "move", key: "target" }])
    return texts(await treeOf(App.new(AppSpec.new<S>("Hover", [120, 80], () => ({ over: false }), view)), ["--script", script, "--at", String(at)], tmp))[0]
  }

  test("numbers are seconds", async () => {
    expect(await hovered(0.4, 0.3)).toBe("out")
    expect(await hovered(0.4, 0.7)).toBe("in")
  })

  test("a negative duration clamps to zero; an infinite one names the parameter", async () => {
    expect(await hovered(-5, 0.2)).toBe("in")
    expect(() => el().hover_delays(Infinity, 0)).toThrow("enter: cannot convert float seconds to Duration")
    expect(() => el().hover_delays("1" as any, 0)).toThrow("enter: expected a number")
  })
})

describe("bytes", () => {
  test("Uint8Array, Buffer and plain arrays all pass where Rust takes Vec<u8>; bytes come back as Uint8Array", async () => {
    const { png } = await snapOf(App.new(AppSpec.new("Bytes", [20, 10], () => ({}), () => el().w_full().h_full().fill(oklch(0.5, 0.1, 30)))), [], tmp)
    const bytes = readFileSync(png)
    for (const input of [new Uint8Array(bytes), bytes, [...bytes]]) {
      const image = ClipboardImage.from_png(input as Uint8Array)
      expect(image).not.toBeNull()
      expect(image!.size()).toEqual([40, 20])
    }
    const back = ClipboardImage.from_png(bytes)!.png()
    expect(back).toBeInstanceOf(Uint8Array)
    expect(ClipboardImage.from_png(back)!.size()).toEqual([40, 20])
    expect(ClipboardImage.from_png(new Uint8Array([1, 2, 3]))).toBeNull() // not a PNG: Rust's None
    expect(() => ClipboardImage.from_png("png" as any)).toThrow("png: expected an array")
  })

  test("AppSpec.fonts takes Uint8Arrays; a plain array is rejected (napi's message, which doesn't name the field)", () => {
    const spec = (fonts: unknown[]) => ({ ...AppSpec.new("Fonts", [10, 10], () => ({}), () => text("x")), fonts: fonts as Uint8Array[] })
    expect(() => App.new(spec([new Uint8Array([1, 2, 3])])).native).not.toThrow()
    expect(() => App.new(spec([[1, 2, 3]])).native).toThrow("Get TypedArray info failed")
  })
})

describe("paths", () => {
  test("paths are strings both ways", () => {
    const d = dirs.AppDirs.rooted("/r/root", "com.example.unit")
    expect(d.is_rooted()).toBe(true)
    expect(d.id()).toBe("com.example.unit")
    for (const path of [d.config(), d.data(), d.cache(), d.state(), d.logs()]) {
      expect(typeof path).toBe("string")
      expect(path.replaceAll("\\", "/")).toMatch(/^\/r\/root\/[a-z]+\/com\.example\.unit$/)
    }
  })
})

describe("enums", () => {
  test("unit variants are strings, data variants { Variant: payload }, both ways", () => {
    expect(Anim.new("Instant").curve).toBe("Instant")
    expect(Anim.new({ Tween: { duration: 0.2, easing: "Linear" } }).curve as unknown).toEqual({ Tween: { duration: Math.fround(0.2), easing: "Linear" } })
    expect(Anim.new({ Spring: Spring.new(0.3, 0.1) }).curve as unknown).toEqual({ Spring: { duration: Math.fround(0.3), bounce: Math.fround(0.1) } })
    expect(KeyEvent.from({ Text: "a" }).key).toEqual({ Text: "a" })
    expect(KeyEvent.from("Enter").key).toBe("Enter")
  })

  test("an unknown variant names the enum and the variant; a wrong shape says what an enum looks like", () => {
    expect(() => Anim.new({ Bogus: 1 } as any)).toThrow('curve: "Bogus" isn\'t a Curve variant (or lacks its value)')
    expect(() => Anim.new("Bogus" as any)).toThrow('curve: "Bogus" isn\'t a Curve variant')
    expect(() => el().cursor("Sideways" as any)).toThrow('cursor: "Sideways" isn\'t a Cursor variant')
    expect(() => Anim.new({ Spring: Spring.new(0.3, 0), Tween: 1 } as any)).toThrow("curve: a Curve object has exactly one key, its variant")
    expect(() => Anim.new(5 as any)).toThrow("curve: expected a Curve (a variant name, or { Variant: value })")
  })
})

describe("records", () => {
  test("a missing or mistyped field names the record and the field", () => {
    expect(() => Anim.from_Spring({ duration: 0.3 } as any)).toThrow("value: Spring.bounce: expected a number")
    expect(() => Anim.from_Spring({ duration: "x", bounce: 0 } as any)).toThrow("value: Spring.duration: expected a number")
  })

  test("plain literals work where a record is taken; fields with defaults may be left out", () => {
    expect(Anim.from_Spring({ duration: 0.3, bounce: 0 } as Spring).curve as unknown).toEqual({ Spring: { duration: Math.fround(0.3), bounce: 0 } })
    expect(oklch(0.5, 0.1, 0).mix({ r: 1 } as Color, 0.5).a).toBe(0.5) // Color's other fields default to 0
  })

  test("returned records are instances of their class and carry Rust's methods", () => {
    const s = Spring.new(0.3, 0)
    expect(s).toBeInstanceOf(Spring)
    expect(s.omega()).toBeCloseTo((2 * Math.PI) / 0.3, 4)
    expect(oklch(0.5, 0.1, 250)).toBeInstanceOf(Color)
    expect(oklch(0.5, 0.1, 250).hex()).toBe("#32669aff")
    expect(new Spring({ duration: 0.2, bounce: 0 }).omega()).toBeCloseTo(Math.PI * 10, 4)
  })
})

describe("traits", () => {
  test("impl Into<String> takes a string; impl Into<Anim> takes an Anim, not what Rust's From would convert", () => {
    expect(() => el().description("help")).not.toThrow()
    expect(() => el().description(5 as any)).toThrow("into rust type `String`")
    expect(() => el().opacity_motion(Anim.from_Spring(Spring.new(0.3, 0)))).not.toThrow()
    // Rust accepts a Spring here (From<Spring> for Anim); the binding takes the Anim only.
    expect(() => el().opacity_motion(Spring.new(0.3, 0) as any)).toThrow("anim: Anim.curve: expected a Curve")
  })

  test("impl AsRef<Path> takes a path string (ImageCache.file, with the waker setup gets)", async () => {
    const { png } = await snapOf(App.new(AppSpec.new("Icon", [8, 8], () => ({}), () => el().w_full().h_full().fill(oklch(0.5, 0.1, 30)))), [], tmp)
    const seen: Record<string, unknown> = {}
    const spec = {
      ...AppSpec.new("AsRef", [40, 40], () => ({}), () => text("x")),
      setup: (_s: object, waker: Waker) => {
        const cache = ImageCache.new(waker)
        seen.image = Object.getPrototypeOf(cache.file(png, 4, 2)) === Image.prototype
        try {
          cache.file(5 as any, 4, 2)
        } catch (e) {
          seen.error = (e as Error).message
        }
      },
    }
    await treeOf(App.new(spec), [], tmp)
    expect(seen.image).toBe(true)
    expect(seen.error).toContain("path: ")
  })

  test("From impls are static from_* (or from) functions", () => {
    expect(Curve.from_Spring(Spring.new(0.3, 0)) as unknown).toEqual({ Spring: { duration: Math.fround(0.3), bounce: 0 } })
    expect(Anim.from_Curve("Instant").curve).toBe("Instant")
    expect(KeyEvent.from("Escape").mods as unknown).toEqual({ shift: false, cmd: false, alt: false, ctrl: false, logo: false })
  })

  test("a Deref target's methods are on the class (Play derefs to Tx)", () => {
    const play = Object.getOwnPropertyNames(Play.prototype)
    // `clone` is Tx's own (Clone isn't reached through Deref; a Play isn't Clone).
    const tx = Object.getOwnPropertyNames(Tx.prototype).filter((m) => m !== "constructor" && m !== "clone")
    expect(tx.length).toBeGreaterThan(50)
    expect(tx.filter((m) => !play.includes(m))).toEqual([])
  })
})

describe("&mut Vec<T>", () => {
  test("the JavaScript array is written back: a popup lands in the layer, and the elements in it are fresh", () => {
    const k = Kit.neutral(true)
    const layer: El[] = [text("kept")]
    const before = layer[0]!
    Tooltip.new("tip").trigger(el().key("t").size(10, 10)).label("hi").open(true).build(k, layer)
    expect(layer).toHaveLength(2)
    expect(layer[0]).not.toBe(before) // moved into Rust's Vec and back out as a new instance
    expect(() => before.key("x")).toThrow(/moved/)
    expect(() => layer[0]!.key("x")).not.toThrow()
  })
})

describe("callbacks", () => {
  test("an argument lent to a callback can't be used after it returns", async () => {
    let cx: Cx | undefined
    let tx: Tx | undefined
    const view = (_: object, c: Cx) => {
      cx = c
      return col().key("root").child(el().key("b").size(50, 30).on_press_tx((_s: object, t: Tx) => { tx = t }))
    }
    await treeOf(App.new(AppSpec.new("Lent", [100, 60], () => ({}), view)), ["--script", writeScript(tmp, [{ t: 0.1, type: "click", key: "b" }])], tmp)
    expect(() => cx!.system_dark()).toThrow("this Cx was lent to a callback that has returned")
    expect(() => tx!.quit()).toThrow("this Tx was lent to a callback that has returned")
  })

  test("an on_edit callback returns the TextEdit to change (&mut T); typing reaches it", async () => {
    type S = { edit: TextEdit }
    let last: S | undefined
    const view = (s: S) => {
      last = s
      return col().key("root").child(text_input(s.edit, tok.type_.BODY).key("in").w(150).on_edit((s: S) => s.edit))
    }
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "in" }, { t: 0.2, type: "type", text: "abc" }])
    const tree = await treeOf(App.new(AppSpec.new<S>("Edit", [200, 60], () => ({ edit: TextEdit.new("") }), view)), ["--script", script, "--at", "0.6"], tmp)
    expect(last!.edit.text).toBe("abc")
    expect(texts(tree)).toContain("abc")
  })

  test("an on_edit callback returning something else rejects the run, naming the type", async () => {
    type S = { edit: TextEdit }
    const view = (s: S) => col().key("root").child(text_input(s.edit, tok.type_.BODY).key("in").w(150).on_edit(() => 42 as any))
    const script = writeScript(tmp, [{ t: 0.1, type: "click", key: "in" }, { t: 0.2, type: "type", text: "a" }])
    // Each later frame's failure is printed with console.error (errors.test.ts).
    const r = await quietly(() => App.new(AppSpec.new<S>("EditWrong", [200, 60], () => ({ edit: TextEdit.new("") }), view)).args(["--script", script, "--tree", `${tmp}/edit-wrong.json`]).run())
    expect((r.error as Error).message).toBe("a callback returned the wrong value: expected a TextEdit")
    expect(r.printed.length).toBeGreaterThan(0)
  })

  test("fn-pointer trampolines: 16 global shortcuts work, the 17th fails with a clear error", () => {
    // In its own process: the trampolines are taken for the process's life.
    const ok = fixture("shortcuts.ts", ["16", "--tree", `${tmp}/shortcuts-16.json`])
    expect(ok.code).toBe(0)
    expect(ok.result).toEqual({ error: null, hits: [0, 15] })
    const full = fixture("shortcuts.ts", ["17", "--tree", `${tmp}/shortcuts-17.json`])
    expect(full.code).toBe(0)
    expect(full.result).toEqual({ error: "more than 16 distinct functions passed where Rust takes a fn pointer", hits: [0, 15] })
  })
})
