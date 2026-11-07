// Helpers for the unit tests' headless runs: a temporary folder per test file, input scripts,
// element trees and PNG sizes. Every run here renders offscreen in this process (`--snap`,
// `--tree`, `--script`), so a test stays well under a second. test/preload.ts keeps a shell's
// RUNEX_PERF and RUNEX_TITLEBAR out of them.
//
//   const tmp = tempDir("conv")
//   const tree = await treeOf(App.new(spec), ["--scene", "two"], tmp)
//   expect(texts(tree)).toContain("n = 2")
import { afterAll } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** One element of a `--tree` dump. Only the fields the tests read are typed. */
export type TreeElement = {
  path: string
  key?: string
  rect: [number, number, number, number]
  fill?: string
  color?: string
  text?: string
  opacity: number
  role?: string
  [field: string]: unknown
}

/** A `--tree` dump. */
export type Tree = {
  title: string
  viewport: [number, number]
  scale: number
  t: number
  elements: TreeElement[]
  accessibility: unknown
  [field: string]: unknown
}

/**
 * A new folder under the OS temp dir, named after the test file. Call it at the file's top level:
 * the folder is removed after the file's tests (RUNEX_UNIT_KEEP=1 keeps it, to look at the output).
 */
export function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `runex-unit-${name}-`))
  if (process.env.RUNEX_UNIT_KEEP !== "1") afterAll(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

let scripts = 0

/** Writes a `--script` file (`{ events }`) and returns its path. Times are `t`, in seconds. */
export function writeScript(dir: string, events: object[]): string {
  const path = join(dir, `script-${++scripts}.json`)
  writeFileSync(path, JSON.stringify({ events }))
  return path
}

export function readTree(path: string): Tree {
  return JSON.parse(readFileSync(path, "utf8")) as Tree
}

/** The texts of a tree's elements, in document order. */
export function texts(tree: Tree): string[] {
  return tree.elements.flatMap((e) => (typeof e.text === "string" ? [e.text] : []))
}

/** The element keyed `key`, or undefined. */
export function byKey(tree: Tree, key: string): TreeElement | undefined {
  return tree.elements.find((e) => e.key === key)
}

/** Width and height of a PNG, from its IHDR chunk. */
export function pngSize(path: string): [number, number] {
  const png = readFileSync(path)
  if (png.subarray(1, 4).toString() !== "PNG") throw new Error(`${path} isn't a PNG`)
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

/** Anything with Rune's `App` shape: `args` then `run`. */
type Runnable = { args(argv: Iterable<string>): Runnable; run(): Promise<void> }

let renders = 0

/** Runs `app` headless with `args` plus `--tree`, and returns the tree. */
export async function treeOf(app: Runnable, args: string[], dir: string): Promise<Tree> {
  const path = join(dir, `tree-${++renders}.json`)
  await app.args([...args, "--tree", path]).run()
  return readTree(path)
}

/** Runs `app` headless with `args` plus `--snap` and `--tree`; returns the PNG's path and the tree. */
export async function snapOf(app: Runnable, args: string[], dir: string): Promise<{ png: string; tree: Tree }> {
  const n = ++renders
  const png = join(dir, `snap-${n}.png`)
  const tree = join(dir, `snap-${n}.json`)
  await app.args([...args, "--snap", png, "--tree", tree]).run()
  return { png, tree: readTree(tree) }
}

/**
 * Runs `f` with `console.error` collected instead of printed, and returns how it settled. The
 * native side rethrows a run's first callback error and prints the rest with `console.error`.
 */
export async function quietly(f: () => Promise<unknown>): Promise<{ error: unknown; printed: unknown[][] }> {
  const printed: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => { printed.push(args) }
  try {
    await f()
    return { error: undefined, printed }
  } catch (error) {
    return { error, printed }
  } finally {
    console.error = original
  }
}
