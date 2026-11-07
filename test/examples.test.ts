// Every ported example (examples/<name>/main.ts with a vendor/rune/examples/<name> original) must
// render 1:1 with the Rust one: identical PNGs and element trees for every window and scene, and
// the same window and scene lists. It runs scripts/compare.ts's comparison, building the Rust
// binaries once (Cargo reuses fresh ones). Diffs land in out/compare/<name>/.
//
//   RUNEX_COMPARE_RUNTIMES=bun|node|bun,node   the runtimes (default: bun, and node when it runs .ts)
//   RUNEX_COMPARE_RELEASE=0                    build and run the Rust examples in debug (default release)
//   RUNEX_COMPARE_STRICT=1                     every Rust example must have a port: an unported one fails
//   RUNEX_COMPARE_SELF_CHECK=1                 render the Rust side twice and fail scenes whose output varies
import { beforeAll, describe, expect, test } from "bun:test"
import config from "../scripts/compare.config.ts"
import {
  availableRuntimes, compareExample, failures, portedExamples, prepare, type Prepared, type Runtime, rustExamples,
} from "../scripts/compare.ts"

const strict = process.env.RUNEX_COMPARE_STRICT === "1"
const examples = strict ? rustExamples() : portedExamples()
const runtimes = (process.env.RUNEX_COMPARE_RUNTIMES?.split(",").map((s) => s.trim()).filter(Boolean) as Runtime[] | undefined)
  ?? availableRuntimes()
const release = process.env.RUNEX_COMPARE_RELEASE !== "0"
const selfCheck = process.env.RUNEX_COMPARE_SELF_CHECK === "1"
const MINUTES = 60_000
let ctx: Prepared

beforeAll(async () => {
  ctx = await prepare({ examples, runtimes, release, strict, selfCheck })
}, 30 * MINUTES)

describe(`TypeScript ports render like the Rust examples (${runtimes.join(", ")}, ${release ? "release" : "debug"})`, () => {
  for (const name of examples) {
    const skip = config.examples[name]?.skip
    if (skip) {
      test.skip(`${name}: ${skip}`, () => {})
      continue
    }
    test(name, async () => {
      const result = await compareExample(ctx, name)
      expect(failures(result, strict)).toEqual([])
      expect(result.rows.length).toBeGreaterThan(0)
    }, 30 * MINUTES)
  }
})
