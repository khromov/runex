// Golden fixture: motion. One bar per tok.motion spring slides across, and dots fade, scale and
// blur on rune-motion curves, all starting on the first frame. test/golden/config.ts renders it
// at fixed `--at` times, so a changed spring duration, bounce or easing moves the elements.
// `--scene reduced` runs the same with the runtime's reduced motion on.
//
//   bun test/golden/fixtures/motion.ts --snap motion.png --at 0.1

import { AppSpec, type Cx, type El, type Spring, TextStyle, col, el, oklch, row, run, text, tok } from "runex-js"
import { Anim, Curve } from "runex-js/motion"

type State = { go: boolean; reduced: boolean }

const SPRINGS: [string, Spring][] = [
  ["INSTANT", tok.motion.INSTANT], ["SNAPPY", tok.motion.SNAPPY], ["QUICK", tok.motion.QUICK], ["DEFAULT", tok.motion.DEFAULT],
  ["SMOOTH", tok.motion.SMOOTH], ["POP", tok.motion.POP], ["MORPH", tok.motion.MORPH], ["CALM", tok.motion.CALM],
  ["DRIFT", tok.motion.DRIFT], ["CAMERA", tok.motion.CAMERA],
]
const LABEL = TextStyle.new(10.0, 500.0)
const TRACK = 300.0

function view(s: State, cx: Cx): El {
  if (s.reduced) cx.reduced_motion(true)
  const t = tok.theme(cx.system_dark())
  const bars = SPRINGS.map(([name, spring], i) =>
    row().key(`row-${name}`).gap(8.0).center_y()
      .child(text(name).font(LABEL).color(t.text_secondary).w(60.0))
      .child(col().w(TRACK + 24.0).h(14.0).radius(7.0).fill(t.control_track)
        .child(el().key(name).size(24.0, 14.0).radius(7.0).fill(oklch(0.72, 0.15, i * 36.0))
          .absolute(s.go ? TRACK : 0.0, 0.0).motion(spring))))
  const curves = [
    ["fade", Anim.new(tok.motion.CSS_ENTER), (e: El) => e.opacity(s.go ? 1.0 : 0.0).opacity_motion(Anim.new(tok.motion.CSS_ENTER))],
    ["scale", Anim.new(Curve.ease_in_out(0.4)), (e: El) => e.scale(s.go ? 1.0 : 0.3).scale_motion(Anim.new(Curve.ease_in_out(0.4)))],
    ["blur", Anim.new(Curve.linear(0.5)), (e: El) => e.blur(s.go ? 0.0 : 8.0).blur_motion(Anim.new(Curve.linear(0.5)))],
    ["fade-reduced", Anim.new(tok.motion.REDUCED_FADE), (e: El) => e.opacity(s.go ? 1.0 : 0.0).opacity_motion(Anim.new(tok.motion.REDUCED_FADE))],
  ] as const
  const dots = row().gap(20.0).children(curves.map(([name, , apply], i) =>
    col().gap(4.0).items_center()
      .child(apply(el().key(`dot-${name}`).size(36.0, 36.0).radius(18.0).fill(oklch(0.75, 0.14, 200.0 + i * 40.0))))
      .child(text(name).font(LABEL).color(t.text_secondary))))
  return col().key("root").w_full().h_full().padding(16.0).gap(6.0).fill(t.bg).children(bars).child(dots)
}

run({
  ...AppSpec.new<State>("Golden motion", [460.0, 330.0], () => ({ go: false, reduced: false }), view),
  scenes: [
    ["springs", (_: State) => {}],
    ["reduced", (s: State) => { s.reduced = true }],
  ],
  // Frame 0 mounts everything at the start; the first poll after it starts every animation.
  poll: (s: State, t: number) => {
    if (s.go || t <= 0.0) return !s.go
    s.go = true
    return true
  },
})
