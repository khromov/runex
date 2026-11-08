// The vendored Svelte tarball lives in packages/svelte/vendor and, identical, in the repo root's
// vendor/: bun.lock records its path relative to this package, but a frozen install (CI) resolves
// it from the root. `bun run vendor` writes both.
import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL("../../vendor", import.meta.url))
const root = fileURLToPath(new URL("../../../../vendor", import.meta.url))

test("the vendored svelte tarball is the same in both vendor/ directories", () => {
  const ours = readdirSync(here).filter((f) => f.endsWith(".tgz"))
  const theirs = readdirSync(root).filter((f) => /^svelte-.*\.tgz$/.test(f))
  expect(theirs).toEqual(ours)
  expect(ours.length).toBe(1)
  expect(readFileSync(`${root}/${ours[0]}`).equals(readFileSync(`${here}/${ours[0]}`))).toBe(true)
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"))
  expect(manifest.dependencies.svelte).toBe(`file:vendor/${ours[0]}`)
})
