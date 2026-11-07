// Drag a file, an app bundle or a line of text out of a Rune window into Finder, System
// Settings or a text field. `bun examples/drag-out/main.ts`; set `DRAG_OUT_APP` to drag a different
// app bundle. A tile dims while it's dragged; each drag's end prints
// `drag-end <tile> <outcome>`.

import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { AppSpec, type Cx, DragItem, type DragOutcome, type El, col, row, run, text, tok } from "runex-js"
const { radius, space, type_ } = tok

type State = {
  file: string
  app: string
  last: [string, DragOutcome] | null
  dragging: string | null
}

function tile(s: State, key: string, title: string, detail: string, item: (s: State) => DragItem): El {
  const t = tok.theme(true)
  return col().key(key).role("button").size(150.0, 92.0).padding(space.S3).gap(space.S1).radius(radius.LG)
    .fill(t.card).border(1.0, t.card_border).hover(t.hover).press(t.press).cursor("Grab")
    .opacity(s.dragging === key ? 0.28 : 1.0)
    .child(text(title).font(type_.TITLE).color(t.text))
    .child(text(detail).font(type_.LABEL).color(t.text_secondary))
    .drag_out((s: State) => item(s).opaque(tok.theme(true).bg))
    .on_drag_start((s: State, _) => { s.dragging = key })
    .on_drag_end((s: State, outcome: DragOutcome, _) => {
      console.log(`drag-end ${key} ${outcome}`)
      s.dragging = null
      s.last = [key, outcome]
    })
}

/**
 * Rust's `Path::file_name`: the last component, or `None` when the path ends in `..` or has no
 * normal component (`/`, `.`, ``). Separators repeat and `.` components drop out, as in
 * `Path::components`.
 */
function file_name(path: string): string | null {
  const sep = process.platform === "win32" ? /[\\/]/ : /\//
  const last = path.split(sep).filter((c) => c !== "" && c !== ".").at(-1)
  return last === undefined || last === ".." ? null : last
}

function name(path: string): string {
  return file_name(path) ?? path
}

function view(s: State, _: Cx): El {
  const t = tok.theme(true)
  const status = s.last !== null
    ? `Last drag: ${s.last[0]}, ${s.last[1]}`
    : "Drag a tile out of the window"
  return col().w_full().h_full().center().gap(space.S6).fill(t.bg)
    .child(row().gap(space.S3)
      .child(tile(s, "file", "A file", name(s.file), (s) => DragItem.new().file(s.file)))
      .child(tile(s, "app", "An app", name(s.app), (s) => DragItem.new().file(s.app)))
      .child(tile(s, "text", "Some text", "Hello from Rune", (_) => DragItem.new().text("Hello from Rune"))))
    .child(text(status).key("status").font(type_.BODY).color(t.text_secondary))
}

function initial(): State {
  const file = join(tmpdir(), "Dragged out of Rune.txt")
  try { writeFileSync(file, "This file was dragged out of a Rune window.\n") } catch { /* `let _ =`: ignored */ }
  const app = process.env.DRAG_OUT_APP ?? "/System/Applications/Calculator.app"
  return { file, app, last: null, dragging: null }
}

run(AppSpec.new<State>("Drag Out", [520.0, 200.0], initial, view))
