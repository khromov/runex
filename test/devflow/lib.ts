// Helpers for the dev-workflow tests (test/devflow/devflow.test.ts): throwaway app directories
// outside the repo, processes that are always killed, and PNGs read only once fully written.
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { renderEnv } from "../../scripts/lib/env.ts"

export const REPO = resolve(import.meta.dir, "../..")
/** The package's own name: what apps import and what bundles must keep external. */
export const PKG = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name as string
export const VITE = join(REPO, "node_modules", "vite", "bin", "vite.js")

/**
 * A temporary app directory with `files` copied from the repo (paths relative to it, flattened
 * to their base names) and node_modules/<package> and node_modules/vite linked to the repo's.
 */
export function tempApp(files: string[]): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "runex-devflow-"))
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(REPO, join(dir, "node_modules", PKG), "dir")
  symlinkSync(join(REPO, "node_modules", "vite"), join(dir, "node_modules", "vite"), "dir")
  for (const f of files) cpSync(join(REPO, f), join(dir, f.split("/").at(-1)!))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export type Done = { code: number | null; stdout: string; stderr: string; ms: number }

/**
 * Runs `cmd` to completion (killed after `timeoutMs`). Here and in `start`, the environment is the
 * test's without RUNEX_PERF and RUNEX_TITLEBAR (scripts/lib/env.ts), plus `env`.
 */
export async function exec(cmd: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<Done> {
  const start = performance.now()
  const proc = Bun.spawn(cmd, { cwd: opts.cwd ?? REPO, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: renderEnv(opts.env) })
  const timer = setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs ?? 30000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  clearTimeout(timer)
  return { code: proc.exitCode, stdout, stderr, ms: performance.now() - start }
}

/** A long-running process (a dev server, a hot session) and its output so far; `stop()` kills it. */
export function start(cmd: string[], opts: { cwd: string; env?: Record<string, string> }) {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: renderEnv(opts.env) })
  const out = { text: "" }
  const read = async (s: ReadableStream<Uint8Array>) => {
    const d = new TextDecoder()
    for await (const c of s) out.text += d.decode(c, { stream: true })
  }
  void read(proc.stdout)
  void read(proc.stderr)
  return {
    proc,
    out,
    async stop() {
      if (proc.exitCode !== null || proc.signalCode !== null) return
      proc.kill("SIGTERM")
      const killed = await Promise.race([proc.exited.then(() => true), Bun.sleep(2000).then(() => false)])
      if (!killed) {
        proc.kill("SIGKILL")
        await proc.exited
      }
    },
  }
}

const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

/** The sha256 of the PNG at `path`, or null while it is missing or not yet fully written. */
export function pngHash(path: string): string | null {
  if (!existsSync(path)) return null
  const png = readFileSync(path)
  if (png.length < 64 || png.subarray(1, 4).toString() !== "PNG" || !png.subarray(-8).equals(IEND)) return null
  return createHash("sha256").update(png).digest("hex")
}

/** Polls until `pngHash(path)` satisfies `ok`, up to `ms`; the hash and how long it took, or null hash on timeout. */
export async function waitPng(path: string, ok: (h: string) => boolean, ms: number): Promise<{ hash: string | null; ms: number }> {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    const h = pngHash(path)
    if (h && ok(h)) return { hash: h, ms: performance.now() - t0 }
    await Bun.sleep(25)
  }
  return { hash: null, ms: performance.now() - t0 }
}

/**
 * The files the dev-workflow tests could leave in the repo by mistake: the example directories
 * they copy, test/devflow itself, Vite's caches under node_modules, and Bun's compile temporaries
 * at the root. Names with sizes and mtimes, to compare before and after.
 */
export function repoFootprint(): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    const abs = join(REPO, rel)
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs).sort()) {
      const p = join(rel, name)
      const st = statSync(join(REPO, p))
      if (st.isDirectory()) walk(p)
      else out.push(`${p} ${st.size} ${st.mtimeMs}`)
    }
  }
  for (const d of ["examples/hello", "examples/vite", "test/devflow", "node_modules/.vite", "node_modules/.vite-temp"]) walk(d)
  for (const name of readdirSync(REPO).sort()) if (/\.bun-build$|^hello$|^dist-vite/.test(name)) out.push(name)
  return out
}
