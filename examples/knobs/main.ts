// A card tuned live with `rune-knobs`: ⌘⇧K slides the panel in beside the page, and its sliders
// and choices change the card as you drag. `bun examples/knobs/main.ts`; `-- --snap knobs.png --scene
// open` renders it headless with the panel open, and `-- --playground "Knobs"` opens the
// playground, whose side column hosts the same knobs as rows.

import { App, AppSpec, type Cx, type El, type KeyEvent, Playground, Story, type Tx, col, text, tok } from "runex-js"
import * as rune_knobs from "runex-js/knobs"
import { Group, Knob, Knobs, Preset, Style } from "runex-js/knobs"
const { type_ } = tok

const RADIUS: Knob = Knob.new("Card radius", 0.0, 32.0, 14.0).about("How round the card's corners are")
const PAD: Knob = Knob.new("Card padding", 8.0, 48.0, 24.0).step(1.0)
const TINT: Knob = Knob.choice("Card tint", ["Plain", "Accent", "Raised"], 0)
const SHADOW: Knob = Knob.choice("Card shadow", ["Off", "On"], 0)
const GROUPS: Group[] = [Group.new("Card", "card", [RADIUS, PAD, TINT, SHADOW]).presets([new Preset({ name: "Round", values: [["Card radius", 28.0]] })])]

type State = {
  knobs: Knobs
}
// #[derive(Default)]
const State = {
  default: (): State => ({ knobs: Knobs.default() }),
}

function page(s: State, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  const ink = cx.system_dark() ? t.bg : t.text
  const k = s.knobs
  let fill
  switch (Math.trunc(k.get(TINT))) {
    case 1: fill = tok.accent(0, true); break
    case 2: fill = t.control_off; break
    default: fill = t.knob
  }
  const card = col()
    .key("card")
    .shadow(k.get(SHADOW) > 0.5 ? 10.0 : 0.0, 24.0, t.bg.alpha(0.35))
    .w(240.0)
    .padding(k.get(PAD))
    .gap(6.0)
    .radius(k.get(RADIUS))
    .fill(fill)
    .child(text("Tune me").font(type_.TITLE).color(ink))
    .child(text("⌘⇧K opens the knobs").color(ink))
  return col().key("page").grow(1.0).h_full().center().fill(t.bg).child(card)
}

function view(s: State, cx: Cx): El {
  const page_ = page(s, cx)
  return rune_knobs.side(page_, s.knobs, GROUPS, style(cx), (s: State) => s.knobs)
}

function style(cx: Cx): Style {
  return cx.system_dark() ? Style.dark() : Style.light()
}

/**
 * The playground's side column: the same knobs as rows, filling its width. With the keyboard
 * on them (→ from the list), ↑↓ pick a knob and ←→ step it.
 */
function story_side(s: State, active: boolean, cx: Cx): El {
  return rune_knobs.inline(s.knobs, GROUPS, style(cx), (s: State) => s.knobs, active)
}

function playground(): Playground {
  return Playground.new().story(Story.new("Card/Knobs", State.default, page).side_keys(story_side, side_key(GROUPS, (s: State) => s.knobs)))
}

/**
 * `rune_knobs::side_key`, which runex doesn't bind yet (it returns `impl Fn`; docs/porting.md): its
 * body (crates/rune-knobs/src/lib.rs) as written, on the bound `Knobs::panel_key` and
 * `Tx::instant`. Swap in `rune_knobs.side_key` once it's there.
 *
 * [`Knobs::panel_key`] as the keys of a playground story's side column, for
 * `rune::Story::side_keys` beside [`inline`]: ↑ ↓ pick a knob, ← → step it (⇧ for 10×), `[`
 * and `]` switch groups. It leaves Esc and Tab to the playground, which leaves the column.
 */
function side_key<S>(groups: Group[], lens: (s: S) => Knobs): (s: S, ev: KeyEvent, tx: Tx) => boolean {
  return (s, ev, tx) => {
    if (ev.key === "Escape" || ev.key === "Tab") {
      return false
    }
    const taken = lens(s).panel_key(groups, ev)
    if (taken) {
      tx.instant()
    }
    return taken
  }
}

function on_key(s: State, ev: KeyEvent, tx: Tx): boolean {
  const taken = rune_knobs.key(s.knobs, ev)
  if (taken) {
    tx.motion(s.knobs.slide())
  }
  return taken
}

const spec = {
  ...AppSpec.new<State>("Knobs", [820.0, 520.0], State.default, view),
  scenes: [["open", (s: State) => { s.knobs.show() }], ["filter", (s: State) => { s.knobs.show(); s.knobs.filter("pad") }]] as [string, (s: State) => void][],
  on_key,
}
App.new(spec).playground(playground()).run()
