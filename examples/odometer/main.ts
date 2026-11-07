// A count and a right-aligned run time as `RollingText` odometers. "Up" and "Down" step the
// number: changed digits roll up as it rises and down as it falls, and "9s" → "10s" grows the
// time to the left with every digit in its column. Below, header rows with a long title that
// truncates and a usage group (context and cost) on the right: "Step" and "Big step" add spend,
// so the cost gains a digit and the token count changes length. The usage group slides on a
// width-leading spring in the first two headers and on the labels' own spring in the third.
// `bun examples/odometer/main.ts`; the motion audit records it with
// `scripts/motion-audit/scenarios/odometer.json`.

import { AppSpec, type Cx, type El, Spring, TextStyle, col, el, row, run, spacer, text } from "runex-js"
import { Button, Kit, RollingText } from "runex-js/kit"

type State = {
  n: number
  cents: number
  tokens: number
}

/** The header numbers' roll and slide: quick, with no overshoot. */
const USAGE: Spring = Spring.new(0.3, 0.0)

/**
 * Rust's `format!("{:.1}", x)`: the exact value rounded to one decimal, an exact tie (x.25,
 * x.75) to the even digit. `toFixed(1)` rounds those ties up.
 */
function fixed1(x: number): string {
  const q = x * 4.0 // exact
  if (!Number.isInteger(q) || q % 2 === 0) return x.toFixed(1)
  const a = Math.abs(x)
  const lo = Math.floor(a * 10.0)
  const tenths = lo % 2 === 0 ? lo : lo + 1
  return (x < 0 ? "-" : "") + (tenths / 10.0).toFixed(1)
}

function tokens_short(n: number): string {
  return n >= 1_000 ? `${fixed1(n / 1e3)}K` : String(n)
}

/** A long title that truncates, and a usage group: a ring, the context and the cost. */
function header(k: Kit, s: State, name: string, trailing_cost: boolean, leads: boolean): El {
  const font = TextStyle.new(12.0, 440.0).lh(16.0).features("'tnum' 1")
  const label = (key: string, t: string, v: number, trailing: boolean) => {
    const l = RollingText.new(key, t).value(v).font(font).color(k.c.text_weak).spring(USAGE)
    return (trailing ? l.trailing() : l).build(k)
  }
  let usage = row().key(`${name}-usage`).gap(6.0).center_y().motion(USAGE)
  if (leads) {
    usage = usage.width_leads()
  }
  const cents = `$${Math.trunc(s.cents / 100)}.${String(s.cents % 100).padStart(2, "0")}`
  usage = usage
    .child(el().size(14.0, 14.0).radius(7.0).border(2.0, k.c.border_base))
    .child(label(`${name}-ctx`, tokens_short(s.tokens), s.tokens, true))
    .child(label(`${name}-cost`, cents, s.cents, trailing_cost))
  return row()
    .key(name)
    .w(300.0)
    .h(32.0)
    .px(10.0)
    .gap(8.0)
    .center_y()
    .fill(k.c.bg_deep)
    .child(row().key(`${name}-crumbs`).center_y().shrink().child(text("Refactor the session list so pinned rows keep their place").font(TextStyle.new(13.0, 530.0)).truncate()))
    .child(spacer())
    .child(usage)
}

function view(s: State, _: Cx): El {
  const k = Kit.neutral(true)
  const big = TextStyle.new(28.0, 600.0).mono()
  const count = RollingText.new("count", String(s.n)).value(s.n).font(big).build(k)
  const time = RollingText.new("secs", `${s.n}s`).value(s.n).font(k.ty.mono).trailing().build(k)
  const button = (label: string, key: string, f: (s: State) => void) => Button.new(label).on_press(f).build(k).key(key)
  return col()
    .w_full()
    .h_full()
    .padding(24.0)
    .gap(16.0)
    .fill(k.c.bg_base)
    .child(
      row()
        .gap(8.0)
        .child(button("Up", "up", (s) => { s.n += 1 }))
        .child(button("Down", "down", (s) => { s.n -= 1 }))
        .child(button("Step", "step", (s) => {
          s.cents += 7
          s.tokens += 1_400
        }))
        .child(button("Big step", "big", (s) => {
          s.cents += 996
          s.tokens += 98_000
        })),
    )
    .child(count)
    .child(row().w(160.0).justify_end().motion(RollingText.SPRING).child(time))
    .child(header(k, s, "head", true, true))
    .child(header(k, s, "head-lead", false, true))
    .child(header(k, s, "head-plain", true, false))
}

run(AppSpec.new<State>("Odometer", [420.0, 360.0], () => ({ n: 9, cents: 42, tokens: 12_345 }), view))
