// A deploy dashboard whose Deploy button is liquid metal. The pointer comes in, presses it, a new
// deployment springs into the list, builds and goes live.

import { type Cx, type El, Transition, col, el, row, spacer } from "runex-js"

import { CHROME, GLOW, PULSE, SHIMMER, SPARKLES } from "../gfx.ts"
import { BG, FAINT, MUTED, PANEL, TEXT, avatar, c, ca, dot, ease, fx, hair, mono, pointer_at, pressed, sp, t, track } from "../kit.ts"
import type { State } from "../main.ts"

/** The toolbar's Deploy, then the confirm sheet's. */
const TAP = 0.7
const CONFIRM = 1.6
const DISMISS = 2.3
const INSERT = 2.4
const READY = 3.4

const ROWS: [string, string, string, string, number][] = [
  ["overlay: motion started while hidden plays on show", "f6d096b", "38s", "12m", 0x7c5cff],
  ["text: a span keeps the paragraph's leading ratio", "4112cac", "41s", "1h", 0xff7a1a],
  ["text: snap the pen to 1/256 px before flooring", "bac9e90", "40s", "2h", 0x34d399],
  ["rune-mermaid: hover settings keep their style", "c83aa06", "44s", "3h", 0x54b3fd],
  ["fx: frosted glass reads a blurred backdrop", "9e1d4b2", "39s", "5h", 0xff5ca8],
]

function status(label: string, color: number, pulse: number | null): El {
  let d = el().size(8.0, 8.0)
  if (pulse !== null) {
    const p = pulse
    d = d.child(fx(PULSE, [1.0, p, 1.2, 9.0]).absolute(0.0, 0.0).size(8.0, 8.0).radius(4.0).effect_bleed(14.0))
  }
  d = d.child(dot(color, 8.0).absolute(0.0, 0.0))
  return row().w(118.0).gap(9.0).center_y().child(d).child(t(label, 13.0, 500.0, TEXT))
}

function list_row(msg: string, sha: string, dur: string, ago: string, who: number, st: El, extra: El | null): El {
  let info = col().gap(5.0).child(t(msg, 13.5, 500.0, TEXT)).child(
    row().gap(8.0).center_y().child(
      el().px(6.0).py(1.0).radius(5.0).fill(ca(0xffffff, 0.06)).child(mono("dev", 11.0, MUTED)),
    )
      .child(mono(sha, 11.0, FAINT)),
  )
  if (extra !== null) {
    const e = extra
    info = info.child(e)
  }
  return row().key(`row-${sha}`)
    .w_full()
    .h(62.0)
    .px(20.0)
    .center_y()
    .child(st)
    .child(info.grow(1.0))
    .child(t(dur, 13.0, 400.0, MUTED).w(60.0))
    .child(t(ago, 13.0, 400.0, MUTED).w(54.0))
    .child(avatar("", who, 22.0))
}

export function view(s: State, _: Cx): El {
  const t_ = s.t
  const hover = track(t_, 0.0, [[0.5, 1.0, sp(0.35, 0.3)]])
  const press = pressed(t_, TAP)
  const scale = Math.fround(
    Math.fround(1.0 + Math.fround(Math.fround(0.05) * hover)) - Math.fround(Math.fround(0.08) * press),
  )
  const flow = Math.fround(
    1.0 + Math.fround(
      Math.fround(1.2) *
        (t_ > TAP ? Math.fround(Math.exp(Math.fround(Math.fround(-(t_ - TAP)) * 1.5))) : 0.0),
    ),
  )

  // The Deploy button: liquid metal under the label, a soft glow while hovered.
  const button = el().key("deploy")
    .size(132.0, 40.0)
    .radius(20.0)
    .scale(scale)
    .child(fx(GLOW, [0.0, 0.0, Math.fround(Math.fround(0.22) * hover), 12.0]).absolute(0.0, 0.0).size(132.0, 40.0).radius(20.0).effect_bleed(40.0))
    .child(fx(CHROME, [5.0, 0.0, flow, 0.0]).absolute(0.0, 0.0).size(132.0, 40.0).radius(20.0))
    .child(row().absolute(0.0, 0.0).size(132.0, 40.0).center().child(t("Deploy", 15.0, 600.0, 0x0e0f12)))

  const logo = el().size(26.0, 26.0).radius(7.0).linear_gradient(2.3, [[0.0, c(0x54b3fd)], [1.0, c(0x3d6bff)]])
  const top = row().w_full()
    .h(64.0)
    .px(24.0)
    .center_y()
    .gap(12.0)
    .child(logo)
    .child(t("anomaly", 14.0, 500.0, MUTED))
    .child(t("/", 14.0, 400.0, FAINT))
    .child(t("rune", 14.0, 600.0, TEXT))
    .child(
      row().ml(6.0).px(10.0).py(4.0).gap(6.0).radius(10.0).center_y().fill(ca(0x34d399, 0.12))
        .child(dot(0x34d399, 6.0))
        .child(t("Production", 12.0, 500.0, 0x6ee7b7)),
    )
    .child(spacer())
    .child(row().child(avatar("", 0xff7a1a, 26.0).border(2.0, c(BG))).child(avatar("", 0x7c5cff, 26.0).border(2.0, c(BG)).ml(-7.0)).child(avatar("", 0x34d399, 26.0).border(2.0, c(BG)).ml(-7.0)))
    .child(el().w(10.0))
    .child(button)

  const tabs = ["Overview", "Deployments", "Analytics", "Logs", "Storage", "Settings"]
  let tab_row = row().w_full().h(42.0).px(24.0).gap(26.0).center_y()
  tabs.forEach((name, i) => {
    const on = i === 1
    tab_row = tab_row.child(
      col().h(42.0).justify_center().child(t(name, 13.5, on ? 600.0 : 450.0, on ? TEXT : MUTED)).child(
        el().absolute(0.0, 40.0).h(2.0).w_full().fill(on ? c(TEXT) : ca(0, 0.0)),
      ),
    )
  })

  // The new deployment springs in at the top of the list once Deploy is pressed.
  const grow = track(t_, 0.0, [[INSERT, 1.0, sp(0.5, 0.18)]])
  const ready = t_ >= READY
  let list = col().w_full().radius(14.0).fill(c(PANEL)).border(1.0, hair()).clip_rounded(14.0)
  if (grow > Math.fround(0.001)) {
    const progress = ease(t_, INSERT + 0.1, READY - INSERT - 0.15)
    const fade = Math.fround(1.0 - ease(t_, READY, 0.3))
    const bar = el().mt(4.0).w(260.0).h(3.0).radius(2.0).fill(ca(0xffffff, Math.fround(Math.fround(0.08) * fade))).child(
      el().absolute(0.0, 0.0).h(3.0).w(Math.fround(260.0 * progress)).radius(2.0).fill(ca(0xffb547, fade))
        .child(fx(SHIMMER, [Math.fround(0.5 * fade), 0.9, 40.0, 0.0]).absolute(0.0, 0.0).h(3.0).w(Math.fround(260.0 * progress)).radius(2.0)),
    )
    const st = ready ? status("Ready", 0x34d399, 4) : status("Building", 0xffb547, 5)
    const fresh = list_row("README: a 30 second showcase, cut from real renders", "ba5b054", ready ? "1m 39s" : "…", "now", 0x54b3fd, st, bar)
    list = list.child(
      el().key("fresh").w_full().h(Math.fround(Math.fround(62.0 * grow) + Math.fround(9.0 * grow))).clip_rounded(0.0).child(
        el().absolute(0.0, Math.fround(-62.0 * Math.fround(1.0 - grow))).w_full().fill(ca(
          0xffffff,
          Math.fround(Math.fround(0.025) + Math.fround(Math.fround(0.03) * Math.fround(1.0 - ease(t_, READY, 0.8)))),
        )).child(fresh),
      ),
    )
  }
  ROWS.forEach(([msg, sha, dur, ago, who], i) => {
    if (i > 0 || grow > Math.fround(0.001)) {
      list = list.child(el().key(`sep-${i}`).w_full().h(1.0).fill(hair()))
    }
    list = list.child(list_row(msg, sha, dur, ago, who, status("Ready", 0x34d399, null), null))
  })

  const header = row().w_full().items_end().child(
    col().gap(6.0).child(t("Deployments", 26.0, 600.0, TEXT)).child(t("Every push to dev ships to production.", 13.5, 400.0, MUTED)),
  )
    .child(spacer())
    .child(row().w(230.0).h(36.0).px(12.0).radius(10.0).center_y().fill(c(PANEL)).border(1.0, hair()).child(t("Search deployments…", 13.0, 400.0, FAINT)))
    .child(el().w(10.0))
    .child(row().h(36.0).px(14.0).radius(10.0).center_y().fill(c(PANEL)).border(1.0, hair()).child(t("All environments", 13.0, 500.0, MUTED)))

  const page = col().w(960.0).h(540.0).fill(c(BG))
    .child(top)
    .child(tab_row)
    .child(el().w_full().h(1.0).fill(hair()))
    .child(col().w_full().px(32.0).pt(26.0).gap(20.0).child(header).child(list))

  // The confirm sheet: a big liquid-metal button, centred, over the dimmed page.
  const dim = Math.fround(ease(t_, TAP + 0.05, 0.3) * Math.fround(1.0 - ease(t_, DISMISS, 0.3)))
  let root = el().w(960.0).h(540.0)
    .child(page.absolute(0.0, 0.0))
    .child(el().key("dim").absolute(0.0, 0.0).size(960.0, 540.0).backdrop_blur(Math.fround(10.0 * dim)).fill(ca(0x000000, Math.fround(Math.fround(0.68) * dim))))
  if (t_ >= TAP + 0.05 && t_ < DISMISS) {
    const press2 = pressed(t_, CONFIRM)
    const flow2 = Math.fround(
      1.0 + Math.fround(
        Math.fround(1.8) *
          (t_ > CONFIRM ? Math.fround(Math.exp(Math.fround(Math.fround(-(t_ - CONFIRM)) * Math.fround(1.6)))) : 0.0),
      ),
    )
    const [bw, bh] = [372.0, 58.0]
    const big = el().size(bw, bh).radius(bh / 2.0).scale(Math.fround(1.0 - Math.fround(Math.fround(0.06) * press2)))
      .child(fx(CHROME, [5.0, 0.0, flow2, 0.0]).absolute(0.0, 0.0).size(bw, bh).radius(bh / 2.0))
      .child(row().absolute(0.0, 0.0).size(bw, bh).center().child(t("Deploy", 18.0, 600.0, 0x0e0f12)))
      .child(fx(SPARKLES, [Math.fround(Math.fround(CONFIRM) + Math.fround(0.06)), 14.0, 11.0, 0.0]).absolute(0.0, 0.0).size(bw, bh).radius(bh / 2.0).effect_bleed(60.0))
    const sheet = col().key("sheet").absolute(264.0, 150.0).w(432.0).padding(30.0).gap(8.0).radius(24.0)
      .fill(c(0x151518)).border(1.0, ca(0xffffff, 0.1)).shadow(24.0, 60.0, ca(0x000000, 0.6))
      .transition(Transition.scale(0.9).combined(Transition.opacity()))
      .child(row().gap(10.0).center_y().child(dot(0x34d399, 8.0)).child(t("Production", 12.5, 600.0, 0x6ee7b7)))
      .child(t("Deploy rune to production?", 21.0, 600.0, TEXT))
      .child(row().gap(8.0).center_y().child(mono("dev", 12.0, MUTED)).child(t("·", 12.0, 400.0, FAINT)).child(mono("ba5b054", 12.0, MUTED)).child(t("·", 12.0, 400.0, FAINT)).child(t("README: a 30 second showcase", 13.0, 400.0, MUTED)))
      .child(el().h(18.0))
      .child(big)
    root = root.child(sheet)
  }
  return root.child(pointer_at(t_, [560.0, 420.0], [[0.12, 861.0, 33.0], [1.0, 500.0, 333.0]], [TAP, CONFIRM]))
}
