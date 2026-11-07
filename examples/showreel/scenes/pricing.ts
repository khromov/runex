// A pricing page. The Pro card hums with a charged border; hovering charges it up, and Upgrade
// throws an electric border round it with a burst of sparks.

import { type Cx, type El, col, el, row, spacer } from "runex-js"

import { ELECTRIC, GLOW, SPARKLES } from "../gfx.ts"
import { H, MUTED, TEXT, W, c, ca, dot, ease, fx, hair, pointer_at, pressed, sp, t, track } from "../kit.ts"
import type { State } from "../main.ts"

const HOVER = 0.55
const TAP = 1.25

function feature(s: string, on: boolean): El {
  return row().gap(10.0).center_y()
    .child(el().size(16.0, 16.0).radius(8.0).center().fill(on ? ca(0x54b3fd, 0.18) : ca(0xffffff, 0.06)).child(dot(on ? 0x54b3fd : 0x8a8a93, 5.0)))
    .child(t(s, 13.5, 400.0, 0xc9c9d0))
}

function plan(name: string, price: string, blurb: string, feats: [string, string, string, string], cta: string, pro: boolean, press: number): El {
  let c_ = col().w(268.0).h(318.0).padding(24.0).gap(8.0).radius(20.0)
    .fill(pro ? c(0x16181f) : c(0x121215))
    .border(1.0, pro ? ca(0x54b3fd, 0.35) : hair())
    .child(row().w_full().center_y().child(t(name, 15.0, 600.0, TEXT)).child(spacer()).child(
      pro
        ? el().px(8.0).py(3.0).radius(8.0).fill(ca(0x54b3fd, 0.16)).child(t("Popular", 11.5, 600.0, 0x8fd0ff))
        : el(),
    ))
    .child(row().mt(6.0).items_end().gap(4.0).child(t(price, 40.0, 600.0, TEXT)).child(t("/mo", 14.0, 500.0, MUTED).mb(8.0)))
    .child(t(blurb, 13.0, 400.0, MUTED).mb(10.0))
  for (const [i, f] of feats.entries()) {
    c_ = c_.child(feature(f, pro || i < 2))
  }
  return c_.child(spacer()).child(
    row().w_full().h(40.0).radius(11.0).center().scale(Math.fround(1.0 - Math.fround(Math.fround(0.06) * press)))
      .fill(pro ? c(0xeef4ff) : ca(0xffffff, 0.07))
      .child(t(cta, 14.0, 600.0, pro ? 0x0e1320 : TEXT)),
  )
}

export function view(s: State, _: Cx): El {
  const t_ = s.t
  const hover = ease(t_, HOVER, 0.35)
  const hit = ease(t_, TAP, 0.08)
  const press = pressed(t_, TAP)
  const x0 = (W - 3.0 * 268.0 - 2.0 * 22.0) / 2.0
  const y0 = 176.0
  const px_ = x0 + 268.0 + 22.0
  const lift = track(t_, 0.0, [[HOVER, 1.0, sp(0.45, 0.3)]])

  const header = col().absolute(0.0, 54.0).w(W).items_center().gap(10.0)
    .child(t("PRICING", 12.0, 600.0, 0x54b3fd))
    .child(t("Plans that scale with you", 32.0, 600.0, TEXT))
    .child(t("Start free. Upgrade when your team needs more.", 15.0, 400.0, MUTED))

  const pro_y = Math.fround(y0 - Math.fround(8.0 * lift))
  return el().w(W).h(H).fill(c(0x0a0a0c))
    .child(header)
    .child(plan("Hobby", "$0", "For side projects and prototypes.", ["One project", "Preview deploys", "Community support", "Analytics"], "Get started", false, 0.0).absolute(x0, y0))
    .child(plan("Team", "$60", "For studios shipping together.", ["Unlimited projects", "SSO and audit log", "Analytics", "Priority support"], "Contact us", false, 0.0).absolute(x0 + 2.0 * (268.0 + 22.0), y0))
    .child(fx(GLOW, [1.0, 13.0, Math.fround(Math.fround(Math.fround(0.35) + Math.fround(0.5 * hover)) + Math.fround(Math.fround(0.8) * hit)), 22.0]).absolute(px_, pro_y).size(268.0, 318.0).radius(20.0).effect_bleed(60.0))
    .child(plan("Pro", "$20", "For apps people use every day.", ["Unlimited projects", "Custom domains", "Team analytics", "Priority builds"], "Upgrade", true, press).absolute(px_, pro_y))
    .child(fx(ELECTRIC, [Math.fround(Math.fround(0.5 + Math.fround(Math.fround(0.7) * hover)) + Math.fround(Math.fround(0.4) * hit)), t_ >= TAP ? 6.0 : 0.0, t_ >= TAP ? 0.0 : 1.0, 13.0]).absolute(px_, pro_y).size(268.0, 318.0).radius(20.0).effect_bleed(40.0))
    .child(fx(SPARKLES, [Math.fround(Math.fround(TAP) + Math.fround(0.05)), 14.0, 10.0, 13.0]).absolute(Math.fround(px_ + 24.0), Math.fround(pro_y + 254.0)).size(220.0, 40.0).radius(11.0).effect_bleed(60.0))
    .child(pointer_at(t_, [960.0, 560.0], [[0.12, Math.fround(px_ + 180.0), Math.fround(pro_y + 140.0)], [0.75, Math.fround(px_ + 140.0), Math.fround(y0 + 272.0)]], [TAP]))
}
