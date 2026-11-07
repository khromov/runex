// A pencil over a canvas: `Cursor::Image` with a 2x PNG, its hot spot on the tip. Drag to
// draw. `bun examples/sketch/main.ts`. `pencil.png` is Rune's `examples/sketch/assets/pencil.png`,
// drawn by its `scripts/pencil.py`.

import { readFileSync } from "node:fs"
import { AppSpec, Color, type Cursor, CursorImage, type Cx, type Drag, type El, Shape, canvas, col, run, text, tok } from "runex-js"
const { radius, space, type_ } = tok

// `CursorImage::png` takes the bytes as an array (`Vec<u8>` binds to `number[]`), not a Buffer.
/** 64×64 px, so 32×32 pt, with the graphite tip at (2, 30) pt. */
const PENCIL: CursorImage = CursorImage.png(Array.from(readFileSync(new URL("./pencil.png", import.meta.url))), [2.0, 30.0])
const INK: Color = { r: 0.11, g: 0.11, b: 0.12, a: 1.0 } as Color

type State = {
  strokes: [number, number][][]
}

function State_default(): State {
  return { strokes: [] }
}

function drawing(s: State): Shape {
  return s.strokes.reduce((shape, stroke) => stroke.length === 1
    ? shape.line(stroke[0], stroke[0], 2.5, "Round", INK)
    : shape.stroke(stroke.slice(), 2.5, INK), Shape.new())
}

function view(s: State, _: Cx): El {
  const t = tok.theme(false)
  return col().w_full().h_full().padding(space.S6).gap(space.S3).fill(t.bg)
    .child(text("Drag to draw").font(type_.BODY).color(t.text_secondary))
    .child(canvas(drawing(s)).key("paper").w_full().grow(1.0).radius(radius.LG)
      .fill(Color.WHITE).border(1.0, t.card_border)
      .cursor({ Image: PENCIL } satisfies Cursor)
      .on_drag((s: State, d: Drag, _) => {
        if (d.phase === "Down") s.strokes.push([[d.x, d.y]])
        else {
          const stroke = s.strokes.at(-1)
          if (stroke) stroke.push([d.x, d.y])
        }
      }))
}

run(AppSpec.new<State>("Sketch", [560.0, 420.0], State_default, view))
