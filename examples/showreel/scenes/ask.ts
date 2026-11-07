// An assistant's composer wrapped in a flowing aura. A prompt types itself, send flares the glow,
// the composer drops to the bottom and the reply streams in under a shimmer.

import { type Cx, type El, col, el, row, spacer } from "runex-js"

import { GLOW, PULSE, SHIMMER } from "../gfx.ts"
import { FAINT, H, MUTED, TEXT, W, c, ca, dot, ease, fx, pointer_at, pressed, sp, t, ta, track } from "../kit.ts"
import type { State } from "../main.ts"

const PROMPT = "make the settings page feel alive"
const TYPE_FROM = 0.3
const TYPE_RATE = 30.0
const SEND = 1.55

function chip(s: string, a: number): El {
  return row().h(32.0).px(14.0).radius(16.0).center().fill(ca(0xffffff, Math.fround(Math.fround(0.05) * a))).border(1.0, ca(0xffffff, Math.fround(Math.fround(0.08) * a))).child(ta(s, 13.0, 500.0, MUTED, a))
}

export function view(s: State, _: Cx): El {
  const t_ = s.t
  const n = Math.min(Math.trunc(Math.max((t_ - TYPE_FROM) * TYPE_RATE, 0.0)), PROMPT.length)
  const sent = t_ >= SEND
  const press = pressed(t_, SEND)
  const flare = sent ? Math.fround(Math.fround(1.6) * Math.fround(Math.exp(Math.fround(Math.fround(-(t_ - SEND)) * Math.fround(2.2))))) : 0.0
  const drop = track(t_, 0.0, [[SEND + 0.08, 1.0, sp(0.6, 0.12)]])
  const [cw, ch] = [640.0, 128.0]
  const cx0 = (W - cw) / 2.0
  const cy0 = Math.fround(214.0 + Math.fround((382.0 - 214.0) * drop))

  const caret_on = Math.trunc(t_ * 2.0) % 2 === 0 || n < PROMPT.length
  const typed = sent ? "" : PROMPT.slice(0, n)
  const field = row().gap(1.0).center_y()
    .child(typed === "" && !sent && n === 0 ? t("Ask anything…", 17.0, 400.0, FAINT) : t(typed, 17.0, 400.0, TEXT))
    .child(el().w(2.0).h(22.0).radius(1.0).fill(ca(0x9fd4ff, caret_on ? 1.0 : 0.0)))

  const send = el().size(36.0, 36.0).radius(18.0).scale(Math.fround(1.0 - Math.fround(Math.fround(0.12) * press))).fill(n > 0 ? c(0xf4f6fb) : ca(0xffffff, 0.15)).center().child(t("↑", 18.0, 600.0, 0x0b0b0d))
  const composer = col().key("composer").absolute(cx0, cy0).size(cw, ch).padding(20.0).radius(24.0).fill(c(0x131317)).border(1.0, ca(0xffffff, 0.1))
    .child(field)
    .child(spacer())
    .child(
      row().w_full().center_y().gap(8.0)
        .child(row().h(30.0).px(12.0).radius(15.0).center().gap(6.0).fill(ca(0xffffff, 0.06)).child(dot(0x54b3fd, 6.0)).child(t("Build", 12.5, 500.0, 0xc9c9d0)))
        .child(row().h(30.0).px(12.0).radius(15.0).center().fill(ca(0xffffff, 0.06)).child(t("opus", 12.5, 500.0, 0xc9c9d0)))
        .child(spacer())
        .child(send),
    )

  const greet = Math.fround(1.0 - ease(t_, SEND, 0.25))
  let root = el().w(W).h(H).fill(c(0x09090b))
    .child(col().key("greet").absolute(0.0, Math.fround(150.0 - Math.fround(20.0 * Math.fround(1.0 - greet)))).w(W).items_center().child(ta("What should we build?", 30.0, 600.0, TEXT, greet)))
    .child(
      row().key("chips").absolute(0.0, 214.0 + ch + 22.0).w(W).justify_center().gap(10.0)
        .child(chip("A springy toggle", greet))
        .child(chip("Liquid metal button", greet))
        .child(chip("Glass sidebar", greet)),
    )
    .child(fx(GLOW, [2.0, 3.0, Math.fround(1.0 + flare), 22.0]).key("aura").absolute(cx0, cy0).size(cw, ch).radius(24.0).effect_bleed(70.0))
    .child(composer)

  if (sent) {
    const k = track(t_, 0.0, [[SEND + 0.12, 1.0, sp(0.45, 0.25)]])
    const a = Math.min(Math.max(k, 0.0), 1.0)
    const bubble = row().h(42.0).px(16.0).radius(16.0).center().fill(ca(0x1f2633, a)).child(ta(PROMPT, 15.0, 400.0, 0xe6ecf7, a))
    root = root.child(row().key("bubble").absolute(0.0, Math.fround(58.0 + Math.fround(14.0 * Math.fround(1.0 - k)))).w(W - 160.0).justify_end().child(bubble))
    const r = ease(t_, SEND + 0.4, 0.3)
    let reply = col().key("reply").absolute(160.0, 132.0).w(640.0).gap(12.0)
      .child(
        row().gap(10.0).center_y()
          .child(el().size(Math.fround(10.0 * r), Math.fround(10.0 * r)).child(fx(PULSE, [1.0, 13.0, 1.2, 10.0]).absolute(0.0, 0.0).size(10.0, 10.0).radius(5.0).effect_bleed(16.0)).child(dot(0x54b3fd, 10.0).absolute(0.0, 0.0)))
          .child(ta("Thinking", 14.0, 500.0, MUTED, r)),
      )
    for (const [i, w] of [600.0, 540.0, 580.0, 360.0].entries()) {
      const k2 = ease(t_, SEND + 0.55 + i * 0.12, 0.25)
      reply = reply.child(
        el().w(Math.fround(w * Math.fround(Math.fround(0.6) + Math.fround(Math.fround(0.4) * k2)))).h(12.0).radius(6.0).fill(ca(0xffffff, Math.fround(Math.fround(0.07) * k2)))
          .child(fx(SHIMMER, [Math.fround(Math.fround(0.35) * k2), 1.3, 60.0, 0.0]).absolute(0.0, 0.0).w(Math.fround(w * Math.fround(Math.fround(0.6) + Math.fround(Math.fround(0.4) * k2)))).h(12.0).radius(6.0)),
      )
    }
    root = root.child(reply)
  }
  return root.child(pointer_at(t_, [760.0, 470.0], [[0.9, cx0 + cw - 38.0, 214.0 + ch - 38.0], [SEND + 0.25, 860.0, 520.0]], [SEND]))
}
