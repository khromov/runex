// FileIcon and Icon, as `file-icon.stories.tsx` and `icon.stories.tsx` lay them out, and Rune's own
// catalogs of every OpenCode icon, file-type badge and file tree icon, and its file tree.

import { type El, TextStyle, col, icon, row, text } from "runex-js"
import { FileNode, type Kit, Tree } from "runex-js/kit"
import * as rune_theme_opencode from "runex-js/theme-opencode"
import { file_icons, icons as ic, tree_icons } from "runex-js/theme-opencode"

import type { G } from "../main.ts"

/**
 * `display: grid; grid-template-columns: repeat(auto-fill, minmax(min, 1fr)); gap` at the
 * story's 672-point width.
 */
function grid(min: number, gap: number, cells: El[]): El {
  // f32 arithmetic, step by step as Rust computes it.
  const f = Math.fround
  const columns = Math.trunc(Math.max(Math.floor(f(f(672.0 + gap) / f(min + gap))), 1.0))
  const width = f(f(672.0 - f(gap * f(columns - 1))) / f(columns))
  let rows = col().gap(gap)
  for (let i = 0; i < cells.length; i += columns) {
    rows = rows.child(row().gap(gap).children(cells.slice(i, i + columns).map((c) => c.w(width))))
  }
  return rows
}

/** The stories' `font-size: 12px; color: var(--text-weak)` names. */
function name(k: Kit, label: string): El {
  return text(label).font(TextStyle.new(12.0, 440.0).lh(18.0)).color(k.c.text_weak).truncate()
}

export function file_icon_samples(_: G, k: Kit, __: El[]): El {
  const items: [string, boolean][] = [
    ["README.md", false],
    ["package.json", false],
    ["tsconfig.json", false],
    ["index.ts", false],
    ["styles.css", false],
    ["logo.svg", false],
    ["photo.png", false],
    ["Dockerfile", false],
    [".env", false],
    ["src", true],
    ["public", true],
  ]
  const cells = items.map(([path, dir]) => {
    const glyph = dir ? file_icons.folder(path, false) : file_icons.file(path)
    return row().gap(8.0).center_y().child(icon(glyph, 16.0).color(k.c.text_base)).child(name(k, path))
  })
  return grid(120.0, 12.0, cells)
}

export function file_icon_folder(_: G, k: Kit, __: El[]): El {
  return row().child(icon(file_icons.folder("src", true), 16.0).color(k.c.text_base))
}

export function icon_gallery(_: G, k: Kit, __: El[]): El {
  const names = [
    "archive", "arrow-left", "arrow-right", "arrow-up-right", "branch", "check", "chevron-down", "close", "code-slash", "edit",
    "folder", "graduation-cap", "help", "magnifying-glass", "menu", "monitor", "outline-arrow-to-corner-top-right",
    "outline-copy", "outline-dots", "outline-eye", "outline-eye-slash", "outline-hexagonal-warning", "plus", "review",
    "settings-gear", "trash", "workspace",
  ]
  // A name the catalog lacks draws `plus`, as `Icon` does.
  const find = (n: string) => ic.ALL.find((i) => i.name === n) ?? ic.PLUS
  const cells = names.map((n) =>
    col().gap(6.0).items_center().child(icon(find(n), 16.0).color(k.c.icon_base)).child(
      text(n).font(TextStyle.new(10.0, 440.0).lh(15.0)).color(k.c.text_weak).truncate(),
    )
  )
  // `(672.0 - 48.0) / 5.0` in f32.
  return grid(Math.fround(Math.fround(672.0 - 48.0) / 5.0), 12.0, cells)
}

/** Every icon in OpenCode's catalog, by name. */
export function icon_catalog(_: G, k: Kit, __: El[]): El {
  const cells = ic.ALL.map((i) => row().gap(8.0).center_y().child(icon(i, 16.0).color(k.c.icon_base)).child(name(k, i.name)))
  return grid(128.0, 8.0, cells)
}

/** Every FileIcon badge and folder icon. */
export function file_icon_catalog(_: G, k: Kit, __: El[]): El {
  const cells = file_icons.all().map((i) => row().gap(8.0).center_y().child(icon(i, 16.0).color(k.c.text_base)).child(name(k, i.name)))
  return grid(128.0, 8.0, cells)
}

/** Every file tree icon, at rest in `icon-muted` and in its type's colour as a selected row draws it. */
export function tree_icon_catalog(_: G, k: Kit, __: El[]): El {
  const muted = rune_theme_opencode.theme(k.dark).color("v2-icon-icon-muted")
  const cells = tree_icons.all().map((t) =>
    row()
      .gap(6.0)
      .center_y()
      .child(icon(t.icon(), 16.0).color(muted))
      .child(icon(t.icon(), 16.0).color(t.color(k.dark)))
      .child(name(k, t.token()))
  )
  return grid(128.0, 8.0, cells)
}

/**
 * Desktop's file tree: folders show only a chevron, files their type's icon, coloured on the
 * selected row.
 */
export function file_tree(s: G, k: Kit, _: El[]): El {
  const dark = k.dark
  const tree = Tree.new((s: G) => s.files, (s: G) => s.files, FileNode.label)
    .row((n: FileNode<null>, r) => tree_icons.item(n.name, n.path, n.dir, r.selected, dark))
    .style(tree_icons.style(k))
    .name("Files")
    .build(s, k)
    .h(8.0 * 28.0 + 8.0)
  // The tree's scroller: 4 points above the rows and 8 either side (`TREE_UNSAFE_CSS`).
  return col().w(240.0).fill(k.c.bg_base).pt(4.0).px(8.0).child(tree)
}
