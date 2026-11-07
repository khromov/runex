// What runex makes of the process's arguments, for test/unit/args.test.ts and the compiled-binary
// test in test/devflow: `extra_args()` before a headless run (FIXTURE_EARLY=1, when Rune reads the
// command line itself) and after it, and the titlebar inset the view saw. FIXTURE_RELOAD=1
// evaluates runex's app module a second time first, as `bun --hot` does on each save.
// Self-contained (it prints its own RESULT line), so devflow can compile it.
//
//   node --no-warnings test/unit/fixtures/args.ts --tree out.json a --b
import { App, AppSpec, extra_args, text, type Cx } from "runex-js"

if (!process.argv.includes("--tree")) {
  console.error("refusing to open a window: pass --tree OUT.json")
  process.exit(3)
}
const early = process.env.FIXTURE_EARLY === "1" ? extra_args() : null
if (process.env.FIXTURE_RELOAD === "1") await import(new URL("app.js?reload", import.meta.resolve("runex-js")).href)

let inset = -1
const view = (_s: number, cx: Cx) => {
  inset = cx.titlebar_inset()
  return text("args")
}
await App.new(AppSpec.new("Args", [320, 200], () => 0, view)).run()
console.log(`RESULT ${JSON.stringify({ early, extra: extra_args(), inset })}`)
