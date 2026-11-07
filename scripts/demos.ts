#!/usr/bin/env bun
// Opens every example, one after another, for looking through them by hand: the next one starts
// when the current one exits (closing its window, for most).
//
//   bun scripts/demos.ts                       # every example, on Bun
//   bun scripts/demos.ts --runtime node        # on Node (22.18+, which runs .ts directly)
//   bun scripts/demos.ts --rust                # Rune's Rust originals instead (cargo run --release)
//   bun scripts/demos.ts hello todo sketch     # just these, in this order
//   bun scripts/demos.ts --from matched        # start at one (to resume)
//   bun scripts/demos.ts --skip video-tiles    # leave one out (repeatable)
//   bun scripts/demos.ts --list                # print the playlist and exit
//   bun scripts/demos.ts --perf                # with the performance overlay in every window
//   bun scripts/demos.ts --perf=overlay,log    # ...and its numbers on stderr (`log` alone: no overlay)
//   bun scripts/demos.ts --titlebar            # macOS: every window with a standard titlebar
//   bun scripts/demos.ts -- --theme light      # Rune arguments for every demo
//
// `--perf` sets RUNEX_PERF for each demo (docs/dev-workflow.md, "Performance overlay"), which
// reaches the Vite one too and can't be mistaken for an app's own argument. `--titlebar` sets
// RUNEX_TITLEBAR=native the same way (docs/dev-workflow.md, "Standard titlebar"). Both are runex's,
// so neither combines with --rust.
//
// Ctrl+C ends the current demo and starts the next. A few keep running without a window
// (`background` after its window closes, the overlay demos), and the header says how to leave
// them. Ctrl+C twice within a second quits.
//
// The playlist is examples/*/main.ts in alphabetical order, plus overlay-lab's two extra binaries
// (examples/overlay-lab/bin/*.ts). examples/vite runs through Vite's dev server. video-tiles'
// bench.ts is a benchmark, not a demo, so it isn't included.
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const RUNE = join(ROOT, "vendor", "rune")

type Demo = {
  /** Playlist name: the example's directory, or `example:bin` for an extra binary. */
  name: string
  cmd: string[]
  cwd: string
  /** The first paragraph of the example's header comment. */
  about: string
  /** How to leave a demo that doesn't exit when its window closes. */
  hint?: string
}

/** Rune or app arguments that particular demos need (on both the TypeScript and Rust sides). */
const ARGS: Record<string, string[]> = {
  // Starts with no window otherwise and is driven from stdin.
  background: ["--open"],
}

const HINTS: Record<string, string> = {
  background: "closing the window keeps it running: type `quit` and Enter (or `open` to reopen), or Ctrl+C",
  "overlay-lab": "a transparent overlay under the pointer; Ctrl+C to move on",
  "overlay-lab:occluded-timer": "an overlay with a timer, no window; Ctrl+C to move on",
  "overlay-lab:layer-filter-overlay": "a static overlay, no window; press Enter to quit",
  // Its poll changes state but never asks for a frame (no `tx.wake_after`), and Rune draws
  // nothing while idle, so it only advances on input. The Rust original behaves the same.
  shapes: "animates only while the pointer moves over it: Rune draws nothing when idle, as in Rust",
}

// ---------------------------------------------------------------------------------------------
// Options

const argv = process.argv.slice(2)
const dash = argv.indexOf("--")
const passthrough = dash < 0 ? [] : argv.slice(dash + 1)
const opts = dash < 0 ? argv : argv.slice(0, dash)

let runtime = "bun"
let rust = false
let list = false
let from: string | null = null
/** RUNEX_PERF for every demo, or null. */
let perf: string | null = null
/** RUNEX_TITLEBAR=native for every demo. */
let titlebar = false
const skip = new Set<string>()
const only: string[] = []
for (let i = 0; i < opts.length; i++) {
  const a = opts[i]!
  const value = () => {
    const v = opts[++i]
    if (v === undefined) fail(`${a} needs a value`)
    return v
  }
  if (a === "--runtime") runtime = value()
  else if (a.startsWith("--runtime=")) runtime = a.slice("--runtime=".length)
  else if (a === "--rust") rust = true
  else if (a === "--perf") perf = "1"
  else if (a.startsWith("--perf=")) perf = a.slice("--perf=".length) || "1"
  else if (a === "--titlebar") titlebar = true
  else if (a === "--list") list = true
  else if (a === "--from") from = value()
  else if (a === "--skip") skip.add(value())
  else if (a === "-h" || a === "--help") {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\nimport ")[0]!.replace(/^#!.*\n/, "").replace(/^\/\/ ?/gm, ""))
    process.exit(0)
  } else if (a.startsWith("-")) fail(`unknown option ${a} (Rune arguments go after --)`)
  else only.push(a)
}
if (runtime !== "bun" && runtime !== "node") fail(`--runtime must be bun or node, not ${runtime}`)
if (perf !== null && rust) fail("--perf is runex's overlay; the Rust originals don't have it")
if (titlebar && rust) fail("--titlebar is runex's; the Rust originals have no such switch")

function fail(message: string): never {
  console.error(`demos: ${message}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------------------------
// The playlist

/** The first paragraph of a file's leading `//` (or Rust `//!`) comment, without its markers. */
function header(file: string): string {
  if (!existsSync(file)) return ""
  const lines: string[] = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("#!")) continue
    const m = /^\s*\/\/!?(?: (.*))?$/.exec(line)
    if (!m) break
    if (!m[1]?.trim()) {
      if (lines.length) break
      continue
    }
    lines.push(m[1])
  }
  return lines.join("\n")
}

/** The most useful description: the port's header, unless it only says what it's a port of. */
function about(...files: string[]): string {
  for (const file of files) {
    const text = header(file)
    if (text && !/^Port of [^\n]*\.$/.test(text)) return text
  }
  return ""
}

function demos(): Demo[] {
  const out: Demo[] = []
  const names = readdirSync(join(ROOT, "examples"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  for (const name of names) {
    const dir = join(ROOT, "examples", name)
    const rustDir = join(RUNE, "examples", name)
    const rustAbout = [join(rustDir, "src", "main.rs"), join(rustDir, "src", "lib.rs")]
    const args = [...(ARGS[name] ?? []), ...passthrough]

    if (name === "vite") {
      // The hello app, served by Vite (examples/vite/vite.config.ts); closing the window stops Vite.
      if (rust) continue
      // `serve` (Vite's default command, named) keeps the `--` before Rune's arguments off the
      // script's heels: Bun drops a `--` that directly follows the script path.
      const vite = join(ROOT, "node_modules", "vite", "bin", "vite.js")
      const cmd = runtime === "bun" ? ["bun", "--bun", vite, "serve"] : ["node", vite, "serve"]
      out.push({ name, cmd: [...cmd, ...(args.length ? ["--", ...args] : [])], cwd: dir, about: about(join(dir, "main.ts")) })
      continue
    }
    if (!existsSync(join(dir, "main.ts"))) continue

    const bins = existsSync(join(dir, "bin"))
      ? readdirSync(join(dir, "bin")).filter((f) => f.endsWith(".ts")).map((f) => f.slice(0, -3)).sort()
      : []
    for (const bin of [null, ...bins]) {
      const id = bin ? `${name}:${bin}` : name
      const ts = bin ? join(dir, "bin", `${bin}.ts`) : join(dir, "main.ts")
      if (rust) {
        if (!existsSync(join(rustDir, "Cargo.toml"))) continue
        const pkg = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(join(rustDir, "Cargo.toml"), "utf8"))?.[1] ?? name
        out.push({
          name: id,
          cmd: ["cargo", "run", "--release", "-q", "-p", pkg, ...(bin ? ["--bin", bin] : []), ...(args.length ? ["--", ...args] : [])],
          cwd: RUNE,
          about: about(bin ? join(rustDir, "src", "bin", `${bin}.rs`) : rustAbout[0]!, ...(bin ? [] : rustAbout.slice(1)), ts),
          hint: HINTS[id],
        })
      } else {
        out.push({
          name: id,
          cmd: [runtime, relative(ROOT, ts), ...args],
          cwd: ROOT,
          about: about(ts, ...(bin ? [] : [join(dir, "lib.ts"), ...rustAbout])),
          hint: HINTS[id],
        })
      }
    }
  }
  return out
}

let playlist = demos()
const known = new Set(playlist.map((d) => d.name))
for (const name of [...only, ...skip, ...(from ? [from] : [])]) {
  if (!known.has(name)) fail(`no demo named ${name}${rust ? " with a Rust original" : ""} (see --list)`)
}
if (only.length) playlist = only.map((name) => playlist.find((d) => d.name === name)!)
if (from) playlist = playlist.slice(playlist.findIndex((d) => d.name === from))
playlist = playlist.filter((d) => !skip.has(d.name))

const tty = process.stdout.isTTY
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s)
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s)
/** The command as you'd type it from the repository root. */
function shown(d: Demo): string {
  const cmd = d.cmd
    .map((a) => (a.startsWith(ROOT + "/") ? relative(d.cwd, a) : a))
    .map((a) => (/^[\w./:=@+-]+$/.test(a) ? a : JSON.stringify(a)))
    .join(" ")
  const line = (perf === null ? "" : `RUNEX_PERF=${perf} `) + (titlebar ? "RUNEX_TITLEBAR=native " : "") + cmd
  return d.cwd === ROOT ? line : `(cd ${relative(ROOT, d.cwd)} && ${line})`
}

if (list) {
  playlist.forEach((d, i) => console.log(`${String(i + 1).padStart(2)}  ${d.name.padEnd(34)} ${dim(shown(d))}`))
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------
// Running

const env: NodeJS.ProcessEnv = { ...process.env }
if (rust) env.PATH = `${join(homedir(), ".cargo", "bin")}:${process.env.PATH ?? ""}`
if (perf !== null) env.RUNEX_PERF = perf
if (titlebar) env.RUNEX_TITLEBAR = "native"
let child: ChildProcess | null = null
let skipped = false
let lastInterrupt = 0

// The terminal sends Ctrl+C to the whole foreground process group, so the demo gets it too and
// usually exits on its own; this only decides what the runner does next.
process.on("SIGINT", () => {
  const now = Date.now()
  if (now - lastInterrupt < 1000) {
    child?.kill("SIGKILL")
    console.log("\ndemos: quit")
    process.exit(130)
  }
  lastInterrupt = now
  if (!child) return
  skipped = true
  const current = child
  setTimeout(() => current.exitCode === null && current.signalCode === null && current.kill("SIGTERM"), 1500).unref()
  setTimeout(() => current.exitCode === null && current.signalCode === null && current.kill("SIGKILL"), 4000).unref()
})

function run(demo: Demo): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    const proc = spawn(demo.cmd[0]!, demo.cmd.slice(1), { cwd: demo.cwd, env, stdio: "inherit" })
    child = proc
    proc.on("error", (error) => {
      console.error(`demos: can't start ${demo.cmd[0]}: ${error.message}`)
      process.exit(1)
    })
    proc.on("exit", (code, signal) => {
      child = null
      resolve({ code, signal })
    })
  })
}

const problems: string[] = []
for (const [i, demo] of playlist.entries()) {
  const title = ` ${i + 1}/${playlist.length}  ${demo.name} `
  console.log(`\n${bold(`━━${title}${"━".repeat(Math.max(4, 76 - title.length))}`)}`)
  if (demo.about) console.log(demo.about.split("\n").slice(0, 6).join("\n"))
  if (demo.hint) console.log(bold(`→ ${demo.hint}`))
  console.log(dim(`$ ${shown(demo)}`))
  skipped = false
  const { code, signal } = await run(demo)
  if (!skipped && (code !== 0 || signal)) {
    const how = signal ? `was killed by ${signal}` : `exited with code ${code}`
    console.log(bold(`demos: ${demo.name} ${how}`))
    problems.push(`${demo.name} ${how}`)
  }
}

console.log(`\n${bold(`demos: done, ${playlist.length} shown`)}`)
if (problems.length) console.log(problems.map((p) => `  ${p}`).join("\n"))
