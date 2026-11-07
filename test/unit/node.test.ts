// The binding layer under Node: the checks in lib/smoke.ts run in a Node process
// (fixtures/node-smoke.ts) and here in Bun, and must pass with the same results on both. The
// rest of test/unit runs on Bun only; this covers the node-api differences cheaply.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { tempDir } from "./lib/headless.ts"
import { smoke } from "./lib/smoke.ts"
import { fixture, TIMEOUT } from "./lib/spawn.ts"

setDefaultTimeout(TIMEOUT)

const node = spawnSync("node", ["--version"], { encoding: "utf8" })
const version = node.status === 0 ? node.stdout.trim() : null

describe.skipIf(!version)(`node ${version ?? "(not found)"}`, () => {
  test("every check passes on Node, with the results Bun gets", async () => {
    const r = fixture("node-smoke.ts", [], { runtime: "node" })
    expect(r.stderr.split("\n").filter((l) => l && !l.startsWith("rune: ") && !l.includes("ExperimentalWarning"))).toEqual([])
    expect(r.code).toBe(0)
    expect(r.result.runtime).toBe("node")
    const checks = r.result.checks as Record<string, { ok: boolean; error?: string }>
    expect(Object.keys(checks).length).toBeGreaterThanOrEqual(15)
    expect(Object.entries(checks).filter(([, c]) => !c.ok)).toEqual([])
    expect(checks).toEqual(await smoke(tempDir("node")))
  })
})
