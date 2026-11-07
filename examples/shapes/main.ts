// Vector shapes: a filled waveform envelope, polylines, meters, a Bézier path and a concave
// polygon. `bun examples/shapes/main.ts -- --snap shapes.png` renders it headless; time animates the
// waveform, so `--at 1.5` shows another moment.

import { AppSpec, type Color, type Cx, type El, Path, Shape, type Tx, canvas, col, row, run, text } from "runex-js"

// Rust computes in f32: every step rounds.
const f = Math.fround

type State = {
  t: number
}

const INK: Color = {
  r: 0.92,
  g: 0.93,
  b: 0.95,
  a: 1.0,
} as Color
const ACCENT: Color = {
  r: 0.35,
  g: 0.55,
  b: 1.0,
  a: 1.0,
} as Color
const SOFT: Color = {
  r: 0.35,
  g: 0.55,
  b: 1.0,
  a: 0.35,
} as Color
const WARM: Color = {
  r: 1.0,
  g: 0.55,
  b: 0.3,
  a: 1.0,
} as Color

function level(t: number, i: number): number {
  const x = f(f(i * f(0.09)) + f(t * 2.0))
  const a = f(f(Math.sin(x)) * f(0.6))
  const b = f(f(Math.sin(f(x * f(2.7)))) * f(0.3))
  const c = f(f(Math.cos(f(x * f(7.1)))) * f(0.1))
  return Math.min(Math.abs(f(f(a + b) + c)), 1.0)
}

function waveform(t: number, w: number, h: number): Shape {
  const n = 160
  const mid = f(h / 2.0)
  const top: number[][] = []
  for (let i = 0; i < n; i++) {
    top.push([
      f(f(i * w) / (n - 1)),
      f(f(mid - f(level(t, i) * f(mid - 2.0))) - 0.5),
    ])
  }
  const envelope = top.map((p) => [...p])
  envelope.push(...[...top].reverse().map((p) => [p[0]!, f(f(2.0 * mid) - p[1]!)]))
  const line: number[][] = []
  for (let i = 0; i < n; i++) {
    line.push([
      f(f(i * w) / (n - 1)),
      f(mid + f(f(f(Math.sin(f(f(i * f(0.21)) + f(t * 3.0)))) * mid) * f(0.8))),
    ])
  }
  // Drawn in a w × h box and stretched to the element's size.
  return Shape.new()
    .fill(envelope, SOFT)
    .stroke(line, 1.5, ACCENT)
    .line([0.0, mid], [w, mid], 0.5, "Butt", INK)
    .view_box(w, h)
}

function meters(t: number): Shape {
  let s = Shape.new()
  for (let i = 0; i < 24; i++) {
    const x = f(4.0 + f(i * 10.0))
    const v = f(f(level(t, i * 7) * 56.0) + 4.0)
    s = s.line(
      [x, 64.0],
      [x, f(64.0 - v)],
      6.0,
      "Round",
      v > 48.0 ? WARM : ACCENT,
    )
  }
  return s
}

function curves(): Shape {
  const wave = Path.new()
    .move_to([4.0, 50.0])
    .cubic_to([40.0, -20.0], [80.0, 120.0], [116.0, 50.0])
    .quad_to([150.0, 0.0], [186.0, 50.0])
  const blob = Path.new()
    .move_to([210.0, 30.0])
    .cubic_to([230.0, 0.0], [270.0, 0.0], [280.0, 30.0])
    .line_to([260.0, 80.0])
    .line_to([220.0, 80.0])
    .close()
  const PI = f(Math.PI)
  const FRAC_PI_2 = f(Math.PI / 2)
  const star: number[][] = []
  for (let i = 0; i < 10; i++) {
    const a = f(f(f(i * PI) / 5.0) - FRAC_PI_2)
    const r = i % 2 === 0 ? 40.0 : 16.0
    star.push([f(340.0 + f(f(Math.cos(a)) * r)), f(46.0 + f(f(Math.sin(a)) * r))])
  }
  return Shape.new()
    .stroke_path(wave, 3.0, "Round", WARM)
    .fill_path(blob, ACCENT)
    .stroke_path(blob, 1.0, "Round", INK)
    .fill(star, INK)
    .line([400.0, 10.0], [460.0, 86.0], 0.5, "Butt", INK)
    .line([410.0, 10.0], [470.0, 86.0], 1.0, "Butt", INK)
    .line([420.0, 10.0], [480.0, 86.0], 2.0, "Butt", INK)
}

function label(s: string): El {
  return text(s).color(INK)
}

function view(s: State, _: Cx): El {
  return col()
    .key("root")
    .padding(24.0)
    .gap(16.0)
    .fill({
      r: 0.06,
      g: 0.065,
      b: 0.08,
      a: 1.0,
    } as Color)
    .child(label("Waveform: filled envelope, polyline, hairline"))
    .child(
      canvas(waveform(s.t, 260.0, 96.0))
        .key("wave")
        .size(520.0, 96.0)
        .fill({
          r: 0.1,
          g: 0.11,
          b: 0.13,
          a: 1.0,
        } as Color)
        .radius(8.0),
    )
    .child(
      row()
        .gap(24.0)
        .child(
          col()
            .gap(8.0)
            .child(label("Meters"))
            .child(canvas(meters(s.t)).key("meters").size(244.0, 68.0)),
        )
        .child(
          col()
            .gap(8.0)
            .child(label("Paths, a concave fill, line widths"))
            .child(canvas(curves()).key("curves").size(490.0, 96.0)),
        ),
    )
}

function poll(s: State, t: number, _: Tx): boolean {
  s.t = f(t)
  return true
}

run({ ...AppSpec.new<State>("Shapes", [820.0, 360.0], () => ({ t: 0.0 }), view), poll })
