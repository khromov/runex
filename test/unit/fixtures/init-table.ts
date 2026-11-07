// Registers `count` apps, then runs a two-window app headless and prints the texts window "b"
// rendered. Every app (and every `WindowSpec.new`) takes one of the native side's 64 `init`
// slots (src/state.rs `INITS`); a window made past them falls back to slot 0.
//
//   bun test/unit/fixtures/init-table.ts 70 --window b --tree out.json
import { readFileSync } from "node:fs"
import { App, AppSpec, WindowSpec, run_windows_with_args, text } from "runex-js"
import { requireHeadless, result } from "../lib/spawn.ts"

const [count, ...args] = process.argv.slice(2)
requireHeadless(args)
for (let i = 0; i < Number(count); i++) {
  void App.new(AppSpec.new(`App ${i}`, [10, 10], () => ({ label: `app ${i}` }), (s: { label: string }) => text(s.label))).native
}
await run_windows_with_args({ accessory: false }, args, () => [
  WindowSpec.new("a", AppSpec.new("A", [120, 80], () => ({ label: "aye" }), (s: { label: string }) => text(s.label))),
  WindowSpec.new("b", AppSpec.new("B", [120, 80], () => ({ label: "bee" }), (s: { label: string }) => text(s.label))),
])
const tree = JSON.parse(readFileSync(args[args.indexOf("--tree") + 1]!, "utf8"))
result({ texts: tree.elements.flatMap((e: { text?: string }) => (e.text === undefined ? [] : [e.text])) })
