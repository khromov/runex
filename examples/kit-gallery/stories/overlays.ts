// Popover, Menu, Tooltip, HoverCard and Toast.

import { type El, Icon, TextStyle, type Tx, col, row, text } from "runex-js"
import {
  Button, HoverCard, Keybind, type Kit, Menu, MenuEntry, MenuItem, Popover, Toast, ToastRegion, Tooltip, body_text,
  overlay_text,
} from "runex-js/kit"
import { icons as ic } from "runex-js/theme-opencode"

import type { G } from "../main.ts"
import { close, flip, is_open, toggle } from "../stories.ts"

function trigger_text(k: Kit, s: string): El {
  return body_text(k, s)
}

export function popover_basic(s: G, k: Kit, layer: El[]): El {
  return row().child(
    Popover.new("popover")
      .trigger(trigger_text(k, "Open popover"))
      .title("Popover")
      .description("Optional description")
      .child(overlay_text(k, "Popover content"))
      .open(is_open(s, "popover"))
      .on_close(close)
      .build(k, layer)
      .on_press(toggle("popover")),
  )
}

export function popover_controlled(s: G, k: Kit, layer: El[]): El {
  return row().child(
    Popover.new("popover")
      .trigger(trigger_text(k, "Toggle popover"))
      .title("Controlled")
      .description("Open state is controlled")
      .child(overlay_text(k, "Controlled content"))
      .open(is_open(s, "popover"))
      .on_close(close)
      .build(k, layer)
      .on_press(toggle("popover")),
  )
}

function menu_button(k: Kit, label: string, key: string, open: boolean): El {
  return Button.new(label).expanded(open).on_press(toggle(key)).build(k)
}

export function menu_basic(s: G, k: Kit, layer: El[]): El {
  const open = is_open(s, "menu")
  return row().child(
    Menu.new("menu")
      .trigger(menu_button(k, "Open menu", "menu", open))
      .item(MenuItem.new("New file").on_select(close))
      .item(MenuItem.new("Open file").on_select(close))
      .item(MenuItem.new("Save").on_select(close))
      .separator()
      .item(MenuItem.new("Print").disabled(true))
      .open(open)
      .on_close(close)
      .build(k, layer),
  )
}

export function menu_appearances(s: G, k: Kit, layer: El[]): El {
  const open = is_open(s, "both")
  return row()
    .gap(16.0)
    .child(
      Menu.new("standard")
        .standard()
        .trigger(menu_button(k, "Standard", "both", open))
        .item(MenuItem.new("New file"))
        .item(MenuItem.new("Open file"))
        .open(open)
        .build(k, layer),
    )
    .child(
      Menu.new("compact")
        .trigger(menu_button(k, "Compact", "both", open))
        .item(MenuItem.new("New file"))
        .item(MenuItem.new("Open file"))
        .open(open)
        .build(k, layer),
    )
}

export function menu_rich(s: G, k: Kit, layer: El[]): El {
  const open = is_open(s, "menu")
  const avatar = row()
    .size(16.0, 16.0)
    .center()
    .radius(4.0)
    .fill(k.c.layer_03)
    .child(text("A").font(k.ty.small_medium).color(k.c.text_base))
  return row().child(
    Menu.new("menu")
      .trigger(menu_button(k, "Open rich menu", "menu", open))
      .min_width(240.0)
      .item(MenuItem.new("Text").lead(avatar).icon(ic.PLUS).shortcut("⇧ D").badge("Label"))
      .item(MenuItem.new("New window").icon(ic.PLUS).shortcut("⌘ N"))
      .item(MenuItem.new("Save as…").icon(ic.PLUS).shortcut("⌘ S").badge("Beta"))
      .separator()
      .item(MenuItem.new("Print").icon(ic.PLUS).shortcut("⌘ P").disabled(true))
      .open(open)
      .on_close(close)
      .build(k, layer),
  )
}

export function menu_checkbox(s: G, k: Kit, layer: El[]): El {
  const open = is_open(s, "menu")
  return row().child(
    Menu.new("menu")
      .trigger(menu_button(k, "View", "menu", open))
      .min_width(200.0)
      .item(MenuItem.new("Word wrap").shortcut("⌥ Z").checked(!s.is("wrap")).on_select(flip("wrap")))
      .item(MenuItem.new("Minimap").checked(s.is("minimap")).on_select(flip("minimap")))
      .item(MenuItem.new("Ruler").checked(false).disabled(true))
      .open(open)
      .on_close(close)
      .build(k, layer),
  )
}

export function menu_radio(s: G, k: Kit, layer: El[]): El {
  const open = is_open(s, "menu")
  const theme = s.picked("theme", "system")
  const pick = (v: string) => {
    return (s: G) => {
      s.pick.set("theme", v)
    }
  }
  return row().child(
    Menu.new("menu")
      .trigger(menu_button(k, "Theme", "menu", open))
      .min_width(200.0)
      .group_label("Appearance")
      .item(MenuItem.new("Light").checked(theme === "light").on_select(pick("light")))
      .item(MenuItem.new("Dark").checked(theme === "dark").on_select(pick("dark")))
      .item(MenuItem.new("System").badge("Auto").checked(theme === "system").on_select(pick("system")))
      .open(open)
      .on_close(close)
      .build(k, layer),
  )
}

export function menu_submenu(s: G, k: Kit, layer: El[]): El {
  const open = is_open(s, "menu")
  const recent: MenuEntry[] = [
    MenuEntry.item(MenuItem.new("project-alpha.tsx")),
    MenuEntry.item(MenuItem.new("project-beta.tsx")),
    MenuEntry.item(MenuItem.new("project-gamma.tsx")),
    "Separator",
    MenuEntry.item(MenuItem.new("Clear recent")),
  ]
  return row().child(
    Menu.new("menu")
      .trigger(menu_button(k, "File", "menu", open))
      .min_width(200.0)
      .item(MenuItem.new("New file").shortcut("⌘ N"))
      .item(MenuItem.new("Open file").shortcut("⌘ O"))
      .item(MenuItem.new("Open recent").submenu(recent, s.is("recent")).on_select(flip("recent")))
      .separator()
      .item(MenuItem.new("Save").shortcut("⌘ S"))
      .item(MenuItem.new("Save as…").shortcut("⇧⌘ S"))
      .open(open)
      .on_close(close)
      .build(k, layer),
  )
}

/** The tooltip stories' frame: 80 points of padding, centred. */
function tip_frame(e: El): El {
  return row().w_full().padding(80.0).center().child(e)
}

export function tooltip_simple(s: G, k: Kit, layer: El[]): El {
  const t = Tooltip.new("tip").trigger(body_text(k, "Hover me")).open(is_open(s, "tip"))
  return tip_frame(t.text(k, "Tooltip Text").build(k, layer))
}

export function tooltip_keybind(s: G, k: Kit, layer: El[]): El {
  const t = Tooltip.new("tip").trigger(body_text(k, "Hover me")).open(is_open(s, "tip"))
  return tip_frame(t.text(k, "Tooltip Text").child(Keybind.new(["⌘", "⌘"]).build(k)).build(k, layer))
}

export function tooltip_path(s: G, k: Kit, layer: El[]): El {
  const t = Tooltip.new("tip").trigger(body_text(k, "Hover me")).open(is_open(s, "tip"))
  const font = t.font(k)
  const parts = row()
    .gap(3.0)
    .child(text("Components").font(font).color(k.c.text_base))
    .child(text("/").font(font).color(k.c.text_faint))
    .child(text("Tooltip").font(font).color(k.c.text_base))
  return tip_frame(t.child(parts).build(k, layer))
}

export function tooltip_title_description(s: G, k: Kit, layer: El[]): El {
  const t = Tooltip.new("tip").trigger(body_text(k, "Hover me")).open(is_open(s, "tip"))
  const font = t.font(k)
  return tip_frame(
    t.child(text("Title").font(font).color(k.c.text_base))
      .child(text("·").font(font).color(k.c.text_faint))
      .child(text("Description").font(font).color(k.c.text_faint))
      .build(k, layer),
  )
}

export function hover_card_basic(s: G, k: Kit, layer: El[]): El {
  return row().child(
    HoverCard.new("card")
      .trigger(body_text(k, "Hover me"))
      .child(
        col()
          .gap(6.0)
          .child(text("Preview").font(TextStyle.new(13.0, 600.0).lh(24.0)).color(k.c.std_text))
          .child(
            text("Short supporting text.").font(TextStyle.new(12.0, 440.0).lh(24.0)).color(k.c.text_weak),
          ),
      )
      .open(is_open(s, "card"))
      .build(k, layer),
  )
}

const DOWNLOAD: Icon = new Icon({
  name: "story-download",
  view: 16.0,
  body: `<path d="M13.5554 10.4453V13.5564H11.7777H4.22211C3.23989 13.5564 2.44434 13.5564 2.44434 13.5564V10.4453" stroke="currentColor"/><path d="M4.88867 6L7.99978 9.11111L11.1109 6" stroke="currentColor"/><path d="M8 9.11198V2.44531" stroke="currentColor"/>`,
})

export function toast_all(s: G, k: Kit, layer: El[]): El {
  const buttons = col()
    .gap(12.0)
    .items_start()
    .child(Button.new("Show download toast").on_press((s: G) => { s.open = "toast" }).build(k))
    .child(Button.new("Show saved toast").build(k))
    .child(Button.new("Show saving toast").build(k))
    .child(Button.new("Show unsaved changes toast").build(k))
  if (is_open(s, "toast")) {
    const t = Toast.new("download", "Download started...")
      .description("23% · 2 min left")
      .icon(k, DOWNLOAD)
      .closable()
      .action(k, "Run in background", true, (s: G, _: Tx) => { s.open = null })
      .action(k, "Cancel", false, (s: G, _: Tx) => { s.open = null })
      .build(k)
    layer.push(ToastRegion.new().toast(t).build(k))
  }
  return buttons
}
