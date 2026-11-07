// Drop files into a Rune window from Finder, Explorer or a file manager. `bun
// examples/drop-files/main.ts`. The pictures zone takes images only; the other zone takes anything; a drop
// anywhere else lands on the window. Each drop prints `drop <target> <files>`.
//
// Headless, with the highlight held before each drop:
// `bun examples/drop-files/main.ts --script examples/drop-files/scripts/drop.json --frames 90 --every 6 --cols 5 --strip strip.png`

import { AppSpec, type Color, type Cx, type El, col, row, run, text, tok } from "runex-js"
const { radius, space, type_ } = tok

type State = {
  /** The zone a file drag is over. */
  over: string | null
  last: [string, string[]] | null
}

function State_default(): State {
  return { over: null, last: null }
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

function names(files: string[]): string {
  return files.map((f) => file_name(f) ?? f).join(", ")
}

function dropped(s: State, target: string, files: string[]) {
  console.log(`drop ${target} ${names(files)}`)
  s.last = [target, files.slice()]
}

function zone(s: State, accent: Color, key: string, title: string, detail: string): El {
  const t = tok.theme(true)
  const over = s.over === key
  return col().key(key).size(200.0, 120.0).padding(space.S3).gap(space.S1).radius(radius.LG).center()
    .fill(over ? accent.alpha(0.18) : t.card)
    .border(over ? 2.0 : 1.0, over ? accent : t.card_border)
    .child(text(title).font(type_.TITLE).color(t.text))
    .child(text(detail).font(type_.LABEL).color(t.text_secondary))
    .on_drop_files((s: State, files: string[], _) => dropped(s, key, files))
    .on_drop_hover((s: State, over: boolean, _) => {
      if (over) s.over = key
      else if (s.over === key) s.over = null
    })
}

function view(s: State, cx: Cx): El {
  const t = tok.theme(true)
  const accent = cx.accent()
  const status = s.last !== null
    ? `Dropped on ${s.last[0]}: ${names(s.last[1])}`
    : "Drag files from another app onto a zone"
  return col().w_full().h_full().center().gap(space.S6).fill(t.bg)
    .child(row().gap(space.S3)
      .child(zone(s, accent, "pictures", "Pictures", "PNG, JPEG, GIF or HEIC")
        .accepts_extensions(["png", "jpg", "jpeg", "gif", "heic"]))
      .child(zone(s, accent, "anything", "Anything", "Any file")))
    .child(text(status).key("status").font(type_.BODY).color(t.text_secondary))
    .on_drop_files((s: State, files: string[], _) => dropped(s, "window", files))
}

run(AppSpec.new<State>("Drop Files", [520.0, 240.0], State_default, view))
