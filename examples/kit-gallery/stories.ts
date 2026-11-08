// The stories, one function per `@opencode/ui` Storybook story id (title + export name).
// Layout wrappers copy each story's own inline styles.

import { type El, Stagger, TextEdit, TextStyle, Transition, type Tx, col, el, icon, row, text } from "runex-js"
import {
  Button, ComboboxState, Dialog, IconButton, type Kit, Loader, PopupItem, PopupList, SegmentedControl, Spinner, type State,
  Switch, Checkbox, TextInput, body_text, glyphs,
} from "runex-js/kit"
import { icons as ic } from "runex-js/theme-opencode"

import type { G } from "./main.ts"

import * as combobox from "./stories/combobox.ts"
import {
  button_all_states, button_icon, button_playground, button_sizes, button_variants, checkbox_basic, checkbox_custom_icon,
  checkbox_hidden_label, checkbox_states, icon_button_all_states, icon_button_playground, icon_button_sizes,
  icon_button_variants, radio_basic, radio_controlled, radio_states, switch_appearances, switch_basic, switch_hidden_label,
  switch_sizes, switch_states, switch_web,
} from "./stories/controls.ts"
import {
  accordion_basic, accordion_multiple, accordion_single, badge_accent, badge_appearances, badge_basic, badge_high_contrast,
  badge_subtle, card_error, card_info, card_normal, card_success, card_warning, collapsible_basic, collapsible_ghost,
  keybind_all, keybind_multiple, keybind_playground, keybind_symbols, keybind_variants, list_active_icon, list_basic,
  list_divider, list_empty, list_grouped, list_no_search, list_with_add, loader_basic, loader_sizes, progress_basic,
  progress_indeterminate, progress_no_label, rolling_text_basic, scroll_view_thumb, segmented_basic, segmented_controlled,
  spinner_basic, spinner_sizes,
} from "./stories/display.ts"
import * as icons from "./stories/icons.ts"
import {
  field_direct_child, field_invalid, field_text_input, field_textarea, select_disabled, select_grouped, select_invalid,
  select_playground, select_states, select_with_field, text_input_appearances, text_input_controlled, text_input_copy,
  text_input_playground, text_input_states, text_input_with_field, textarea_controlled, textarea_playground,
  textarea_states, textarea_with_field,
} from "./stories/inputs.ts"
import {
  markdown_basic, markdown_code, markdown_diagrams, markdown_lenient, markdown_mermaid_charts, markdown_mermaid_data,
  markdown_mermaid_flows, markdown_mermaid_git, markdown_mermaid_hover, markdown_mermaid_maps, markdown_mermaid_shapes,
  markdown_mermaid_streaming, markdown_mermaid_systems, markdown_stream_tail, markdown_streaming, markdown_table_styles,
  markdown_walkthrough,
} from "./stories/markdown.ts"
import {
  hover_card_basic, menu_appearances, menu_basic, menu_checkbox, menu_radio, menu_rich, menu_submenu, popover_basic,
  popover_controlled, toast_all, tooltip_keybind, tooltip_path, tooltip_simple, tooltip_title_description,
} from "./stories/overlays.ts"

export type Story = (s: G, k: Kit, layer: El[]) => El

/** The `stories!` macro: the story table and, for each story, its scene. */
function stories(list: [string, Story][]): { STORIES: [string, Story][]; SCENES: [string, (s: G) => void][] } {
  const SCENES = list.map(([id]): [string, (s: G) => void] => [id, (s: G) => {
    s.story = id
    s.combo = ComboboxState.default()
    if (id.startsWith("rune-combobox--")) {
      s.combo.open = true
      // `s.combo.search.focused = true`: `s.combo.search` reads a copy of the `TextEdit`, so set
      // the field on it and store it back.
      const search = s.combo.search
      search.focused = true
      s.combo.search = search
    }
    if (id === "rune-popup-list--composer") {
      s.edits[7] = TextEdit.new("/")
      s.edits[7].focused = true
    }
    s.open = OPENED.find(([i]) => i === id)?.[1] ?? null
  }])
  return { STORIES: list, SCENES }
}

/**
 * Stories whose web version opens an overlay (by default or through the harness's click):
 * their scene starts with that overlay open.
 */
const OPENED: [string, string][] = [
  ["ui-dialog--basic", "dialog"],
  ["rune-dialog--fit", "dialog-fit"],
  ["rune-popup-list--composer", "popup-list"],
  ["ui-menu--basic", "menu"],
  ["ui-menu--rich", "menu"],
  ["ui-menu--with-checkbox", "menu"],
  ["ui-menu--with-radio", "menu"],
  ["ui-menu--with-submenu", "menu"],
  ["ui-menu--appearances", "both"],
  ["ui-select--playground", "select"],
  ["ui-select--grouped", "select"],
  ["rune-select--states", "select"],
  ["components-popover--basic", "popover"],
  ["components-popover--controlled", "popover"],
  ["components-hover-card--basic", "card"],
  ["ui-tooltip--simple", "tip"],
  ["ui-tooltip--with-keybind", "tip"],
  ["ui-tooltip--path", "tip"],
  ["ui-tooltip--title-description", "tip"],
  ["ui-toast--all-examples", "toast"],
]

export function is_open(s: G, key: string): boolean {
  return s.open === key || s.open === "both"
}

export function toggle(key: string): (s: G) => void {
  return (s: G) => s.toggle_open(key)
}

export function close(s: G): void {
  s.open = null
}

export function flip(key: string): (s: G) => void {
  return (s: G) => s.flip(key)
}

export const { STORIES, SCENES } = stories([
  ["rune-combobox--searchable", combobox.searchable],
  ["rune-combobox--animated-filter", combobox.animated_filter],
  ["ui-dialog--basic", dialog_basic],
  ["motion-focus-modal", motion_focus_modal],
  ["motion-stagger-list", motion_stagger_list],
  ["ui-button--playground", button_playground],
  ["ui-button--variants", button_variants],
  ["ui-button--sizes", button_sizes],
  ["ui-button--icon", button_icon],
  ["ui-button--all-states", button_all_states],
  ["ui-icon-button--playground", icon_button_playground],
  ["ui-icon-button--variants", icon_button_variants],
  ["ui-icon-button--sizes", icon_button_sizes],
  ["ui-icon-button--all-states", icon_button_all_states],
  ["ui-switch--basic", switch_basic],
  ["ui-switch--appearances", switch_appearances],
  ["ui-switch--states", switch_states],
  ["ui-switch--hidden-label", switch_hidden_label],
  ["rune-switch--web", switch_web],
  ["ui-checkbox--basic", checkbox_basic],
  ["ui-checkbox--states", checkbox_states],
  ["ui-checkbox--custom-icon", checkbox_custom_icon],
  ["ui-checkbox--hidden-label", checkbox_hidden_label],
  ["ui-radio--basic", radio_basic],
  ["ui-radio--controlled", radio_controlled],
  ["ui-radio--states", radio_states],
  ["ui-text-input--playground", text_input_playground],
  ["ui-text-input--with-copy-button", text_input_copy],
  ["ui-text-input--controlled", text_input_controlled],
  ["ui-text-input--appearances", text_input_appearances],
  ["ui-text-input--with-field", text_input_with_field],
  ["ui-text-input--states", text_input_states],
  ["ui-textarea--playground", textarea_playground],
  ["ui-textarea--controlled", textarea_controlled],
  ["ui-textarea--with-field", textarea_with_field],
  ["ui-textarea--states", textarea_states],
  ["ui-field--text-input-example", field_text_input],
  ["ui-field--text-input-direct-child", field_direct_child],
  ["ui-field--textarea-example", field_textarea],
  ["ui-field--invalid", field_invalid],
  ["ui-select--playground", select_playground],
  ["ui-select--grouped", select_grouped],
  ["ui-select--invalid", select_invalid],
  ["ui-select--disabled", select_disabled],
  ["ui-select--with-field", select_with_field],
  ["rune-select--states", select_states],
  ["components-popover--basic", popover_basic],
  ["components-popover--controlled", popover_controlled],
  ["ui-menu--basic", menu_basic],
  ["ui-menu--appearances", menu_appearances],
  ["ui-menu--rich", menu_rich],
  ["ui-menu--with-checkbox", menu_checkbox],
  ["ui-menu--with-radio", menu_radio],
  ["ui-menu--with-submenu", menu_submenu],
  ["ui-tooltip--simple", tooltip_simple],
  ["ui-tooltip--with-keybind", tooltip_keybind],
  ["ui-tooltip--path", tooltip_path],
  ["ui-tooltip--title-description", tooltip_title_description],
  ["components-hover-card--basic", hover_card_basic],
  ["ui-toast--all-examples", toast_all],
  ["components-card--normal", card_normal],
  ["components-card--error", card_error],
  ["components-card--warning", card_warning],
  ["components-card--success", card_success],
  ["components-card--info", card_info],
  ["components-list--basic", list_basic],
  ["components-list--grouped", list_grouped],
  ["components-list--empty", list_empty],
  ["components-list--with-add", list_with_add],
  ["components-list--divider", list_divider],
  ["components-list--active-icon", list_active_icon],
  ["components-list--no-search", list_no_search],
  ["ui-accordion--basic", accordion_basic],
  ["ui-accordion--multiple", accordion_multiple],
  ["ui-accordion--non-collapsible", accordion_single],
  ["components-collapsible--basic", collapsible_basic],
  ["components-collapsible--ghost", collapsible_ghost],
  ["ui-badge--basic", badge_basic],
  ["ui-badge--appearances", badge_appearances],
  ["ui-badge--subtle", badge_subtle],
  ["ui-badge--high-contrast", badge_high_contrast],
  ["ui-badge--accent", badge_accent],
  ["ui-keybind--playground", keybind_playground],
  ["ui-keybind--variants", keybind_variants],
  ["ui-keybind--multiple-keys", keybind_multiple],
  ["ui-keybind--all-examples", keybind_all],
  ["components-spinner--basic", spinner_basic],
  ["components-spinner--sizes", spinner_sizes],
  ["ui-loader--basic", loader_basic],
  ["ui-loader--sizes", loader_sizes],
  ["components-progress--basic", progress_basic],
  ["components-progress--no-label", progress_no_label],
  ["components-progress--indeterminate", progress_indeterminate],
  ["ui-segmented-control--basic", segmented_basic],
  ["ui-segmented-control--controlled", segmented_controlled],
  ["rune-keybind--symbols", keybind_symbols],
  ["rune-switch--sizes", switch_sizes],
  ["rune-scroll-view--thumb", scroll_view_thumb],
  ["rune-rolling-text--basic", rolling_text_basic],
  ["rune-markdown--basic", markdown_basic],
  ["rune-markdown--streaming", markdown_streaming],
  ["rune-markdown--stream-tail", markdown_stream_tail],
  ["rune-markdown--walkthrough", markdown_walkthrough],
  ["rune-markdown--diagrams", markdown_diagrams],
  ["rune-markdown--lenient", markdown_lenient],
  ["rune-markdown--mermaid-shapes", markdown_mermaid_shapes],
  ["rune-markdown--mermaid-charts", markdown_mermaid_charts],
  ["rune-markdown--mermaid-maps", markdown_mermaid_maps],
  ["rune-markdown--mermaid-git", markdown_mermaid_git],
  ["rune-markdown--mermaid-data", markdown_mermaid_data],
  ["rune-markdown--mermaid-systems", markdown_mermaid_systems],
  ["rune-markdown--mermaid-flows", markdown_mermaid_flows],
  ["rune-markdown--mermaid-hover", markdown_mermaid_hover],
  ["rune-markdown--mermaid-streaming", markdown_mermaid_streaming],
  ["rune-markdown--table-styles", markdown_table_styles],
  ["rune-markdown--code", markdown_code],
  ["rune-text--selectable-help", text_selectable_help],
  ["rune-text--truncate-middle", text_truncate_middle],
  ["rune-dialog--fit", dialog_fit],
  ["rune-popup-list--composer", popup_list_composer],
  ["rune-scroll-bar--basic", scroll_bar_basic],
  ["rune-scroll-bar--grow", scroll_bar_grow],
  ["components-file-icon--samples", icons.file_icon_samples],
  ["components-file-icon--folder", icons.file_icon_folder],
  ["ui-icon--gallery", icons.icon_gallery],
  ["rune-icon--catalog", icons.icon_catalog],
  ["rune-file-icon--catalog", icons.file_icon_catalog],
  ["rune-tree-icon--catalog", icons.tree_icon_catalog],
  ["rune-tree--files", icons.file_tree],
])

function popup_list_composer(s: G, k: Kit, layer: El[]): El {
  const entries = [
    ["review", "/review", "Review branch changes", glyphs.SPARKLE, "⏎", false],
    ["compact", "/compact", "Summarize the conversation", glyphs.FILE_TEXT, "⌘K", false],
    ["search", "/search", "Search workspace files", k.glyph.search, "⌘P", false],
    ["share", "/share", "Create a read-only link", k.glyph.lock, "", true],
  ] as const
  const q = s.edits[7].text.replace(/^\/+/, "").toLowerCase()
  const filtered = entries.filter(([, label, desc]) =>
    q === "" || label.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
  )
  const count = filtered.length
  const parsed = parse_usize(s.pick.get("popup-list") ?? "")
  const active = Math.min(parsed ?? 0, Math.max(count - 1, 0))
  const items = filtered.map(([id, label, desc, glyph, hint, disabled]) => {
    let item = PopupItem.new(id, label)
      .description(desc)
      .leading(icon(glyph, 14.0).color(k.c.icon_muted))
      .disabled(disabled)
    if (hint !== "") {
      item = item.trailing(text(hint).font(k.ty.small_medium).color(k.c.text_faint))
    }
    return item
  })
  PopupList.new("popup-list", "composer")
    .open(is_open(s, "popup-list"))
    .width(320.0)
    .items(items)
    .active(count > 0 ? active : null)
    .on_active((s: G, i: number) => { s.pick.set("popup-list", String(i)) })
    .on_choose((s: G, id: string, _: Tx) => {
      s.edits[7] = TextEdit.new(`/${id} `)
      s.edits[7].focused = true
      s.open = null
    })
    .build(k, layer)
  return TextInput.new(s.edits[7])
    .width(320.0)
    .placeholder("Type / for commands or @ to mention…")
    .animate_edit_layout()
    .on_edit((s: G) => s.edits[7])
    .on_change((s: G, _: Tx) => { s.open = "popup-list"; s.pick.set("popup-list", "0") })
    .build(k)
    .key("composer")
}

function dialog_basic(s: G, k: Kit, layer: El[]): El {
  Dialog.new("dialog", "Dialog").description("Description").open(is_open(s, "dialog"))
    .on_close(close).child(body_text(k, "Dialog body content.")).build(k, layer)
  return Button.new("Open dialog").on_press(toggle("dialog")).build(k).key("opener")
}

function dialog_fit(s: G, k: Kit, layer: El[]): El {
  const actions = row().w_full().padding(16.0).gap(8.0).justify_end()
    .child(Button.new("Cancel").variant("Ghost").on_press(close).build(k))
    .child(Button.new("Delete").on_press(close).build(k))
  Dialog.new("dialog-fit", "Delete item?").description("This cannot be undone.").width(400.0).fit()
    .open(is_open(s, "dialog-fit")).on_close(close).child(actions).build(k, layer)
  return Button.new("Open confirmation").on_press(toggle("dialog-fit")).build(k).key("opener")
}

function motion_focus_modal(s: G, k: Kit, layer: El[]): El {
  Dialog.new("dialog", "Loading").open(is_open(s, "dialog")).on_close(close)
    .child(row().gap(16.0).child(Spinner.new().build(k).key("spinner"))
      .child(Loader.new().build(k).key("loader")))
    .child(Button.new("Done").on_press(close).build(k).key("done")).build(k, layer)
  return col().gap(16.0)
    .child(Button.new("Open dialog").on_press(toggle("dialog")).build(k).key("opener"))
    .child(Switch.new(s.is("switch")).label("Sync").on_toggle((s: G) => s.flip("switch")).build(k).key("switch"))
    .child(Checkbox.new(s.is("check")).label("Remember").on_toggle((s: G) => s.flip("check")).build(k).key("check"))
    .child(SegmentedControl.new(["First", "Second"], s.is("second") ? 1 : 0)
      .on_pick((s: G, i: number, _: Tx) => { if (s.is("second") !== (i === 1)) { s.flip("second") } }).build(k))
}

/**
 * Five rows that rise and fade in one after another (`El::enter_delay` with a `Stagger`) and
 * leave together.
 */
function motion_stagger_list(s: G, k: Kit, _: El[]): El {
  const ROWS = ["Inbox", "Drafts", "Sent", "Archive", "Trash"]
  const stagger = Stagger.new(0.05)
  const rows = ROWS.map((label, i): [number, string] => [i, label]).filter(() => s.is("rows")).map(([i, label]) =>
    row().key(label).w(240.0).h(36.0).px(12.0).center_y().fill(k.c.surface_base).radius(k.radius.md)
      .child(text(label).font(k.ty.ui).color(k.c.text_base))
      .transition(Transition.offset(0.0, 12.0).combined(Transition.opacity()))
      .enter_delay(stagger.delay(i, ROWS.length))
  )
  return col().gap(8.0)
    .child(Button.new("Show rows").on_press((s: G) => s.flip("rows")).build(k).key("opener"))
    .child(col().key("rows").gap(4.0).children(rows))
}

export function render(s: G, k: Kit, overlays: El[]): El {
  const found = STORIES.find(([id]) => id === s.story)
  return found ? found[1](s, k, overlays) : index(s, k, overlays)
}

/** Every story stacked, for browsing in a window. */
function index(s: G, k: Kit, overlays: El[]): El {
  let c = col().key("index").gap(24.0)
  for (const [id, f] of STORIES) {
    c = c.child(col().key(id).gap(8.0).child(caption(k, id)).child(f(s, k, overlays)))
  }
  return c
}

/** The stories' `font-size: 12px; color: var(--text-weak)` labels (line height inherited). */
export function caption(k: Kit, label: string): El {
  return text(label).font(TextStyle.new(12.0, 440.0).lh(24.0)).color(k.c.text_weak)
}

/** `display: flex; gap; align-items: center; flex-wrap: wrap`. */
export function flex(gap: number): El {
  return row().gap(gap).center_y().flex_wrap()
}

/** CSS `text-transform: capitalize`: the first letter of every word (hyphens split words). */
export function title_case(s: string): string {
  let out = ""
  let start = true
  for (const ch of s) {
    if (start) {
      out += ch.toUpperCase()
    } else {
      out += ch
    }
    start = !/^[\p{Alphabetic}\p{N}]$/u.test(ch)
  }
  return out
}

/** The stories' own `toTitleCase`: only the first letter. */
export function cap_first(s: string): string {
  const [f, ...rest] = s
  return f === undefined ? "" : f.toUpperCase() + rest.join("")
}

/** `str::parse::<usize>()`: digits (an optional `+`), in range; anything else is `None`. */
export function parse_usize(v: string): number | null {
  if (!/^\+?[0-9]+$/.test(v)) return null
  const n = Number(v.replace(/^\+/, ""))
  return Number.isSafeInteger(n) ? n : null
}

export const STATES: [string, State][] = [
  ["default", "Rest"],
  ["hover", "Hover"],
  ["pressed", "Pressed"],
  ["focus", "Focus"],
  ["disabled", "Disabled"],
]

// ---------------------------------------------------------------------------------------------
// Selectable text and help

const SERVE = "opencode serve --port 4096 --hostname 0.0.0.0"

/**
 * A settings row: a command people can select and copy, highlighted as the kit's fields
 * highlight a selection, and an icon-only copy button that explains itself on hover.
 */
function text_selectable_help(s: G, k: Kit, _: El[]): El {
  const c = k.c
  return col().w(480.0).gap(8.0)
    .child(caption(k, "Run the server from a terminal"))
    .child(
      row().key("command-row").h(36.0).pl(12.0).pr(4.0).gap(8.0).center_y()
        .fill(c.surface_base).radius(k.radius.md).border(1.0, c.border_weak)
        .child(text(SERVE).key("command").font(k.ty.mono).color(c.text_base).grow(1.0).shrink()
          .selectable(true).selection_color(k.selection()))
        .child(IconButton.new(ic.COPY).variant("Ghost").control_size("Small")
          .label("Copy command").on_press_tx((_: G, tx: Tx) => tx.copy(SERVE)).build(k)
          .key("copy").help("Copy command")),
    )
    .child(row().w(280.0).child(TextInput.new(s.edits[7]).placeholder("Selected like a field")
      .on_edit((s: G) => s.edits[7]).build(k).key("field")))
}

const LONG_PATH = "~/Projects/rune/crates/rune-kit/src/components/settings/appearance_panel.rs"

/**
 * A path keeps its folder and file name as its box narrows, beside the end and head cuts, each
 * with a `Type::caption` line under it.
 */
function text_truncate_middle(_: G, k: Kit, __: El[]): El {
  const c = k.c
  const path = (w: number, cut: (e: El) => El, how: string) => col().w(w)
    .child(cut(text(LONG_PATH).font(k.ty.ui).color(c.text_base)).selectable(true).selection_color(k.selection()))
    .child(text(`${how}, ${w} pt`).font(k.ty.caption()).color(c.text_weak))
  const truncate_middle = (e: El) => e.truncate_middle()
  const truncate = (e: El) => e.truncate()
  const truncate_head = (e: El) => e.truncate_head()
  return col().gap(12.0)
    .child(path(360.0, truncate_middle, "Middle"))
    .child(path(240.0, truncate_middle, "Middle"))
    .child(path(160.0, truncate_middle, "Middle"))
    .child(path(240.0, truncate, "End"))
    .child(path(240.0, truncate_head, "Head"))
}

function scroll_bar_basic(_: G, k: Kit, __: El[]): El {
  return scroll_feed(k, 24, null)
}

/**
 * A feed whose button lengthens or shortens what follows its rows, so its thumb glides to each
 * new length.
 */
function scroll_bar_grow(s: G, k: Kit, _: El[]): El {
  return col().gap(8.0)
    .child(Button.new("Change rows").on_press(flip("more")).build(k).key("more"))
    .child(scroll_feed(k, 12, s.is("more") ? 600.0 : 0.0))
}

function scroll_feed(k: Kit, rows: number, tail: number | null): El {
  // Rust: `viewport.scroll_bar(k)`, the `rune_kit::ScrollBar` extension trait on `El`. This calls
  // `Kit::scroll_bar(viewport)`, the same wrapper.
  const feed = col()
    .key("feed")
    .w_full()
    .grow(1.0)
    .min_h(0.0)
    .padding(8.0)
    .gap(4.0)
    .scroll({ stick_bottom: false })
    .children(Array.from({ length: rows }, (_, i) =>
      row()
        .key(`item-${i}`)
        .w_full()
        .h(32.0)
        .px(10.0)
        .center_y()
        .justify_between()
        .radius(k.radius.sm)
        .child(text(`Build step ${String(i + 1).padStart(2, "0")}`).font(k.ty.ui_compact).color(k.c.text_base))
        .child(text(`${12 + i * 7} ms`).font(k.ty.small).color(k.c.text_muted))
    ))
    .children(tail === null ? [] : [el().key("tail").w_full().h(tail)])
  return col()
    .key("panel")
    .w(360.0)
    .h(260.0)
    .radius(k.radius.md)
    .fill(k.c.layer_01)
    .border(1.0, k.c.border_weak)
    .clip_soft(k.radius.md)
    .child(k.scroll_bar(feed))
}
