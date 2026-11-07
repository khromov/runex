// Writes the README's examples table from a comparison report:
//
//   bun scripts/compare.ts --all --runtime bun,node --json out/compare/report.json
//   bun scripts/examples-table.ts out/compare/report.json
//
// Replaces everything between `<!-- examples-table -->` and the next heading in README.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs"

type Row = { window: string; scene: string; runtime: string; status: string }
type Example = { name: string; status: string; rows?: Row[]; reason?: string; problems?: string[] }

const report = JSON.parse(readFileSync(process.argv[2] ?? "out/compare/report.json", "utf8")) as { examples: Example[]; runtimes: string[] }
const readme = new URL("../README.md", import.meta.url)
const UPSTREAM = "https://github.com/anomalyco/rune/tree/d03349e25189ce1edc8c26ada6bf6d4aac72c826/examples"

const lines = [
  "<!-- examples-table -->",
  "",
  `| Example | Windows × scenes | Result (${report.runtimes.join(", ")}) |`,
  "| --- | --- | --- |",
]
for (const e of [...report.examples].sort((a, b) => a.name.localeCompare(b.name))) {
  const rows = e.rows ?? []
  const renders = new Set(rows.map((r) => `${r.window}/${r.scene}`)).size
  const pass = rows.filter((r) => r.status === "pass").length
  const result =
    e.status === "pass" ? `identical (${pass}/${rows.length})`
    : e.status === "skip" ? `skipped: ${e.reason ?? ""}`
    : e.status === "not ported" ? "not ported"
    : `${e.status} (${pass}/${rows.length} identical)`
  // An example with no port (site-scenes) links to Rune's, at the pinned revision.
  const link = existsSync(new URL(`../examples/${e.name}`, import.meta.url)) ? `examples/${e.name}` : `${UPSTREAM}/${e.name}`
  lines.push(`| [${e.name}](${link}) | ${renders || "–"} | ${result} |`)
}
lines.push("")

const text = readFileSync(readme, "utf8")
const start = text.indexOf("<!-- examples-table -->")
const end = text.indexOf("\n## ", start)
writeFileSync(readme, text.slice(0, start) + lines.join("\n") + text.slice(end))
console.log(lines.join("\n"))
