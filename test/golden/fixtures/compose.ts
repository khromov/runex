// Golden fixture: the compositor. One "hdr" compositor (runex-js/fx) draws a rune-fx glow under
// a marked card (`glow`), lights the window with rune-light, a point light over a raised card
// and an emissive chip (`light`), or draws nothing (`plain`). The trees match on every platform;
// the pixels are each platform's own (rune-light differs most between Metal and lavapipe).
//
//   bun test/golden/fixtures/compose.ts --snap compose.png --scene light

import { App, AppSpec, type Cx, type El, TextStyle, col, el, oklch, row, text, tok } from "runex-js"
import { type Compositor, type Frame, Fx, GlowParams, type Plan, Shape } from "runex-js/fx"
import { Light, Settings } from "runex-js/light"

type Scene = "plain" | "glow" | "light"
type State = { scene: Scene }

const CARD = 1
const CHIP = 2

function view(_: State, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  const card = col().key("card").mark(CARD).size(200.0, 120.0).padding(16.0).gap(6.0).radius(14.0).fill(t.card)
    .child(text("Composited card").font(TextStyle.new(15.0, 600.0)).color(t.text))
    .child(text("glow under it, or lit from above").font(TextStyle.new(11.0, 400.0)).color(t.text_secondary))
  const chip = el().key("chip").mark(CHIP).size(56.0, 56.0).radius(28.0).fill(oklch(0.75, 0.18, 40.0))
  return row().key("root").w_full().h_full().center().gap(40.0).fill(t.bg).child(card).child(chip)
}

class Gfx implements Compositor<State> {
  readonly pipeline = "hdr"

  render(f: Frame<State>): Plan {
    const [x, y, w, h] = f.presented("card")?.[0] ?? [0, 0, 0, 0]
    const [cx, cy, cw] = f.presented("chip")?.[0] ?? [0, 0, 0, 0]
    const s = f.env.scale
    switch (f.state.scene) {
      case "plain":
        return { animating: false }
      case "glow":
        return {
          layers: [{ layer: Fx.on(Fx.glow(GlowParams.default()), Shape.rounded(x, y, w, h, 14.0)).at(f.t), at: { under: CARD } }],
          animating: false,
        }
      case "light":
        return {
          routes: [{ match: [0, 0], lit: true }],
          lighting: {
            lights: [Light.point((x + w / 2) * s, (y - 60.0) * s, 260.0 * s).intensity(3.0)],
            settings: new Settings(),
            alpha: 1.0,
            at: "top",
            prims: [
              { match: CARD, style: { raised: 6.0 * s, bevel: [6.0 * s, 2.0 * s], gloss: [0.5, 0.4] } },
              { match: CHIP, style: { on: 6.0 * s, emissive: 2.0 } },
            ],
          },
          animating: false,
        }
    }
  }
}

App.new<State>({
  ...AppSpec.new<State>("Golden compose", [520.0, 260.0], () => ({ scene: "plain" }), view),
  scenes: [
    ["plain", (s: State) => { s.scene = "plain" }],
    ["glow", (s: State) => { s.scene = "glow" }],
    ["light", (s: State) => { s.scene = "light" }],
  ],
}).compositor(new Gfx()).run()
