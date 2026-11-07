// The hello app, run by Vite: `vite` in this directory opens it, and saving this file or
// `label.ts` swaps the new view into the open window. `vite -- --snap out.png --scene on` renders
// it headless instead (again on every save).

import { AppSpec, type Cx, type El, col, el, run, text, tok } from "runex-js"
import { caption } from "./label.ts"
const { motion, type_ } = tok

type State = { on: boolean }

function view(s: State, _: Cx): El {
  const t = tok.theme(true)
  const label = text(caption(s.on)).font(type_.TITLE).color(t.text)
  const knob = el().key("knob").size(18.0, 18.0).radius(9.0).fill(t.knob)
    .absolute(s.on ? 18.0 : 2.0, 2.0)
  const switch_ = el().key("switch").role("switch").label("Lights").checked(s.on).focusable(true).size(38.0, 22.0).radius(11.0)
    .fill(s.on ? tok.accent(0, true) : t.control_off)
    .motion(motion.SNAPPY)
    .on_press((s: State) => { s.on = !s.on })
    .child(knob)
  return col().w_full().h_full().center().gap(16.0).fill(t.bg).child(label).child(switch_)
}

run({
  ...AppSpec.new<State>("Hello (Vite)", [320.0, 200.0], () => ({ on: false }), view),
  scenes: [["on", (s) => { s.on = true }]],
})
