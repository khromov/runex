// Golden fixture: layout. Flex rows and columns, equal-column grids, wrapping, min and max
// sizes, absolute and pinned children, and a scroll view that starts at its bottom. Frozen:
// it changes only when Rune's layout does.
//
//   bun test/golden/fixtures/layout.ts --list-scenes
//   bun test/golden/fixtures/layout.ts --snap layout.png --scene grid

import { AppSpec, type Color, type Cx, type El, TextStyle, col, el, oklch, row, run, text, tok } from "runex-js"

type Scene = "flex" | "grid" | "wrap" | "min-max" | "absolute" | "scroll"
type State = { scene: Scene }

const SMALL = TextStyle.new(11.0, 500.0)

function swatch(i: number, dark: boolean): Color {
  return oklch(dark ? 0.62 : 0.72, 0.13, (i * 47.0) % 360.0)
}

function cell(i: number, dark: boolean, w: number | null = null, h = 28.0): El {
  const c = el().key(`c${i}`).h(h).radius(4.0).fill(swatch(i, dark)).center()
    .child(text(`${i}`).font(SMALL).color(tok.theme(dark).text))
  return w === null ? c : c.w(w)
}

function frame(t: tok.Theme, key: string, child: El): El {
  return col().key(key).padding(6.0).radius(6.0).border(1.0, t.card_border).fill(t.card).child(child)
}

function flex(t: tok.Theme, dark: boolean): El {
  const r = (key: string, f: (r: El) => El) => frame(t, key, f(row().w(320.0).h(44.0).gap(6.0)))
  return col().gap(8.0)
    .child(r("start", (x) => x.child(cell(0, dark, 40.0)).child(cell(1, dark, 60.0)).child(cell(2, dark, 30.0))))
    .child(r("grow", (x) => x.child(cell(0, dark, 40.0)).child(cell(1, dark).grow(1.0)).child(cell(2, dark).grow(2.0))))
    .child(r("between", (x) => x.justify_between().child(cell(0, dark, 40.0)).child(cell(1, dark, 40.0)).child(cell(2, dark, 40.0))))
    .child(r("center", (x) => x.justify_center().center_y().child(cell(0, dark, 40.0, 20.0)).child(cell(1, dark, 40.0, 36.0))))
    .child(r("end", (x) => x.justify_end().items_end().child(cell(0, dark, 40.0, 16.0)).child(cell(1, dark, 40.0, 30.0))))
    .child(frame(t, "column", col().w(320.0).gap(4.0).items_stretch().child(cell(3, dark)).child(cell(4, dark, 100.0).self_center())))
}

function grid(t: tok.Theme, dark: boolean): El {
  return col().gap(10.0)
    .child(frame(t, "cols3", row().w(360.0).gap(6.0).equal_columns(3)
      .children([0, 1, 2, 3, 4, 5].map((i) => cell(i, dark)))))
    .child(frame(t, "cols4", row().w(360.0).gap(6.0).equal_columns(4)
      .child(cell(6, dark).grid_cell(0)).child(cell(7, dark).grid_cell(2)).child(cell(8, dark, 30.0).grid_cell(2))))
    .child(frame(t, "cols2", col().w(360.0).gap(12.0).equal_columns(2)
      .children([9, 10, 11, 12, 13].map((i) => cell(i, dark, null, 20.0)))))
}

function wrap(t: tok.Theme, dark: boolean): El {
  return col().gap(10.0)
    .child(frame(t, "wrap", row().w(300.0).gap(6.0).flex_wrap().children(Array.from({ length: 14 }, (_, i) => cell(i, dark, 30.0 + (i % 4) * 14.0)))))
    .child(frame(t, "wrap-narrow", row().w(200.0).gap(4.0).flex_wrap().children(Array.from({ length: 9 }, (_, i) => cell(i + 20, dark, 50.0, 18.0)))))
}

function minMax(t: tok.Theme, dark: boolean): El {
  return col().gap(8.0)
    .child(frame(t, "min-w", row().w(320.0).gap(6.0).child(cell(0, dark).grow(1.0).min_w(200.0)).child(cell(1, dark).grow(1.0))))
    .child(frame(t, "max-w", row().w(320.0).gap(6.0).child(cell(2, dark).grow(1.0).max_w(80.0)).child(cell(3, dark).grow(1.0))))
    .child(frame(t, "min-h", row().w(320.0).gap(6.0).items_start().child(cell(4, dark, 60.0, 10.0).min_h(40.0)).child(cell(5, dark, 60.0))))
    .child(frame(t, "max-h", col().w(320.0).h(120.0).gap(6.0).child(cell(6, dark).grow(1.0).max_h(30.0)).child(cell(7, dark).grow(1.0))))
    .child(frame(t, "aspect", row().w(320.0).gap(6.0).items_start().child(cell(8, dark, 80.0, 0.0).aspect_ratio(2.0)).child(cell(9, dark, 40.0, 0.0).aspect_ratio(0.5))))
}

function absolute(t: tok.Theme, dark: boolean): El {
  return frame(t, "abs", col().w(360.0).h(220.0)
    .child(cell(0, dark, 60.0).absolute(10.0, 10.0))
    .child(cell(1, dark, 60.0).absolute(200.0, 120.0))
    .child(cell(2, dark).pin(null, null, 8.0, 8.0).w(50.0))
    .child(cell(3, dark).pin(20.0, 60.0, 20.0, null))
    .child(el().key("overlay").pin(0.0, 0.0, 0.0, 0.0).radius(8.0).border(2.0, swatch(4, dark))))
}

function scroll(t: tok.Theme, dark: boolean): El {
  const rows = col().w_full().gap(4.0).children(Array.from({ length: 30 }, (_, i) => cell(i, dark, null, 22.0)))
  return row().gap(12.0).items_start()
    .child(frame(t, "top", col().key("list-top").w(160.0).h(200.0).scroll({ stick_bottom: false }).child(rows)))
    .child(frame(t, "bottom", col().key("list-bottom").w(160.0).h(200.0).scroll({ stick_bottom: true })
      .child(col().w_full().gap(4.0).children(Array.from({ length: 30 }, (_, i) => cell(i, dark, null, 22.0))))))
}

function view(s: State, cx: Cx): El {
  const dark = cx.system_dark()
  const t = tok.theme(dark)
  const body = (() => {
    switch (s.scene) {
      case "flex": return flex(t, dark)
      case "grid": return grid(t, dark)
      case "wrap": return wrap(t, dark)
      case "min-max": return minMax(t, dark)
      case "absolute": return absolute(t, dark)
      case "scroll": return scroll(t, dark)
    }
  })()
  return col().key("root").w_full().h_full().padding(16.0).fill(t.bg).child(body)
}

const SCENES: Scene[] = ["flex", "grid", "wrap", "min-max", "absolute", "scroll"]

run({
  ...AppSpec.new<State>("Golden layout", [480.0, 400.0], () => ({ scene: "flex" }), view),
  scenes: SCENES.map((name) => [name, (s: State) => { s.scene = name }]),
})
