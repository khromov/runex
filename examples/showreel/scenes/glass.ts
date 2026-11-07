// Now playing: the cover is a live mesh gradient under a huge title and a moving waveform. A
// slab of fluted glass slides in over all of it and the queue settles onto the glass.

import { type Cx, type El, col, el, row, spacer } from "runex-js"

import { FLUTED, MESH } from "../gfx.ts"
import { H, W, c, ca, ease, fx, mono, mono_a, sp, t, ta, track } from "../kit.ts"
import type { State } from "../main.ts"

const QUEUE: [string, string, string, number][] = [
  ["Low Light", "Kaito Hayes", "3:41", 7],
  ["Glass Hours", "Mira Sol", "4:02", 1],
  ["Afterimage", "Sunday Static", "2:57", 5],
  ["Paper Moons", "Kaito Hayes", "3:18", 4],
  ["Slow Signal", "Ode Park", "5:06", 6],
]

export function view(s: State, _: Cx): El {
  const t_ = s.t
  let root = el().w(W).h(H).fill(c(0x120a1e))
  root = root.child(fx(MESH, [7.0, 0.55, 3.0, 0.22]).absolute(0.0, 0.0).size(W, H))

  // A waveform across the whole width, so the glass has something moving behind it.
  let wave = row().absolute(40.0, 400.0).w(W - 40.0).h(80.0).gap(4.0).items_end()
  for (let i = 0; i < 112; i++) {
    const x = i
    const a = Math.fround(Math.fround(x * Math.fround(0.37)) + Math.fround(Math.fround(t_) * Math.fround(5.1)))
    const b = Math.fround(Math.fround(x * Math.fround(0.11)) - Math.fround(Math.fround(t_) * Math.fround(2.3)))
    const h = Math.fround(
      10.0 + Math.fround(
        Math.fround(34.0 * Math.fround(0.5 + Math.fround(0.5 * Math.fround(Math.sin(a))))) *
          Math.fround(Math.fround(0.55) + Math.fround(Math.fround(0.45) * Math.abs(Math.fround(Math.sin(b))))),
      ),
    )
    wave = wave.child(el().w(4.0).h(h).radius(2.0).fill(ca(0xffffff, x < 44.0 ? 0.85 : 0.5)))
  }
  root = root.child(wave)

  const title = col().absolute(48.0, 120.0)
    .gap(6.0)
    .child(ta("NOW PLAYING", 12.0, 600.0, 0xffffff, 0.75))
    .child(t("Night Drive", 128.0, 600.0, 0xffffff))
    .child(ta("Kaito Hayes · Low Light Sessions", 20.0, 500.0, 0xffffff, 0.8))
  root = root.child(title)

  const progress = Math.fround(Math.fround(0.38) + Math.fround(Math.fround(0.02) * Math.fround(t_)))
  root = root.child(
    row().absolute(48.0, 496.0).w(470.0).gap(12.0).center_y()
      .child(mono("1:42", 12.0, 0xffffff))
      .child(el().w(380.0).h(4.0).radius(2.0).fill(ca(0xffffff, 0.25)).child(el().absolute(0.0, 0.0).h(4.0).w(Math.fround(380.0 * progress)).radius(2.0).fill(c(0xffffff))))
      .child(mono("3:58", 12.0, 0xffffff)),
  )

  // The slab slides in from the right edge on a spring.
  const x = track(t_, W + 10.0, [[0.35, 548.0, sp(0.95, 0.12)]])
  const gw = W - 548.0
  let queue = col().absolute(x, 0.0).w(gw).h(H).pt(54.0).px(34.0).gap(4.0)
  const head = ease(t_, 0.95, 0.4)
  queue = queue.child(
    row().w_full().mb(14.0).offset(0.0, Math.fround(10.0 * Math.fround(1.0 - head)))
      .child(ta("Up next", 22.0, 600.0, 0xffffff, head))
      .child(spacer())
      .child(ta("Shuffle", 13.0, 500.0, 0xffffff, Math.fround(Math.fround(0.7) * head))),
  )
  QUEUE.forEach(([name, artist, dur, pal], i) => {
    const k = track(t_, 0.0, [[1.05 + i * 0.07, 1.0, sp(0.5, 0.2)]])
    const kc = Math.min(Math.max(k, 0.0), 1.0)
    queue = queue.child(
      row().w_full().h(68.0).gap(14.0).center_y().offset(Math.fround(24.0 * Math.fround(1.0 - k)), 0.0)
        .child(fx(MESH, [pal, 0.4, i + 5.0, 0.0]).size(Math.fround(48.0 * kc), Math.fround(48.0 * kc)).radius(10.0))
        .child(col().gap(4.0).grow(1.0).child(ta(name, 15.0, 600.0, 0xffffff, k)).child(ta(artist, 13.0, 400.0, 0xffffff, Math.fround(Math.fround(0.7) * k))))
        .child(mono_a(dur, 12.0, 0xffffff, Math.fround(Math.fround(0.8) * k))),
    )
  })
  return root.child(fx(FLUTED, [18.0, 16.0, 0.12, 0.3]).effect_backdrop(true).absolute(x, 0.0).size(gw + 10.0, H))
    .child(el().absolute(x, 0.0).w(1.0).h(H).fill(ca(0xffffff, 0.35)))
    .child(queue)
}
