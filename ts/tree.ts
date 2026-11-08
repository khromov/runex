// `rune_kit::Tree`, `TreeModel`, `FileNode` and `FileTree` (src/manual/tree.rs): a virtualised
// tree over a model in the app's state, whose nodes are the app's own values. In Rust a node is
// any `T`; here it's any JavaScript value, held by reference, so `get` and `get_mut` return the
// same object and changing it shows on the next build.
import native from "./native.js"
import type { El, Icon, KeyEvent, Mods, Tx } from "./gen/types.js"
import { kit_TreeItem, kit_file_icon, kit_glyphs__FOLDER, kit_glyphs__FOLDER_OPEN } from "./gen/types.js"
import type { kit_Kit as Kit, kit_TreeKey as TreeKey, kit_TreeRow as TreeRow, kit_TreeStyle as TreeStyle } from "./gen/types.js"

/** The tree's data (`rune_kit::TreeModel<T>`): nodes by id, their order, which are open, the selection and the cursor. */
export interface TreeModel<T = any> {
  /** The key prefix of the tree's rows (`"tree"` by default). */
  key(key: string): this
  /** Shift extends and Cmd toggles the selection on a click (off: a click selects one row). */
  multi_select(on: boolean): this
  /** Adds `data` as `id` under `parent` (`null`: at the top), after its siblings. False when `id` is taken or `parent` doesn't exist. */
  insert(parent: string | null, id: string, data: T): boolean
  clear(): void
  len(): number
  is_empty(): boolean
  contains(id: string): boolean
  /** The node `id`, or `null`. */
  get(id: string): T | null
  /** The node `id`, or `null`: the same object `get` returns, changed in place. */
  get_mut(id: string): T | null
  parent(id: string): string | null
  /** The ids under `id` (`null`: the top level), in order. */
  children(id: string | null): string[]
  has_children(id: string): boolean
  /** 0 at the top level; `null` for an unknown id. */
  depth(id: string): number | null
  /** `id`'s node and every node under it. */
  subtree(id: string): T[]
  /** Orders every node's children by `cmp` (negative, 0 or positive, as a sort comparator). */
  sort_by(cmp: (a: T, b: T) => number): void
  is_expanded(id: string): boolean
  set_expanded(id: string, open: boolean): void
  toggle(id: string): void
  expand_all(): void
  collapse_all(): void
  /** Opens every folder above `id`, so its row shows. */
  expand_to(id: string): void
  /** The selected ids, in tree order. */
  selected(): string[]
  is_selected(id: string): boolean
  /** The row the keyboard cursor is on. */
  cursor(): string | null
  clear_selection(): void
  /** Selects `id` alone and puts the cursor on it. */
  select(id: string): void
  set_selected(id: string, on: boolean): void
  select_range(id: string): void
  /** A click on `id` with `mods` held; true for a plain click. */
  click(id: string, mods: Mods): boolean
  /** Opens the folders above `id`, moves the cursor to it and scrolls its row into view. */
  reveal(id: string, tx: Tx): boolean
  /** Shows only the nodes `keep` accepts and the folders leading to them, open. */
  filter(keep: (node: T) => boolean): void
  clear_filter(): void
  is_filtering(): boolean
  is_match(id: string): boolean
  /** How many rows show. */
  visible_len(): number
  visible_id(row: number): string | null
  visible_row(id: string): number | null
  /** Shown row `row`: its node and its state, or `null`. */
  row(row: number): [T, TreeRow] | null
  /** Arrow keys move the cursor and open or close folders, Return opens, typing jumps by `label`. */
  handle_key(ev: KeyEvent, label: (node: T) => string, tx: Tx): TreeKey
}

export interface TreeModelStatic {
  readonly prototype: TreeModel
  /** An empty tree. */
  new: <T = any>() => TreeModel<T>
  default: <T = any>() => TreeModel<T>
}

export const TreeModel: TreeModelStatic = native.kit_TreeModel as any

/** A virtualised tree over a `TreeModel` in the app's state `S` (`rune_kit::Tree<S, T>`). */
export interface Tree<S = any, T = any> {
  /** What each row shows; by default its label alone. */
  row(f: (node: T, row: TreeRow) => kit_TreeItem): this
  /** The cursor moved to `id`, by click or key. */
  on_select(f: (s: S, id: string, tx: Tx) => void): this
  /** A row without children was double-clicked, or Return or Space pressed on it. */
  on_open(f: (s: S, id: string, tx: Tx) => void): this
  style(s: TreeStyle): this
  /** The tree's accessibility label ("Files"). */
  name(n: string): this
  /** The tree, filling the height its parent gives it (set one with `.h(..)` or `.grow(..)`). */
  build(s: S, k: Kit): El
}

export interface TreeStatic {
  /**
   * `get` and `get_mut` find the model in the state; `label` names a node (rows show it, and
   * typing jumps by it). Rust takes `fn` pointers here: each distinct function takes one of 32
   * slots, so pass the same functions (or functions with the same source) every build.
   */
  new: <S, T>(get: (s: S) => TreeModel<T>, get_mut: (s: S) => TreeModel<T>, label: (node: T) => string) => Tree<S, T>
}

export const Tree: TreeStatic = native.kit_Tree as any

/** A node of a file tree: a folder (`dir`) or a file carrying the app's data (`rune_kit::FileNode<D>`). */
export class FileNode<D = any> {
  /** What the row shows: the file or folder name, or `a/b/c` for folders compacted into one. */
  declare name: string
  /** The path from the root, which is also the node's id. */
  declare path: string
  declare dir: boolean
  /** The file's data; `null` for folders. */
  declare data: D | null
  constructor(init: { name: string; path: string; dir: boolean; data?: D | null }) {
    this.name = init.name
    this.path = init.path
    this.dir = init.dir
    this.data = init.data ?? null
  }
  label(): string {
    return this.name
  }
  /** The folder or file icon for this node (`file_icon`). */
  icon(open: boolean): Icon {
    if (this.dir) return open ? kit_glyphs__FOLDER_OPEN : kit_glyphs__FOLDER
    return kit_file_icon(this.name)
  }
  /** `FileNode::label` as a function, for `Tree.new`'s `label`. */
  static label(node: FileNode<any>): string {
    return node.name
  }
}

const layout: (paths: string[], compact: boolean, dirs_first: boolean, key: string) => [string | null, string, string, boolean, number][] =
  (native as any).__kit_file_tree_layout

/**
 * Builds a `TreeModel` of `FileNode`s from file paths (`/`-separated, relative to a root)
 * (`rune_kit::FileTree`). By default folders sort before files, names sort naturally (`file2`
 * before `file10`, case aside), and a chain of folders that each hold only one folder shows as
 * one row named `a/b/c`. Folders start closed; open them on the model.
 */
export class FileTree {
  #compact = true
  #dirs_first = true
  #key = "files"
  static new(): FileTree {
    return new FileTree()
  }
  static default(): FileTree {
    return new FileTree()
  }
  /** Show a chain of single-folder folders as one `a/b/c` row (on by default). */
  compact_folders(on: boolean): this {
    this.#compact = on
    return this
  }
  /** Sort folders before files (on by default); off, they mix by name. */
  dirs_first(on: boolean): this {
    this.#dirs_first = on
    return this
  }
  /** The model's row-key prefix (`TreeModel.key`, `"files"` here). */
  key(key: string): this {
    this.#key = key
    return this
  }
  /** The model, laid out by Rune's `FileTree::build`: files are `[path, data]` pairs. */
  build<D>(files: Iterable<readonly [string, D]>): TreeModel<FileNode<D>> {
    const list = [...files]
    const model = TreeModel.new<FileNode<D>>().key(this.#key)
    for (const [parent, path, name, dir, file] of layout(list.map(([p]) => p), this.#compact, this.#dirs_first, this.#key)) {
      model.insert(parent, path, new FileNode<D>({ name, path, dir, data: file >= 0 ? list[file]![1] : null }))
    }
    return model
  }
}

/** `TreeItem::file`: a file tree's row, the node's name and its folder or file icon. */
function tree_item_file(node: FileNode<any>, row: TreeRow): kit_TreeItem {
  return kit_TreeItem.new(node.name).icon(node.icon(row.expanded === true))
}

// `TreeItem.file(node, row)`, as Rust spells it.
Object.defineProperty(kit_TreeItem, "file", { value: tree_item_file, configurable: true, writable: true })

declare module "./gen/types.js" {
  interface kit_TreeItem$Static {
    /** A file tree's row: the node's name and its folder or file icon (`TreeItem::file`). */
    file(node: FileNode<any>, row: TreeRow): kit_TreeItem
  }
}
