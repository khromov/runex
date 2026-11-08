// src/gen/el.ts is generated from runex's bindgen surface; a Rune update that adds or changes an
// El method must regenerate it (`bun run gen`).
import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("src/gen/el.ts matches tools/bindgen/surface.txt", () => {
  const run = Bun.spawnSync(["bun", fileURLToPath(new URL("../../scripts/gen-el.ts", import.meta.url)), "--check"], { stdout: "pipe", stderr: "pipe" })
  expect(run.stderr.toString()).toBe("")
  expect(run.exitCode).toBe(0)
})
