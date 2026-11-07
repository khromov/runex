// A feed scrolling under a floating liquid-glass tab bar. The selection is a drop of the same
// glass that slides between tabs and bulges out of the bar as it goes.

import { type Cx, type El, col, el, row } from "runex-js"

import { LENS, MESH } from "../gfx.ts"
import { H, MUTED, TEXT, W, c, fx, sp, t, track } from "../kit.ts"
import type { State } from "../main.ts"

const STORIES: [string, string, number][] = [
  ["Kyoto after rain", "Photo essay · 12 min", 1],
  ["The quiet studio", "Design · 6 min", 7],
  ["Night markets", "Travel · 9 min", 5],
  ["Ferry to Naoshima", "Photo essay · 8 min", 4],
  ["Paper and light", "Craft · 5 min", 2],
  ["Cold coast", "Travel · 11 min", 6],
]

function story(title: string, meta: string, pal: number, w: number, h: number, seed: number): El {
  return col().w(w).gap(10.0)
    .child(fx(MESH, [pal, 0.5, seed, 0.25]).w(w).h(h).radius(18.0))
    .child(t(title, 17.0, 600.0, TEXT))
    .child(t(meta, 13.0, 400.0, MUTED))
}

export function view(s: State, _: Cx): El {
  const t_ = s.t
  // The feed scrolls on its own, with a flick a second in.
  const scroll = Math.fround(Math.fround(50.0 * Math.fround(t_)) + track(t_, 0.0, [[0.9, 260.0, sp(1.1, 0.0)]]))
  let feed = col().absolute(40.0, Math.fround(30.0 - scroll)).w(W - 80.0).gap(28.0)
    .child(col().gap(4.0).child(t("Today", 30.0, 600.0, TEXT)).child(t("Friday, November 6", 14.0, 500.0, MUTED)))
    .child(story("Glass, light and the long weekend", "Featured · 14 min", 0, W - 80.0, 300.0, 1.0))
  for (let start = 0; start < STORIES.length; start += 3) {
    const pair = STORIES.slice(start, start + 3)
    let r = row().gap(20.0)
    for (const [i, [title, meta, pal]] of pair.entries()) {
      r = r.child(story(title, meta, pal, Math.fround((W - 80.0 - 40.0) / 3.0), 180.0, 10.0 + i + pal))
    }
    feed = feed.child(r)
  }

  // The bar and its selection drop.
  const [bw, bh] = [400.0, 64.0]
  const [bx, by] = [(W - bw) / 2.0, H - bh - 26.0]
  const tabs = ["Today", "Search", "Saved", "Profile"]
  const slot = bw / 4.0
  const sel = track(t_, 0.0, [[0.55, 2.0, sp(0.7, 0.28)], [1.75, 1.0, sp(0.6, 0.3)]])
  const sx = Math.fround(bx + Math.fround(slot * Math.fround(sel + 0.5)))
  let root = el().w(W).h(H).fill(c(0x0b0b0d)).child(feed)
    .child(fx(LENS, [sx, by + bh / 2.0, 42.0, 0.2]).effect_backdrop(true).absolute(bx, by).size(bw, bh).radius(bh / 2.0))
    .child(fx(LENS, [0.0, 0.0, 0.0, 0.25]).effect_backdrop(true).absolute(bx + bw + 16.0, by).size(bh, bh).radius(bh / 2.0))
  for (const [i, name] of tabs.entries()) {
    const on = Math.abs(Math.fround(sel - i)) < 0.5
    root = root.child(row().absolute(bx + slot * i, by).size(slot, bh).center().child(t(name, 13.5, 600.0, on ? 0xffffff : 0xd8d8de)))
  }
  return root.child(row().absolute(bx + bw + 16.0, by).size(bh, bh).center().child(t("+", 26.0, 400.0, 0xffffff)))
}
