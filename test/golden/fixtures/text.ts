// Golden fixture: text layout and shaping. Frozen on purpose: it changes only when Rune's text
// engine does, which separates engine regressions from example churn. Latin text and the
// bundled fonts only (Inter, and opencode's Inter and IBM Plex Mono): symbol and emoji fallback
// fonts differ per platform.
//
//   bun test/golden/fixtures/text.ts --list-scenes
//   bun test/golden/fixtures/text.ts --snap text.png --scene wrap

import { AppSpec, type Color, type Cx, type El, Span, TextStyle, col, el, row, run, text, tok } from "runex-js"
import { FAMILIES, FONTS } from "runex-js/theme-opencode"

type Scene = "wrap" | "elide" | "rich" | "align" | "line-height" | "weights" | "fonts"
type State = { scene: Scene }

const PARAGRAPH = "Rune lays out text with its own shaper: words wrap at the box edge, long words break " +
  "only when nothing else fits, and every line keeps the paragraph's baseline grid."
const LONG = "a-very-long-file-name-without-any-spaces-that-must-break-somewhere.txt"
const PATH = "/Users/someone/projects/runex/vendor/rune/crates/rune/src/text/layout.rs"

function box(t: tok.Theme, w: number, child: El): El {
  return col().w(w).padding(8.0).radius(6.0).fill(t.card).border(1.0, t.card_border).child(child)
}

function label(t: tok.Theme, s: string): El {
  return text(s).font(TextStyle.new(11.0, 500.0)).color(t.text_secondary)
}

function wrap(t: tok.Theme): El {
  return row().gap(16.0).items_start()
    .child(col().gap(6.0).child(label(t, "wrap, 220 pt")).child(box(t, 220.0, text(PARAGRAPH).color(t.text).wrap())))
    .child(col().gap(6.0).child(label(t, "wrap, 140 pt")).child(box(t, 140.0, text(PARAGRAPH).color(t.text).wrap())))
    .child(col().gap(6.0).child(label(t, "wrap_anywhere, 120 pt")).child(box(t, 120.0, text(LONG).color(t.text).wrap_anywhere())))
}

function elide(t: tok.Theme): El {
  const line = (name: string, e: El) => col().gap(4.0).child(label(t, name)).child(box(t, 260.0, e))
  return col().gap(10.0)
    .child(line("truncate", text(PATH).color(t.text).truncate()))
    .child(line("truncate_middle", text(PATH).color(t.text).truncate_middle()))
    .child(line("truncate_head", text(PATH).color(t.text).truncate_head()))
    .child(line("max_lines(2)", text(PARAGRAPH).color(t.text).wrap().max_lines(2)))
    .child(line("single_line", text(PARAGRAPH).color(t.text).single_line()))
}

function rich(t: tok.Theme, accent: Color): El {
  const s = "Bold, italic, mono, larger, coloured, highlighted and underlined spans in one paragraph."
  const at = (word: string) => [s.indexOf(word), s.indexOf(word) + word.length] as const
  const span = (word: string) => Span.new(...at(word))
  return col().gap(12.0)
    .child(box(t, 420.0, text(s).color(t.text).wrap().spans([
      span("Bold").bold(),
      span("italic").italic(),
      span("mono").mono(),
      span("larger").size(18.0),
      span("coloured").color(accent),
      span("highlighted").bg(t.control_track, 2.0),
      span("underlined").underline(accent),
    ])))
    .child(box(t, 420.0, text("Struck through, and a ringed word.").color(t.text)
      .strike(0, 14, null).span_ring(22, 27, accent, 1.0)))
}

function align(t: tok.Theme): El {
  const line = (a: "Start" | "Center" | "End") => box(t, 300.0, text(`align ${a}: a short line`).color(t.text).w_full().align(a))
  return col().gap(8.0).child(line("Start")).child(line("Center")).child(line("End"))
    .child(box(t, 300.0, text(PARAGRAPH).color(t.text).wrap().w_full().align("Center")))
}

function lineHeight(t: tok.Theme): El {
  // Line heights in points, for 13 pt text.
  const para = (lh: number) => col().gap(4.0).child(label(t, `lh ${lh} pt`))
    .child(box(t, 200.0, text(PARAGRAPH).font(TextStyle.new(13.0, 400.0).lh(lh)).color(t.text).wrap()))
  return row().gap(12.0).items_start().child(para(14.0)).child(para(18.0)).child(para(26.0))
}

function weights(t: tok.Theme): El {
  const ws = [100.0, 300.0, 400.0, 500.0, 650.0, 800.0, 900.0]
  return col().gap(4.0)
    .children(ws.map((w) => text(`Weight ${w}: The quick brown fox`).font(TextStyle.new(16.0, w)).color(t.text)))
    .child(text("Tracking 0.1 em, 15 pt").font(TextStyle.new(15.0, 500.0).tracking(0.1)).color(t.text))
    .child(text("Italic 15 pt").font(TextStyle.new(15.0, 400.0).italic()).color(t.text))
    .child(text("Mono 15 pt: 0123456789 {}[]()").font(TextStyle.new(15.0, 400.0).mono()).color(t.text))
}

function fonts(t: tok.Theme): El {
  const [sans, mono] = FAMILIES
  const fam = (name: string, size: number, weight: number) => TextStyle.new(size, weight).family({ Named: name })
  return col().gap(6.0)
    .child(text(`${sans} 13/400: The quick brown fox jumps over the lazy dog`).font(fam(sans, 13.0, 400.0)).color(t.text))
    .child(text(`${sans} 20/600: Sphinx of black quartz`).font(fam(sans, 20.0, 600.0)).color(t.text))
    .child(text(`${mono} 13/400: fn main() { println!("{}", 42); }`).font(fam(mono, 13.0, 400.0)).color(t.text))
    .child(text(`${mono} 13/500: 0O 1lI |{}[] => != <=`).font(fam(mono, 13.0, 500.0)).color(t.text))
    .child(text("tok.type_ BODY, TITLE, CAPTION").font(tok.type_.BODY).color(t.text))
    .child(text("TITLE").font(tok.type_.TITLE).color(t.text))
}

function view(s: State, cx: Cx): El {
  const dark = cx.system_dark()
  const t = tok.theme(dark)
  const accent = tok.accent(0, dark)
  const body = (() => {
    switch (s.scene) {
      case "wrap": return wrap(t)
      case "elide": return elide(t)
      case "rich": return rich(t, accent)
      case "align": return align(t)
      case "line-height": return lineHeight(t)
      case "weights": return weights(t)
      case "fonts": return fonts(t)
    }
  })()
  return col().key("root").w_full().h_full().padding(20.0).fill(t.bg).child(el().key("stage").child(body))
}

const SCENES: Scene[] = ["wrap", "elide", "rich", "align", "line-height", "weights", "fonts"]

run({
  ...AppSpec.new<State>("Golden text", [720.0, 360.0], () => ({ scene: "wrap" }), view),
  scenes: SCENES.map((name) => [name, (s: State) => { s.scene = name }]),
  fonts: FONTS,
  families: FAMILIES,
})
