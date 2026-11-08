// `TreeModel`, `Tree`, `FileNode` and `FileTree` (src/manual/tree.rs, ts/tree.ts): a model whose
// nodes are JavaScript values, Rune's own file layout, and a tree that reads its model through
// the state and changes it on a click.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { App, AppSpec, col } from "runex-js"
import { FileNode, FileTree, Kit, Tree, TreeItem, TreeModel } from "runex-js/kit"
import { byKey, tempDir, texts, treeOf, writeScript } from "./lib/headless.ts"
import { TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const tmp = tempDir("tree")

describe("TreeModel", () => {
  test("nodes are the app's values, held by reference", () => {
    const m = TreeModel.new<{ name: string; size: number }>()
    expect(m.insert(null, "a", { name: "A", size: 1 })).toBe(true)
    expect(m.insert("a", "a/b", { name: "B", size: 2 })).toBe(true)
    expect(m.insert("missing", "x", { name: "X", size: 0 })).toBe(false)
    expect(m.insert(null, "a", { name: "again", size: 0 })).toBe(false)
    expect(m.len()).toBe(2)
    expect(m.children(null)).toEqual(["a"])
    expect(m.children("a")).toEqual(["a/b"])
    expect(m.parent("a/b")).toBe("a")
    expect(m.depth("a/b")).toBe(1)
    expect(m.get("nope")).toBeNull()
    m.get_mut("a/b")!.size = 20
    expect(m.get("a/b")!.size).toBe(20)
    expect(m.subtree("a").map((n) => n.name).sort()).toEqual(["A", "B"])
  })

  test("open folders, the selection, the filter and the shown rows", () => {
    const m = TreeModel.new<string>().key("t")
    for (const [p, id] of [[null, "x"], ["x", "x/2"], ["x", "x/10"], [null, "y"]] as const) m.insert(p, id, id.split("/").pop()!)
    m.sort_by((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    expect(m.children("x")).toEqual(["x/2", "x/10"])
    expect(m.visible_len()).toBe(2)
    m.expand_to("x/10")
    expect(m.is_expanded("x")).toBe(true)
    expect(m.visible_len()).toBe(4)
    expect(m.visible_id(2)).toBe("x/10")
    expect(m.visible_row("y")).toBe(3)
    m.select("x/10")
    expect(m.selected()).toEqual(["x/10"])
    expect(m.cursor()).toBe("x/10")
    const row = m.row(2)!
    expect(row[0]).toBe("10")
    expect({ id: row[1].id, depth: row[1].depth, expanded: row[1].expanded, selected: row[1].selected }).toEqual({ id: "x/10", depth: 1, expanded: null, selected: true })
    m.filter((n) => n === "y")
    expect(m.is_filtering()).toBe(true)
    expect(m.is_match("y")).toBe(true)
    expect(m.visible_len()).toBe(1)
    m.clear_filter()
    m.collapse_all()
    expect(m.visible_len()).toBe(2)
  })
})

describe("FileTree", () => {
  const paths = ["src/util/format.ts", "src/main.ts", "a/b/c/deep.md", "README.md", "file10.txt", "file2.txt"]

  test("lays files out as Rune's FileTree::build does: folders first, natural order, compact chains", () => {
    const m = FileTree.new().build(paths.map((p, i) => [p, i] as const))
    expect(m.children(null)).toEqual(["a/b/c", "src", "file2.txt", "file10.txt", "README.md"])
    expect(m.children("src")).toEqual(["src/util", "src/main.ts"])
    const deep = m.get("a/b/c")!
    expect(deep).toBeInstanceOf(FileNode)
    expect({ ...deep }).toEqual({ name: "a/b/c", path: "a/b/c", dir: true, data: null })
    expect(m.get("src/main.ts")!.data).toBe(1)
    expect(m.get("src/main.ts")!.label()).toBe("main.ts")
  })

  test("compact_folders(false) and dirs_first(false)", () => {
    const m = FileTree.new().compact_folders(false).dirs_first(false).build(paths.map((p) => [p, null] as const))
    expect(m.children(null)).toEqual(["a", "file2.txt", "file10.txt", "README.md", "src"])
    expect(m.children("a")).toEqual(["a/b"])
  })

  test("TreeItem.file names the node and picks its icon", () => {
    const m = FileTree.new().build([["src/x.ts", null]])
    const [node, row] = m.row(0)!
    expect(() => TreeItem.file(node, row)).not.toThrow()
    expect(node.icon(false).name).toBe(FileNode.prototype.icon.call(node, false).name)
  })
})

type S = { files: TreeModel<FileNode<null>>; picked: string[] }

const files = (s: S) => s.files

function app() {
  return App.new(AppSpec.new("Tree", [300, 240], (): S => {
    const files = FileTree.new().build(["src/a.ts", "src/b.ts", "README.md"].map((p) => [p, null] as const))
    return { files, picked: [] }
  }, (s: S) => {
    const k = Kit.neutral(true)
    return col().w_full().h_full().child(
      Tree.new(files, files, FileNode.label)
        .row((n: FileNode<null>, r) => TreeItem.file(n, r))
        .on_select((s: S, id) => { s.picked.push(id) })
        .name("Files")
        .build(s, k)
        .h(200),
    )
  }))
}

describe("Tree", () => {
  test("builds the model's shown rows, with their labels", async () => {
    const tree = await treeOf(app(), [], tmp)
    expect(texts(tree)).toEqual(expect.arrayContaining(["src", "README.md"]))
    expect(texts(tree)).not.toContain("a.ts")
  })

  test("a click opens a folder through get_mut and reaches on_select", async () => {
    const script = writeScript(tmp, [
      { t: 0.05, type: "tap", key: "src" },
      { t: 0.3, type: "mark", name: "end" },
    ])
    const tree = await treeOf(app(), ["--script", script, "--at", "mark:end"], tmp)
    expect(texts(tree)).toEqual(expect.arrayContaining(["a.ts", "b.ts"]))
    expect(byKey(tree, "src/a.ts")).toBeDefined()
  })
})
