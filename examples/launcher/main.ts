// A notes app with a ⌘Space launcher panel: three windows that `--desktop` records together.
// `bun examples/launcher/main.ts` opens the notes window; ⌘Space shows the launcher.
//
// ```sh
// bun examples/launcher/main.ts --desktop examples/launcher/backdrop.png \
//   --script examples/launcher/scripts/demo.json --video demo.mp4 --keys --pointer
// ```
//
// With `--desktop` the app adds a fake menu bar, so the recording reads as a desktop.

import {
  App, type AppHandle, AppSpec, Color, type Cx, type El, type KeyEvent, MacWindowOptions, TextEdit, type Tx,
  WindowOptions, WindowSpec, col, el, row, run_windows, spacer, text, text_input, tok,
} from "runex-js"
const { type_ } = tok

/** Recording with `--desktop`: there is no native chrome, so the app draws its own. */
let DESKTOP = false

const NOTES: [string, string][] = [
  ["Groceries", "Oat milk, lemons, basil, sourdough, two avocados."],
  ["Trip to Lisbon", "Book the tram tour. Pastéis de nata first."],
  ["Reading list", "The Design of Everyday Things. Thinking in Systems."],
  ["Ideas", "A launcher that opens notes by typing their first letters."],
]

type Notes = {
  selected: number
  focused: boolean
}

type Launcher = {
  query: TextEdit
  picked: number
  me: AppHandle<Launcher>
  notes: AppHandle<Notes>
}

function matches(query: string): number[] {
  const q = query.toLowerCase()
  return NOTES.map((_, i) => i).filter((i) => NOTES[i]![0].toLowerCase().includes(q))
}

function notes_view(s: Notes, _: Cx): El {
  const t = tok.theme(true)
  const accent = tok.accent(0, true)
  const light = (c: [number, number, number]) => el().size(12.0, 12.0).radius(6.0)
    .fill(s.focused ? new Color({ r: c[0], g: c[1], b: c[2], a: 1.0 }) : t.control_off)
  const title_bar = row().h(38.0).px(14.0).gap(8.0).center_y()
    .child(light([1.0, 0.37, 0.34])).child(light([1.0, 0.74, 0.18])).child(light([0.16, 0.79, 0.25]))
    .child(spacer()).child(text("Notes").font(type_.TITLE).color(t.text_secondary)).child(spacer())
    .child(el().w(52.0))
  let list = col().key("list").w(170.0).h_full().px(8.0).gap(2.0)
  for (const [i, [title]] of NOTES.entries()) {
    const on = i === s.selected
    list = list.child(row().key(`note-${i}`).h(30.0).px(10.0).radius(6.0).center_y()
      .fill(on ? accent.alpha(0.85) : Color.TRANSPARENT)
      .child(text(title).font(type_.BODY).color(on ? Color.WHITE : t.text))
      .on_press((s: Notes) => { s.selected = i }))
  }
  const [title, body] = NOTES[s.selected]!
  const page = col().key("page").grow(1.0).h_full().padding(20.0).gap(10.0).fill(t.bg)
    .child(text(title).font(type_.TITLE.lh(22.0)).color(t.text))
    .child(text(body).font(type_.BODY.lh(20.0)).color(t.text_secondary))
    .child(spacer())
    .child(text("⌘Space to search").font(type_.LABEL).color(t.text_secondary.alpha(0.7)))
  return col().w_full().h_full().fill(t.card)
    .child(DESKTOP ? title_bar : el().h(12.0))
    .child(row().w_full().grow(1.0).child(list).child(page))
}

function launcher_view(s: Launcher, _: Cx): El {
  const t = tok.theme(true)
  const accent = tok.accent(0, true)
  const found = matches(s.query.text)
  const field = text_input(s.query, type_.BODY.lh(26.0)).key("query").single_line().grow(1.0)
    .color(t.text).placeholder("Search notes", t.text_secondary)
    .on_edit((s: Launcher) => s.query)
    .on_input_key((s: Launcher, ev: KeyEvent, tx: Tx) => {
      const n = matches(s.query.text).length
      if (ev.key === "Down" && n > 0) s.picked = (s.picked + 1) % n
      else if (ev.key === "Up" && n > 0) s.picked = (s.picked + n - 1) % n
      else if (ev.key === "Escape") tx.close_window()
      else return false
      return true
    })
    .on_input_change((s: Launcher, _: Tx) => { s.picked = 0 })
    .on_submit(open_picked)
  let panel = col().key("panel").w_full().radius(14.0).clip_rounded(14.0)
    .fill(t.card).border(1.0, Color.WHITE.alpha(0.1))
    .child(row().h(56.0).px(18.0).gap(12.0).center_y()
      .child(text("⌕").font(type_.TITLE.lh(26.0)).color(t.text_secondary))
      .child(field))
  if (found.length !== 0) {
    let results = col().key("results").padding(6.0).gap(2.0)
    for (const [row_i, i] of found.entries()) {
      const on = row_i === s.picked
      results = results.child(row().key(`result-${i}`).h(36.0).px(12.0).radius(8.0).center_y()
        .fill(on ? accent.alpha(0.85) : Color.TRANSPARENT)
        .child(text(NOTES[i]![0]).font(type_.BODY).color(on ? Color.WHITE : t.text)))
    }
    panel = panel.child(el().h(1.0).w_full().fill(t.separator)).child(results)
  }
  return col().w_full().h_full().child(panel)
}

function open_picked(s: Launcher, tx: Tx) {
  const i = matches(s.query.text)[s.picked]
  if (i === undefined) return
  s.notes.update((n: Notes) => { n.selected = i })
  s.notes.focus()
  s.query.clear()
  tx.close_window()
}

function menu_bar_view(_: null, _cx: Cx): El {
  const ink = Color.WHITE.alpha(0.92)
  const item = (s: string) => text(s).font(type_.BODY).color(ink)
  return row().w_full().h_full().px(14.0).gap(18.0).center_y().fill(Color.BLACK.alpha(0.22))
    .child(text("◆").font(type_.TITLE).color(ink))
    .child(text("Notes").font(type_.TITLE).color(ink))
    .child(item("File")).child(item("Edit")).child(item("View")).child(item("Window"))
    .child(spacer())
    .child(item("Sat 9:41"))
}

DESKTOP = process.argv.slice(2).some((a) => a === "--desktop")
run_windows((displays) => {
  const notes = App.new(AppSpec.new<Notes>("Notes", [520.0, 320.0], () => ({ selected: 0, focused: true }), notes_view))
    .keep_running()
    .on_focus((s: Notes, focused: boolean, _: Tx) => { s.focused = focused })
  let launcher = App.new(AppSpec.new<Launcher>("Launcher", [560.0, 220.0], () => { throw new Error("internal error: entered unreachable code") }, launcher_view)).windowless()
  const [notes_handle, me] = [notes.handle(), launcher.handle()]
  launcher = launcher
    .init((): Launcher => {
      const query: TextEdit = TextEdit.new("")
      query.focused = true
      return { query, picked: 0, me, notes: notes_handle }
    })
    .global_shortcut("cmd+space", (s: Launcher, _: Tx) => {
      s.me.place("Primary", { Edge: { edge: "Top", margin: 150.0, align: "Center", inset: 0.0 } })
      s.me.show()
    })
    .on_focus((_: Launcher, focused: boolean, tx: Tx) => { if (!focused) tx.close_window() })
  const windows: WindowSpec[] = [
    WindowSpec.from_app("notes", notes).boxed(),
    WindowSpec.from_app("launcher", launcher).configured_options(WindowOptions.launcher_panel()).boxed(),
  ]
  const d = displays.find((d) => d.primary) ?? displays[0]
  if (DESKTOP && d !== undefined) {
    const bar = new WindowOptions({
      transparent: true, borderless: true, click_through: true, always_on_top: true,
      position: d.position, physical_size: [d.size[0], Math.round(24.0 * d.scale)],
      min_size: [0.0, 0.0],
    })
    windows.push(WindowSpec.new("menu-bar", AppSpec.new<null>("Menu bar", [0.0, 24.0], () => null, menu_bar_view))
      .configured_options(bar.macos(MacWindowOptions.default().shadow(false))).boxed())
  }
  return windows
})
