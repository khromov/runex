// The binding checks of test/unit/lib/smoke.ts, run by whatever runtime runs this file (Node, for
// test/unit/node.test.ts), into a temp folder. Prints one RESULT line: `{ check: { ok, value } }`.
//
//   node test/unit/fixtures/node-smoke.ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { smoke } from "../lib/smoke.ts"
import { result } from "../lib/spawn.ts"

const dir = mkdtempSync(join(tmpdir(), "runex-node-smoke-"))
result({ runtime: process.versions.bun ? "bun" : "node", checks: await smoke(dir) })
rmSync(dir, { recursive: true, force: true })
