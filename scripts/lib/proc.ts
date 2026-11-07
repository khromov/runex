// Process helpers shared by scripts/compare.ts and scripts/golden.ts: run a command with a
// timeout, run tasks a few at a time, and the runtimes this machine can run the ports with.
//
//   const r = await exec(["bun", "examples/hello/main.ts", "--list-scenes"], ROOT, {}, 30)
//   if (r.code !== 0) console.error(failure(r, 30))

import { join, resolve } from "node:path"
import { renderEnv } from "./env.ts"

export const ROOT = resolve(import.meta.dir, "..", "..")
export const RUNE = join(ROOT, "vendor", "rune")

export type Runtime = "bun" | "node"

export type Exec = { code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number }

/**
 * Runs `cmd` to completion; kills it after `timeoutS` seconds. Never throws. Its environment is
 * this process's without RUNEX_PERF and RUNEX_TITLEBAR (lib/env.ts), plus `env`.
 */
export async function exec(cmd: string[], cwd: string, env: Record<string, string> | undefined, timeoutS: number): Promise<Exec> {
  const t0 = performance.now()
  let proc: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>
  try {
    proc = Bun.spawn(cmd, { cwd, env: renderEnv(env), stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  } catch (e) {
    return { code: -1, stdout: "", stderr: `error: can't run ${cmd[0]}: ${e instanceof Error ? e.message : String(e)}`, timedOut: false, ms: 0 }
  }
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL") }, timeoutS * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  clearTimeout(timer)
  return { code, stdout, stderr, timedOut, ms: Math.round(performance.now() - t0) }
}

export function tail(text: string, lines: number): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n")
}

/** Why a process failed: the timeout, or its exit code and the stderr lines that say why. */
export function failure(r: Exec, timeoutS: number): string {
  if (r.timedOut) return `timed out after ${timeoutS} s`
  const all = r.stderr.split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("rune: ") && !l.startsWith("note: ") && !/^Bun v\d/.test(l))
  const why = all.filter((l) => /panicked|error|Error|no scene|no window|not found/.test(l)).slice(0, 2)
  const text = (why.length ? why : all.slice(-2)).join(" | ")
  return `exit ${r.code}${text ? `: ${text}` : ""}`
}

/** Runs `tasks` with at most `n` at a time; results keep the tasks' order. */
export async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker))
  return results
}

function nodeVersion(): [number, number] | undefined {
  try {
    const p = Bun.spawnSync(["node", "--version"], { stdout: "pipe", stderr: "pipe" })
    if (p.exitCode !== 0) return undefined
    const [major = 0, minor = 0] = p.stdout.toString().trim().replace(/^v/, "").split(".").map(Number)
    return [major, minor]
  } catch {
    return undefined
  }
}

let nodeFlagsCache: string[] | undefined

/** Node strips types itself from 23.6; 22.6–23.5 need the flag. */
export function nodeFlags(): string[] {
  if (nodeFlagsCache) return nodeFlagsCache
  const [major, minor] = nodeVersion() ?? [0, 0]
  nodeFlagsCache = major > 23 || (major === 23 && minor >= 6) ? [] : ["--experimental-strip-types", "--no-warnings"]
  return nodeFlagsCache
}

/** The runtimes this machine has: bun always (it runs this script), node when it can run .ts. */
export function availableRuntimes(): Runtime[] {
  const v = nodeVersion()
  if (!v) return ["bun"]
  const [major, minor] = v
  return major > 22 || (major === 22 && minor >= 6) ? ["bun", "node"] : ["bun"]
}

/** The command that runs a TypeScript entry point (an example's main.ts, a fixture) on `runtime`. */
export function tsCommand(main: string, runtime: Runtime): string[] {
  return runtime === "bun" ? [process.execPath, main] : ["node", ...nodeFlags(), main]
}
