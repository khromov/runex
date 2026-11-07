// View-building cost: 1000 rows of about 11 builder calls each. `bun bench/rows.ts`, `node bench/rows.ts`.
import { col, el, row, text, tok } from "runex-js"
const t = tok.theme(true)
function build(n: number) {
  const rows = []
  for (let i = 0; i < n; i++) {
    rows.push(row().key(`r${i}`).h(28).px(12).gap(8).center_y().fill(t.card).child(el().size(8, 8).radius(4).fill(t.knob)).child(text(`Row ${i}`).color(t.text)))
  }
  return col().w_full().children(rows)
}
for (let i = 0; i < 5; i++) build(1000)
const runs = Number(process.env.RUNS ?? 20), t0 = performance.now()
for (let i = 0; i < runs; i++) build(1000)
const ms = (performance.now() - t0) / runs
console.log(`${typeof Bun !== "undefined" ? "bun" : "node"}: 1000 rows (≈11 calls each) in ${ms.toFixed(2)} ms → ${((ms * 1e6) / 11000).toFixed(0)} ns/call`)
