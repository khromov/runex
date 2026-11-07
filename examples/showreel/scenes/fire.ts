// Friday, 4:58 PM. A release card with a Ship it button; pressing it sets the card on fire
// (simulated flames and embers off its top edge, heat haze above).

import { type Cx, type El, col, el, row, spacer } from "runex-js"

import { FIRE, GLOW, HAZE } from "../gfx.ts"
import { BG, FAINT, H, MUTED, TEXT, W, avatar, c, ca, ease, fx, hair, mono, pointer_at, pressed, t } from "../kit.ts"
import type { State } from "../main.ts"

const TAP = 0.95

function channel(name: string, on: boolean): El {
  return row().w_full().h(30.0).px(12.0).radius(8.0).center_y().gap(8.0)
    .fill(on ? ca(0xffffff, 0.07) : ca(0, 0.0))
    .child(t("#", 14.0, 500.0, FAINT))
    .child(t(name, 13.5, on ? 600.0 : 450.0, on ? TEXT : MUTED))
}

function msg(who: number, name: string, time: string, body: string): El {
  return row().w_full().gap(12.0)
    .child(avatar("", who, 30.0))
    .child(col().gap(4.0).child(row().gap(8.0).center_y().child(t(name, 13.5, 600.0, TEXT)).child(t(time, 12.0, 400.0, FAINT))).child(t(body, 13.5, 400.0, 0xc9c9d0)))
}

export function view(s: State, _: Cx): El {
  const t_ = s.t
  const press = pressed(t_, TAP)
  const blaze = ease(t_, TAP, 0.5)
  const flame = Math.fround(Math.fround(0.18) + Math.fround(1.25 * blaze))

  let side = col().w(220.0).h(H).px(12.0).pt(22.0).gap(2.0).fill(c(0x101013)).border(1.0, hair())
  side = side.child(row().px(12.0).pb(16.0).gap(10.0).center_y().child(el().size(22.0, 22.0).radius(6.0).fill(c(0xff7a1a))).child(t("Anomaly", 14.0, 600.0, TEXT)))
  for (const [i, ch] of ["general", "releases", "incidents", "design", "random"].entries()) {
    side = side.child(channel(ch, i === 1))
  }

  const cx0 = 220.0 + (W - 220.0 - 460.0) / 2.0
  const cy0 = 250.0
  const card = col().absolute(cx0, cy0).w(460.0).h(220.0).padding(24.0).gap(10.0).radius(18.0).fill(c(0x1c1b1f)).border(1.0, ca(0xffffff, 0.09))
    .shadow(18.0, 40.0, ca(0x000000, 0.5))
    .child(row().gap(10.0).center_y().child(t("Release", 12.0, 600.0, 0xff9a5a)).child(spacer()).child(mono("v2.0.0", 12.0, MUTED)))
    .child(t("Ship v2.0 to production", 22.0, 600.0, TEXT))
    .child(t("Friday · 4:58 PM · 214 files changed", 13.5, 400.0, MUTED))
    .child(spacer())
    .child(
      row().w_full().gap(10.0)
        .child(spacer())
        .child(row().h(38.0).px(18.0).radius(10.0).center().fill(ca(0xffffff, 0.06)).child(t("Not today", 13.5, 500.0, MUTED)))
        .child(
          row().h(38.0).px(20.0).radius(10.0).center().scale(Math.fround(1.0 - Math.fround(Math.fround(0.07) * press))).fill(c(0xff5a1f))
            .child(t(t_ >= TAP ? "Shipping…" : "Ship it", 13.5, 600.0, 0xffffff)),
        ),
    )

  const thread = col().absolute(220.0 + 40.0, 40.0).w(W - 300.0).gap(18.0)
    .child(msg(0x7c5cff, "mira", "4:51 PM", "all green on dev, release notes are in"))
    .child(msg(0x34d399, "kai", "4:55 PM", "it's friday. it's 4:55. are we sure"))
    .child(msg(0xff7a1a, "ode", "4:57 PM", "rune renders it at 120 Hz, what could go wrong"))

  return el().w(W).h(H).fill(c(BG))
    .child(side.absolute(0.0, 0.0))
    .child(thread)
    .child(fx(GLOW, [0.0, 8.0, Math.fround(0.25 + Math.fround(Math.fround(0.9) * blaze)), 30.0]).absolute(cx0, cy0).size(460.0, 220.0).radius(18.0).effect_bleed(80.0))
    .child(fx(FIRE, [Math.fround(64.0 + Math.fround(70.0 * blaze)), flame, 0.0, 0.6]).absolute(cx0, cy0).size(460.0, 220.0).radius(18.0).effect_bleed(200.0))
    .child(card)
    .child(fx(HAZE, [150.0, Math.fround(Math.fround(1.6) * blaze), 0.0, 0.0]).effect_backdrop(true).absolute(cx0 - 10.0, cy0 - 170.0).size(480.0, 180.0))
    .child(pointer_at(t_, [700.0, 520.0], [[0.25, cx0 + 400.0, cy0 + 182.0]], [TAP]))
}
