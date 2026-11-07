// Copy and paste formatted text. `bun examples/rich-clipboard/main.ts`.
//
// Paste into the field from a browser, Notes, TextEdit or Pages: the field still pastes the
// plain text, and the panel below shows which forms arrived and the start of the sanitised
// HTML (on macOS, RTF-only sources arrive converted to HTML). Each paste also prints its
// HTML. "Copy formatted" puts plain text, HTML and RTF on the clipboard: paste it into
// TextEdit or Mail and it keeps its bold and italic. "Read clipboard" looks without pasting.

import { AppSpec, ClipboardContent, type Cx, type El, TextEdit, type Tx, col, row, run, text, text_input, tok } from "runex-js"
const { radius, space, type_ } = tok

type State = {
  field: TextEdit
  /** How the last paste or read arrived, and what it held. */
  last: [string, ClipboardContent] | null
}

function State_default(): State {
  return { field: TextEdit.default(), last: null }
}

function sample(): ClipboardContent {
  return ClipboardContent.new("Rune copies bold and italic text.")
    .with_html("Rune copies <b>bold</b> and <i>italic</i> text.")
    .with_rtf(String.raw`{\rtf1\ansi{\fonttbl\f0\fswiss Helvetica;}\f0 Rune copies {\b bold} and {\i italic} text.}`)
}

/** `str::len`: the length in UTF-8 bytes. */
function len(s: string): number {
  return Buffer.byteLength(s, "utf8")
}

/** `{:?}` of an `Option<usize>`. */
function debug_option(n: number | null): string {
  return n === null ? "None" : `Some(${n})`
}

function seen(s: State, how: string, content: ClipboardContent) {
  const html = content.html()
  const rtf = content.rtf()
  console.log(`${how}: text ${len(content.text())} bytes, html ${debug_option(html === null ? null : len(html))} bytes, rtf ${debug_option(rtf === null ? null : len(rtf))} bytes`)
  if (html !== null) console.log(html)
  s.last = [how, content.clone()]
}

function summary(last: [string, ClipboardContent] | null): [string, string] {
  if (last === null) return ["Paste formatted text into the field", ""]
  const [how, content] = last
  const form = (name: string, len: number | null) => len !== null ? `${name} ${len} B` : `no ${name}`
  const html = content.html()
  const rtf = content.rtf()
  const head = `${how}: text ${len(content.text())} B, ${form("HTML", html === null ? null : len(html))}, ${form("RTF", rtf === null ? null : len(rtf))}`
  const preview = Array.from(html ?? "").slice(0, 400).join("")
  return [head, preview]
}

function button(key: string, label: string, f: (s: State, tx: Tx) => void): El {
  const t = tok.theme(true)
  return row().key(key).role("button").padding(space.S2).radius(radius.MD).fill(t.card).border(1.0, t.card_border)
    .child(text(label).font(type_.LABEL).color(t.text))
    .on_press_tx(f)
}

function view(s: State, _: Cx): El {
  const t = tok.theme(true)
  const [head, preview] = summary(s.last)
  const field = text_input(s.field, type_.BODY).key("field").w_full().min_h(80.0).padding(space.S2)
    .radius(radius.MD).fill(t.card).border(1.0, t.card_border).color(t.text)
    .on_edit((s: State) => s.field)
    // Look at every form, then let the editor paste the text as usual.
    .on_input_paste((s: State, content: ClipboardContent, _: Tx) => { seen(s, "Pasted", content); return false })
  return col().w_full().h_full().padding(space.S6).gap(space.S3).fill(t.bg)
    .child(field)
    .child(row().gap(space.S2)
      .child(button("copy", "Copy formatted", (_, tx) => tx.copy_rich(sample())))
      .child(button("read", "Read clipboard", (_, tx) => tx.read_clipboard((s: State, content: ClipboardContent, _: Tx) => seen(s, "Read", content)))))
    .child(text(head).key("summary").font(type_.BODY).color(t.text_secondary))
    .child(text(preview).key("preview").font(type_.LABEL).color(t.text_secondary).w_full())
}

run(AppSpec.new<State>("Rich Clipboard", [560.0, 420.0], State_default, view))
