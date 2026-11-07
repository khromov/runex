// Checks what `git apply` can't about runex's patch to Rune (patches/0001-pump-event-loop.patch).
//
//   bun scripts/patch-lint.ts                        lint vendor/rune, compare the fingerprints
//   bun scripts/patch-lint.ts --accept-fingerprints  record the fingerprints anew, after review
//   ... --rune DIR                                   another (patched) Rune checkout
//   ... --rev REV                                    the upstream revision to fingerprint
//                                                    (default: the checkout's HEAD)
//   ... --json FILE                                  also write the result as JSON
//
// Exit 0 when both checks pass, 1 when one fails, 2 on an error (a file that can't be read).
//
// 1. Wakes. A pumped app (`Pump`) sleeps in JavaScript's run loop, not winit's, so every wake
//    must go through `send_wake` (window/pump_wake.rs), which runs the pump's hook after
//    `EventLoopProxy::send_event`. A raw `.send_event(` anywhere else in crates/rune/src compiles
//    and works under `App::run`, but a pumped app never hears it: #152's popup-menu wake would
//    have been one. Web-only code is exempt (files named web.rs or under a web/ directory, and
//    functions or statements under `#[cfg(target_arch = "wasm32")]`), as the pump doesn't exist
//    there. The test is textual: a call on something other than the event loop's proxy needs an
//    entry in ALLOWED below, with the reason.
// 2. Fingerprints. The patch copies some upstream functions rather than calling them, so an
//    upstream change to one merges cleanly and leaves runex's copy behind. patches/fingerprints.json
//    lists them, with the sha256 of each one's upstream source (`git show REV:file`, from `fn` to
//    its closing brace, whitespace runs as one space; wasm32-only definitions left out). Any
//    change fails until someone has compared it with the copy the entry names and run
//    --accept-fingerprints. A new entry (name, file, fn, duplicatedBy) needs only that command.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const FINGERPRINTS = join(ROOT, "patches", "fingerprints.json")

/** Raw `.send_event(` calls that are fine, by `file:trimmed line`, with why. */
const ALLOWED: Record<string, string> = {}

export interface Fingerprint {
  /** The upstream function, as the patch's comments name it. */
  name: string
  /** Its file in the Rune checkout. */
  file: string
  /** The `fn` name to find there. */
  fn: string
  /** Where the patch duplicates it: what to compare when it changes. */
  duplicatedBy: string
  sha256?: string
}

interface FingerprintFile {
  about: string
  /** The upstream revision the hashes were taken at. */
  rev: string
  functions: Fingerprint[]
}

const DEFAULTS: Fingerprint[] = [
  { name: "App::try_run", file: "crates/rune/src/app.rs", fn: "try_run", duplicatedBy: "App::start (patch: crates/rune/src/app.rs)" },
  { name: "window::run", file: "crates/rune/src/window/event_loop.rs", fn: "run", duplicatedBy: "App::start's window branch (patch: crates/rune/src/app.rs)" },
  { name: "tooling::run_window_factory", file: "crates/rune/src/tooling.rs", fn: "run_window_factory", duplicatedBy: "start_windows_with_args (patch: crates/rune/src/tooling.rs)" },
  { name: "event_loop::run_configured", file: "crates/rune/src/window/event_loop.rs", fn: "run_configured", duplicatedBy: "build and finish, which the patch splits it into (crates/rune/src/window/event_loop.rs)" },
]

export interface LintResult {
  rev: string
  wakes: { file: string; line: number; text: string }[]
  /** Fingerprints that differ from the recorded ones (or whose function is gone). */
  changed: { name: string; duplicatedBy: string; recorded?: string; now?: string; why: string }[]
  fingerprints: Fingerprint[]
  recordedRev?: string
}

// ── Rust source, roughly ─────────────────────────────────────────────────────

/** `src` with comments and the insides of string and char literals blanked out (same length, same lines). */
export function codeOnly(src: string): string {
  const out = src.split("")
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " "
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i)
      const stop = end < 0 ? src.length : end
      blank(i, stop)
      i = stop
    } else if (c === "/" && src[i + 1] === "*") {
      let depth = 1
      let j = i + 2
      while (j < src.length && depth) {
        if (src[j] === "/" && src[j + 1] === "*") (depth++, (j += 2))
        else if (src[j] === "*" && src[j + 1] === "/") (depth--, (j += 2))
        else j++
      }
      blank(i, j)
      i = j
    } else if ((c === "r" || (c === "b" && src[i + 1] === "r")) && /^b?r#*"/.test(src.slice(i, i + 40)) && !/\w/.test(src[i - 1] ?? "")) {
      const m = /^b?r(#*)"/.exec(src.slice(i))!
      const close = `"${m[1]}`
      const end = src.indexOf(close, i + m[0].length)
      const stop = end < 0 ? src.length : end + close.length
      blank(i + m[0].length, stop - close.length)
      i = stop
    } else if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1
      blank(i + 1, j)
      i = j + 1
    } else if (c === "'") {
      // A char literal ('a', '\n', '\u{1F600}'), not a lifetime ('a, 'static).
      const m = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/u.exec(src.slice(i, i + 16))
      if (m) {
        blank(i + 1, i + m[0].length - 1)
        i += m[0].length
      } else i++
    } else i++
  }
  return out.join("")
}

function lineOf(src: string, at: number): number {
  let n = 1
  for (let i = 0; i < at; i++) if (src.charCodeAt(i) === 10) n++
  return n
}

/** The attribute lines (`#[..]`) right above the line at `at`, as written in `src` (`code` is `codeOnly(src)`). */
function attrsAbove(src: string, code: string, at: number): string[] {
  const end = code.lastIndexOf("\n", at) + 1
  const lines = code.slice(0, end).split("\n")
  const text = src.slice(0, end).split("\n")
  lines.pop()
  const out: string[] = []
  for (let k = lines.length - 1; k >= 0; k--) {
    const l = lines[k]!.trim()
    if (l === "") continue // a blank line or a (blanked) doc comment
    if (!l.startsWith("#[") && !l.startsWith("#![")) break
    out.push(text[k]!.trim())
  }
  return out
}

const wasmOnly = (attrs: string[]) => attrs.some((a) => /cfg\(\s*target_arch\s*=\s*"wasm32"\s*\)/.test(a.replace(/\s+/g, " ")) && !/not\(\s*target_arch/.test(a))

/** Every non-wasm32 definition of `fn name` in `src`: from its line's start to its closing brace. */
export function functionSources(src: string, name: string): string[] {
  const code = codeOnly(src)
  const out: string[] = []
  for (const m of code.matchAll(new RegExp(`\\bfn\\s+${name}\\b`, "g"))) {
    const at = m.index!
    if (wasmOnly(attrsAbove(src, code, at))) continue
    const open = code.indexOf("{", at)
    const semi = code.indexOf(";", at)
    if (open < 0 || (semi >= 0 && semi < open)) continue // a declaration without a body
    let depth = 0
    let end = open
    for (; end < code.length; end++) {
      if (code[end] === "{") depth++
      else if (code[end] === "}" && --depth === 0) break
    }
    const start = code.lastIndexOf("\n", at) + 1
    out.push(src.slice(start, end + 1))
  }
  return out
}

export function fingerprint(sources: string[]): string {
  return createHash("sha256").update(sources.map((s) => s.replace(/\s+/g, " ").trim()).join("\n")).digest("hex")
}

// ── checks ───────────────────────────────────────────────────────────────────

function rsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? rsFiles(p) : n.endsWith(".rs") ? [p] : []
  })
}

/** Raw `.send_event(` calls in crates/rune/src outside pump_wake.rs and web-only code. */
export function rawWakes(rune: string): LintResult["wakes"] {
  const src = join(rune, "crates", "rune", "src")
  const out: LintResult["wakes"] = []
  for (const file of rsFiles(src)) {
    const rel = relative(rune, file).replace(/\\/g, "/")
    if (rel.endsWith("/window/pump_wake.rs")) continue
    if (/(^|\/)web(\.rs$|\/)/.test(rel)) continue
    const text = readFileSync(file, "utf8")
    const code = codeOnly(text)
    if (/^\s*#!\[cfg\(\s*target_arch\s*=\s*"wasm32"\s*\)\]/m.test(text)) continue
    for (const m of code.matchAll(/\.send_event\s*\(/g)) {
      const at = m.index!
      // Under a wasm32-only statement attribute, or in a wasm32-only function.
      if (wasmOnly(attrsAbove(text, code, at))) continue
      const fns = [...code.slice(0, at).matchAll(/\bfn\s+\w+/g)]
      const enclosing = fns[fns.length - 1]
      if (enclosing && wasmOnly(attrsAbove(text, code, enclosing.index!))) continue
      const line = lineOf(text, at)
      const lineText = text.split("\n")[line - 1]!.trim()
      if (ALLOWED[`${rel}:${lineText}`]) continue
      out.push({ file: rel, line, text: lineText })
    }
  }
  return out
}

function git(rune: string, args: string[]): string {
  return execFileSync("git", ["-C", rune, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 })
}

function readFingerprints(): FingerprintFile | undefined {
  if (!existsSync(FINGERPRINTS)) return undefined
  return JSON.parse(readFileSync(FINGERPRINTS, "utf8")) as FingerprintFile
}

/** Lints `rune` and fingerprints its upstream functions at `rev`. */
export function lint(rune: string, rev = "HEAD"): LintResult {
  const sha = git(rune, ["rev-parse", rev]).trim()
  const recorded = readFingerprints()
  const fingerprints = (recorded?.functions ?? DEFAULTS).map((f) => ({ ...f }))
  const changed: LintResult["changed"] = []
  for (const f of fingerprints) {
    const old = f.sha256
    let sources: string[] = []
    try {
      sources = functionSources(git(rune, ["show", `${sha}:${f.file}`]), f.fn)
    } catch {
      // The file is gone: reported below as an empty match.
    }
    if (!sources.length) {
      changed.push({ name: f.name, duplicatedBy: f.duplicatedBy, recorded: old, why: `no \`fn ${f.fn}\` in ${f.file} any more` })
      delete f.sha256
      continue
    }
    f.sha256 = fingerprint(sources)
    if (!old) changed.push({ name: f.name, duplicatedBy: f.duplicatedBy, now: f.sha256, why: "no fingerprint recorded yet" })
    else if (old !== f.sha256) changed.push({ name: f.name, duplicatedBy: f.duplicatedBy, recorded: old, now: f.sha256, why: "changed upstream" })
  }
  return { rev: sha, wakes: rawWakes(rune), changed, fingerprints, recordedRev: recorded?.rev }
}

export function writeFingerprints(r: LintResult) {
  const file: FingerprintFile = {
    about: "sha256 of the upstream Rune functions patches/0001-pump-event-loop.patch duplicates, at rev. Written by `bun scripts/patch-lint.ts --accept-fingerprints` after comparing a change with the copy duplicatedBy names; see scripts/patch-lint.ts.",
    rev: r.rev,
    functions: r.fingerprints,
  }
  writeFileSync(FINGERPRINTS, JSON.stringify(file, null, 2) + "\n")
}

/** The lint's findings as lines, and whether it passes. */
export function formatLint(r: LintResult, accepted = false): { ok: boolean; text: string } {
  const lines: string[] = []
  if (r.wakes.length) {
    lines.push(`FAIL  ${r.wakes.length} raw send_event call${r.wakes.length === 1 ? "" : "s"} outside pump_wake.rs: a pumped app sleeps through these wakes. Route each through \`send_wake(&proxy, event)\` (crate::window::send_wake) in the patch:`)
    for (const w of r.wakes) lines.push(`        ${w.file}:${w.line}: ${w.text}`)
  } else lines.push(`ok    wakes: every send_event outside web-only code goes through send_wake`)
  if (accepted) lines.push(`ok    fingerprints recorded at ${r.rev.slice(0, 8)} (patches/fingerprints.json)`)
  else if (r.changed.length) {
    for (const c of r.changed) lines.push(`REVIEW ${c.name} ${c.why}: compare it with its copy, ${c.duplicatedBy}`)
    lines.push(`        After updating the patch to match (or confirming it needn't change): bun scripts/patch-lint.ts --accept-fingerprints`)
  } else {
    const at = r.recordedRev && r.recordedRev !== r.rev ? ` (recorded at ${r.recordedRev.slice(0, 8)}, unchanged at ${r.rev.slice(0, 8)})` : ""
    lines.push(`ok    fingerprints: ${r.fingerprints.length} duplicated upstream functions unchanged${at}`)
  }
  return { ok: !r.wakes.length && (accepted || !r.changed.length), text: lines.join("\n") }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const option = (name: string) => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const v = args[i + 1]
    if (!v || v.startsWith("--")) {
      console.error(`patch-lint: ${name} needs a value`)
      process.exit(2)
    }
    return v
  }
  const rune = resolve(option("--rune") ?? join(ROOT, "vendor", "rune"))
  const rev = option("--rev") ?? "HEAD"
  const json = option("--json")
  const accept = args.includes("--accept-fingerprints")
  let r: LintResult
  try {
    r = lint(rune, rev)
  } catch (e) {
    console.error(`patch-lint: ${(e as Error).message}`)
    process.exit(2)
  }
  if (accept) writeFingerprints(r)
  const { ok, text } = formatLint(r, accept)
  console.log(text)
  if (json) writeFileSync(json, JSON.stringify({ ok, ...r }, null, 2) + "\n")
  process.exit(ok ? 0 : 1)
}
