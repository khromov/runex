// Moves vendor/rune to another Rune revision and runs every check around the move, then writes
// a checklist for the PR. It never stages, commits or blesses anything: it prints the commands.
//
//   bun scripts/update-rune.ts <rev|--tip> [options]
//
//   --tip          upstream's default branch, as `git ls-remote origin HEAD` gives it
//   --dry-run      change nothing in the repo: try the bump in a clone (out/update-rune/rune, which
//                  shares vendor/rune's objects), bind it into the state dir, and skip the build,
//                  compare, golden and perf steps
//   --patches DIR  apply DIR's *.patch instead of patches/ (every patch, some rebased); a real run
//                  copies them into patches/ once they apply
//   --from STEP    rerun STEP and every step after it; earlier results come from state.json
//   --only STEP    rerun STEP alone
//   --release      build the addon in release mode (default debug)
//   --no-compare   skip scripts/compare.ts
//   --no-golden    skip scripts/golden.ts
//
// Steps, in order: preflight, upstream, patch, lint, align, bindings, build, inventory, compare,
// golden, perf, summary. A step ends done, review (a human must look: a changed fingerprint, a
// breaking API change, a golden diff), failed, stopped (the run can't go on: the patch doesn't
// apply), or skipped. State, logs and the summary are in out/update-rune/<old8>-<new8>[-dry]/:
// state.json, logs/<step>.log, summary.md (also printed). Exit 0 unless a step failed or stopped.
//
// The patches go on in name order, as prepare-rune applies them, each as a commit in the clone, so
// HEAD there is always the base of the next one. The first that doesn't apply stops the run at
// `patch`, with its conflicted files and hunks, whether each later patch applies without it, and
// how to rebase that patch alone and resume (`--from patch --patches DIR`). DIR then holds every
// patch; the steps rewrite only the one that stopped the run, and keep its header (the text
// before its first `diff --git`).
import { spawnSync } from "node:child_process"
import { appendFileSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { breaking, diffSurface, formatSurfaceDiff } from "../tools/bindgen/surface-diff.ts"
import { cleanRuneCrates } from "./lib/cargo.ts"
import { codeOnly, formatLint, lint } from "./patch-lint.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR = join(ROOT, "vendor", "rune")
const STEPS = ["preflight", "upstream", "patch", "lint", "align", "bindings", "build", "inventory", "compare", "golden", "perf", "summary"] as const
type Step = (typeof STEPS)[number]
type Status = "done" | "review" | "failed" | "stopped" | "skipped"

interface StepResult {
  status: Status
  /** One line for the checklist. */
  summary: string
  /** Lines for the summary's details section. */
  details?: string[]
  at: string
  data?: unknown
}

interface State {
  old: string
  new: string
  dry: boolean
  release: boolean
  patches: string
  steps: Partial<Record<Step, StepResult>>
}

// ── example inventory (also test/static/inventory.test.ts) ──────────────────

/** Ports with no Rust example: why each is fine. */
export const TS_ONLY: Record<string, string> = { vite: "runex's Vite dev-server example; Rune has no Vite" }
/** Rust examples with no port: why each is fine. */
export const UPSTREAM_ONLY: Record<string, string> = { "site-scenes": "the scenes of Rune's website, not an app" }

export interface Inventory {
  ports: string[]
  upstream: string[]
  /** Ports whose Rust example is gone (upstream deleted or renamed it). */
  noTwin: string[]
  /** Rust examples without a port. */
  unported: string[]
  /** Allowlist entries that no longer apply. */
  stale: string[]
}

/** examples/<name>/main.ts against `rune`/examples/<name>/Cargo.toml. */
export function inventory(root: string, rune: string): Inventory {
  const dirs = (d: string, file: string) => (existsSync(d) ? readdirSync(d).filter((n) => existsSync(join(d, n, file))).sort() : [])
  const ports = dirs(join(root, "examples"), "main.ts")
  const upstream = dirs(join(rune, "examples"), "Cargo.toml")
  return {
    ports,
    upstream,
    noTwin: ports.filter((p) => !upstream.includes(p) && !TS_ONLY[p]),
    unported: upstream.filter((u) => !ports.includes(u) && !UPSTREAM_ONLY[u]),
    stale: [
      ...Object.keys(TS_ONLY).filter((k) => !ports.includes(k) || upstream.includes(k)).map((k) => `TS_ONLY ${k}`),
      ...Object.keys(UPSTREAM_ONLY).filter((k) => !upstream.includes(k) || ports.includes(k)).map((k) => `UPSTREAM_ONLY ${k}`),
    ],
  }
}

/** Scene and story names in Rust source: `scenes: &[("name", ..)]`, `scenes: CONST`, `stories! { "name" => .. }`. */
export function scenesIn(src: string): string[] {
  const code = codeOnly(src)
  const names: string[] = []
  const push = (n: string) => !names.includes(n) && names.push(n)
  const body = (open: number, o: string, c: string) => {
    let depth = 0
    for (let i = open; i < code.length; i++) {
      if (code[i] === o) depth++
      else if (code[i] === c && --depth === 0) return src.slice(open + 1, i)
    }
    return src.slice(open + 1)
  }
  for (const m of code.matchAll(/\bscenes\s*:\s*(?:(&\s*\[)|([A-Za-z_][\w:]*))/g)) {
    let text: string | undefined
    if (m[1]) text = body(m.index! + m[0].length - 1, "[", "]")
    else {
      const ident = m[2]!.split("::").pop()!
      const def = new RegExp(`\\b(?:const|static)\\s+${ident}\\s*:[^=]*=\\s*&?\\s*\\[`).exec(code)
      if (def) text = body(def.index + def[0].length - 1, "[", "]")
    }
    for (const s of text?.matchAll(/\(\s*"((?:[^"\\]|\\.)*)"\s*,/g) ?? []) push(s[1]!)
  }
  for (const m of code.matchAll(/\bstories!\s*\{/g)) {
    for (const s of body(m.index! + m[0].length - 1, "{", "}").matchAll(/"((?:[^"\\]|\\.)*)"\s*=>/g)) push(s[1]!)
  }
  return names
}

// ── helpers ──────────────────────────────────────────────────────────────────

const PATH = `${process.env.HOME}/.cargo/bin:${process.env.PATH}`

function git(dir: string, args: string[], allowFail = false, env?: Record<string, string>): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 28, env: env && { ...process.env, ...env } })
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")} (in ${dir}) failed:\n${(r.stderr || r.stdout).trim()}`)
  return r.status === 0 ? r.stdout : ""
}

function gitOk(dir: string, args: string[], env?: Record<string, string>): { ok: boolean; out: string } {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 28, env: env && { ...process.env, ...env } })
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() }
}

/** Runs a command with its output going to `log` as it comes (`tail -f` it); returns the exit code and the output. */
function sh(cmd: string[], log: string, opts: { cwd?: string; env?: Record<string, string> } = {}): { code: number; out: string } {
  mkdirSync(dirname(log), { recursive: true })
  appendFileSync(log, `$ ${cmd.join(" ")}\n`)
  const from = statSync(log).size
  const fd = openSync(log, "a")
  const t0 = Date.now()
  let r: ReturnType<typeof spawnSync>
  try {
    r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: opts.cwd ?? ROOT, env: { ...process.env, PATH, ...opts.env }, stdio: ["ignore", fd, fd] })
  } finally {
    closeSync(fd)
  }
  const code = r.status ?? 1
  const out = readFileSync(log).subarray(from).toString("utf8") + (r.error ? `\n${r.error.message}` : "")
  appendFileSync(log, `${r.error ? `${r.error.message}\n` : ""}[exit ${code} after ${((Date.now() - t0) / 1000).toFixed(1)} s]\n\n`)
  return { code, out }
}

const short = (sha: string) => sha.slice(0, 8)
const tail = (text: string, n: number) => text.trim().split("\n").slice(-n)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function toml(file: string): any {
  return Bun.TOML.parse(readFileSync(file, "utf8"))
}

/** Whether `version` satisfies a Cargo requirement (`~30.0.1`, `0.5.2`, `^1.2`, `=30.0.1`, `>= 1`). */
export function satisfies(req: string, version: string): boolean {
  const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map((x) => Number.parseInt(x, 10))
  const v = parse(version)
  return req.split(",").every((part) => {
    const m = /^\s*(\^|~|=|>=|<=|>|<)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(part)
    if (!m) return true
    const op = m[1] ?? "^"
    const r = [Number(m[2]), m[3] === undefined ? undefined : Number(m[3]), m[4] === undefined ? undefined : Number(m[4])]
    const cmp = (a: number[], b: (number | undefined)[]) => {
      for (let i = 0; i < 3; i++) {
        if (b[i] === undefined) return 0
        if (a[i]! !== b[i]) return a[i]! < b[i]! ? -1 : 1
      }
      return 0
    }
    const c = cmp(v, r)
    if (op === "=") return c === 0
    if (op === ">=") return c >= 0
    if (op === ">") return c > 0
    if (op === "<=") return c <= 0
    if (op === "<") return c < 0
    if (op === "~") return c >= 0 && v[0] === r[0] && (r[1] === undefined || v[1] === r[1])
    // Caret: the leftmost non-zero part stays.
    if (c < 0) return false
    if (r[0]! > 0 || r[1] === undefined) return v[0] === r[0]
    if (r[1]! > 0 || r[2] === undefined) return v[0] === 0 && v[1] === r[1]
    return v[0] === 0 && v[1] === 0 && v[2] === r[2]
  })
}

// ── patches (also test/static/update-rune.test.ts) ──────────────────────────

/** A hunk `git apply` rejected: its file and line, or no line when the file isn't there. */
export interface Hunk {
  file: string
  line?: number
}

/** One patch's result in tryPatches. */
export interface PatchTry {
  /** Its file name, e.g. 0001-pump-event-loop.patch. */
  name: string
  file: string
  /**
   * applied: it applies, and is a commit in the clone on top of the ones before it.
   * conflict: it doesn't apply; the run stops here, with `git apply --3way`'s result in the work tree.
   * after: not applied, since an earlier patch stopped the run; `applies` says whether it would without that one.
   */
  status: "applied" | "conflict" | "after"
  /** conflict: the hunks `git apply --check` rejected. after: the same, without the patch that stopped the run. */
  failed?: Hunk[]
  /** conflict: `git apply --3way` merged it with no conflict markers (to check by eye). */
  merged?: boolean
  /** conflict: files with conflict markers after --3way, and the lines each marker starts at. */
  conflicts?: { file: string; lines: number[] }[]
  /** after: it applies to HEAD (the stopped patch's base) plus the patches between that apply, without the stopped one. */
  applies?: boolean
}

const COMMIT = ["-c", "user.name=update-rune", "-c", "user.email=update-rune@localhost", "-c", "commit.gpgsign=false"]

function rejected(out: string): Hunk[] {
  const hunks: Hunk[] = [...out.matchAll(/patch failed: (\S+):(\d+)/g)].map((m) => ({ file: m[1]!, line: Number(m[2]) }))
  for (const m of out.matchAll(/error: (\S+): (?:does not exist in index|No such file or directory)/g)) hunks.push({ file: m[1]! })
  return hunks
}

export const formatHunk = (h: Hunk) => (h.line === undefined ? `${h.file} is missing` : `hunk at ${h.file}:${h.line}`)

/**
 * Checks out `rev` in `repo`, a scratch checkout (reset and cleaned first), and applies `patches`
 * in order, each as a commit, so HEAD is always the base of the next patch. The first that doesn't
 * apply is merged with `git apply --3way` into the work tree; the ones after it are checked
 * without it in a throwaway index, and none of them is applied.
 */
export function tryPatches(repo: string, rev: string, patches: string[], log: (text: string) => void = () => {}): PatchTry[] {
  git(repo, ["reset", "--quiet", "--hard"])
  git(repo, ["clean", "-fdq"])
  git(repo, ["checkout", "--quiet", "--detach", rev])
  const out: PatchTry[] = []
  let i = 0
  for (; i < patches.length; i++) {
    const file = patches[i]!
    const name = basename(file)
    const check = gitOk(repo, ["apply", "--check", file])
    log(`$ git apply --check ${name}\n${check.out}\n`)
    if (check.ok) {
      const apply = gitOk(repo, ["apply", "--index", file])
      if (!apply.ok) throw new Error(`${name}: git apply failed after --check passed:\n${apply.out}`)
      git(repo, [...COMMIT, "commit", "--quiet", "--no-verify", "--allow-empty", "-m", name])
      out.push({ name, file, status: "applied" })
      continue
    }
    const three = gitOk(repo, ["apply", "--3way", file])
    log(`$ git apply --3way ${name}\n${three.out}\n`)
    const conflicts = git(repo, ["diff", "--name-only", "--diff-filter=U"]).trim().split("\n").filter(Boolean).map((f) => {
      const lines = readFileSync(join(repo, f), "utf8").split("\n").flatMap((l, n) => (l.startsWith("<<<<<<<") ? [n + 1] : []))
      return { file: f, lines }
    })
    out.push({ name, file, status: "conflict", failed: rejected(check.out), merged: three.ok, conflicts })
    break
  }
  if (i >= patches.length - 1) return out
  // The rest, on HEAD without the one that stopped the run, each on top of those that apply.
  const tmp = mkdtempSync(join(tmpdir(), "update-rune-"))
  try {
    const env = { GIT_INDEX_FILE: join(tmp, "index") }
    git(repo, ["read-tree", "HEAD"], false, env)
    for (const file of patches.slice(i + 1)) {
      const name = basename(file)
      const check = gitOk(repo, ["apply", "--cached", "--check", file], env)
      log(`$ git apply --cached --check ${name}   (without ${out[i]!.name}, in a throwaway index)\n${check.out}\n`)
      if (check.ok) git(repo, ["apply", "--cached", file], false, env)
      out.push({ name, file, status: "after", applies: check.ok, failed: check.ok ? undefined : rejected(check.out) })
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return out
}

/** The text before a patch's first `diff --git` line (git apply skips it): what the patch is, and why. */
export function patchHeader(text: string): string {
  const at = text.search(/^diff --git /m)
  return at > 0 ? text.slice(0, at) : ""
}

const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export interface Rebase {
  /** The shell command that writes the rebased patch into `out`, once the work tree is resolved. */
  write: string
  /** What happened to `out`: copies kept as they were, files that don't belong. */
  notes: string[]
}

/**
 * Makes `out` hold every patch of `tries` (each copied from where it was tried, unless `out`
 * already has its own copy, which may be a patch rebased earlier), saves the stopped patch's
 * header in `headers`, and returns the command that rewrites that patch alone in `out`: `git diff
 * --cached HEAD` of `repo` (HEAD is the commit the patch goes on) after the header. `show`
 * formats a path for the command and notes.
 */
export function prepareRebase(repo: string, tries: PatchTry[], out: string, headers: string, show: (path: string) => string = (p) => p): Rebase {
  const stop = tries.find((t) => t.status === "conflict")
  if (!stop) throw new Error("prepareRebase: no patch stopped the run")
  mkdirSync(out, { recursive: true })
  const notes: string[] = []
  for (const t of tries) {
    const to = join(out, t.name)
    if (resolve(t.file) === resolve(to)) continue
    if (!existsSync(to)) copyFileSync(t.file, to)
    else if (readFileSync(to, "utf8") !== readFileSync(t.file, "utf8")) notes.push(`${show(to)} differs from ${show(t.file)}: kept (a patch rebased earlier?); delete it to start over from ${show(t.file)}`)
  }
  for (const f of readdirSync(out).filter((f) => f.endsWith(".patch") && !tries.some((t) => t.name === f))) notes.push(`${show(join(out, f))} isn't one of the patches tried; --patches ${show(out)} would apply it: delete it unless it belongs`)
  const header = patchHeader(readFileSync(stop.file, "utf8"))
  const diff = `git -C ${q(show(repo))} diff --cached --no-color --no-ext-diff HEAD`
  const target = q(show(join(out, stop.name)))
  let write = `git -C ${q(show(repo))} add -A && ${diff} > ${target}`
  if (header) {
    const h = join(headers, stop.name)
    mkdirSync(headers, { recursive: true })
    writeFileSync(h, header)
    write = `git -C ${q(show(repo))} add -A && { cat ${q(show(h))}; ${diff}; } > ${target}`
  }
  return { write, notes }
}

// ── arguments, state ─────────────────────────────────────────────────────────

interface Args {
  rev?: string
  tip: boolean
  dry: boolean
  release: boolean
  noCompare: boolean
  noGolden: boolean
  patches?: string
  from?: Step
  only?: Step
}

function parseArgs(argv: string[]): Args {
  const a: Args = { tip: false, dry: false, release: false, noCompare: false, noGolden: false }
  const value = (i: number, name: string) => {
    const v = argv[i + 1]
    if (!v || v.startsWith("--")) usage(`${name} needs a value`)
    return v
  }
  const step = (v: string) => {
    if (!(STEPS as readonly string[]).includes(v)) usage(`unknown step ${v}; steps: ${STEPS.join(", ")}`)
    return v as Step
  }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!
    if (x === "--tip") a.tip = true
    else if (x === "--dry-run") a.dry = true
    else if (x === "--release") a.release = true
    else if (x === "--no-compare") a.noCompare = true
    else if (x === "--no-golden") a.noGolden = true
    else if (x === "--patches") a.patches = resolve(value(i++, x))
    else if (x === "--from") a.from = step(value(i++, x))
    else if (x === "--only") a.only = step(value(i++, x))
    else if (x === "-h" || x === "--help") usage()
    else if (x.startsWith("--")) usage(`unknown option ${x}`)
    else if (a.rev) usage(`one revision only (got ${a.rev} and ${x})`)
    else a.rev = x
  }
  if (!a.rev === !a.tip) usage("give a revision or --tip")
  if (a.from && a.only) usage("--from and --only don't go together")
  return a
}

function usage(error?: string): never {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, ""))
  if (error) console.error(`update-rune: ${error}\n`)
  console.error(header.slice(0, header.findIndex((l) => l.startsWith("Steps, in order"))).join("\n"))
  process.exit(error ? 2 : 0)
}

// ── the run ──────────────────────────────────────────────────────────────────

class Run {
  readonly clone = join(ROOT, "out", "update-rune", "rune")
  dir = ""
  state!: State
  constructor(readonly args: Args) {}

  /** The Rune checkout the steps after `patch` work on. */
  get rune() {
    return this.state.dry ? this.clone : VENDOR
  }
  get patchDir() {
    return this.state.patches
  }
  log(step: Step) {
    return join(this.dir, "logs", `${step}.log`)
  }
  save() {
    writeFileSync(join(this.dir, "state.json"), JSON.stringify(this.state, null, 2) + "\n")
  }

  /** Resolves both revisions, prepares the clone and loads or starts the state. */
  open() {
    const entry = git(ROOT, ["ls-files", "-s", "vendor/rune"]).trim()
    const old = /^160000 ([0-9a-f]{40}) /.exec(entry)?.[1]
    if (!old) throw new Error(`the superproject records no revision for vendor/rune (git ls-files -s vendor/rune: ${JSON.stringify(entry)})`)
    this.ensureClone()
    let rev = this.args.rev
    if (this.args.tip) {
      const head = git(this.clone, ["ls-remote", "origin", "HEAD"]).split(/\s/)[0]
      if (!head) throw new Error("git ls-remote origin HEAD gave nothing")
      rev = head
    }
    let sha = git(this.clone, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], true).trim()
    if (!sha) {
      console.log(`fetching ${rev} from ${git(this.clone, ["remote", "get-url", "origin"]).trim()}`)
      // The branches and the default HEAD; a full sha on no branch needs asking for by name.
      git(this.clone, ["fetch", "--quiet", "origin"], true)
      git(this.clone, ["fetch", "--quiet", "origin", "HEAD"], true)
      sha = git(this.clone, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], true).trim()
      if (!sha && /^[0-9a-f]{40}$/.test(rev!)) {
        git(this.clone, ["fetch", "--quiet", "origin", rev!], true)
        sha = git(this.clone, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], true).trim()
      }
    }
    if (!sha) throw new Error(`no Rune revision ${rev} (looked in vendor/rune and origin)`)
    this.dir = join(ROOT, "out", "update-rune", `${short(old)}-${short(sha)}${this.args.dry ? "-dry" : ""}`)
    mkdirSync(join(this.dir, "logs"), { recursive: true })
    const file = join(this.dir, "state.json")
    const resume = this.args.from || this.args.only
    if (resume && existsSync(file)) {
      this.state = JSON.parse(readFileSync(file, "utf8"))
      if (this.args.patches) this.state.patches = this.args.patches
      this.state.release = this.args.release || this.state.release
    } else {
      if (resume) console.log(`no state in ${relative(ROOT, this.dir)} yet: starting one`)
      this.state = { old, new: sha, dry: this.args.dry, release: this.args.release, patches: this.args.patches ?? join(ROOT, "patches"), steps: {} }
    }
  }

  /** out/update-rune/rune: a clone sharing vendor/rune's objects, fetching from Rune's origin. */
  ensureClone() {
    if (!existsSync(join(this.clone, ".git"))) {
      mkdirSync(dirname(this.clone), { recursive: true })
      git(ROOT, ["clone", "--quiet", "--shared", "--no-checkout", VENDOR, this.clone])
    }
    const url = git(VENDOR, ["remote", "get-url", "origin"], true).trim()
    if (url) git(this.clone, ["remote", "set-url", "origin", url])
  }

  /** The steps to run this time. */
  plan(): Step[] {
    if (this.args.only) return this.args.only === "summary" ? ["summary"] : [this.args.only, "summary"]
    const from = this.args.from ? STEPS.indexOf(this.args.from) : 0
    return STEPS.slice(from)
  }

  async go(): Promise<number> {
    const steps = this.plan()
    for (const s of steps) delete this.state.steps[s]
    let stopped = false
    for (const s of steps) {
      if (stopped && s !== "summary") continue
      const t0 = Date.now()
      process.stdout.write(`── ${s} `)
      let r: Omit<StepResult, "at">
      try {
        r = await this.step(s)
      } catch (e) {
        r = { status: "failed", summary: `error: ${(e as Error).message.split("\n")[0]}`, details: (e as Error).message.split("\n").slice(1) }
      }
      this.state.steps[s] = { ...r, at: new Date().toISOString() }
      this.save()
      console.log(`${r.status} (${((Date.now() - t0) / 1000).toFixed(1)} s): ${r.summary}`)
      if (r.status === "stopped") stopped = true
    }
    const summary = join(this.dir, "summary.md")
    if (steps.includes("summary") && existsSync(summary)) console.log(`\n${readFileSync(summary, "utf8")}`)
    const bad = Object.values(this.state.steps).some((r) => r?.status === "failed" || r?.status === "stopped")
    if (!bad) this.tidy()
    return bad ? 1 : 0
  }

  /**
   * After a run with nothing failed or stopped: removes what only a rerun (`--from`) or a patch
   * to rebase needs, the clone (a checkout of Rune) and a dry run's rustdoc target (gigabytes).
   * The state, logs, summary and generated bindings stay. A later run clones again (it shares
   * vendor/rune's objects, so that's quick).
   */
  tidy() {
    const gone = [this.clone, join(this.dir, "rustdoc")].filter((p) => existsSync(p))
    for (const p of gone) rmSync(p, { recursive: true, force: true })
    if (gone.length) console.log(`removed ${gone.map((p) => relative(ROOT, p)).join(" and ")}`)
  }

  step(s: Step): Promise<Omit<StepResult, "at">> | Omit<StepResult, "at"> {
    switch (s) {
      case "preflight": return this.preflight()
      case "upstream": return this.upstream()
      case "patch": return this.patch()
      case "lint": return this.lint()
      case "align": return this.align()
      case "bindings": return this.bindings()
      case "build": return this.build()
      case "inventory": return this.inventory()
      case "compare": return this.compare()
      case "golden": return this.golden()
      case "perf": return this.perf()
      case "summary": return this.summary()
    }
  }

  // 1. The repo is in a known state, and the tools are there.
  preflight(): Omit<StepResult, "at"> {
    const log = this.log("preflight")
    const details: string[] = []
    const check = sh(["node", "scripts/prepare-rune.mjs", "--check"], log, { env: { RUNEX_RUNE_BUMP: this.state.new } })
    details.push(...check.out.trim().split("\n"))
    const tools = ["cargo", "rustc"].map((t) => sh([t, "--version"], log, { cwd: VENDOR }))
    for (const t of tools) details.push(t.code === 0 ? t.out.trim() : `missing: ${t.out.trim()}`)
    if (check.code !== 0) return { status: "stopped", summary: "vendor/rune isn't its pinned revision plus patches/ exactly (prepare-rune --check); fix that first", details }
    if (tools.some((t) => t.code !== 0)) return { status: "stopped", summary: "cargo or rustc is missing (~/.cargo/bin)", details }
    return { status: "done", summary: `vendor/rune is ${short(this.state.old)} + patches/; ${tools[0]!.out.trim()}`, details }
  }

  // 2. What changed upstream, grouped by what runex depends on.
  upstream(): Omit<StepResult, "at"> {
    const { old, new: now } = this.state
    const c = this.clone
    const commits = git(c, ["log", "--oneline", "--no-decorate", `${old}..${now}`]).trim().split("\n").filter(Boolean)
    const behind = git(c, ["rev-list", "--count", `${now}..${old}`]).trim()
    const files = git(c, ["diff", "--name-only", old, now]).trim().split("\n").filter(Boolean)
    const patched = this.patchedFiles()
    const ported = inventory(ROOT, VENDOR).ports
    const watch: [string, (f: string) => boolean][] = [
      ["files the patches touch", (f) => patched.includes(f)],
      ["compositor references (ported in src/manual/compose)", (f) => /^examples\/(lab|cursed-settings)\/src\/gfx\.rs$/.test(f)],
      ["render.rs (Instance, KIND_*)", (f) => f === "crates/rune/src/render.rs"],
      ["compose.rs", (f) => f === "crates/rune/src/compose.rs"],
      ["tooling flags (tooling/args.rs)", (f) => /^crates\/rune\/src\/tooling\/args\.rs$/.test(f)],
      ["tree JSON (tooling/trace.rs)", (f) => /^crates\/rune\/src\/tooling\/trace\.rs$/.test(f)],
      ["toolchain", (f) => f === "rust-toolchain.toml"],
      ["Cargo.lock", (f) => f === "Cargo.lock"],
      ["ported examples", (f) => ported.some((p) => f.startsWith(`examples/${p}/`))],
    ]
    const details: string[] = [`${plural(commits.length, "commit")} ${short(old)}..${short(now)}${behind !== "0" ? ` (and ${behind} on the old side: not a fast-forward)` : ""}:`, ...commits.map((l) => `  ${l}`), "", `${plural(files.length, "file")} changed. Watchlist:`]
    const hits: string[] = []
    for (const [name, test] of watch) {
      const hit = files.filter(test)
      if (!hit.length) continue
      hits.push(`${name} (${hit.length})`)
      details.push(`  ${name}:`, ...hit.map((f) => `    ${f}`))
    }
    // render.rs: does the diff touch Instance or the KIND_ codes src/manual/compose compares?
    if (files.includes("crates/rune/src/render.rs")) {
      const d = git(c, ["diff", old, now, "--", "crates/rune/src/render.rs"]).split("\n").filter((l) => /^[+-](?![+-])/.test(l) && /KIND_|struct Instance|pub params|pub data/.test(l))
      if (d.length) details.push("  render.rs lines naming Instance or KIND_ (src/manual/compose matches on these):", ...d.map((l) => `    ${l}`))
    }
    const deps = this.lockChanges(old, now)
    if (deps.length) details.push("  wgpu and objc2 in Cargo.lock:", ...deps.map((l) => `    ${l}`))
    const fragments = git(c, ["diff", "--name-only", "--diff-filter=A", old, now, "--", "changelog/unreleased"]).trim().split("\n").filter(Boolean)
    if (fragments.length) {
      details.push("", `Changelog fragments added (${fragments.length}): what upstream says moves an app's output`)
      for (const f of fragments) details.push(`  ${f}:`, ...git(c, ["show", `${now}:${f}`]).trim().split("\n").map((l) => `    ${l}`))
    }
    const changelog = git(c, ["diff", "--numstat", old, now, "--", "CHANGELOG.md"]).trim()
    if (changelog) {
      details.push("", `CHANGELOG.md: ${changelog.split(/\s+/).slice(0, 2).map((n, i) => (i ? `-${n}` : `+${n}`)).join(" ")} lines; the added ones:`)
      details.push(...git(c, ["diff", "-U0", old, now, "--", "CHANGELOG.md"]).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).slice(0, 80).map((l) => `  ${l}`))
    }
    writeFileSync(this.log("upstream"), details.join("\n") + "\n")
    return {
      status: commits.length ? "done" : "review",
      summary: `${plural(commits.length, "commit")}, ${plural(files.length, "file")}; watchlist: ${hits.join(", ") || "nothing"}; ${plural(fragments.length, "changelog fragment")}`,
      details,
      data: { commits, fragments, files },
    }
  }

  patchedFiles(): string[] {
    const out: string[] = []
    for (const p of this.patchFiles()) for (const m of readFileSync(p, "utf8").matchAll(/^diff --git a\/(\S+) b\//gm)) if (!out.includes(m[1]!)) out.push(m[1]!)
    return out
  }

  patchFiles(): string[] {
    if (!existsSync(this.patchDir)) throw new Error(`no patch directory ${this.patchDir}`)
    return readdirSync(this.patchDir).filter((f) => f.endsWith(".patch")).sort().map((f) => join(this.patchDir, f))
  }

  /** Versions of wgpu* and objc2* packages in Rune's Cargo.lock, before → after. */
  lockChanges(old: string, now: string): string[] {
    const versions = (rev: string) => {
      const m = new Map<string, string[]>()
      const text = git(this.clone, ["show", `${rev}:Cargo.lock`], true)
      for (const p of (text ? (Bun.TOML.parse(text) as any).package : []) ?? []) {
        if (!/^(wgpu|objc2)/.test(p.name)) continue
        m.set(p.name, [...(m.get(p.name) ?? []), p.version])
      }
      return m
    }
    const [a, b] = [versions(old), versions(now)]
    const out: string[] = []
    for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const [x, y] = [(a.get(name) ?? []).join(", "), (b.get(name) ?? []).join(", ")]
      if (x !== y) out.push(`${name}: ${x || "none"} -> ${y || "none"}`)
    }
    return out
  }

  // 3. The patches on the new revision, one by one: tried in the clone, then (a real run) applied to vendor/rune.
  patch(): Omit<StepResult, "at"> {
    const { new: now } = this.state
    const c = this.clone
    const rc = relative(ROOT, c)
    const log = this.log("patch")
    const patches = this.patchFiles()
    const details: string[] = []
    // --patches DIR stands for patches/: a patch only patches/ has isn't tried, yet prepare-rune would apply it.
    const ours = join(ROOT, "patches")
    if (this.patchDir !== ours) {
      for (const f of readdirSync(ours).filter((f) => f.endsWith(".patch") && !patches.some((p) => basename(p) === f))) {
        details.push(`note: patches/${f} isn't in ${relative(ROOT, this.patchDir)}, so this run doesn't try it, and prepare-rune would still apply it: copy it there, or delete it from patches/ to drop it`)
      }
    }
    const tries = tryPatches(c, now, patches, (t) => appendFileSync(log, t))
    const stop = tries.find((t) => t.status === "conflict")
    for (const t of tries) {
      const name = relative(ROOT, t.file)
      if (t.status === "applied") details.push(`${name}: applies to ${short(now)}`)
      else if (t.status === "after") {
        details.push(`${name}: not tried, the run stops at ${stop!.name}; without it, it ${t.applies ? "applies" : "doesn't apply"}`, ...(t.failed ?? []).map((h) => `  ${formatHunk(h)}`))
      } else {
        details.push(`${name} doesn't apply to ${short(now)}:`, ...(t.failed ?? []).map((h) => `  ${formatHunk(h)}`))
        if (t.merged) details.push(`  git apply --3way merged it cleanly in ${rc}; check the merge, then make it the patch (below)`)
        for (const f of t.conflicts ?? []) details.push(`  conflict in ${f.file} at line${f.lines.length === 1 ? "" : "s"} ${f.lines.join(", ")}`)
      }
    }
    if (stop) {
      const conflicted = (stop.conflicts ?? []).map((f) => f.file)
      const files = [...new Set([...(stop.failed ?? []).map((h) => h.file), ...conflicted])]
      const out = join(this.dir, "rebased")
      const rebase = prepareRebase(c, tries, out, join(this.dir, "headers"), (p) => relative(ROOT, p))
      const before = tries.filter((t) => t.status === "applied").map((t) => t.name)
      const after = tries.filter((t) => t.status === "after")
      const header = patchHeader(readFileSync(stop.file, "utf8"))
      const intent = `keep upstream's change and the patch's intent${/\bsend_wake\b/.test(readFileSync(stop.file, "utf8")) ? ", and send any new wake through send_wake" : ""}`
      const resolveStep = conflicted.length
        ? `In ${rc}, resolve the conflict markers in ${conflicted.join(", ")}: ${intent}.`
        : stop.merged
          ? `In ${rc}, check the merge (git -C ${rc} diff --cached HEAD): ${intent}.`
          : `In ${rc}, make ${stop.name}'s changes to ${files.join(", ")} by hand: ${intent}. git -C ${rc} apply --reject ${relative(ROOT, stop.file)} applies the hunks that fit and leaves the rest in .rej files; delete those before step 2.`
      details.push(
        "",
        `To rebase ${stop.name} (patch ${before.length + 1} of ${tries.length}):`,
        `  1. ${resolveStep} HEAD there is ${short(now)}${before.length ? ` plus ${before.join(", ")}, a commit each` : ""}: the base this patch goes on.`,
        `  2. ${rebase.write}`,
        `  3. bun scripts/update-rune.ts ${short(now)}${this.state.dry ? " --dry-run" : ""} --from patch --patches ${relative(ROOT, out)}`,
        `  ${relative(ROOT, out)} holds every patch; step 2 rewrites ${stop.name} alone${header ? `, after its header (saved in ${relative(ROOT, join(this.dir, "headers", stop.name))})` : ""}.${after.length ? " A later patch that doesn't apply then stops the run there, with its own steps." : ""}`,
        ...rebase.notes.map((n) => `  note: ${n}`),
      )
      const later = after.length ? `; after it: ${after.map((a) => `${a.name} ${a.applies ? "applies" : "doesn't apply"} without it`).join(", ")}` : ""
      const how = stop.merged ? " (3-way merged cleanly, needs checking)" : `; ${plural(conflicted.length, "file")} in conflict after --3way`
      return {
        status: "stopped",
        summary: `${relative(ROOT, stop.file)} doesn't apply: ${files.join(", ")}${how}${later}`,
        details,
        data: { files, conflicted, patches: tries.map(({ name, status, applies }) => ({ name, status, ...(applies === undefined ? {} : { applies }) })) },
      }
    }
    if (this.state.dry) return { status: "done", summary: `the ${tries.length === 1 ? "patch applies" : `${tries.length} patches apply`} to ${short(now)} (in ${rc}, a commit each)`, details }
    // A real run moves vendor/rune: the patches off, the new revision, the patches on.
    if (git(VENDOR, ["rev-parse", "HEAD"]).trim() !== now) {
      for (const p of readdirSync(join(ROOT, "patches")).filter((f) => f.endsWith(".patch")).sort().reverse()) {
        const r = gitOk(VENDOR, ["apply", "--reverse", join(ROOT, "patches", p)])
        if (!r.ok) throw new Error(`couldn't take ${p} off vendor/rune:\n${r.out}`)
      }
      if (!gitOk(VENDOR, ["cat-file", "-e", `${now}^{commit}`]).ok) git(VENDOR, ["fetch", "--quiet", c, now])
      git(VENDOR, ["checkout", "--quiet", "--detach", now])
      details.push(`vendor/rune moved to ${short(now)}`)
    }
    if (this.patchDir !== join(ROOT, "patches")) {
      for (const p of this.patchFiles()) copyFileSync(p, join(ROOT, "patches", p.split(/[\\/]/).pop()!))
      details.push(`copied ${this.patchFiles().map((p) => p.split(/[\\/]/).pop()).join(", ")} into patches/`)
      this.state.patches = join(ROOT, "patches")
    }
    // --reapply: vendor/rune may already be at the new revision with older patches (a rerun).
    const apply = sh(["node", "scripts/prepare-rune.mjs", "--reapply"], log, { env: { RUNEX_RUNE_BUMP: now } })
    if (apply.code !== 0) return { status: "stopped", summary: "prepare-rune failed on vendor/rune after the clone took the patches", details: [...details, ...tail(apply.out, 20)] }
    return { status: "done", summary: `vendor/rune is ${short(now)} + patches/`, details }
  }

  // 4. Raw wakes and the fingerprints of the upstream code the patch duplicates.
  lint(): Omit<StepResult, "at"> {
    const r = lint(this.rune, this.state.new)
    const { text } = formatLint(r)
    writeFileSync(this.log("lint"), text + "\n")
    const details = text.split("\n")
    if (r.wakes.length) return { status: "stopped", summary: `${plural(r.wakes.length, "raw send_event call")} outside pump_wake.rs: route them through send_wake in the patch, then --from patch`, details, data: r }
    if (r.changed.length) return { status: "review", summary: `upstream changed ${r.changed.map((c) => c.name).join(", ")}: compare with the patch's copies, then bun scripts/patch-lint.ts --accept-fingerprints`, details, data: r }
    return { status: "done", summary: "no raw wakes; the duplicated upstream functions are unchanged", details, data: r }
  }

  // 5. runex pins what Rune pins: the toolchain, and wgpu and objc2 versions that compile once.
  align(): Omit<StepResult, "at"> {
    const details: string[] = []
    let ok = true
    const ours = toml(join(ROOT, "rust-toolchain.toml")).toolchain?.channel
    const theirsFile = join(this.rune, "rust-toolchain.toml")
    const theirs = existsSync(theirsFile) ? toml(theirsFile).toolchain?.channel : undefined
    if (theirs && ours !== theirs) {
      ok = false
      details.push(`FAIL  rust-toolchain.toml channel is ${ours}, Rune's is ${theirs}: set runex's to ${theirs} (and check tools/bindgen/config.ts rustdocFormat after the bindings step)`)
    } else details.push(`ok    toolchain ${ours}${theirs ? "" : " (Rune pins none)"}`)
    const cargo = toml(join(ROOT, "Cargo.toml"))
    const tables: Record<string, any>[] = [cargo.dependencies ?? {}, ...Object.values(cargo.target ?? {}).map((t: any) => t.dependencies ?? {})]
    const lock = (toml(join(this.rune, "Cargo.lock")).package ?? []) as { name: string; version: string }[]
    for (const table of tables) {
      for (const [name, spec] of Object.entries(table)) {
        if (!/^(wgpu|objc2)/.test(name)) continue
        const req = typeof spec === "string" ? spec : (spec as { version?: string }).version
        if (!req) continue
        const locked = lock.filter((p) => p.name === name).map((p) => p.version)
        if (!locked.length) {
          details.push(`note  ${name} ${req}: Rune no longer locks ${name}; runex compiles its own copy`)
          continue
        }
        if (locked.some((v) => satisfies(req, v))) details.push(`ok    ${name} ${req}: Rune locks ${locked.join(", ")}`)
        else {
          ok = false
          details.push(`FAIL  ${name} ${req}: Rune locks ${locked.join(", ")}; runex would compile a second copy (src/manual/compose's types wouldn't match Rune's). Update Cargo.toml.`)
        }
      }
    }
    writeFileSync(this.log("align"), details.join("\n") + "\n")
    return ok ? { status: "done", summary: "toolchain and wgpu/objc2 requirements match Rune's", details } : { status: "failed", summary: "runex's toolchain or dependency pins differ from Rune's", details }
  }

  // 6. Bindings from the new rustdoc JSON: the API surface's diff, and report.md's.
  bindings(): Omit<StepResult, "at"> {
    const log = this.log("bindings")
    const out = join(this.dir, "bindings")
    const old = join(this.dir, "old")
    // What the repo held before this run regenerated it (kept across --from reruns).
    if (!existsSync(join(old, "surface.txt"))) {
      mkdirSync(old, { recursive: true })
      for (const f of ["surface.txt", "report.md"]) if (existsSync(join(ROOT, "tools", "bindgen", f))) copyFileSync(join(ROOT, "tools", "bindgen", f), join(old, f))
    }
    const bindgen = ["bun", "tools/bindgen/main.ts", "--rustdoc", "--out", out]
    if (this.state.dry) {
      // Its own rustdoc target, seeded from the repo's so dependencies needn't build again.
      const target = join(this.dir, "rustdoc")
      if (!existsSync(target) && existsSync(join(ROOT, "target", "rustdoc"))) seed(join(ROOT, "target", "rustdoc"), target)
      bindgen.push("--rune", this.clone, "--rustdoc-dir", target)
    }
    const gen = sh(bindgen, log)
    if (gen.code !== 0) return { status: "failed", summary: `bindgen failed: ${tail(gen.out, 1)[0]}`, details: tail(gen.out, 30) }
    if (!this.state.dry) {
      const write = sh(["bun", "tools/bindgen/main.ts"], log)
      if (write.code !== 0) return { status: "failed", summary: `bindgen failed writing the repo: ${tail(write.out, 1)[0]}`, details: tail(write.out, 30) }
    }
    const d = diffSurface(readOr(join(old, "surface.txt")), readFileSync(join(out, "tools", "bindgen", "surface.txt"), "utf8"))
    const counts = (f: string) => /Generated: ([^\n]*)\./.exec(readOr(f))?.[1] ?? "?"
    const [was, now] = [counts(join(old, "report.md")), counts(join(out, "tools", "bindgen", "report.md"))]
    const skipped = (f: string) => /Skipped: (\d+) items/.exec(readOr(f))?.[1] ?? "?"
    const reportDiff = gitOk(ROOT, ["diff", "--no-index", "--no-color", "--stat", join(old, "report.md"), join(out, "tools", "bindgen", "report.md")]).out
    const generated = was === now ? `report.md: ${now}` : `report.md: ${countDiff(was, now)}`
    const details = [
      generated,
      `skipped items: ${skipped(join(old, "report.md"))} -> ${skipped(join(out, "tools", "bindgen", "report.md"))}${reportDiff ? ` (git diff --no-index ${relative(ROOT, join(old, "report.md"))} ${relative(ROOT, join(out, "tools", "bindgen", "report.md"))})` : ""}`,
      "",
      ...formatSurfaceDiff(d, 200).split("\n"),
    ]
    writeFileSync(join(this.dir, "surface-diff.txt"), formatSurfaceDiff(d) + "\n")
    const where = this.state.dry ? ` (in ${relative(ROOT, out)})` : ""
    const summary = `${generated}; surface: ${d.removed.length} removed, ${d.changed.length} changed, ${d.added.length} added${where}`
    return { status: breaking(d) ? "review" : "done", summary: breaking(d) ? `${summary}: breaking, see surface-diff.txt` : summary, details, data: { counts: d.counts, removed: d.removed.length, changed: d.changed.length, added: d.added.length } }
  }

  // 7. The addon and the fast tests, on the moved submodule.
  build(): Omit<StepResult, "at"> {
    if (this.state.dry) return { status: "skipped", summary: "--dry-run" }
    const log = this.log("build")
    const env = { RUNEX_RUNE_BUMP: this.state.new }
    const details: string[] = []
    // The old revision's builds of Rune's crates, in runex's target and Rune's own (compare's).
    const cleaned = [...cleanRuneCrates(ROOT, VENDOR), ...cleanRuneCrates(ROOT, VENDOR, join(ROOT, "target", "rustdoc")), ...cleanRuneCrates(VENDOR, VENDOR)]
    for (const c of cleaned) details.push(`${c.cmd}: exit ${c.code}`)
    const install = sh(["./scripts/dev-install.sh", ...(this.state.release ? ["--release"] : [])], log, { env })
    details.push(`dev-install${this.state.release ? " --release" : ""}: exit ${install.code}`)
    if (install.code !== 0) return { status: "stopped", summary: "the addon doesn't build against the new Rune (logs/build.log)", details: [...details, ...tail(install.out, 40)] }
    const results: [string, number][] = []
    const run = (label: string, cmd: string[]) => {
      const r = sh(cmd, log, { env })
      results.push([label, r.code])
      details.push(`${label}: exit ${r.code}`, ...(r.code ? tail(r.out, 15).map((l) => `  ${l}`) : []))
    }
    run("typecheck", ["bun", "run", "typecheck"])
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {}) as Record<string, string>
    // `test` is the fast tier; a bare `bun test` would also run the 27-build compare test.
    if (scripts.test && scripts.test !== "bun test") run("bun run test", ["bun", "run", "test"])
    else run("bun test (static, unit)", ["bun", "test", ...["./test/static", "./test/unit"].filter((d) => existsSync(join(ROOT, d)))])
    const display = process.platform === "darwin" && !process.env.CI && !process.env.SSH_CONNECTION && !process.env.SSH_TTY
    if (!display) details.push("windowed tests: skipped (no local macOS display)")
    else if (scripts["test:windowed"]) run("bun run test:windowed", ["bun", "run", "test:windowed"])
    else if (existsSync(join(ROOT, "test", "windowed"))) run("bun test ./test/windowed", ["bun", "test", "./test/windowed"])
    else details.push("windowed tests: none yet")
    const failed = results.filter(([, c]) => c !== 0).map(([l]) => l)
    return failed.length ? { status: "failed", summary: `built; failing: ${failed.join(", ")} (logs/build.log)`, details } : { status: "done", summary: `built (${this.state.release ? "release" : "debug"}); ${results.map(([l]) => l).join(", ")} pass`, details }
  }

  // 8. Examples: ports without a Rust twin, new upstream examples, and changed scene lists.
  inventory(): Omit<StepResult, "at"> {
    const inv = inventory(ROOT, this.rune)
    const details: string[] = []
    const { old, new: now } = this.state
    const changed: string[] = []
    for (const name of inv.ports.filter((p) => inv.upstream.includes(p))) {
      const files = git(this.clone, ["diff", "--name-only", old, now, "--", `examples/${name}`]).trim().split("\n").filter(Boolean)
      const [a, b] = [scenesAt(this.clone, old, name), scenesAt(this.clone, now, name)]
      const added = b.filter((s) => !a.includes(s))
      const removed = a.filter((s) => !b.includes(s))
      if (!files.length) continue
      changed.push(name)
      details.push(`${name}: ${plural(files.length, "source file")} changed upstream: update the port${added.length ? `; new scenes: ${added.join(", ")}` : ""}${removed.length ? `; removed scenes: ${removed.join(", ")}` : ""}`)
      for (const f of files) details.push(`  ${f}`)
    }
    for (const n of inv.noTwin) details.push(`FAIL  examples/${n} has no Rust example in Rune any more: delete or re-home the port`)
    for (const n of inv.unported) details.push(`FAIL  Rune has a new example ${n}: port it (or add it to UPSTREAM_ONLY in scripts/update-rune.ts with a reason)`)
    for (const s of inv.stale) details.push(`FAIL  stale allowlist entry ${s} (scripts/update-rune.ts)`)
    writeFileSync(this.log("inventory"), details.join("\n") + "\n")
    const bad = inv.noTwin.length + inv.unported.length + inv.stale.length
    const summary = `${plural(inv.ports.length, "port")}, ${plural(inv.upstream.length, "Rust example")}; ${changed.length ? `changed upstream: ${changed.join(", ")}` : "no example changed upstream"}${bad ? `; ${inv.noTwin.length} without a twin, ${inv.unported.length} unported` : ""}`
    return { status: bad ? "failed" : changed.length ? "review" : "done", summary, details, data: { ...inv, changed } }
  }

  // 9. The ports against the Rust examples at the new revision.
  compare(): Omit<StepResult, "at"> {
    if (this.state.dry) return { status: "skipped", summary: "--dry-run" }
    if (this.args.noCompare) return { status: "skipped", summary: "--no-compare" }
    const json = join(this.dir, "compare.json")
    const r = sh(["bun", "scripts/compare.ts", "--all", "--runtime", "bun,node", "--release", "--strict", "--json", json], this.log("compare"))
    let report: any
    try {
      report = JSON.parse(readFileSync(json, "utf8"))
    } catch {
      return { status: "failed", summary: `compare wrote no report (exit ${r.code})`, details: tail(r.out, 30) }
    }
    const examples = (report.examples ?? []) as { name: string; status: string; problems?: string[]; reason?: string; rows?: { status: string }[] }[]
    const bad = examples.filter((e) => !["pass", "skip"].includes(e.status))
    const details = bad.map((e) => `${e.name}: ${e.status}${e.reason ? ` (${e.reason})` : ""}${e.problems?.length ? `: ${e.problems.join("; ")}` : ""}${e.rows ? `; rows ${e.rows.filter((x) => x.status !== "pass").length}/${e.rows.length} not passing` : ""}`)
    const summary = `${examples.length - bad.length}/${examples.length} examples pass${bad.length ? `; failing: ${bad.map((e) => e.name).join(", ")}` : ""} (${relative(ROOT, json)})`
    return { status: r.code === 0 && !bad.length ? "done" : "failed", summary, details }
  }

  // 10. The reference baselines: what Rune's change moved, beside its changelog fragments.
  golden(): Omit<StepResult, "at"> {
    if (this.state.dry) return { status: "skipped", summary: "--dry-run" }
    if (this.args.noGolden) return { status: "skipped", summary: "--no-golden" }
    if (!existsSync(join(ROOT, "scripts", "golden.ts"))) return { status: "skipped", summary: "scripts/golden.ts doesn't exist yet" }
    const r = sh(["bun", "scripts/golden.ts", "--tier", "full", "--summary", join(this.dir, "golden-summary.md")], this.log("golden"))
    const summaryFile = [join(this.dir, "golden-summary.md"), join(ROOT, "out", "golden", "summary.md")].find(existsSync)
    const fragments = ((this.state.steps.upstream?.data as { fragments?: string[] } | undefined)?.fragments ?? [])
    const details = [
      ...(summaryFile ? readFileSync(summaryFile, "utf8").trim().split("\n") : tail(r.out, 30)),
      "",
      fragments.length ? `Match each change with a changelog fragment (upstream step): ${fragments.join(", ")}` : "No changelog fragments were added upstream: a changed case is unexplained.",
      "To bless, after reviewing every case: bun scripts/golden.ts --update --tier full, then --push-images; on Linux scripts/golden-linux.sh --update, or bun scripts/golden.ts --accept <CI artifact dir>.",
    ]
    if (r.code === 0) return { status: "done", summary: "every golden case matches", details }
    if (r.code === 1) return { status: "review", summary: "golden cases changed: review them against the changelog, then bless (below)", details }
    return { status: "failed", summary: `golden.ts failed (exit ${r.code}): a harness or tooling error`, details }
  }

  // 11. Binding-call timings, report only.
  perf(): Omit<StepResult, "at"> {
    if (this.state.dry) return { status: "skipped", summary: "--dry-run" }
    const log = this.log("perf")
    const now: Record<string, Record<string, number>> = {}
    for (const bench of ["calls", "rows"]) {
      const file = join(ROOT, "bench", `${bench}.ts`)
      if (!existsSync(file)) continue
      const r = sh(["bun", file], log)
      now[bench] = {}
      for (const m of r.out.matchAll(/^(.+?)\s+([\d.]+) (ns|µs|us|ms)\s*$/gm)) now[bench]![m[1]!.trim()] = Number(m[2]) * ({ ns: 1, µs: 1e3, us: 1e3, ms: 1e6 } as Record<string, number>)[m[3]!]!
    }
    writeFileSync(join(this.dir, "bench.json"), JSON.stringify(now, null, 2) + "\n")
    const baseFile = join(ROOT, "out", "bench-baseline.json")
    const base = existsSync(baseFile) ? (JSON.parse(readFileSync(baseFile, "utf8")) as typeof now) : undefined
    const details: string[] = []
    for (const [bench, rows] of Object.entries(now)) {
      for (const [label, ns] of Object.entries(rows)) {
        const was = base?.[bench]?.[label]
        details.push(`${bench}: ${label.padEnd(30)} ${ns.toFixed(0)} ns${was ? `  (baseline ${was.toFixed(0)} ns, ${((ns / was - 1) * 100).toFixed(0)}%)` : ""}`)
      }
    }
    details.push(base ? "" : `No baseline: cp ${relative(ROOT, join(this.dir, "bench.json"))} out/bench-baseline.json makes these the baseline.`)
    return { status: "done", summary: `${Object.values(now).reduce((n, r) => n + Object.keys(r).length, 0)} timings${base ? " against out/bench-baseline.json" : " (no baseline yet)"}; report only`, details }
  }

  // 12. The checklist.
  summary(): Omit<StepResult, "at"> {
    const { old, new: now, dry } = this.state
    const box: Record<Status, string> = { done: "[x]", review: "[!] review", failed: "[!] FAILED", stopped: "[!] STOPPED", skipped: "[ ]" }
    const lines = [
      `# Rune ${short(old)} -> ${short(now)}${dry ? " (dry run)" : ""}`,
      "",
      `Made by \`bun scripts/update-rune.ts\`; state and logs in \`${relative(ROOT, this.dir)}\`.`,
      "",
    ]
    for (const s of STEPS.filter((x) => x !== "summary")) {
      const r = this.state.steps[s]
      lines.push(r ? `- ${box[r.status]} **${s}**: ${r.status === "skipped" ? "skipped, " : ""}${r.summary}` : `- [ ] **${s}**: not run`)
    }
    for (const s of STEPS.filter((x) => x !== "summary")) {
      const r = this.state.steps[s]
      if (!r?.details?.length) continue
      lines.push("", `## ${s}`, "", "```", ...r.details, "```")
    }
    const paths = ["vendor/rune", "patches", "tools/bindgen", "src/gen", "ts/gen", "test/golden"].filter((p) => existsSync(join(ROOT, p)))
    lines.push("", "## Next", "")
    if (dry) lines.push(`This was a dry run: nothing in the repo changed. Run it for real with \`bun scripts/update-rune.ts ${short(now)}\`${this.state.patches !== join(ROOT, "patches") ? ` --patches ${relative(ROOT, this.state.patches)}` : ""}.`)
    else {
      lines.push("Review every [!] item. Nothing is staged, committed or blessed; when it all holds:", "", "```", `git add ${paths.join(" ")}`, "```")
    }
    writeFileSync(join(this.dir, "summary.md"), lines.join("\n") + "\n")
    return { status: "done", summary: relative(ROOT, join(this.dir, "summary.md")) }
  }
}

/** Copies a cargo target dir, by reference where the filesystem can (APFS, btrfs). */
function seed(from: string, to: string) {
  const r = process.platform === "darwin" ? spawnSync("cp", ["-c", "-R", from, to]) : process.platform === "linux" ? spawnSync("cp", ["-R", "--reflink=auto", from, to]) : { status: 1 }
  if (r.status !== 0 && !existsSync(to)) cpSync(from, to, { recursive: true })
}

function readOr(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : ""
}

/** "218 classes, 77 records" vs "219 classes, 77 records" → "classes 218 -> 219, records 77". */
function countDiff(was: string, now: string): string {
  const parse = (s: string) => new Map([...s.matchAll(/(\d+) (\w+)/g)].map((m) => [m[2]!, m[1]!]))
  const [a, b] = [parse(was), parse(now)]
  return [...new Set([...a.keys(), ...b.keys()])].map((k) => (a.get(k) === b.get(k) ? `${k} ${b.get(k)}` : `${k} ${a.get(k) ?? 0} -> ${b.get(k) ?? 0}`)).join(", ")
}

/** An example's scene names at `rev`, from its Rust source. */
function scenesAt(rune: string, rev: string, example: string): string[] {
  const files = git(rune, ["ls-tree", "-r", "--name-only", rev, "--", `examples/${example}/src`], true).trim().split("\n").filter((f) => f.endsWith(".rs"))
  return scenesIn(files.map((f) => git(rune, ["show", `${rev}:${f}`], true)).join("\n"))
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2))
  const run = new Run(args)
  try {
    run.open()
  } catch (e) {
    console.error(`update-rune: ${(e as Error).message}`)
    process.exit(2)
  }
  console.log(`Rune ${short(run.state.old)} -> ${short(run.state.new)}${run.state.dry ? " (dry run)" : ""}; state in ${relative(ROOT, run.dir)}`)
  process.exit(await run.go())
}
