// The cost of single binding calls (element creation, builders, records, moves). `bun bench/calls.ts`.
import { col, el, oklch, text, tok } from "runex-js"
const N = 200_000
const c = oklch(0.5, 0.1, 200)
function time(label: string, f: () => void) {
  for (let i = 0; i < 2000; i++) f()
  const t0 = performance.now()
  for (let i = 0; i < N; i++) f()
  console.log(`${label.padEnd(28)} ${(((performance.now() - t0) * 1e6) / N).toFixed(0)} ns`)
}
const e = el()
time("el()", () => { el() })
time("e.w(1)", () => { e.w(1) })
time("e.fill(color record)", () => { e.fill(c) })
time("e.key('k')", () => { e.key("k") })
time("col().child(el())", () => { col().child(el()) })
time("text('hi')", () => { text("hi") })
time("tok.theme(true)", () => { tok.theme(true) })
