// `App.global_shortcut` takes a Rust `fn` pointer, so each distinct JavaScript handler takes one of
// 16 native trampolines (src/app.rs `SHORTCUT_FNS`), for the life of the process. This registers
// `count` handlers with distinct sources (on chords ctrl+shift+a, b, ...), then presses the first
// and the last through a script and prints which handlers ran, or the registration's error.
//
//   bun test/unit/fixtures/shortcuts.ts 16 --tree out.json
import { writeFileSync } from "node:fs"
import { App, AppSpec, text } from "runex-js"
import { requireHeadless, result } from "../lib/spawn.ts"

type S = { hits: number[] }
const [count, ...args] = process.argv.slice(2)
requireHeadless(args)
const n = Number(count)
const chord = (i: number) => `ctrl+shift+${String.fromCharCode(97 + i)}`
const app = App.new(AppSpec.new<S>("Shortcuts", [200, 60], () => ({ hits: [] }), (s) => text(`hits ${s.hits.join(",")}`).key("hits")))
let error: string | null = null
try {
  // Built first, so each registration runs (and can fail) here rather than inside `run()`.
  void app.native
  for (let i = 0; i < n; i++) {
    // A distinct source per handler: the registry reuses a slot for a function with the same source.
    const handler = new Function("s", `s.hits.push(${i})`) as (s: S) => void
    app.global_shortcut(chord(i), handler)
  }
  // The same source again reuses its slot instead of taking a new one.
  app.global_shortcut(chord(0), new Function("s", "s.hits.push(0)") as (s: S) => void)
} catch (e) {
  error = (e as Error).message
}
const registered = error ? n - 1 : n
const script = `${args[args.indexOf("--tree") + 1]}.script.json`
writeFileSync(script, JSON.stringify({ events: [{ t: 0.1, type: "shortcut", chord: chord(0) }, { t: 0.2, type: "shortcut", chord: chord(Math.max(registered - 1, 0)) }] }))
let hits: number[] = []
await app.init(() => ({ hits })).args([...args, "--script", script, "--at", "0.5"]).run()
result({ error, hits })
