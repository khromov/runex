// TextInput, Textarea, Field and Select.

import { type El, TextEdit, TextStyle, type Tx, col, row, text } from "runex-js"
import { Field, type Kit, Select, type State, TextArea, TextInput } from "runex-js/kit"

import type { G } from "../main.ts"
import { close, is_open, toggle } from "../stories.ts"

// TextInput, Textarea, Field
//
// Solid passes `defaultValue` to these inputs as an attribute the DOM ignores, so the web
// stories show their placeholders; the gallery does the same.

function edit(v: string): TextEdit {
  return TextEdit.new(v)
}

function grid(gap: number, width: number): El {
  return col().gap(gap).w(width).items_stretch()
}

export function text_input_playground(s: G, k: Kit, _: El[]): El {
  return row().child(TextInput.new(s.edits[0]).placeholder("Placeholder").on_edit((s: G) => s.edits[0]).build(k))
}

export function text_input_copy(_: G, k: Kit, __: El[]): El {
  return row().child(TextInput.new(edit("")).placeholder("api.example.com/v1").copy_button().build(k))
}

export function text_input_controlled(s: G, k: Kit, _: El[]): El {
  const value = s.edits[1].text === "" && !s.is("typed")
    ? "Controlled value"
    : s.edits[1].text
  return col()
    .gap(12.0)
    .child(TextInput.new(edit(value)).placeholder("Type here…").build(k))
    .child(text(`Value: ${value}`).font(TextStyle.new(12.0, 440.0).lh(24.0)).color(k.c.std_text))
}

export function text_input_appearances(_: G, k: Kit, __: El[]): El {
  return grid(20.0, 280.0)
    .child(TextInput.new(edit("")).placeholder("Base (28px)").build(k))
    .child(TextInput.new(edit("")).placeholder("Large (32px)").large().build(k))
    .child(TextInput.new(edit("")).placeholder("Large with copy").large().copy_button().build(k))
}

export function text_input_with_field(_: G, k: Kit, __: El[]): El {
  return grid(24.0, 280.0)
    .child(
      Field.new()
        .label("Label")
        .info()
        .prefix("Prefix")
        .control(TextInput.new(edit("")).placeholder("Text").copy_button().build(k))
        .suffix("Suffix")
        .build(k),
    )
    .child(
      Field.new()
        .label("Label")
        .prefix("Prefix")
        .control(TextInput.new(edit("")).placeholder("Text").copy_button().invalid(true).build(k))
        .suffix("Suffix")
        .build(k),
    )
}

export function text_input_states(_: G, k: Kit, __: El[]): El {
  return grid(20.0, 280.0)
    .child(TextInput.new(edit("")).placeholder("Default").build(k))
    .child(TextInput.new(edit("")).placeholder("With value").build(k))
    .child(TextInput.new(edit("")).placeholder("With copy").copy_button().build(k))
    .child(TextInput.new(edit("")).placeholder("Invalid").invalid(true).copy_button().build(k))
    .child(TextInput.new(edit("")).placeholder("Disabled").disabled(true).build(k))
    .child(TextInput.new(edit("")).placeholder("Disabled with value").disabled(true).copy_button().build(k))
}

export function textarea_playground(s: G, k: Kit, _: El[]): El {
  return row().child(TextArea.new(s.edits[2]).placeholder("Placeholder").on_edit((s: G) => s.edits[2]).build(k))
}

export function textarea_controlled(_: G, k: Kit, __: El[]): El {
  return grid(12.0, 280.0)
    .child(TextArea.new(edit("")).placeholder("Type here…").build(k))
    .child(text("Value: Controlled value").font(TextStyle.new(12.0, 440.0).lh(24.0)).color(k.c.std_text))
}

export function textarea_with_field(_: G, k: Kit, __: El[]): El {
  return grid(24.0, 280.0)
    .child(
      Field.new()
        .label("Label")
        .info()
        .prefix("Prefix")
        .control(TextArea.new(edit("")).placeholder("Text").build(k))
        .suffix("Suffix")
        .build(k),
    )
    .child(
      Field.new()
        .label("Label")
        .prefix("Prefix")
        .control(TextArea.new(edit("")).placeholder("Text").invalid(true).build(k))
        .suffix("Suffix")
        .build(k),
    )
}

export function textarea_states(_: G, k: Kit, __: El[]): El {
  return grid(20.0, 280.0)
    .child(TextArea.new(edit("")).placeholder("Default").build(k))
    .child(TextArea.new(edit("")).placeholder("With value").build(k))
    .child(TextArea.new(edit("")).placeholder("Invalid").invalid(true).build(k))
    .child(TextArea.new(edit("")).placeholder("Disabled").disabled(true).build(k))
    .child(TextArea.new(edit("")).placeholder("Disabled with value").disabled(true).build(k))
}

export function field_text_input(_: G, k: Kit, __: El[]): El {
  return grid(0.0, 280.0).child(
    Field.new()
      .label("Label")
      .info()
      .prefix("Prefix")
      .control(TextInput.new(edit("")).placeholder("Text").copy_button().build(k))
      .suffix("Suffix")
      .build(k),
  )
}

export function field_direct_child(_: G, k: Kit, __: El[]): El {
  return grid(0.0, 280.0).child(
    Field.new()
      .label("Label")
      .prefix("Prefix")
      .control(TextInput.new(edit("")).placeholder("Text").build(k))
      .suffix("Suffix")
      .build(k),
  )
}

export function field_textarea(_: G, k: Kit, __: El[]): El {
  return grid(0.0, 280.0).child(
    Field.new()
      .label("Label")
      .prefix("Prefix")
      .control(TextArea.new(edit("")).placeholder("Text").build(k))
      .suffix("Suffix")
      .build(k),
  )
}

export function field_invalid(_: G, k: Kit, __: El[]): El {
  return grid(0.0, 280.0).child(
    Field.new()
      .label("Label")
      .prefix("Prefix")
      .control(TextInput.new(edit("")).placeholder("Text").copy_button().invalid(true).build(k))
      .suffix("Suffix")
      .build(k),
  )
}

// Select

const FRUITS = ["Apple", "Banana", "Cherry", "Date", "Elderberry"]

function fruit_select(s: G, key: string): Select {
  const current = s.pick.get(key) ?? null
  return Select.new(key, FRUITS)
    .label("Fruit")
    .placeholder("Pick a fruit")
    .current(current)
    .open(is_open(s, key))
    .on_toggle(toggle(key))
    .on_close(close)
    .on_choose((s: G, v: string, _: Tx) => {
      s.pick.set(key, v)
      s.open = null
    })
}

export function select_playground(s: G, k: Kit, layer: El[]): El {
  return row().child(fruit_select(s, "select").build(k, layer))
}

export function select_grouped(s: G, k: Kit, layer: El[]): El {
  const cities: [string, string][] =
    [["North", "Boston"], ["South", "Miami"], ["South", "Atlanta"], ["West", "Seattle"], ["West", "Denver"]]
  const current = s.pick.get("select") ?? null
  return row().child(
    Select.grouped("select", cities)
      .label("City")
      .placeholder("Pick a fruit")
      .current(current)
      .open(is_open(s, "select"))
      .on_toggle(toggle("select"))
      .on_close(close)
      .on_choose((s: G, v: string, _: Tx) => {
        s.pick.set("select", v)
        s.open = null
      })
      .build(k, layer),
  )
}

export function select_invalid(s: G, k: Kit, layer: El[]): El {
  return row().child(fruit_select(s, "select").invalid(true).build(k, layer))
}

export function select_disabled(_: G, k: Kit, layer: El[]): El {
  return row().child(Select.new("select", FRUITS).current("Cherry").disabled(true).build(k, layer))
}

/**
 * Both triggers in every state, forced, and an open field with its listbox: the inline trigger's
 * rest, hover, open and disabled; the 280 x 28 field's rest, hover, keyboard focus, open,
 * invalid and disabled.
 */
export function select_states(s: G, k: Kit, layer: El[]): El {
  const pick = (key: string, st: State) => Select.new(key, FRUITS).label("Fruit").placeholder("Pick a fruit").current("Banana").state(st)
  const line = (name: string, e: El) => row().gap(16.0).center_y().child(text(name).font(k.ty.small).color(k.c.text_faint).w(72.0)).child(e)
  const field = (key: string, st: State) => pick(key, st).appearance("Field")
  return col().gap(10.0)
    .child(line("Inline", pick("i1", "Rest").trigger(k)))
    .child(line("Hover", pick("i2", "Hover").trigger(k)))
    .child(line("Open", pick("i3", "Rest").open(true).trigger(k)))
    .child(line("Disabled", pick("i4", "Rest").disabled(true).trigger(k)))
    .child(line("Field", field("f1", "Rest").trigger(k)))
    .child(line("Hover", field("f2", "Hover").trigger(k)))
    .child(line("Focus", field("f3", "Focus").trigger(k)))
    .child(line("Invalid", field("f4", "Rest").invalid(true).trigger(k)))
    .child(line("Disabled", field("f5", "Rest").disabled(true).trigger(k)))
    .child(line("Open", fruit_select(s, "select").appearance("Field").build(k, layer)))
}

export function select_with_field(s: G, k: Kit, layer: El[]): El {
  return grid(0.0, 280.0).child(
    Field.new()
      .label("Fruit")
      .info()
      .prefix("Optional helper")
      .control(fruit_select(s, "select").build(k, layer))
      .suffix("After selection")
      .build(k),
  )
}
