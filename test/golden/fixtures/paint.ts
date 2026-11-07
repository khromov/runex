// Golden fixture: paint. oklch fills, linear and radial gradients, borders (solid, dashed,
// gradient), outlines with an offset, radii, outer and inset box shadows, blur and backdrop
// blur, opacity, rounded clips, and vector shapes (Path, a polygon, a polyline). Frozen: it
// changes only when Rune's renderer does.
//
//   bun test/golden/fixtures/paint.ts --list-scenes
//   bun test/golden/fixtures/paint.ts --snap paint.png --scene gradients

import { AppSpec, type Color, type Cx, type El, Path, Shadow, Shape, TextStyle, canvas, col, el, oklch, oklcha, row, run, text, tok } from "runex-js"

type Scene = "fills" | "gradients" | "borders" | "shadows" | "blur" | "clip" | "shapes"
type State = { scene: Scene }

const PI = Math.PI

function tile(key: string, e: El): El {
  return e.key(key).size(96.0, 64.0)
}

function caption(t: tok.Theme, s: string): El {
  return text(s).font(TextStyle.new(10.0, 500.0)).color(t.text_secondary)
}

function labeled(t: tok.Theme, name: string, e: El): El {
  return col().gap(4.0).items_center().child(e).child(caption(t, name))
}

function grid(items: El[]): El {
  return row().w(560.0).gap(12.0).flex_wrap().children(items)
}

function fills(t: tok.Theme): El {
  const hues = [0.0, 45.0, 90.0, 145.0, 200.0, 265.0, 320.0]
  return col().gap(12.0)
    .child(row().gap(6.0).children(hues.map((h, i) => tile(`l${i}`, el().fill(oklch(0.7, 0.15, h)).radius(6.0)))))
    .child(row().gap(6.0).children([0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map((l, i) => tile(`g${i}`, el().fill(oklch(l, 0.0, 0.0)).radius(6.0)))))
    .child(row().gap(6.0).children([0.1, 0.25, 0.5, 0.75, 1.0].map((a, i) => tile(`a${i}`, el().fill(oklcha(0.7, 0.18, 265.0, a)).radius(6.0)))))
    .child(row().gap(6.0).child(tile("theme-card", el().fill(t.card).border(1.0, t.card_border).radius(8.0)))
      .child(tile("accent", el().fill(tok.accent(0, true)).radius(8.0))).child(tile("track", el().fill(t.control_track).radius(8.0))))
}

function gradients(t: tok.Theme): El {
  const a = oklch(0.7, 0.17, 30.0), b = oklch(0.6, 0.17, 265.0), c = oklch(0.85, 0.12, 120.0)
  return grid([
    labeled(t, "gradient(top, bottom)", tile("vertical", el().gradient(a, b).radius(8.0))),
    labeled(t, "linear 0", tile("lin0", el().linear_gradient(0.0, [[0.0, a], [1.0, b]]).radius(8.0))),
    labeled(t, "linear pi/2", tile("lin90", el().linear_gradient(PI / 2, [[0.0, a], [1.0, b]]).radius(8.0))),
    labeled(t, "linear 3 stops", tile("lin3", el().linear_gradient(PI / 4, [[0.0, a], [0.5, c], [1.0, b]]).radius(8.0))),
    labeled(t, "radial", tile("radial", el().radial_gradient([0.5, 0.5], 48.0, [[0.0, c], [1.0, b]]).radius(8.0))),
    labeled(t, "radial ellipse", tile("ellipse", el().radial_gradient([0.25, 0.3], [70.0, 30.0], [[0.0, a], [0.6, c], [1.0, oklcha(0.6, 0.17, 265.0, 0.0)]]).radius(8.0))),
    labeled(t, "border_gradient", tile("border-gradient", el().fill(t.card).border_gradient(3.0, a, b).radius(10.0))),
  ])
}

function borders(t: tok.Theme): El {
  const ink = oklch(0.75, 0.15, 200.0)
  return grid([
    labeled(t, "border 1", tile("b1", el().fill(t.card).border(1.0, ink).radius(0.0))),
    labeled(t, "border 4 r12", tile("b4", el().fill(t.card).border(4.0, ink).radius(12.0))),
    labeled(t, "dashed", tile("dash", el().fill(t.card).border(2.0, ink).border_dash(6.0, 4.0).radius(8.0))),
    labeled(t, "outline 0", tile("o0", el().fill(t.card).outline(2.0, 0.0, ink).radius(8.0))),
    labeled(t, "outline offset 3", tile("o3", el().fill(t.card).outline(2.0, 3.0, ink).radius(8.0))),
    labeled(t, "radius 32 (pill)", tile("pill", el().fill(ink).radius(32.0))),
    labeled(t, "radii 0 8 16 24", tile("radii", el().fill(ink).corners([0.0, 8.0, 16.0, 24.0]))),
    labeled(t, "rotate 0.2", tile("rot", el().fill(ink).radius(8.0).rotate(0.2))),
  ])
}

function shadows(t: tok.Theme): El {
  const black = (a: number): Color => oklcha(0.0, 0.0, 0.0, a)
  const card = (key: string) => tile(key, el().fill(t.card).radius(10.0))
  return grid([
    labeled(t, "shadow(4, 10)", card("s1").shadow(4.0, 10.0, black(0.5))),
    labeled(t, "two layers", card("s2").box_shadow(new Shadow({ x: 0.0, y: 1.0, blur: 2.0, spread: 0.0, color: black(0.4), inset: false }))
      .box_shadow(new Shadow({ x: 0.0, y: 12.0, blur: 24.0, spread: -4.0, color: black(0.5), inset: false }))),
    labeled(t, "spread ring", card("ring").box_shadow(new Shadow({ x: 0.0, y: 0.0, blur: 0.0, spread: 3.0, color: oklch(0.7, 0.17, 30.0), inset: false }))),
    labeled(t, "inset", card("inset").box_shadow(new Shadow({ x: 0.0, y: 4.0, blur: 8.0, spread: 0.0, color: black(0.6), inset: true }))),
    labeled(t, "coloured", card("glow").box_shadow(new Shadow({ x: 0.0, y: 0.0, blur: 20.0, spread: 2.0, color: oklcha(0.7, 0.2, 265.0, 0.8), inset: false }))),
    labeled(t, "core_animation", card("ca").box_shadow(Shadow.core_animation(0.0, 6.0, 10.0, black(0.5)))),
  ])
}

function blur(t: tok.Theme): El {
  const stripes = row().key("stripes").w(520.0).h(120.0).children(Array.from({ length: 13 }, (_, i) =>
    el().w(40.0).h_full().fill(oklch(0.7, 0.16, (i * 28.0) % 360.0))))
  const glass = (key: string, x: number, sigma: number) => el().key(key).absolute(x, 20.0).size(120.0, 80.0).radius(12.0)
    .backdrop_blur(sigma).fill(oklcha(0.2, 0.0, 0.0, 0.25)).border(1.0, oklcha(1.0, 0.0, 0.0, 0.3))
  return col().gap(14.0)
    .child(col().w(520.0).h(120.0).child(stripes).child(glass("glass-4", 20.0, 4.0)).child(glass("glass-16", 200.0, 16.0)))
    .child(row().gap(12.0)
      .child(labeled(t, "blur 0", tile("blur0", el().fill(oklch(0.7, 0.17, 30.0)).radius(8.0))))
      .child(labeled(t, "blur 3", tile("blur3", el().fill(oklch(0.7, 0.17, 30.0)).radius(8.0).blur(3.0))))
      .child(labeled(t, "opacity 0.5", tile("op50", el().fill(oklch(0.7, 0.17, 30.0)).radius(8.0).opacity(0.5))))
      .child(labeled(t, "opacity 0.2 group", tile("op20", el().fill(oklch(0.7, 0.17, 200.0)).radius(8.0).opacity(0.2)
        .child(el().size(40.0, 40.0).fill(oklch(0.9, 0.1, 90.0)))))))
}

function clip(t: tok.Theme): El {
  const big = (hue: number) => el().size(200.0, 140.0).linear_gradient(PI / 4, [[0.0, oklch(0.7, 0.17, hue)], [1.0, oklch(0.5, 0.17, hue + 120.0)]])
  return row().gap(16.0)
    .child(labeled(t, "unclipped overflow", col().key("noclip").size(120.0, 90.0).border(1.0, t.card_border).child(big(30.0))))
    .child(labeled(t, "clip_rounded 20", col().key("clip").size(120.0, 90.0).clip_rounded(20.0).child(big(150.0))))
    .child(labeled(t, "clip_rounded 45 (circle)", col().key("circle").size(90.0, 90.0).clip_rounded(45.0).child(big(260.0))))
}

function shapes(t: tok.Theme): El {
  const ink = oklch(0.92, 0.0, 0.0), warm = oklch(0.75, 0.15, 50.0), cool = oklch(0.65, 0.15, 250.0)
  const curve = Path.new().move_to([10.0, 70.0]).cubic_to([40.0, -10.0], [90.0, 150.0], [130.0, 60.0]).quad_to([160.0, 10.0], [190.0, 60.0])
  const blob = Path.new().move_to([220.0, 30.0]).cubic_to([240.0, 0.0], [290.0, 0.0], [300.0, 40.0]).line_to([270.0, 90.0]).line_to([230.0, 90.0]).close()
  const star: number[][] = []
  for (let i = 0; i < 10; i++) {
    const a = (i * PI) / 5 - PI / 2
    const r = i % 2 === 0 ? 40.0 : 16.0
    star.push([370.0 + Math.cos(a) * r, 50.0 + Math.sin(a) * r])
  }
  const zig = Array.from({ length: 12 }, (_, i) => [430.0 + i * 8.0, i % 2 === 0 ? 20.0 : 80.0])
  const shape = Shape.new()
    .stroke_path(curve, 3.0, "Round", warm)
    .fill_path(blob, cool)
    .stroke_path(blob, 1.0, "Round", ink)
    .fill(star, ink)
    .stroke(zig, 2.0, warm)
    .line([10.0, 100.0], [520.0, 100.0], 0.5, "Butt", ink)
    .line([10.0, 110.0], [520.0, 110.0], 4.0, "Round", cool)
  return col().gap(8.0).child(canvas(shape).key("shapes").size(540.0, 120.0).fill(t.card).radius(8.0)).child(caption(t, "Path, polygon, polyline, lines"))
}

function view(s: State, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  const body = (() => {
    switch (s.scene) {
      case "fills": return fills(t)
      case "gradients": return gradients(t)
      case "borders": return borders(t)
      case "shadows": return shadows(t)
      case "blur": return blur(t)
      case "clip": return clip(t)
      case "shapes": return shapes(t)
    }
  })()
  return col().key("root").w_full().h_full().padding(24.0).fill(t.bg).child(body)
}

const SCENES: Scene[] = ["fills", "gradients", "borders", "shadows", "blur", "clip", "shapes"]

run({
  ...AppSpec.new<State>("Golden paint", [760.0, 340.0], () => ({ scene: "fills" }), view),
  scenes: SCENES.map((name) => [name, (s: State) => { s.scene = name }]),
})
