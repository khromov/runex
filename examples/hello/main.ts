// The smallest Rune app: one piece of state, a view of it, and a switch that flips it on a spring.
// `bun examples/hello/main.ts` opens the window; `-- --snap hello.png --scene on` renders it headless.

import { AppSpec, type Cx, type El, col, el, run, text, tok } from "runex-js"
const { motion, type_ } = tok

type State = { on: boolean }

function view(s: State, _: Cx): El {
  const t = tok.theme(true)
  const label = text(s.on ? "Lights on" : "Lights off")
    .font(type_.TITLE).color(t.text)
  const knob = el().key("knob").size(18.0, 18.0).radius(9.0).fill(t.knob)
    .absolute(s.on ? 18.0 : 2.0, 2.0)
  // Screen readers hear "Lights, switch, on": the label names it, `checked` says its state.
  const switch_ = el().key("switch").role("switch").label("Lights").checked(s.on).focusable(true).size(38.0, 22.0).radius(11.0)
    .fill(s.on ? tok.accent(0, true) : t.control_off)
    .motion(motion.SNAPPY)
    .on_press((s: State) => { s.on = !s.on })
    .child(knob)
  return col().w_full().h_full().center().gap(16.0).fill(t.bg).child(label).child(switch_)
}

run({
  ...AppSpec.new<State>("Hello", [320.0, 200.0], () => ({ on: false }), view),
  scenes: [["on", (s) => { s.on = true }]],
})
