// The performance overlay's switches, in a process of its own (RUNEX_PERF is read at start):
// renders a small app headless with the command line's arguments, as `run()` reads them, and
// prints whether the overlay is in the tree and the extra arguments Rune and runex saw.
// FIXTURE_APP_PERF=MODE calls `App.perf(MODE)` first; FIXTURE_STATS=1 passes it a stats callback.
//
//   RUNEX_PERF=1 bun test/unit/fixtures/perf.ts --perf=log --tree out.json
import { readFileSync } from "node:fs"
import { App, AppSpec, col, extra_args, text, type PerfMode } from "runex-js"
import native from "../../../native.cjs"
import { requireHeadless, result } from "../lib/spawn.ts"

const args = process.argv.slice(2)
requireHeadless(args)
const mode = process.env.FIXTURE_APP_PERF as PerfMode | undefined
let stats = 0
const app = App.new(AppSpec.new("Perf", [400, 240], () => ({}), () => col().key("root").w_full().h_full().child(text("app"))))
if (mode) app.perf(mode, process.env.FIXTURE_STATS === "1" ? () => { stats++ } : undefined)
await app.run()

const tree = readFileSync(args[args.indexOf("--tree") + 1]!, "utf8")
result({ overlay: tree.includes("runex-perf"), rune_extra: (native as unknown as { extra_args(): string[] }).extra_args(), extra: extra_args(), stats })
