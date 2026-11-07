// Runs a fixture in test/unit/fixtures/ in its own process. Tests use one where a run can't share
// the test process: Rune exits the process on a bad flag (code 2), winit allows one event loop
// per process, and some registries (global-shortcut trampolines, the 64 app `init`s) only grow.
//
//   const r = fixture("tooling.ts", ["--list-scenes"])
//   expect(r.code).toBe(0)
//   expect(r.lines).toEqual(["a", "b", "rune-x"])
//
// A fixture that reports results prints one JSON line starting with `RESULT ` (see `result`).
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderEnv } from "../../../scripts/lib/env.ts"

export const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url))

export type Runtime = "bun" | "node"

export type FixtureRun = {
  code: number | null
  stdout: string
  stderr: string
  /** stdout's lines, without Rune's `rune: ...` timing lines and blank lines. */
  lines: string[]
  /** The fixture's `RESULT {...}` line, parsed; undefined if it printed none. */
  result: any
}

/** The command that runs a .ts file on `runtime`: this Bun, or `node` (which strips types itself). */
export function runtimeCommand(runtime: Runtime): string {
  if (runtime === "node") return "node"
  return process.versions.bun ? process.execPath : "bun"
}

/**
 * Runs fixtures/`name` with `args` (and `opts.runtimeArgs`, the runtime's own flags, before the
 * script); never throws on a non-zero exit. The fixture gets this process's environment without
 * RUNEX_PERF and RUNEX_TITLEBAR (scripts/lib/env.ts: a shell's setting would change every tree),
 * plus `opts.env`.
 */
export function fixture(name: string, args: string[] = [], opts: { runtime?: Runtime; runtimeArgs?: string[]; env?: Record<string, string | undefined>; timeout?: number } = {}): FixtureRun {
  const p = spawnSync(runtimeCommand(opts.runtime ?? "bun"), [...(opts.runtimeArgs ?? []), join(FIXTURES, name), ...args], {
    encoding: "utf8",
    env: renderEnv(opts.env),
    timeout: opts.timeout ?? 30_000, // a hung run fails its test instead of the whole file
  })
  const stdout = p.stdout ?? ""
  const lines = stdout.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("rune: ") && !l.startsWith("RESULT "))
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT "))
  return { code: p.status, stdout, stderr: p.stderr ?? "", lines, result: line ? JSON.parse(line.slice("RESULT ".length)) : undefined }
}

/** For fixtures: prints `value` as the `RESULT` line `fixture()` parses. */
export function result(value: unknown) {
  console.log(`RESULT ${JSON.stringify(value)}`)
}

// The flags that make Rune render headless (`tooling::Args::headless`).
const HEADLESS = ["--snap", "--tree", "--html", "--script", "--trace", "--frames", "--duration", "--out", "--video", "--strip", "--list-scenes", "--first-pixels", "--list-windows", "--desktop"]

/**
 * For fixtures: exits with code 3 unless `args` render headless. A unit test must never open a
 * real window (test/windowed does that, on purpose).
 */
export function requireHeadless(args: string[]) {
  if (args.includes("--native") || !args.some((a) => HEADLESS.includes(a))) {
    console.error(`refusing to open a window: no headless flag in ${JSON.stringify(args)}`)
    process.exit(3)
  }
}

/** The per-test timeout in test/unit: tests start processes, and a loaded machine starts them slowly. */
export const TIMEOUT = 60_000
