// Golden fixture: rune-kit components on Rune's neutral kit, in their rest, hover, pressed,
// focus, invalid and disabled states, dark and light (the `-light` scenes build the light kit
// whatever the system theme). Catches kit restyles (sheen, outline offset, spacing) that the
// examples port along with Rust and compare.ts therefore can't see. rune-kit at this revision
// has no Slider or Tabs: SegmentedControl and Progress stand in.
//
//   bun test/golden/fixtures/kit.ts --list-scenes
//   bun test/golden/fixtures/kit.ts --snap kit.png --scene buttons-light

import { AppSpec, type Cx, type El, TextEdit, col, row, run, text } from "runex-js"
import {
  Button, type ButtonVariant, Checkbox, Field, Kit, Markdown, Progress, RadioGroup, RadioItem, SegmentedControl, Select,
  type State, Switch, TextArea, TextInput, root,
} from "runex-js/kit"

type Part = "buttons" | "inputs" | "select" | "toggles" | "segmented" | "markdown"
type S = { part: Part; light: boolean }

const STATES: State[] = ["Rest", "Hover", "Pressed", "Focus", "Disabled"]
const VARIANTS: ButtonVariant[] = ["Neutral", "Contrast", "Submit", "Danger", "Ghost"]
const edit = (v: string) => TextEdit.new(v)

const MARKDOWN = `# Heading one

A paragraph with **bold**, *italic*, \`inline code\` and a [link](https://example.com).

## Heading two

- First item
- Second item with more words
  - Nested item

1. One
2. Two

> A quote, set apart.

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\`

| Name | Value |
| --- | ---: |
| alpha | 1 |
| beta | 22 |
`

function caption(k: Kit, s: string): El {
  return text(s).font(k.ty.ui).color(k.c.text_muted)
}

function buttons(k: Kit): El {
  return col().gap(8.0).children(VARIANTS.map((v) =>
    row().gap(8.0).center_y().child(caption(k, v).w(70.0))
      .children(STATES.map((st) => Button.new(st).variant(v).state(st).build(k).key(`${v}-${st}`)))))
}

function inputs(k: Kit): El {
  return row().gap(16.0).items_start()
    .child(col().w(280.0).gap(10.0)
      .child(TextInput.new(edit("")).placeholder("Placeholder").build(k).key("empty"))
      .child(TextInput.new(edit("Some value")).build(k).key("value"))
      .child(TextInput.new(edit("")).placeholder("Focused").state("Focus").build(k).key("focus"))
      .child(TextInput.new(edit("")).placeholder("Hovered").state("Hover").build(k).key("hover"))
      .child(TextInput.new(edit("Bad value")).invalid(true).build(k).key("invalid"))
      .child(TextInput.new(edit("Disabled")).disabled(true).build(k).key("disabled")))
    .child(col().w(280.0).gap(10.0)
      .child(TextArea.new(edit("Two lines\nof text")).rows(3).build(k).key("area"))
      .child(TextArea.new(edit("")).placeholder("Invalid").invalid(true).build(k).key("area-invalid"))
      .child(Field.new().label("Label").info().prefix("Prefix").control(TextInput.new(edit("")).placeholder("In a field").build(k)).suffix("Suffix").build(k)))
}

function select(k: Kit, layer: El[]): El {
  const FRUITS = ["Apple", "Banana", "Cherry"]
  return row().gap(16.0).items_start()
    .child(col().w(220.0).gap(10.0)
      .child(Select.new("field", FRUITS).label("Field").placeholder("Pick a fruit").build(k, layer))
      .child(Select.new("current", FRUITS).current("Banana").build(k, layer))
      .child(Select.new("invalid", FRUITS).current("Cherry").invalid(true).build(k, layer))
      .child(Select.new("disabled", FRUITS).current("Apple").disabled(true).build(k, layer)))
    .child(col().w(220.0).gap(10.0)
      .child(Select.new("inline", FRUITS).appearance("Inline").current("Apple").build(k, layer))
      .child(Select.new("inline-hover", FRUITS).appearance("Inline").current("Banana").state("Hover").build(k, layer))
      .child(Select.new("open", FRUITS).current("Cherry").open(true).build(k, layer)))
}

function toggles(k: Kit): El {
  return row().gap(24.0).items_start()
    .child(col().gap(10.0)
      .child(Switch.new(true).label("On").build(k))
      .child(Switch.new(false).label("Off").build(k))
      .child(Switch.new(true).label("Hover").state("Hover").build(k))
      .child(Switch.new(false).label("Focus").state("Focus").build(k))
      .child(Switch.new(true).label("Disabled").disabled(true).build(k))
      .child(Switch.new(true).label("Standard").standard().build(k)))
    .child(col().gap(10.0)
      .child(Checkbox.new(true).label("Checked").build(k))
      .child(Checkbox.new(false).label("Unchecked").build(k))
      .child(Checkbox.new(false).label("Indeterminate").indeterminate(true).build(k))
      .child(Checkbox.new(true).label("Pressed").state("Pressed").build(k))
      .child(Checkbox.new(false).label("Disabled").disabled(true).build(k))
      .child(Checkbox.new(false).label("With description").description("Helper text").build(k)))
    .child(RadioGroup.new().label("Radio").item(RadioItem.new("First", true)).item(RadioItem.new("Second", false))
      .item(RadioItem.new("Hover", false).state("Hover")).item(RadioItem.new("Disabled", false).disabled(true)).build(k))
}

function segmented(k: Kit): El {
  return col().gap(14.0).items_start()
    .child(SegmentedControl.new(["List", "Grid", "Board"], 1).label("View").build(k))
    .child(SegmentedControl.new(["One", "Two", "Three", "Four"], 0).build(k))
    .child(SegmentedControl.new(["None", "Selected"], null).build(k))
    .child(col().w(260.0).gap(8.0)
      .child(Progress.new(0.0).label("Empty").show_value().build(k))
      .child(Progress.new(0.42).label("Upload").show_value().build(k))
      .child(Progress.new(1.0).label("Done").build(k)))
}

function view(s: S, cx: Cx): El {
  const dark = s.light ? false : cx.system_dark()
  const k = Kit.neutral(dark)
  const layer: El[] = []
  const body = (() => {
    switch (s.part) {
      case "buttons": return buttons(k)
      case "inputs": return inputs(k)
      case "select": return select(k, layer)
      case "toggles": return toggles(k)
      case "segmented": return segmented(k)
      case "markdown": return col().w(520.0).child(Markdown.new(MARKDOWN).build(k))
    }
  })()
  return root(col().key("frame").w_full().h_full().fill(k.c.page).padding(20.0).child(body), layer)
}

const PARTS: Part[] = ["buttons", "inputs", "select", "toggles", "segmented", "markdown"]

run({
  ...AppSpec.new<S>("Golden kit", [640.0, 640.0], () => ({ part: "buttons", light: false }), view),
  scenes: PARTS.flatMap((part) => [
    [part, (s: S) => { s.part = part }],
    [`${part}-light`, (s: S) => { s.part = part; s.light = true }],
  ] as [string, (s: S) => void][]),
})
