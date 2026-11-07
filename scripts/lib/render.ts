// One headless render: runs an app (a Rust example binary, or `bun|node <file>.ts`) with
// `--snap <stem>.png --tree <stem>.json` plus the given Rune arguments, and says whether both
// files came out. On failure the command, stdout and stderr go to `<stem>.log`.
//
//   const r = await render({ label: "bun", cmd: tsCommand(main, "bun"), cwd: ROOT }, ["--scene", "on"], "out/x/on.bun", {})
//   if (!r.ok) console.error(r.error, r.log)

import { existsSync, rmSync, writeFileSync } from "node:fs"
import { relative } from "node:path"
import { exec, failure, ROOT } from "./proc.ts"

/** How to start one side of a render: a label for messages, the command, its directory. */
export type Side = { label: string; cmd: string[]; cwd: string }

export type Render = { ok: boolean; png: string; tree?: string; error?: string; log?: string; ms: number; stderr?: string }

export type RenderOptions = {
  /** Write `--tree` too (default true). */
  tree?: boolean
  /** Write `--snap` (default true). */
  png?: boolean
  /** Seconds before the process is killed (default 120). */
  timeout?: number
  env?: Record<string, string>
}

export async function render(side: Side, args: string[], stem: string, o: RenderOptions = {}): Promise<Render> {
  const png = `${stem}.png`
  const tree = o.tree !== false ? `${stem}.json` : undefined
  const wantPng = o.png !== false
  rmSync(png, { force: true })
  if (tree) rmSync(tree, { force: true })
  const timeout = o.timeout ?? 120
  const full = [...side.cmd, ...(wantPng ? ["--snap", png] : []), ...(tree ? ["--tree", tree] : []), ...args]
  const r = await exec(full, side.cwd, o.env, timeout)
  const missing = wantPng && !existsSync(png) ? png : tree && !existsSync(tree) ? tree : undefined
  if (r.code === 0 && !r.timedOut && !missing) return { ok: true, png, tree, ms: r.ms, stderr: r.stderr }
  const log = `${stem}.log`
  writeFileSync(log, `$ ${full.join(" ")}\n(cwd ${side.cwd})\n\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`)
  const error = r.code === 0 && !r.timedOut ? `wrote no ${relative(ROOT, missing!)}` : failure(r, timeout)
  return { ok: false, png, tree, error: `${side.label}: ${error}`, log, ms: r.ms, stderr: r.stderr }
}
