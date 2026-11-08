#!/usr/bin/env bun
// Verifies that each TypeScript port of a Rune example renders 1:1 with its Rust original.
//
//   bun scripts/compare.ts [example ...] [--all] [--json report.json] [options] [-- rune args]
//
// For each example: builds the Rust package in vendor/rune, lists its windows (`--list-windows`)
// and each window's scenes (`--list-scenes`, falling back to the `scenes:` arrays in the Rust
// source), renders every (window, scene) plus the no-scene default with the Rust binary and with
// `bun|node examples/<name>/main.ts`, both with `--snap` and `--tree`, and compares the PNGs
// (bytes, then pixels) and the element trees. Writes the renders under out/compare/<name>/ and
// deletes each scene's once all its comparisons pass (`--keep` keeps them), so what's left there is
// what failed. Cargo builds Rune without incremental caches or debug info (scripts/lib/cargo.ts).
// A window whose scenes all render the same bytes fails too: Rune ignored `--scene`, and both
// sides would collapse alike. The process, PNG, tree and listing helpers live in scripts/lib/
// (shared with scripts/golden.ts). See scripts/README.md.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { availableParallelism, homedir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import defaultConfig from "./compare.config.ts"
import { fileStem, listingLines, NO_SCENE, portedExamples, portPath, rustExamples, scenesFromSource } from "./lib/discover.ts"
import { comparePng, type PngResult, sha256, type Tolerance } from "./lib/png.ts"
import { runeCargoEnv } from "./lib/cargo.ts"
import { availableRuntimes, exec, failure, pool, ROOT, RUNE, type Runtime, tail, tsCommand } from "./lib/proc.ts"
import { render as renderSide, type Render, type Side } from "./lib/render.ts"
import { compareTrees, type TreeDiff, type TreeResult } from "./lib/tree.ts"

export { availableRuntimes, compareTrees, NO_SCENE, portedExamples, portPath, ROOT, RUNE, rustExamples, scenesFromSource }
export type { PngResult, Runtime, Tolerance, TreeDiff, TreeResult }

// -------------------------------------------------------------------------------------------
// Configuration (scripts/compare.config.ts)

export type SceneConfig = {
  /** Don't compare this scene; the reason shows in the report. */
  skip?: string
  /** Extra Rune arguments for this scene's renders, on both sides. */
  args?: string[]
  tolerance?: Tolerance
  /** Tree paths to leave out of the comparison: a prefix of the plain path, or a pattern. */
  ignoreTree?: (string | RegExp)[]
}

export type WindowConfig = {
  skip?: string
  /** Per-scene settings for this window only (they win over the example's `scenes`). */
  scenes?: Record<string, SceneConfig>
}

export type ExampleConfig = {
  /** Don't compare the example at all; the reason shows in the report. */
  skip?: string
  /** The Cargo package (default: the one in vendor/rune/examples/<name>). */
  package?: string
  /** The binary target (default: the one named like the package). */
  bin?: string
  /** Extra Rune arguments for every listing and render of this example, on both sides. */
  args?: string[]
  /** Extra environment for both sides. */
  env?: Record<string, string>
  /** Working directory of the Rust binary, relative to vendor/rune (default "."). */
  rustCwd?: string
  /** Working directory of the TypeScript port, relative to the repository (default "."). */
  tsCwd?: string
  /** Seconds each process may run (default: --timeout). */
  timeout?: number
  tolerance?: Tolerance
  ignoreTree?: (string | RegExp)[]
  /** Per-window settings, by window key. */
  windows?: Record<string, WindowConfig>
  /** Per-scene settings, by scene name; `"(none)"` is the render without `--scene`. */
  scenes?: Record<string, SceneConfig>
}

export type CompareConfig = { examples: Record<string, ExampleConfig> }

// -------------------------------------------------------------------------------------------
// Paths and options

export type Options = {
  examples: string[]
  runtimes: Runtime[]
  /** A missing port fails instead of reporting "not ported". */
  strict: boolean
  /** Compare `--tree` dumps too. */
  tree: boolean
  /** Run `cargo build` (off: use the binaries already in the target directory). */
  build: boolean
  release: boolean
  jobs: number
  /** Seconds each render or listing may take. */
  timeout: number
  /** Render the Rust side twice and flag scenes whose own output varies. */
  selfCheck: boolean
  out: string
  /** Keep every render under `out`; by default a scene's files go once all its comparisons pass. */
  keep: boolean
  scenes: string[]
  windows: string[]
  /** Rune arguments appended to every render on both sides (after `--`). */
  extraArgs: string[]
  /** Tree differences kept per comparison. */
  maxDiffs: number
  config: CompareConfig
  log: (line: string) => void
}

export function defaultOptions(over: Partial<Options> = {}): Options {
  return {
    examples: [],
    runtimes: ["bun"],
    strict: false,
    tree: true,
    build: true,
    release: false,
    jobs: Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2))),
    timeout: 120,
    selfCheck: false,
    out: join(ROOT, "out", "compare"),
    keep: false,
    scenes: [],
    windows: [],
    extraArgs: [],
    maxDiffs: 8,
    config: defaultConfig,
    log: (line) => console.error(line),
    ...over,
  }
}

// -------------------------------------------------------------------------------------------
// Results

export type RowStatus = "pass" | "close" | "fail" | "error" | "flaky" | "skip"

export type Row = {
  window: string
  scene: string
  runtime: Runtime | "-"
  status: RowStatus
  reason?: string
  png?: PngResult
  tree?: TreeResult
  error?: string
  files: { rust?: string; ts?: string; rustTree?: string; tsTree?: string; diff?: string; logs: string[] }
  ms: { rust?: number; ts?: number }
}

export type ExampleStatus = "pass" | "fail" | "error" | "skip" | "not ported"

export type ExampleResult = {
  name: string
  status: ExampleStatus
  reason?: string
  package?: string
  bin?: string
  exe?: string
  windows: string[]
  scenes: Record<string, string[]>
  /** How the scenes were found: Rune's `--list-scenes`, or the Rust source as a fallback. */
  discovery?: "list-scenes" | "source"
  /** Example-level failures: listings that differ between Rust and the port, and the like. */
  problems: string[]
  rows: Row[]
  ms: number
}

export type Report = {
  startedAt: string
  ms: number
  runtimes: Runtime[]
  profile: "debug" | "release"
  examples: ExampleResult[]
  totals: Record<ExampleStatus, number> & { rows: Record<RowStatus, number> }
  ok: boolean
}

const failingRow = (s: RowStatus) => s === "fail" || s === "error" || s === "flaky"

/** One line per failure in `r`: empty when the example passed (or was skipped/not ported). */
export function failures(r: ExampleResult, strict = false): string[] {
  const out: string[] = []
  if (r.status === "error") out.push(`${r.name}: ${r.reason ?? "error"}`)
  if (r.status === "not ported" && strict) out.push(`${r.name}: not ported`)
  for (const p of r.problems) out.push(`${r.name}: ${p}`)
  for (const row of r.rows) if (failingRow(row.status)) out.push(`${r.name} ${rowLabel(row)}: ${row.status}: ${rowDetail(row)}`)
  return out
}

// -------------------------------------------------------------------------------------------
// Examples, packages and builds

function cargo(): string {
  if (process.env.CARGO) return process.env.CARGO
  const home = join(homedir(), ".cargo", "bin", "cargo")
  return existsSync(home) ? home : "cargo"
}

function cargoEnv(): Record<string, string> {
  return runeCargoEnv()
}

type Target = { package: string; bins: string[] }
type Metadata = { targetDir: string; byDir: Map<string, Target> }

let metadataCache: Metadata | undefined

/** The workspace's packages by directory; without Cargo, guesses (package = directory name). */
function cargoMetadata(): Metadata {
  if (metadataCache) return metadataCache
  metadataCache = { targetDir: join(RUNE, "target"), byDir: new Map() }
  try {
    const p = Bun.spawnSync([cargo(), "metadata", "--format-version", "1", "--no-deps", "--offline"], {
      cwd: RUNE, env: cargoEnv(), stdout: "pipe", stderr: "pipe",
    })
    if (p.exitCode !== 0) return metadataCache
    const meta = JSON.parse(p.stdout.toString())
    metadataCache.targetDir = meta.target_directory
    for (const pkg of meta.packages) {
      const bins = pkg.targets.filter((t: any) => t.kind.includes("bin")).map((t: any) => t.name)
      metadataCache.byDir.set(resolve(dirname(pkg.manifest_path)), { package: pkg.name, bins })
    }
  } catch {}
  return metadataCache
}

type Binary = { package: string; bin: string; exe?: string; error?: string }

function binaryFor(name: string, cfg: ExampleConfig): Binary {
  const target = cargoMetadata().byDir.get(resolve(RUNE, "examples", name))
  const pkg = cfg.package ?? target?.package ?? name
  const bin = cfg.bin ?? (target?.bins.includes(pkg) ? pkg : target?.bins[0]) ?? pkg
  return { package: pkg, bin }
}

/**
 * Builds each example's binary with its own `cargo build -p <package>`, as `cargo run -p` would:
 * one invocation for several packages unifies their dependencies' features, which rebuilds
 * `rune` whenever the set changes and links binaries unlike the example's own. Cargo reuses
 * fresh builds, so a build that's done costs a fraction of a second. Without `build`, looks for
 * the binaries in the target directory.
 */
export async function buildExamples(names: string[], opts: Options): Promise<Map<string, Binary>> {
  const out = new Map<string, Binary>()
  for (const name of names) out.set(name, binaryFor(name, opts.config.examples[name] ?? {}))
  const profile = opts.release ? "release" : "debug"
  for (const b of out.values()) {
    if (opts.build) {
      Object.assign(b, await cargoBuild(b, opts))
      continue
    }
    const exe = join(cargoMetadata().targetDir, profile, b.bin)
    if (existsSync(exe)) b.exe = exe
    else b.error = `no ${relative(ROOT, exe)}; build it or drop --no-build`
  }
  return out
}

async function cargoBuild(b: Binary, opts: Options): Promise<{ exe?: string; error?: string }> {
  const t0 = performance.now()
  const cmd = [cargo(), "build", "--message-format=json-render-diagnostics", ...(opts.release ? ["--release"] : []), "-p", b.package, "--bin", b.bin]
  let proc: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>
  try {
    proc = Bun.spawn(cmd, { cwd: RUNE, env: cargoEnv(), stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  } catch (e) {
    return { error: `can't run cargo (${cargo()}): ${e instanceof Error ? e.message : String(e)}` }
  }
  // Pass on what shows progress on a cold build: the workspace's own crates, errors, the end.
  let stderr = ""
  let compiled = false
  const progress = (async () => {
    const decoder = new TextDecoder()
    let pending = ""
    for await (const chunk of proc.stderr) {
      const text = decoder.decode(chunk, { stream: true })
      stderr += text
      const parts = (pending + text).split("\n")
      pending = parts.pop()!
      for (const l of parts) {
        if (/^\s*Compiling /.test(l)) {
          if (!compiled) opts.log(`cargo build -p ${b.package} (${opts.release ? "release" : "debug"})`)
          compiled = true
          if (l.includes(RUNE)) opts.log(`  ${l.trim()}`)
        } else if (/^error/.test(l)) opts.log(`  ${l.trim()}`)
      }
    }
  })()
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), progress])
  const code = await proc.exited
  if (compiled) opts.log(`  built ${b.package} in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
  let exe: string | undefined
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    let msg: any
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.reason === "compiler-artifact" && msg.executable && msg.target?.kind?.includes("bin") && msg.target.name === b.bin) {
      exe = msg.executable
    }
  }
  if (code === 0 && exe && existsSync(exe)) return { exe }
  return { error: code === 0 ? `cargo built no binary ${b.bin} in package ${b.package}` : `cargo build -p ${b.package} failed:\n${tail(stderr, 30)}` }
}

// -------------------------------------------------------------------------------------------
// Processes

function rustSide(exe: string, cfg: ExampleConfig): Side {
  return { label: "rust", cmd: [exe], cwd: resolve(RUNE, cfg.rustCwd ?? ".") }
}

function tsSide(name: string, runtime: Runtime, cfg: ExampleConfig): Side {
  return { label: runtime, cmd: tsCommand(portPath(name), runtime), cwd: resolve(ROOT, cfg.tsCwd ?? ".") }
}

function render(side: Side, args: string[], stem: string, opts: Options, cfg: ExampleConfig): Promise<Render> {
  return renderSide(side, args, stem, { tree: opts.tree, timeout: cfg.timeout ?? opts.timeout, env: cfg.env })
}

/**
 * The "all scenes identical" sanity check: a window with two or more scenes whose Rust renders
 * are all byte-identical (PNG and tree) means `--scene` was ignored, for example after Rune
 * renamed the flag. Every row would still pass, because both sides collapse the same way.
 */
function identicalScenes(jobs: { window: string; scene: string; skip?: string }[], renders: (Render | undefined)[], windows: string[]): string[] {
  const out: string[] = []
  for (const w of windows) {
    const hashes = jobs.flatMap((j, i) => {
      const r = renders[i]
      if (j.window !== w || j.scene === NO_SCENE || j.skip || !r?.ok) return []
      const tree = r.tree && existsSync(r.tree) ? readFileSync(r.tree) : ""
      return [sha256(readFileSync(r.png)) + sha256(tree)]
    })
    if (hashes.length >= 2 && new Set(hashes).size === 1) {
      out.push(`${windows.length > 1 ? `${w}: ` : ""}all ${hashes.length} scenes render identical bytes; is --scene ignored?`)
    }
  }
  return out
}

// -------------------------------------------------------------------------------------------
// One example

export type Prepared = { opts: Options; binaries: Map<string, Binary> }

/** Resolves options and builds every example's Rust binary once. */
export async function prepare(over: Partial<Options> = {}): Promise<Prepared> {
  const opts = defaultOptions(over)
  const runnable = opts.examples.filter((n) =>
    !opts.config.examples[n]?.skip && existsSync(portPath(n)) && existsSync(join(RUNE, "examples", n, "Cargo.toml")))
  const binaries = await buildExamples(runnable, opts)
  return { opts, binaries }
}

function sceneConfig(cfg: ExampleConfig, window: string, scene: string): SceneConfig {
  const fromWindow = cfg.windows?.[window]?.scenes?.[scene]
  const fromExample = cfg.scenes?.[scene]
  return { ...fromExample, ...fromWindow }
}

/** Runs a listing on both sides; returns Rust's lines and notes a difference in the port's. */
async function listBoth(rust: Side, ts: Side[], args: string[], what: string, opts: Options, cfg: ExampleConfig,
  problems: string[]): Promise<string[] | undefined> {
  const timeout = cfg.timeout ?? opts.timeout
  const [r, ...others] = await Promise.all([rust, ...ts].map((s) => exec([...s.cmd, ...args], s.cwd, cfg.env, timeout)))
  if (r!.code !== 0 || r!.timedOut) {
    problems.push(`rust ${what} failed: ${failure(r!, timeout)}`)
    return undefined
  }
  const want = listingLines(r!.stdout)
  others.forEach((o, i) => {
    const label = `${ts[i]!.label} ${what}`
    if (o.code !== 0 || o.timedOut) problems.push(`${label} failed: ${failure(o, timeout)}`)
    else {
      const got = listingLines(o.stdout)
      if (got.join("\n") !== want.join("\n")) problems.push(`${label} differs: rust [${want.join(", ")}], port [${got.join(", ")}]`)
    }
  })
  return want
}

/** Compares one example: discovery, renders and comparisons. Never throws for app failures. */
export async function compareExample(ctx: Prepared, name: string): Promise<ExampleResult> {
  const { opts } = ctx
  const t0 = performance.now()
  const cfg = opts.config.examples[name] ?? {}
  const result: ExampleResult = { name, status: "pass", windows: [], scenes: {}, problems: [], rows: [], ms: 0 }
  const done = (status: ExampleStatus, reason?: string) => {
    result.status = status
    if (reason) result.reason = reason
    result.ms = Math.round(performance.now() - t0)
    return result
  }
  if (!existsSync(join(RUNE, "examples", name, "Cargo.toml"))) return done("error", `no Rust example vendor/rune/examples/${name}`)
  if (cfg.skip) return done("skip", cfg.skip)
  if (!existsSync(portPath(name))) return done(opts.strict ? "error" : "not ported", `no ${relative(ROOT, portPath(name))}`)
  const bin = ctx.binaries.get(name) ?? (await buildExamples([name], opts)).get(name)!
  ctx.binaries.set(name, bin)
  Object.assign(result, { package: bin.package, bin: bin.bin, exe: bin.exe })
  if (!bin.exe) return done("error", bin.error ?? "no binary")

  const dir = join(opts.out, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const rust = rustSide(bin.exe, cfg)
  const ports = opts.runtimes.map((rt) => tsSide(name, rt, cfg))
  const base = [...(cfg.args ?? []), ...opts.extraArgs]

  // Windows, then each window's scenes; the port must list the same ones.
  const windows = (await listBoth(rust, ports, ["--list-windows", ...base], "--list-windows", opts, cfg, result.problems)) ?? ["main"]
  result.windows = windows
  const multi = windows.length > 1
  result.discovery = "list-scenes"
  for (const w of windows) {
    const winArgs = multi ? ["--window", w] : []
    let scenes = await listBoth(rust, ports, [...winArgs, "--list-scenes", ...base], `${multi ? `${w} ` : ""}--list-scenes`, opts, cfg, result.problems)
    if (!scenes) {
      scenes = scenesFromSource(name)
      result.discovery = "source"
    }
    result.scenes[w] = scenes
  }

  // Every (window, scene) to render, the no-scene default first.
  type Job = { window: string; scene: string; args: string[]; stem: string; scfg: SceneConfig; skip?: string }
  const jobs: Job[] = []
  for (const w of windows) {
    if (opts.windows.length && !opts.windows.includes(w)) continue
    for (const scene of [NO_SCENE, ...result.scenes[w]!]) {
      if (opts.scenes.length && !opts.scenes.includes(scene)) continue
      const scfg = sceneConfig(cfg, w, scene)
      const stem = join(dir, ...(multi ? [fileStem(w)] : []), fileStem(scene))
      const args = [...(multi ? ["--window", w] : []), ...(scene === NO_SCENE ? [] : ["--scene", scene]), ...(cfg.args ?? []), ...(scfg.args ?? []), ...opts.extraArgs]
      jobs.push({ window: w, scene, args, stem, scfg, skip: cfg.windows?.[w]?.skip ?? scfg.skip })
    }
  }
  for (const j of jobs) mkdirSync(dirname(j.stem), { recursive: true })

  // Render: Rust (twice with --self-check) and each runtime, all through one pool.
  const live = jobs.filter((j) => !j.skip)
  const tasks: (() => Promise<Render>)[] = []
  const slots = live.map((j) => {
    const slot = { rust: tasks.length, again: -1, ports: [] as number[] }
    tasks.push(() => render(rust, j.args, `${j.stem}.rust`, opts, cfg))
    if (opts.selfCheck) { slot.again = tasks.length; tasks.push(() => render({ ...rust, label: "rust (again)" }, j.args, `${j.stem}.rust-again`, opts, cfg)) }
    for (const p of ports) { slot.ports.push(tasks.length); tasks.push(() => render(p, j.args, `${j.stem}.${p.label}`, opts, cfg)) }
    return slot
  })
  opts.log(`${name}: ${windows.length} window${multi ? "s" : ""}, ${jobs.length} render${jobs.length === 1 ? "" : "s"} × rust + ${opts.runtimes.join(", ")}`)
  const renders = await pool(tasks, opts.jobs)
  result.problems.push(...identicalScenes(jobs, jobs.map((j) => (j.skip ? undefined : renders[slots[live.indexOf(j)]!.rust])), windows))

  for (const j of jobs) {
    if (j.skip) {
      result.rows.push({ window: j.window, scene: j.scene, runtime: "-", status: "skip", reason: j.skip, files: { logs: [] }, ms: {} })
      continue
    }
    const slot = slots[live.indexOf(j)]!
    const r = renders[slot.rust]!
    let flaky: string | undefined
    if (opts.selfCheck && r.ok) {
      const again = renders[slot.again]!
      if (!again.ok) flaky = `second Rust render failed: ${again.error}`
      else {
        try {
          const png = comparePng(r.png, again.png, `${j.stem}.rust-again.diff.png`, {})
          const tree = opts.tree ? compareTrees(r.tree!, again.tree!, [], 1) : undefined
          if (!png.identical || (tree && !tree.identical)) {
            flaky = `the Rust example's own output varies between runs (${!png.identical ? `${png.pixels ?? "?"} px` : `tree: ${tree!.diffs[0]?.path}`}); skip it or set a tolerance in compare.config.ts`
          }
        } catch (e) {
          flaky = `comparing the two Rust renders: ${e instanceof Error ? e.message : String(e)}`
        }
      }
    }
    opts.runtimes.forEach((runtime, i) => {
      const t = renders[slot.ports[i]!]!
      const row: Row = {
        window: j.window, scene: j.scene, runtime, status: "pass",
        files: { rust: r.png, ts: t.png, rustTree: r.tree, tsTree: t.tree, logs: [r.log, t.log].filter((l): l is string => !!l) },
        ms: { rust: r.ms, ts: t.ms },
      }
      result.rows.push(row)
      if (!r.ok || !t.ok) {
        row.status = "error"
        row.error = [r.error, t.error].filter(Boolean).join("; ")
        return
      }
      const tol = { ...cfg.tolerance, ...j.scfg.tolerance }
      try {
        row.png = comparePng(r.png, t.png, `${j.stem}.${runtime}.diff.png`, tol)
        if (row.png.diff) row.files.diff = row.png.diff
        if (opts.tree) row.tree = compareTrees(r.tree!, t.tree!, [...(cfg.ignoreTree ?? []), ...(j.scfg.ignoreTree ?? [])], opts.maxDiffs)
      } catch (e) {
        row.status = "error"
        row.error = `comparing: ${e instanceof Error ? e.message : String(e)}`
        return
      }
      const treeOk = !row.tree || row.tree.identical
      if (row.png.identical && treeOk) row.status = "pass"
      else if (row.png.withinTolerance && treeOk) row.status = "close"
      else row.status = "fail"
      if (flaky) {
        row.status = "flaky"
        row.reason = flaky
      }
    })
  }
  if (!opts.keep) prunePassing(jobs, result.rows, dir)
  const failed = result.problems.length > 0 || result.rows.some((r) => failingRow(r.status))
  const allSkipped = result.rows.length > 0 && result.rows.every((r) => r.status === "skip")
  if (failed) return done("fail")
  return allSkipped ? done("skip", "every scene is skipped in compare.config.ts") : done("pass")
}

/**
 * Deletes the renders, trees, logs and diffs of every scene whose comparisons all passed, then the
 * example's folder if nothing is left: what stays under `out` is what needs looking at. Those rows
 * keep their results but no file paths.
 */
function prunePassing(jobs: { window: string; scene: string; stem: string }[], rows: Row[], dir: string) {
  for (const j of jobs) {
    const mine = rows.filter((r) => r.window === j.window && r.scene === j.scene)
    if (!mine.length || !mine.every((r) => r.status === "pass" || r.status === "skip")) continue
    const folder = dirname(j.stem)
    const prefix = `${basename(j.stem)}.`
    for (const f of existsSync(folder) ? readdirSync(folder) : []) if (f.startsWith(prefix)) rmSync(join(folder, f), { force: true })
    for (const r of mine) r.files = { logs: [] }
  }
  removeEmpty(dir)
}

/** Removes `dir` and its subfolders when they hold no files. */
function removeEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true
  const empty = readdirSync(dir, { withFileTypes: true }).every((e) => e.isDirectory() && removeEmpty(join(dir, e.name)))
  if (empty) rmSync(dir, { recursive: true, force: true })
  return empty
}

/** Builds and compares every example in `opts.examples`. */
export async function compareAll(over: Partial<Options> = {}): Promise<Report> {
  const t0 = performance.now()
  const startedAt = new Date().toISOString()
  const ctx = await prepare(over)
  const { opts } = ctx
  const examples: ExampleResult[] = []
  for (const name of opts.examples) {
    const r = await compareExample(ctx, name)
    if (r.status !== "not ported" && !(r.status === "skip" && r.rows.length === 0)) {
      opts.log(`${name}: ${r.status}${r.reason ? ` (${r.reason.split("\n")[0]})` : ""} in ${(r.ms / 1000).toFixed(1)} s`)
    }
    examples.push(r)
  }
  const totals = { pass: 0, fail: 0, error: 0, skip: 0, "not ported": 0, rows: { pass: 0, close: 0, fail: 0, error: 0, flaky: 0, skip: 0 } }
  for (const e of examples) {
    totals[e.status]++
    for (const r of e.rows) totals.rows[r.status]++
  }
  const ok = examples.every((e) => failures(e, opts.strict).length === 0)
  return { startedAt, ms: Math.round(performance.now() - t0), runtimes: opts.runtimes, profile: opts.release ? "release" : "debug", examples, totals, ok }
}

// -------------------------------------------------------------------------------------------
// Reporting

function rowLabel(row: Row): string {
  return [row.window !== "main" ? row.window : "", row.scene, row.runtime !== "-" ? `[${row.runtime}]` : ""].filter(Boolean).join(" ")
}

function pngCell(p?: PngResult): string {
  if (!p) return "-"
  if (p.identical) return p.samePixels ? "same pixels" : "identical"
  if (p.rustSize && p.tsSize && (p.rustSize[0] !== p.tsSize[0] || p.rustSize[1] !== p.tsSize[1])) {
    return `size ${p.rustSize.join("x")} vs ${p.tsSize.join("x")}`
  }
  return `${p.pixels} px, Δ${p.maxDelta}`
}

function treeCell(t?: TreeResult): string {
  if (!t) return "-"
  return t.identical ? "identical" : `${t.count} diff${t.count === 1 ? "" : "s"}`
}

function show(v: unknown): string {
  const s = v === undefined ? "(absent)" : JSON.stringify(v)
  return s.length > 60 ? `${s.slice(0, 57)}...` : s
}

function rowDetail(row: Row): string {
  if (row.reason) return row.reason
  if (row.error) return row.error
  const parts: string[] = []
  if (row.png && !row.png.identical && row.png.bbox) parts.push(`differs in ${row.png.bbox.join(",")} (x,y,w,h px)`)
  if (row.tree && !row.tree.identical) {
    const d = row.tree.diffs[0]!
    parts.push(`${d.path}: ${show(d.rust)} → ${show(d.ts)}`)
  }
  return parts.join("; ")
}

const tty = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const colours: Record<string, (s: string) => string> = {
  pass: paint(32), close: paint(32), fail: paint(31), error: paint(31), flaky: paint(33), skip: paint(90), "not ported": paint(90),
}

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const fmt = (r: string[], header = false) => r.map((c, i) => {
    const pad = i === r.length - 1 ? c : c.padEnd(widths[i]!)
    return !header && head[i] === "STATUS" ? (colours[c] ?? ((s: string) => s))(pad) : pad
  }).join("  ").trimEnd()
  return [fmt(head, true), ...rows.map((r) => fmt(r))].join("\n")
}

export function formatReport(report: Report, opts: Pick<Options, "strict">): string {
  const multiWindow = report.examples.some((e) => e.windows.length > 1)
  const multiRuntime = report.runtimes.length > 1
  const head = ["EXAMPLE", ...(multiWindow ? ["WINDOW"] : []), "SCENE", ...(multiRuntime ? ["RUNTIME"] : []), "STATUS", "PNG", "TREE", "DETAIL"]
  const rows: string[][] = []
  const clip = (s: string) => (s.length > 100 ? `${s.slice(0, 97)}...` : s)
  for (const e of report.examples) {
    if (e.rows.length === 0) {
      rows.push([e.name, ...(multiWindow ? ["-"] : []), "-", ...(multiRuntime ? ["-"] : []), e.status, "-", "-", clip((e.reason ?? e.problems[0] ?? "").split("\n")[0]!)])
      continue
    }
    for (const r of e.rows) {
      rows.push([e.name, ...(multiWindow ? [r.window] : []), r.scene, ...(multiRuntime ? [r.runtime] : []), r.status, pngCell(r.png), treeCell(r.tree), clip(rowDetail(r))])
    }
    for (const p of e.problems) rows.push([e.name, ...(multiWindow ? ["-"] : []), "-", ...(multiRuntime ? ["-"] : []), "fail", "-", "-", clip(p)])
  }
  const out = [table(head, rows), ""]

  // Details of each failure: every kept tree difference and where the files are.
  const failed = report.examples.flatMap((e) => e.rows.filter((r) => failingRow(r.status)).map((r) => [e, r] as const))
  if (failed.length) {
    out.push("Failures:")
    for (const [e, r] of failed) {
      out.push(`  ${e.name} ${rowLabel(r)} (${r.status})`)
      if (r.error) out.push(`    ${r.error}`)
      if (r.reason) out.push(`    ${r.reason}`)
      if (r.png && !r.png.identical) out.push(`    png: ${pngCell(r.png)}${r.png.bbox ? ` in ${r.png.bbox.join(",")}` : ""}`)
      if (r.tree && !r.tree.identical) {
        for (const d of r.tree.diffs) out.push(`    tree ${d.path}: rust ${show(d.rust)}, port ${show(d.ts)}`)
        if (r.tree.count > r.tree.diffs.length) out.push(`    ... ${r.tree.count - r.tree.diffs.length} more tree differences`)
      }
      for (const f of [r.files.rust, r.files.ts, r.files.diff, ...r.files.logs]) if (f && existsSync(f)) out.push(`    ${relative(ROOT, f)}`)
    }
    out.push("")
  }
  for (const e of report.examples) if (e.status === "error" && e.reason?.includes("\n")) out.push(`${e.name}: ${e.reason}`, "")

  const t = report.totals
  const examples = (["pass", "fail", "error", "skip", "not ported"] as const).filter((k) => t[k]).map((k) => `${t[k]} ${k}`).join(", ")
  const renders = (["pass", "close", "fail", "error", "flaky", "skip"] as const).filter((k) => t.rows[k]).map((k) => `${t.rows[k]} ${k}`).join(", ")
  out.push(`${report.examples.length} example${report.examples.length === 1 ? "" : "s"}: ${examples || "none"}; comparisons: ${renders || "none"} (${(report.ms / 1000).toFixed(1)} s)`)
  if (!report.ok) out.push(opts.strict && t["not ported"] ? "FAILED (--strict: unported examples fail)" : "FAILED")
  return out.join("\n")
}

// -------------------------------------------------------------------------------------------
// CLI

const HELP = `usage: bun scripts/compare.ts [example ...] [options] [-- rune args]

Renders each example with the Rust binary and its TypeScript port and compares the PNGs and
element trees. With no examples, compares every ported one (examples/*/main.ts).

  --all               every Rust example in vendor/rune/examples (unported ones: "not ported")
  --runtime R         bun (default), node, or both: --runtime bun,node
  --json FILE         write the full report as JSON
  --strict            a missing port fails instead of reporting "not ported"
  --scene NAME        only this scene (repeatable; "${NO_SCENE}" is the render without --scene)
  --window KEY        only this window (repeatable)
  --no-tree           compare PNGs only
  --no-build          don't run cargo; use the binaries already built
  --release           build and run the Rust examples in release
  --self-check        render the Rust side twice and flag scenes whose output varies
  --jobs N            renders at once (default ${defaultOptions().jobs})
  --timeout S         seconds per render or listing (default 120)
  --max-diffs N       tree differences kept per comparison (default 8)
  --out DIR           scratch directory (default out/compare): what failed, and the report
  --keep              keep every render there, not only the scenes that didn't pass
  -- ARGS             Rune arguments for both sides, e.g. -- --theme light --at 1.5 --scale 1

Skips, tolerances and per-example arguments live in scripts/compare.config.ts.`

export function parseArgs(argv: string[]): { opts: Partial<Options>; all: boolean; json?: string } {
  const opts: Partial<Options> & { scenes: string[]; windows: string[]; examples: string[] } = { scenes: [], windows: [], examples: [] }
  let all = false
  let json: string | undefined
  const usage = (msg: string): never => {
    console.error(`${msg}\n\n${HELP}`)
    process.exit(2)
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const val = () => argv[++i] ?? usage(`${a} needs a value`)
    switch (a) {
      case "--all": all = true; break
      case "--json": json = resolve(val()); break
      case "--runtime": {
        const rts = val().split(",").map((s) => s.trim()).filter(Boolean)
        for (const r of rts) if (r !== "bun" && r !== "node") usage(`unknown runtime ${r}`)
        opts.runtimes = rts as Runtime[]
        break
      }
      case "--strict": opts.strict = true; break
      case "--scene": opts.scenes.push(val()); break
      case "--window": opts.windows.push(val()); break
      case "--no-tree": opts.tree = false; break
      case "--no-build": opts.build = false; break
      case "--release": opts.release = true; break
      case "--self-check": opts.selfCheck = true; break
      case "--keep": opts.keep = true; break
      case "--jobs": opts.jobs = Math.max(1, Number(val()) || 1); break
      case "--timeout": opts.timeout = Number(val()) || 120; break
      case "--max-diffs": opts.maxDiffs = Math.max(1, Number(val()) || 1); break
      case "--out": opts.out = resolve(val()); break
      case "-h": case "--help": console.log(HELP); process.exit(0)
      case "--": opts.extraArgs = argv.slice(i + 1); i = argv.length; break
      default:
        if (a.startsWith("-")) usage(`unknown option ${a}`)
        opts.examples.push(a.replace(/\/+$/, "").split("/").pop()!)
    }
  }
  return { opts, all, json }
}

async function main() {
  const { opts, all, json } = parseArgs(process.argv.slice(2))
  const rust = rustExamples()
  if (all) opts.examples = [...new Set([...rust, ...opts.examples!])]
  else if (!opts.examples!.length) opts.examples = portedExamples()
  const unknown = opts.examples!.filter((n) => !rust.includes(n))
  if (unknown.length) {
    console.error(`no Rust example ${unknown.join(", ")} in vendor/rune/examples (have: ${rust.join(", ")})`)
    process.exit(2)
  }
  if (!opts.examples!.length) {
    console.log("No ported examples (examples/<name>/main.ts) to compare; --all lists every Rust example.")
    return
  }
  const report = await compareAll(opts)
  console.log(formatReport(report, { strict: !!opts.strict }))
  if (json) {
    mkdirSync(dirname(json), { recursive: true })
    writeFileSync(json, JSON.stringify(report, (_, v) => (v instanceof RegExp ? String(v) : v), 2))
    console.log(`report: ${relative(process.cwd(), json)}`)
  }
  process.exit(report.ok ? 0 : 1)
}

if (import.meta.main) await main()
