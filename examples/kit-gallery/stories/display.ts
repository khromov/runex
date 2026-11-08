// Card, List, Accordion, Collapsible, Badge, Keybind, Spinner, Loader, Progress and SegmentedControl.

import { Color, type El, type Icon, TextStyle, type Tx, col, row, text, theme } from "runex-js"
import {
  Accordion, AccordionItem, Badge, Button, Card, Collapsible, Keybind, type KeybindVariant, type Kit, List, ListItem, Loader,
  Progress, RollingText, ScrollBarStyle, SegmentedControl, Spinner,
} from "runex-js/kit"
import { icons as ic } from "runex-js/theme-opencode"

import type { G } from "../main.ts"
import { flip, parse_usize } from "../stories.ts"

// Card, List, Accordion, Collapsible

function card(k: Kit, accent: Color | null, icon: Icon | null): El {
  let c = Card.new()
    .title("Card title", icon)
    .description("Small supporting text.")
    .action(Button.new("Action").build(k))
  if (accent !== null) {
    c = c.accent(accent)
  }
  return c.build(k)
}

export function card_normal(_: G, k: Kit, __: El[]): El {
  return card(k, null, null)
}
export function card_error(_: G, k: Kit, __: El[]): El {
  return card(k, k.c.danger.icon, ic.CIRCLE_BAN_SIGN_BOLD)
}
export function card_warning(_: G, k: Kit, __: El[]): El {
  return card(k, k.c.warning.icon, ic.WARNING_BOLD)
}
export function card_success(_: G, k: Kit, __: El[]): El {
  return card(k, k.c.success.icon, ic.CIRCLE_CHECK_BOLD)
}
export function card_info(_: G, k: Kit, __: El[]): El {
  return card(k, k.c.info.icon, ic.HELP_BOLD)
}

function list(s: G, items: string[], search: boolean): List {
  let l = List.new()
  if (search) {
    l = l.search(s.edits[3], "").on_search_edit((s: G) => s.edits[3])
  }
  for (const i of items) {
    l = l.item(ListItem.new(i))
  }
  return l
}

export function list_basic(s: G, k: Kit, _: El[]): El {
  return list(s, ["One", "Two", "Three", "Four"], true).build(k)
}
export function list_grouped(s: G, k: Kit, _: El[]): El {
  return List.new()
    .search(s.edits[3], "")
    .item(ListItem.new("Alpha").group("Group A"))
    .item(ListItem.new("Bravo").group("Group A"))
    .item(ListItem.new("Delta").group("Group B"))
    .build(k)
}
export function list_empty(s: G, k: Kit, _: El[]): El {
  return list(s, [], true).build(k)
}
export function list_with_add(s: G, k: Kit, _: El[]): El {
  return list(s, ["One", "Two"], true)
    .add_row(
      row()
        .px(8.0)
        .py(6.0)
        .child(text("Add item").font(TextStyle.new(14.0, 500.0).lh(21.0)).color(k.c.text_strong)),
    )
    .build(k)
}
export function list_divider(s: G, k: Kit, _: El[]): El {
  return list(s, ["One", "Two", "Three"], false).divider().build(k)
}
export function list_active_icon(s: G, k: Kit, _: El[]): El {
  return list(s, ["Alpha", "Beta", "Gamma"], false).active_icon(ic.CHEVRON_RIGHT).build(k)
}
export function list_no_search(s: G, k: Kit, _: El[]): El {
  return list(s, ["One", "Two", "Three"], false).build(k)
}

function accordion_content(k: Kit, s: string, padded: boolean): El {
  const t = text(s).font(TextStyle.new(13.0, 440.0).lh(24.0))
  if (padded) { return row().py(8.0).child(t.color(k.c.text_weak)) } else { return row().child(t.color(k.c.std_text)) }
}

/** The web story's `value="first"` arrives as a control arg and renders closed; so does this. */
export function accordion_basic(s: G, k: Kit, _: El[]): El {
  const open = s.picked("acc", "")
  const pick = (v: string) => {
    return (s: G) => {
      const cur = s.picked("acc", "")
      s.pick.set("acc", cur === v ? "" : v)
    }
  }
  return col().w(420.0).gap(8.0).child(
    Accordion.new()
      .item(
        AccordionItem.new("First")
          .expanded(open === "first")
          .child(accordion_content(k, "Accordion content.", true))
          .on_toggle(pick("first")),
      )
      .item(
        AccordionItem.new("Second")
          .expanded(open === "second")
          .child(accordion_content(k, "More content.", true))
          .on_toggle(pick("second")),
      )
      .build(k),
  )
}

export function accordion_multiple(s: G, k: Kit, _: El[]): El {
  return Accordion.new()
    .item(
      AccordionItem.new("First")
        .expanded(!s.is("a1"))
        .child(accordion_content(k, "Accordion content.", false))
        .on_toggle(flip("a1")),
    )
    .item(
      AccordionItem.new("Second")
        .expanded(!s.is("a2"))
        .child(accordion_content(k, "More content.", false))
        .on_toggle(flip("a2")),
    )
    .build(k)
}

/** The web story passes `value="first"` without `multiple` or `collapsible` and renders closed. */
export function accordion_single(_: G, k: Kit, __: El[]): El {
  return Accordion.new()
    .item(AccordionItem.new("First").expanded(false).child(accordion_content(k, "Accordion content.", false)))
    .build(k)
}

export function collapsible_basic(s: G, k: Kit, _: El[]): El {
  return Collapsible.new("Details", !s.is("c"))
    .child(
      row().pt(8.0).child(
        text("Optional details sit here.").font(TextStyle.new(13.0, 440.0).lh(24.0)).color(k.c.text_weak),
      ),
    )
    .on_toggle(flip("c"))
    .build(k)
}

export function collapsible_ghost(s: G, k: Kit, _: El[]): El {
  return Collapsible.new("Ghost trigger", s.is("c"))
    .ghost()
    .child(
      row().pt(8.0).child(text("Ghost content.").font(TextStyle.new(13.0, 440.0).lh(24.0)).color(k.c.text_weak)),
    )
    .on_toggle(flip("c"))
    .build(k)
}

// Badge, Keybind, Spinner, Loader, Progress, SegmentedControl

export function badge_basic(_: G, k: Kit, __: El[]): El {
  return row().child(Badge.new("Label").build(k))
}
export function badge_appearances(_: G, k: Kit, __: El[]): El {
  return row().gap(8.0).center_y().child(Badge.new("Standard").standard().build(k)).child(Badge.new("Compact").build(k))
}
export function badge_subtle(_: G, k: Kit, __: El[]): El {
  return row()
    .gap(8.0)
    .center_y()
    .child(Badge.new("1").variant("Subtle").build(k))
    .child(Badge.new("12").variant("Subtle").build(k))
}
export function badge_high_contrast(_: G, k: Kit, __: El[]): El {
  return row().gap(8.0).center_y().child(Badge.new("Label").build(k)).child(Badge.new("Label").high_contrast().build(k))
}
export function badge_accent(_: G, k: Kit, __: El[]): El {
  return row().child(Badge.new("New").variant("Accent").build(k))
}

export function keybind_playground(_: G, k: Kit, __: El[]): El {
  return row().child(Keybind.new(["⌘"]).build(k))
}
export function keybind_variants(_: G, k: Kit, __: El[]): El {
  return row()
    .gap(24.0)
    .center_y()
    .child(Keybind.new(["⌘"]).build(k))
    .child(Keybind.new(["⌘"]).variant("Ghost").build(k))
}
export function keybind_multiple(_: G, k: Kit, __: El[]): El {
  return row()
    .gap(24.0)
    .center_y()
    .child(Keybind.new(["⌘", "K"]).build(k))
    .child(Keybind.new(["⌘", "K"]).variant("Ghost").build(k))
    .child(Keybind.new(["Ctrl", "B"]).build(k))
    .child(Keybind.new(["Ctrl", "B"]).variant("Ghost").build(k))
}
export function keybind_all(_: G, k: Kit, __: El[]): El {
  const line = (name: string, v: KeybindVariant) => {
    return row()
      .gap(24.0)
      .center_y()
      .child(
        text(name)
          .w(50.0)
          .font(TextStyle.new(11.0, 440.0).lh(24.0))
          .color(theme.hex("#808080") ?? COLOR_DEFAULT),
      )
      .child(Keybind.new(["⌘"]).variant(v).build(k))
      .child(Keybind.new(["⌘", "K"]).variant(v).build(k))
      .child(Keybind.new(["⌘", "⇧", "P"]).variant(v).build(k))
      .child(Keybind.new(["Ctrl", "Shift", "B"]).variant(v).build(k))
  }
  return col().gap(16.0).child(line("Neutral", "Neutral")).child(line("Ghost", "Ghost"))
}

/** `Color::default()`, for `unwrap_or_default`. */
const COLOR_DEFAULT: Color = new Color({ r: 0.0, g: 0.0, b: 0.0, a: 0.0 })

/** Keyboard symbols next to capitals, in both families at 13 and 15 pt, then keycaps. */
export function keybind_symbols(_: G, k: Kit, __: El[]): El {
  const SAMPLE = "⌘K ⇧P ⏎ ⌫ ⎋ ⌥⌃ ←↑ HP"
  let c = col().gap(10.0)
  for (const mono of [false, true]) {
    for (const size of [13.0, 15.0]) {
      let font = TextStyle.new(size, 500.0).lh(Math.fround(size * 1.5))
      font = mono ? font.mono() : font
      const label = `${mono ? "Plex Mono" : "Inter"} ${size}`
      c = c.child(
        row()
          .gap(16.0)
          .center_y()
          .child(text(label).w(96.0).font(TextStyle.new(11.0, 440.0).lh(16.0)).color(k.c.text_faint))
          .child(text(SAMPLE).font(font).color(k.c.text_base)),
      )
    }
    const kk = k.clone()
    if (mono) {
      // `kk.ty.small_medium = kk.ty.small_medium.mono()`: `kk.ty` reads a copy of the `Type`, so
      // set the field on it and store it back.
      const ty = kk.ty
      ty.small_medium = ty.small_medium.mono()
      kk.ty = ty
    }
    let caps = row().gap(12.0).center_y().child(
      text(mono ? "Plex Mono caps" : "Inter caps")
        .w(96.0)
        .font(TextStyle.new(11.0, 440.0).lh(16.0))
        .color(k.c.text_faint),
    )
    const sets: string[][] = [["⌘", "⇧", "P"], ["⇧", "⏎"], ["⌫"], ["⎋"], ["⌥", "⌃", "K"], ["←", "↑"]]
    for (const keys of sets) {
      caps = caps.child(Keybind.new(keys).build(kk))
    }
    c = c.child(caps)
  }
  return c
}

export function spinner_basic(_: G, k: Kit, __: El[]): El {
  return row().child(Spinner.new().build(k))
}
export function spinner_sizes(_: G, k: Kit, __: El[]): El {
  return row()
    .gap(16.0)
    .center_y()
    .child(Spinner.new().size(12.0).build(k))
    .child(Spinner.new().size(20.0).build(k))
    .child(Spinner.new().size(28.0).build(k))
}
export function loader_basic(_: G, k: Kit, __: El[]): El {
  return row().child(Loader.new().build(k))
}
export function loader_sizes(_: G, k: Kit, __: El[]): El {
  return row()
    .gap(16.0)
    .center_y()
    .child(Loader.new().size(12.0).build(k))
    .child(Loader.new().build(k))
    .child(Loader.new().size(24.0).build(k))
}
export function progress_basic(_: G, k: Kit, __: El[]): El {
  return Progress.new(0.6).label("Progress").show_value().build(k)
}
export function progress_no_label(_: G, k: Kit, __: El[]): El {
  return Progress.new(0.3).build(k)
}
export function progress_indeterminate(_: G, k: Kit, __: El[]): El {
  return Progress.new(null).label("Loading").build(k)
}

export function segmented_basic(s: G, k: Kit, _: El[]): El {
  const sel = parse_usize(s.picked("seg", "0")) ?? 0
  return row().child(
    SegmentedControl.new(["Label", "Label", "Label", "Label"], sel)
      .on_pick((s: G, i: number, _: Tx) => {
        s.pick.set("seg", String(i))
      })
      .build(k),
  )
}
export function segmented_controlled(s: G, k: Kit, _: El[]): El {
  const sel = parse_usize(s.picked("seg", "1")) ?? 1
  return col()
    .gap(12.0)
    .items_start()
    .child(
      SegmentedControl.new(["List", "Grid", "Board"], sel)
        .label("View")
        .on_pick((s: G, i: number, _: Tx) => {
          s.pick.set("seg", String(i))
        })
        .build(k),
    )
    .child(
      text(`Value: ${["a", "b", "c"][Math.min(sel, 2)]}`)
        .font(TextStyle.new(12.0, 440.0).lh(24.0))
        .color(theme.hex("#808080") ?? COLOR_DEFAULT),
    )
}

/**
 * A copy label and countdown, sans and mono. Each press of "Roll" advances one step:
 * "Copy password" → "Copied, clears in 0:30" → "… 0:29", and the countdown "0:30" → "0:29" → ….
 */
export function rolling_text_basic(s: G, k: Kit, _: El[]): El {
  const step = parse_u32(s.picked("roll", "0")) ?? 0
  const label = step === 0 ? "Copy password" : `Copied, clears in 0:${String(31 - Math.min(step, 31)).padStart(2, "0")}`
  const count = `0:${String(30 - Math.min(step, 30)).padStart(2, "0")}`
  const big = TextStyle.new(28.0, 600.0)
  const line = (name: string, e: El) => row().gap(12.0).center_y().child(text(name).font(k.ty.small).color(k.c.text_faint).w(56.0)).child(e)
  return col()
    .gap(14.0)
    .child(
      row()
        .gap(8.0)
        .child(
          Button.new("Roll")
            .on_press((s: G) => {
              const n = parse_u32(s.picked("roll", "0")) ?? 0
              s.pick.set("roll", String(n + 1))
            })
            .build(k)
            .key("roll"),
        )
        .child(Button.new(label).rolling("roll-button").build(k).key("rolling-button"))
        .child(Button.new("Cancel").build(k).key("cancel")),
    )
    .child(line("Sans", RollingText.new("roll-sans", label).font(k.ty.body).build(k)))
    .child(line("Mono", RollingText.new("roll-mono", label).font(k.ty.mono).build(k)))
    .child(line("Centred", row().w(260.0).center().child(RollingText.new("roll-centre", label).font(k.ty.body).build(k))))
    .child(line("Count", RollingText.new("count-sans", count).font(big).from("Top").build(k)))
    .child(line("", RollingText.new("count-mono", count).font(big.mono()).from("Top").build(k)))
}

/**
 * `ScrollBarStyle::scroll_view`: the `@opencode/ui` ScrollView thumb, hidden at rest and shown while
 * the pointer is over the list or it scrolls.
 */
export function scroll_view_thumb(_: G, k: Kit, __: El[]): El {
  const rows = Array.from({ length: 24 }, (_, j) => j + 1).map((i) => row().key(`row${i}`).h(28.0).px(12.0).center_y()
    .child(text(`Row ${i}`).font(k.ty.ui_compact).color(k.c.text_base)))
  return col().key("list").w(240.0).h(180.0).radius(k.radius.md).fill(k.c.bg_base).border(1.0, k.c.border_weak)
    .scroll({ stick_bottom: false })
    .child(col().children(rows))
    .scroll_bar_styled(ScrollBarStyle.scroll_view(k))
}

/** `str::parse::<u32>()`. */
function parse_u32(v: string): number | null {
  const n = parse_usize(v)
  return n !== null && n <= 0xffff_ffff ? n : null
}
