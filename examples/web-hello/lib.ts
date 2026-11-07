// Port of vendor/rune/examples/web-hello/src/lib.rs: a message list with a composer, the app
// Rune's web build runs in the browser. `bun examples/web-hello/main.ts` opens it natively.
//
// The Rust crate's wasm32-only parts have no runex counterpart (runex runs Rune natively, never as
// wasm in a page): `mod input_proof` (the ?input-proof browser fixture) and the title's
// `rune::web::open_url`. They're compiled out of the native binary this port mirrors.

import { AppSpec, type Cx, type El, TextEdit, type Tx, col, el, row, run, text, text_input, tok } from "runex-js"
const { type_ } = tok

type State = {
  messages: string[]
  draft: TextEdit
}

const State = {
  default(): State {
    return {
      messages: Array.from({ length: 24 }, (_, i) => `Message ${i + 1}: Hello from Rune.`),
      draft: TextEdit.new(""),
    }
  },
}

function send(state: State, tx: Tx) {
  // `str::trim` strips Unicode White_Space (unlike JS `trim`, which also strips U+FEFF).
  if (/^\p{White_Space}*$/u.test(state.draft.text)) return
  state.messages.push(state.draft.text)
  state.draft.clear()
  tx.scroll_to_bottom("messages")
}

function view(state: State, cx: Cx): El {
  const dark = cx.system_dark()
  const t = tok.theme(dark)
  const [top, right, bottom, left] = cx.safe_area()
  let messages = col().w_full().gap(12.0).py(16.0)
  for (const [i, message] of state.messages.entries()) {
    messages = messages.child(text(message).key(`message-${i}`)
      .font(type_.BODY).color(t.text).w_full().padding(16.0).radius(12.0).fill(t.card))
  }
  const composer = text_input(state.draft, type_.BODY).key("composer")
    .placeholder("Message", t.text_secondary).color(t.text)
    .grow(1.0).h(48.0).padding(12.0).radius(12.0).fill(t.card)
    .on_edit((s: State) => s.draft).on_submit(send)
  const send_button = el().key("send").h(48.0).px(16.0).center().radius(12.0).fill(t.control_off)
    .child(text("Send").font(type_.LABEL).color(t.text)).on_press_tx(send)
  const copy = el().key("copy").h(44.0).px(8.0).center()
    .child(text("Copy last").font(type_.LABEL).color(t.text_secondary)).on_press_tx((s: State, tx: Tx) => {
      const message = s.messages.at(-1)
      if (message !== undefined) tx.copy(message)
    })
  const title = text("Messages").font(type_.TITLE).color(t.text).grow(1.0)
  // wasm32 only: `title.on_press(|_| { let _ = rune::web::open_url("https://www.rust-lang.org/"); })`.
  return col().w_full().h_full().pt(16.0 + top).pr(16.0 + right).pb(16.0 + bottom).pl(16.0 + left).gap(8.0).fill(t.bg)
    .child(row().w_full().center_y().child(title).child(copy))
    .child(col().key("messages").w_full().grow(1.0).shrink()
      .scroll({ stick_bottom: true }).scroll_edge_fade(16.0).child(messages))
    .child(row().w_full().gap(8.0).child(composer).child(send_button))
}

export function start() {
  // wasm32 only: `if input_proof::enabled() { input_proof::run(); return; }`.
  run(AppSpec.new<State>("Messages", [390.0, 760.0], State.default, view))
}
