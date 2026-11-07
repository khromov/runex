// Button, IconButton, Switch, Checkbox and Radio.

import { type El, TextStyle, col, row, text } from "runex-js"
import {
  Button, type ButtonVariant, Checkbox, type ControlSize, IconButton, type IconButtonVariant, type Kit, RadioGroup,
  RadioItem, type State, Switch,
} from "runex-js/kit"
import { icons as ic } from "runex-js/theme-opencode"

import type { G } from "../main.ts"
import { STATES, cap_first, caption, flex, flip, title_case } from "../stories.ts"

// Button

export function button_playground(_: G, k: Kit, __: El[]): El {
  return row().child(Button.new("Button").build(k))
}

export function button_variants(_: G, k: Kit, __: El[]): El {
  return flex(12.0)
    .child(Button.new("Neutral").variant("Neutral").build(k))
    .child(Button.new("Danger").variant("Danger").build(k))
    .child(Button.new("Warning").variant("Warning").build(k))
    .child(Button.new("Contrast").variant("Contrast").build(k))
    .child(Button.new("Submit").variant("Submit").build(k))
    .child(Button.new("Ghost").variant("Ghost").build(k))
    .child(Button.new("Ghost muted").variant("GhostMuted").icon(ic.EDIT).build(k))
    .child(Button.new("Ghost faint").variant("GhostFaint").icon(ic.EDIT).build(k))
    .child(Button.new("Loading").variant("Loading").build(k))
}

export function button_sizes(_: G, k: Kit, __: El[]): El {
  return flex(12.0)
    .child(Button.new("Mini").control_size("Mini").build(k))
    .child(Button.new("Small").control_size("Small").build(k))
    .child(Button.new("Regular").build(k))
    .child(Button.new("Large").control_size("Large").build(k))
    .child(Button.new("Extra large").control_size("ExtraLarge").build(k))
}

export function button_icon(_: G, k: Kit, __: El[]): El {
  return flex(12.0)
    .child(Button.new("Regular").icon(ic.PLUS).build(k))
    .child(Button.new("Large").variant("Contrast").control_size("Large").icon(ic.PLUS).build(k))
}

export function button_all_states(_: G, k: Kit, __: El[]): El {
  const variants: [string, ButtonVariant][] = [
    ["neutral", "Neutral"],
    ["danger", "Danger"],
    ["warning", "Warning"],
    ["contrast", "Contrast"],
    ["submit", "Submit"],
    ["ghost", "Ghost"],
    ["ghost-muted", "GhostMuted"],
    ["ghost-faint", "GhostFaint"],
    ["loading", "Loading"],
  ]
  let c = col().gap(12.0)
  for (const [name, v] of variants) {
    let r = row().gap(8.0).flex_wrap()
    for (const [state, st] of STATES) {
      r = r.child(Button.new(cap_first(state)).variant(v).state(st).build(k).key(`${name}-${state}`))
    }
    c = c.child(col().gap(8.0).child(caption(k, title_case(name))).child(r))
  }
  return c
}

// IconButton

export function icon_button_playground(_: G, k: Kit, __: El[]): El {
  return row().child(IconButton.new(ic.PLUS).label("Add").build(k))
}

export function icon_button_variants(_: G, k: Kit, __: El[]): El {
  return flex(12.0)
    .child(IconButton.new(ic.PLUS).label("Add").variant("Neutral").build(k))
    .child(IconButton.new(ic.PLUS).label("Add").variant("Contrast").build(k))
    .child(IconButton.new(ic.ARROW_UP).label("Send").variant("Submit").build(k))
    .child(IconButton.new(ic.PLUS).label("Add").variant("Ghost").build(k))
}

export function icon_button_sizes(_: G, k: Kit, __: El[]): El {
  return flex(12.0)
    .child(IconButton.new(ic.PLUS).label("Add").control_size("Mini").build(k))
    .child(IconButton.new(ic.PLUS).label("Add").control_size("Small").build(k))
    .child(IconButton.new(ic.PLUS).label("Add").build(k))
    .child(IconButton.new(ic.PLUS).label("Add").control_size("Large").build(k))
    .child(IconButton.new(ic.PLUS).label("Add").control_size("ExtraLarge").build(k))
}

export function icon_button_all_states(_: G, k: Kit, __: El[]): El {
  const variants: [string, IconButtonVariant][] = [["neutral", "Neutral"], ["contrast", "Contrast"], ["submit", "Submit"], ["ghost", "Ghost"]]
  let c = col().gap(12.0)
  for (const [name, v] of variants) {
    let r = row().gap(8.0).flex_wrap()
    for (const [state, st] of STATES) {
      r = r.child(IconButton.new(ic.PLUS).label("Add").variant(v).state(st).build(k).key(`${name}-${state}`))
    }
    c = c.child(col().gap(8.0).child(caption(k, title_case(name))).child(r))
  }
  return c
}

// Switch

/** `defaultChecked` items read as on until toggled. */
function on_by_default(s: G, key: string): boolean {
  return !s.is(key)
}

export function switch_basic(s: G, k: Kit, _: El[]): El {
  return row().child(Switch.new(on_by_default(s, "sw")).label("Enable notifications").on_toggle(flip("sw")).build(k))
}

export function switch_appearances(s: G, k: Kit, _: El[]): El {
  return col()
    .gap(12.0)
    .child(Switch.new(on_by_default(s, "std")).label("Standard").standard().on_toggle(flip("std")).build(k))
    .child(Switch.new(on_by_default(s, "cmp")).label("Compact").on_toggle(flip("cmp")).build(k))
}

export function switch_states(s: G, k: Kit, _: El[]): El {
  return col()
    .gap(12.0)
    .child(Switch.new(on_by_default(s, "a")).label("Enabled").on_toggle(flip("a")).build(k))
    .child(Switch.new(s.is("b")).label("Disabled").on_toggle(flip("b")).build(k))
    .child(Switch.new(false).label("Disabled switch").disabled(true).build(k))
}

/** Every control size off, on, hovered and pressed. */
export function switch_sizes(s: G, k: Kit, _: El[]): El {
  const sizes: [string, ControlSize][] = [["Mini", "Mini"], ["Small", "Small"], ["Regular", "Regular"],
    ["Large", "Large"], ["Extra large", "ExtraLarge"]]
  return col().gap(12.0).children(sizes.map(([name, size]) => {
    const key = `size-${name}`
    const sw = (on: boolean, st: State) => Switch.new(on).control_size(size).state(st).build(k)
    return row().gap(12.0).center_y()
      .child(caption(k, name).w(80.0))
      .child(Switch.new(s.is(key)).control_size(size).label(name).hide_label().on_toggle((s: G) => s.flip(key)).build(k))
      .child(sw(true, "Rest"))
      .child(sw(false, "Hover"))
      .child(sw(true, "Pressed"))
  }))
}

export function switch_hidden_label(s: G, k: Kit, _: El[]): El {
  return row().child(Switch.new(on_by_default(s, "sw")).label("Hidden label").hide_label().on_toggle(flip("sw")).build(k))
}

// Checkbox

export function checkbox_basic(s: G, k: Kit, _: El[]): El {
  return row().child(Checkbox.new(on_by_default(s, "cb")).label("Checkbox").on_toggle(flip("cb")).build(k))
}

export function checkbox_states(s: G, k: Kit, _: El[]): El {
  return col()
    .gap(12.0)
    .child(Checkbox.new(on_by_default(s, "a")).label("Checked").on_toggle(flip("a")).build(k))
    .child(Checkbox.new(s.is("b")).label("Unchecked").on_toggle(flip("b")).build(k))
    .child(Checkbox.new(false).label("Disabled").disabled(true).build(k))
    .child(
      Checkbox.new(s.is("d")).label("With description").description("Helper text").on_toggle(flip("d")).build(k),
    )
}

export function checkbox_custom_icon(s: G, k: Kit, _: El[]): El {
  return row().child(
    Checkbox.new(on_by_default(s, "cb")).label("Custom icon").icon(ic.CHECK).on_toggle(flip("cb")).build(k),
  )
}

export function checkbox_hidden_label(s: G, k: Kit, _: El[]): El {
  return row().child(Checkbox.new(s.is("cb")).label("Hidden label").hide_label().on_toggle(flip("cb")).build(k))
}

// Radio

function radio_group(
  s: G,
  group: string,
  default_: string,
  label: string,
  items: [string, string, string | null][],
): RadioGroup {
  const current = s.picked(group, default_)
  let g = RadioGroup.new().label(label)
  for (const [value, l, d] of items) {
    const v = value
    let item = RadioItem.new(l, current === v).on_select((s: G) => {
      s.pick.set(group, v)
    })
    if (d !== null) {
      item = item.description(d)
    }
    g = g.item(item)
  }
  return g
}

export function radio_basic(s: G, k: Kit, _: El[]): El {
  return radio_group(
    s,
    "freq",
    "daily",
    "Notification frequency",
    [
      ["daily", "Daily", "Once per day at 9am."],
      ["weekly", "Weekly", "Every Monday morning."],
      ["never", "Never", "No notifications."],
    ],
  )
    .build(k)
}

export function radio_controlled(s: G, k: Kit, _: El[]): El {
  const v = s.picked("ctl", "daily")
  return col()
    .gap(12.0)
    .child(
      radio_group(
        s,
        "ctl",
        "daily",
        "Controlled",
        [["daily", "Daily", null], ["weekly", "Weekly", null], ["never", "Never", null]],
      )
        .build(k),
    )
    .child(text(`Value: ${v}`).font(TextStyle.new(12.0, 440.0).lh(24.0)).color(k.c.text_faint))
}

export function radio_states(s: G, k: Kit, _: El[]): El {
  const disabled_item = RadioGroup.new()
    .label("Disabled item")
    .item(RadioItem.new("Enabled", s.picked("di", "a") === "a").on_select((s: G) => {
      s.pick.set("di", "a")
    }))
    .item(RadioItem.new("Disabled", false).disabled(true))
  return col()
    .gap(20.0)
    .child(
      radio_group(
        s,
        "def",
        "a",
        "Default",
        [["a", "Option A", null], ["b", "Option B", "Has a description."]],
      )
        .build(k),
    )
    .child(
      RadioGroup.new()
        .label("Disabled group")
        .disabled(true)
        .item(RadioItem.new("Option A", true))
        .item(RadioItem.new("Option B", false))
        .build(k),
    )
    .child(disabled_item.build(k))
    .child(
      radio_group(s, "inv", "a", "Invalid", [["a", "Option A", null], ["b", "Option B", null]])
        .description("Pick one option.")
        .invalid(true)
        .build(k),
    )
}
