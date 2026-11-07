// Showreel: purpose-made 960×540 scenes for Rune's showcase video. Each scene animates itself from
// the (virtual) clock, so a headless `--video` run records it frame-exact:
//
//     bun examples/showreel/main.ts --scene deploy --video deploy.mp4 --size 960x540 --scale 2 --duration 4

import { readFileSync } from "node:fs"
import { App, AppSpec, type Cx, type El } from "runex-js"
import { Gfx } from "./gfx.ts"
import * as scenes from "./scenes/mod.ts"

export type Scene =
  | "Word"
  | "Card"
  | "Deploy"
  | "Glass"
  | "Fire"
  | "Pricing"
  | "Ask"
  | "Shock"
  | "Keys"
  | "Tabs"
  | "Type"

export type State = {
  scene: Scene
  /** Seconds since the scene started (Rune's virtual clock when headless). */
  t: number
}

const State = {
  default(): State {
    return { scene: "Word", t: 0.0 }
  },
}

function view(s: State, cx: Cx): El {
  switch (s.scene) {
    case "Word": return scenes.word.view(s, cx, false)
    case "Card": return scenes.word.view(s, cx, true)
    case "Deploy": return scenes.deploy.view(s, cx)
    case "Glass": return scenes.glass.view(s, cx)
    case "Fire": return scenes.fire.view(s, cx)
    case "Pricing": return scenes.pricing.view(s, cx)
    case "Ask": return scenes.ask.view(s, cx)
    case "Shock": return scenes.shock.view(s, cx)
    case "Keys": return scenes.keys.view(s, cx)
    case "Tabs": return scenes.tabs.view(s, cx)
    case "Type": return scenes.type_.view(s, cx)
  }
}

const app = App.new<State>({
  ...AppSpec.new<State>("Showreel", [960.0, 540.0], State.default, view),
  scenes: [
    ["word", (s) => { s.scene = "Word" }],
    ["card", (s) => { s.scene = "Card" }],
    ["deploy", (s) => { s.scene = "Deploy" }],
    ["glass", (s) => { s.scene = "Glass" }],
    ["fire", (s) => { s.scene = "Fire" }],
    ["pricing", (s) => { s.scene = "Pricing" }],
    ["ask", (s) => { s.scene = "Ask" }],
    ["shock", (s) => { s.scene = "Shock" }],
    ["keys", (s) => { s.scene = "Keys" }],
    ["tabs", (s) => { s.scene = "Tabs" }],
    ["type", (s) => { s.scene = "Type" }],
  ],
  fonts: [
    readFileSync(new URL("./fonts/Inter-Regular.ttf", import.meta.url)),
    readFileSync(new URL("./fonts/Inter-Medium.ttf", import.meta.url)),
    readFileSync(new URL("./fonts/Inter-SemiBold.ttf", import.meta.url)),
    readFileSync(new URL("./fonts/IBMPlexMono-Medium.ttf", import.meta.url)),
  ],
  families: ["Inter", "IBM Plex Mono"],
  poll: (s, t, _) => {
    s.t = t
    return true
  },
}).compositor(new Gfx())
app.run()
