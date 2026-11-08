// CSS colours to Rune's `Color`, which is linear-light RGB with straight alpha: `#rgb[a]`,
// `#rrggbb[aa]`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklch()` and the common named colours.
import { color, type Color } from "runex-js"

/** sRGB-encoded 0..1 to linear, as Rune's own `color::hex` decodes. */
function decode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const make = (r: number, g: number, b: number, a: number): Color =>
  ({ r: decode(clamp(r)), g: decode(clamp(g)), b: decode(clamp(b)), a: clamp(a) }) as Color

const clamp = (v: number) => Math.min(1, Math.max(0, v))

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  lime: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  purple: "#800080",
  teal: "#008080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  gold: "#ffd700",
  indigo: "#4b0082",
  violet: "#ee82ee",
  coral: "#ff7f50",
  crimson: "#dc143c",
  tomato: "#ff6347",
  salmon: "#fa8072",
  khaki: "#f0e68c",
  plum: "#dda0dd",
  orchid: "#da70d6",
  tan: "#d2b48c",
  beige: "#f5f5dc",
  ivory: "#fffff0",
  lavender: "#e6e6fa",
  turquoise: "#40e0d0",
  skyblue: "#87ceeb",
  steelblue: "#4682b4",
  slategray: "#708090",
  dimgray: "#696969",
  darkgray: "#a9a9a9",
  lightgray: "#d3d3d3",
  gainsboro: "#dcdcdc",
  whitesmoke: "#f5f5f5",
  rebeccapurple: "#663399",
}

/** `50%` → 0.5, `0.5` → 0.5, for alpha and the 0..1 channels of `oklch`. */
function unit(s: string, scale = 1): number {
  return s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s) / scale
}

/** `rgb(1 2 3 / 50%)` and `rgb(1, 2, 3, 0.5)` alike. */
function args(inner: string): string[] {
  return inner.replace(/\//g, " ").split(/[\s,]+/).filter(Boolean)
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

/** A parsed CSS colour, or null when `text` isn't one this understands. */
export function parse_color(text: string): Color | null {
  const s = text.trim().toLowerCase()
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 } as Color
  if (s.startsWith("#")) {
    const h = s.slice(1)
    if (!/^[0-9a-f]+$/.test(h)) return null
    // Rune reads #rgb, #rrggbb and #rrggbbaa; #rgba is the short form of the last.
    if (h.length === 4) return color.hex(`#${[...h].map((c) => c + c).join("")}`)
    return color.hex(s)
  }
  if (NAMED[s]) return color.hex(NAMED[s]!)
  const fn = /^([a-z]+)\((.*)\)$/.exec(s)
  if (!fn) return null
  const [, name, inner] = fn
  const a = args(inner!)
  const alpha = a.length > 3 ? unit(a[3]!) : 1
  if (name === "rgb" || name === "rgba") {
    if (a.length < 3) return null
    const ch = (v: string) => unit(v, 255)
    return make(ch(a[0]!), ch(a[1]!), ch(a[2]!), alpha)
  }
  if (name === "hsl" || name === "hsla") {
    if (a.length < 3) return null
    const [r, g, b] = hsl(parseFloat(a[0]!), unit(a[1]!, 100), unit(a[2]!, 100))
    return make(r, g, b, alpha)
  }
  if (name === "oklch") {
    if (a.length < 3) return null
    // L is 0..1 (or a percentage), C as given (0.4 is 100%), H in degrees.
    const l = unit(a[0]!)
    const c = a[1]!.endsWith("%") ? (parseFloat(a[1]!) / 100) * 0.4 : parseFloat(a[1]!)
    return color.oklcha(l, c, parseFloat(a[2]!), alpha)
  }
  return null
}

/** Whether `v` is already a Rune colour (a `Color` record or a plain `{ r, g, b, a }`). */
export function is_color(v: unknown): v is Color {
  return typeof v === "object" && v !== null && "r" in v && "g" in v && "b" in v && "a" in v
}
