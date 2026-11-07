// A long list scrolling under a frosted bottom bar: `El::backdrop_blur` blurs the rows behind
// the bar each frame, and the bar's fill tints the blur.
//
// ```sh
// bun examples/frosted-bar/main.ts
// bun examples/frosted-bar/main.ts --snap bar.png --scale 2 --theme dark
// bun examples/frosted-bar/main.ts --script examples/frosted-bar/scroll.json --frames 480 --fps 120 --scale 2
// ```
//
// The bar blurs at σ 8 pt under a light tint. `--scene strong` blurs at σ 20 pt under a
// heavier tint; `--scene plain` draws the bar with its tint alone, for comparison.

import { AppSpec, type Cx, type El, TextStyle, col, el, oklch, oklcha, row, run, text, tok } from "runex-js"
const { type_ } = tok

const BAR = 60.0
const TABS = ["Inbox", "Today", "Later", "Done"] as const

type Look = "Soft" | "Strong" | "Plain"

type State = {
  tab: number
  look: Look
}

function list_row(i: number, dark: boolean): El {
  const t = tok.theme(dark)
  const hue = Math.fround(Math.fround(i * 47.0) % 360.0)
  const swatch = el().size(40.0, 40.0).radius(12.0).fill(oklch(dark ? 0.62 : 0.7, 0.16, hue))
  const lines = col().grow(1.0).gap(3.0)
    .child(text(`Item ${i + 1}`).font(type_.TITLE).color(t.text))
    .child(text(`A row that scrolls under the bar, hue ${hue.toFixed(0)}`).font(type_.BODY).color(t.text_secondary))
  return row().w_full().px(16.0).py(10.0).gap(12.0).center_y().child(swatch).child(lines)
}

function tab(i: number, s: State, dark: boolean): El {
  const t = tok.theme(dark)
  const on = s.tab === i
  return col().key(TABS[i]!).role("button").label(TABS[i]!).hit().grow(1.0).h_full().center().gap(4.0)
    .on_press((s: State) => { s.tab = i })
    .child(el().size(22.0, 4.0).radius(2.0).fill(on ? tok.accent(0, dark) : t.control_off))
    .child(text(TABS[i]!).font(TextStyle.new(11.0, on ? 650.0 : 500.0))
      .color(on ? t.text : t.text_secondary))
}

function view(s: State, cx: Cx): El {
  const dark = cx.system_dark()
  const t = tok.theme(dark)
  const rows = col().w_full().pb(BAR).children(Array.from({ length: 60 }, (_, i) => list_row(i, dark)))
  const list = col().key("list").w_full().h_full().scroll({ stick_bottom: false }).child(rows)
  const [sigma, alpha] = (() => {
    switch (s.look) {
      case "Soft": return [8.0, dark ? 0.4 : 0.45]
      case "Strong": return [20.0, dark ? 0.55 : 0.6]
      case "Plain": return [0.0, dark ? 0.4 : 0.45]
    }
  })()
  const tint = dark ? oklcha(0.2, 0.005, 265.0, alpha) : oklcha(0.98, 0.003, 265.0, alpha)
  const hairline = el().w_full().h(0.5).fill(t.separator)
  const bar = col().key("bar").pin(0.0, null, 0.0, 0.0).h(BAR)
    .backdrop_blur(sigma).fill(tint)
    .child(hairline)
    .child(row().w_full().grow(1.0).children(TABS.map((_, i) => tab(i, s, dark))))
  return el().w_full().h_full().fill(t.bg).child(list).child(bar)
}

run({
  ...AppSpec.new<State>("Frosted bar", [390.0, 640.0], () => ({ tab: 0, look: "Soft" }), view),
  scenes: [["strong", (s) => { s.look = "Strong" }], ["plain", (s) => { s.look = "Plain" }]],
})
