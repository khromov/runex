// A writing app: a note on type. The last line types itself under a blinking caret, then a
// double click selects two words and a format bar springs up over them. Made for macro shots
// (`--scale 6`), where the glyph edges are the subject.

import { type Cx, type El, TextStyle, col, el, row, text } from "runex-js"

import { FAINT, H, MUTED, W, avatar, c, ca, mono, sp, track } from "../kit.ts"
import type { State } from "../main.ts"

const TITLE = "Small type, sharp edges"
const LINES: [string, string] = ["Good interfaces are mostly text. Labels, numbers,", "code and long reading all live or die by the edge"]
const TYPED: [string, string, string] = ["of ", "every glyph", ", and where it lands on the pixel."]
const TYPE_FROM = 0.5
const TYPE_RATE = 16.0
const SELECT = 3.9

const BODY = 17.0
const INK = 0xc9cad1

function body(s: string, color: number): El {
  return text(s).font(TextStyle.new(BODY, 400.0)).color(c(color))
}

function caret(t_: number, typing: boolean): El {
  const on = typing || Math.trunc(t_ * 1.8) % 2 === 0
  return el().w(2.0).h(22.0).radius(1.0).fill(ca(0x8ab4ff, on ? 1.0 : 0.0))
}

function format_bar(k: number): El {
  const item = (s: string, w: number, on: boolean): El =>
    row().size(30.0, 28.0).radius(7.0).center().fill(ca(0xffffff, on ? 0.1 : 0.0))
      .child(text(s).font(TextStyle.new(14.0, w)).color(c(on ? 0xffffff : 0xb4b6bf)))
  return row().key("format").h(38.0).px(5.0).gap(2.0).radius(11.0).center_y()
    .fill(c(0x1d1e23)).border(1.0, ca(0xffffff, 0.1)).shadow(10.0, 28.0, ca(0x000000, 0.55))
    .scale(Math.fround(Math.fround(0.86) + Math.fround(Math.fround(0.14) * k))).opacity(Math.min(Math.max(k, 0.0), 1.0))
    .child(item("B", 700.0, true))
    .child(item("I", 400.0, false))
    .child(item("U", 400.0, false))
    .child(el().w(1.0).h(18.0).mx(4.0).fill(ca(0xffffff, 0.12)))
    .child(item("Aa", 500.0, false))
    .child(item("“", 500.0, false))
}

export function view(s: State, _: Cx): El {
  const t_ = s.t
  const full = `${TYPED[0]}${TYPED[1]}${TYPED[2]}`
  const chars = Array.from(full)
  const n = Math.min(Math.trunc(Math.max((t_ - TYPE_FROM) * TYPE_RATE, 0.0)), chars.length)
  const typing = n < chars.length
  const sel = track(t_, 0.0, [[SELECT, 1.0, sp(0.3, 0.0)]])
  const bar = track(t_, 0.0, [[SELECT + 0.12, 1.0, sp(0.45, 0.32)]])

  let last: El
  if (t_ < SELECT) {
    const typed = chars.slice(0, n).join("")
    last = row().h(28.0).center_y().child(body(typed, INK)).child(caret(t_, typing))
  } else {
    last = row().h(28.0).center_y()
      .child(body(TYPED[0], INK))
      .child(el().radius(3.0).fill(ca(0x3b82f6, Math.fround(Math.fround(0.42) * sel))).child(body(TYPED[1], 0xffffff)))
      .child(body(TYPED[2], INK))
  }

  let doc = col().key("doc").absolute(200.0, 130.0).w(600.0).gap(0.0)
    .child(
      row().gap(8.0).center_y()
        .child(text("Notes").font(TextStyle.new(12.5, 500.0)).color(c(FAINT)))
        .child(text("/").font(TextStyle.new(12.5, 400.0)).color(c(0x45454c)))
        .child(text("Typography").font(TextStyle.new(12.5, 500.0)).color(c(MUTED))),
    )
    .child(el().h(22.0))
    // Rust: `TextStyle { tracking: -0.9, ..TextStyle::new(40.0, 600.0) }`; `TextStyle::tracking` is that update.
    .child(text(TITLE).font(TextStyle.new(40.0, 600.0).tracking(-0.9)).color(c(0xf3f3f5)))
    .child(el().h(10.0))
    .child(
      row().gap(10.0).center_y()
        .child(avatar("", 0x7c5cff, 18.0))
        .child(text("Mira Chen").font(TextStyle.new(13.0, 500.0)).color(c(MUTED)))
        .child(text("·").font(TextStyle.new(13.0, 400.0)).color(c(FAINT)))
        .child(text("4 min read").font(TextStyle.new(13.0, 400.0)).color(c(FAINT))),
    )
    .child(el().h(26.0))
  for (const l of LINES) {
    doc = doc.child(row().h(28.0).center_y().child(body(l, INK)))
  }
  doc = doc.child(last)
  doc = doc.child(el().h(24.0)).child(
    row().gap(10.0).center_y()
      .child(el().px(8.0).py(3.0).radius(6.0).fill(ca(0xffffff, 0.06)).child(mono("font-feature-settings: \"tnum\"", 12.5, 0x9ecbff)))
      .child(text("0123456789").font(TextStyle.new(13.0, 500.0)).color(c(MUTED))),
  )

  let root = el().w(W).h(H).fill(c(0x0b0b0d)).child(doc)
  if (t_ >= SELECT + 0.1) {
    // Centred over the selected words on the third body line.
    root = root.child(row().key("format-at").absolute(181.0, Math.fround(284.0 - Math.fround(6.0 * Math.fround(1.0 - bar)))).child(format_bar(bar)))
  }
  return root
}
