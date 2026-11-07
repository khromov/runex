// The Rune submodule is its pin plus patches/, exactly, and the patch keeps its promises:
// - `node scripts/prepare-rune.mjs --check` on vendor/rune (skips when it isn't a git checkout);
// - `bun scripts/patch-lint.ts`: no raw wakes, and the upstream functions the patch duplicates
//   are unchanged since patches/fingerprints.json;
// - both on throwaway repos, to show they fail when they should: an edit beyond the patch, and a
//   raw `send_event` outside pump_wake.rs;
// - --check on a copy without .git (linux-docker.sh's): passes with the patches applied, fails
//   without them even inside another repository, and fails in CI.
// `bun test ./test/static`.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { codeOnly, fingerprint, functionSources, rawWakes } from "../../scripts/patch-lint.ts"

const ROOT = join(import.meta.dir, "..", "..")
const VENDOR = join(ROOT, "vendor", "rune")
const isCheckout = existsSync(join(VENDOR, ".git"))
if (!isCheckout) console.log("prepare-rune --check and patch-lint skipped: vendor/rune isn't a git checkout")
const tmp = mkdtempSync(join(tmpdir(), "runex-patch-test-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } })
const gitIn = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
  return r.stdout
}

describe("vendor/rune", () => {
  test.skipIf(!isCheckout)("prepare-rune --check: the pinned revision plus patches/, exactly", () => {
    const r = run("node", ["scripts/prepare-rune.mjs", "--check"])
    if (r.status !== 0) console.error(r.stdout + r.stderr)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("exact")
  }, 30_000)

  test.skipIf(!isCheckout)("patch-lint: no raw wakes, fingerprints unchanged", () => {
    const r = run(process.execPath, ["scripts/patch-lint.ts"])
    if (r.status !== 0) console.error(r.stdout + r.stderr)
    expect(r.status).toBe(0)
  }, 30_000)

  // The Windows windowed tests time their windows by Rune's steady hold: a Rune update that
  // changes it must change test/windowed/lib.ts's copy too.
  const draw = join(ROOT, "vendor", "rune", "crates", "rune", "src", "window", "draw.rs")
  test.skipIf(!existsSync(draw))("test/windowed's STEADY_HOLD_MS is Rune's STEADY", () => {
    const steady = /const STEADY: Duration = Duration::from_(secs|millis)\((\d+)\)/.exec(readFileSync(draw, "utf8"))
    expect(steady).not.toBeNull()
    const ms = Number(steady![2]) * (steady![1] === "secs" ? 1000 : 1)
    const copy = /export const STEADY_HOLD_MS = (\d+)/.exec(readFileSync(join(ROOT, "test", "windowed", "lib.ts"), "utf8"))
    expect(Number(copy?.[1])).toBe(ms)
  })
})

/** A miniature Rune in `repo` at its pin (one file the patch changes, one it doesn't), and its patch in `patches`. */
function miniRune(repo: string, patches: string) {
  mkdirSync(join(repo, "src"), { recursive: true })
  mkdirSync(patches)
  writeFileSync(join(repo, "Cargo.toml"), "[package]\nname = \"mini\"\n")
  writeFileSync(join(repo, "src", "patched.rs"), "fn a() {}\n")
  writeFileSync(join(repo, "src", "other.rs"), "fn b() {}\n")
  writeFileSync(join(repo, ".gitignore"), "target/\n")
  gitIn(repo, "init", "-q")
  // Files as written, whatever the runner's core.autocrlf (Windows runners convert to CRLF).
  gitIn(repo, "config", "core.autocrlf", "false")
  gitIn(repo, "add", "-A")
  gitIn(repo, "commit", "-qm", "pin")
  writeFileSync(join(repo, "src", "patched.rs"), "fn a() { pumped() }\n")
  writeFileSync(join(repo, "src", "new.rs"), "fn pumped() {}\n")
  gitIn(repo, "add", "-A")
  writeFileSync(join(patches, "0001-mini.patch"), gitIn(repo, "diff", "--cached", "HEAD"))
  gitIn(repo, "reset", "-q", "--hard")
  gitIn(repo, "clean", "-fdq")
}

describe("prepare-rune --check on a throwaway repo", () => {
  // Each test builds its own throwaway Rune, so the tests pass in any order (bun test --randomize).
  let n = 0
  function fresh() {
    const dir = join(tmp, `rune-${++n}`)
    const repo = join(dir, "rune")
    const patches = join(dir, "patches")
    miniRune(repo, patches)
    const prepare = (...args: string[]) => run("node", ["scripts/prepare-rune.mjs", ...args, "--rune", repo, "--patches", patches])
    expect(prepare().status).toBe(0)
    return { repo, prepare, check: () => prepare("--check") }
  }

  test("passes once prepare-rune applied the patch, with ignored files about", () => {
    const { repo, check } = fresh()
    mkdirSync(join(repo, "target"))
    writeFileSync(join(repo, "target", "build.out"), "ignored\n")
    const r = check()
    expect(r.stdout).toContain("exact")
    expect(r.status).toBe(0)
  })

  test("fails with a stat after one blank line in a file the patch doesn't touch", () => {
    const { repo, check } = fresh()
    writeFileSync(join(repo, "src", "other.rs"), "fn b() {}\n\n")
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DRIFT")
    expect(r.stdout).toContain("src/other.rs")
    // --check changed nothing: the edit is still there, the real index untouched.
    expect(readFileSync(join(repo, "src", "other.rs"), "utf8")).toBe("fn b() {}\n\n")
    expect(gitIn(repo, "status", "--porcelain")).toContain(" M src/other.rs")
  })

  test("--reapply saves the edit, then rebuilds pin plus patches", () => {
    const { repo, prepare, check } = fresh()
    writeFileSync(join(repo, "src", "other.rs"), "fn b() {}\n\n")
    const r = prepare("--reapply")
    expect(r.status).toBe(0)
    expect(readFileSync(join(repo, "src", "other.rs"), "utf8")).toBe("fn b() {}\n")
    expect(readFileSync(join(repo, "src", "patched.rs"), "utf8")).toBe("fn a() { pumped() }\n")
    const saved = /what it held is in (\S+)/.exec(r.stdout)?.[1]
    expect(saved && readFileSync(saved, "utf8")).toContain("+\n")
    if (saved) rmSync(saved)
    expect(check().status).toBe(0)
  })
})

describe("prepare-rune --check on a copy without .git", () => {
  // Like linux-docker.sh's copy, but inside another repository: git must not use that one, or
  // `apply --check` takes the patch's paths relative to it and passes without checking anything.
  // Each test makes its own copy, so the tests pass in any order (bun test --randomize).
  let n = 0
  function copied(apply: boolean) {
    const dir = join(tmp, `copy-${++n}`)
    const patches = join(dir, "patches")
    const pinned = join(dir, "pin")
    miniRune(pinned, patches)
    const outer = join(dir, "outer")
    const copy = join(outer, "vendor", "rune")
    mkdirSync(outer)
    gitIn(outer, "init", "-q")
    cpSync(pinned, copy, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes(".git") })
    const prepare = (env: Record<string, string> = {}, ...flags: string[]) =>
      run("node", ["scripts/prepare-rune.mjs", ...flags, "--rune", copy, "--patches", patches], { CI: "", ...env })
    if (apply) expect(prepare().status).toBe(0)
    return { copy, prepare }
  }

  test("applies, then passes and says what it can't check", () => {
    const { copy, prepare } = copied(false)
    expect(existsSync(join(copy, ".git"))).toBe(false)
    expect(prepare().status).toBe(0)
    expect(readFileSync(join(copy, "src", "patched.rs"), "utf8")).toBe("fn a() { pumped() }\n")
    const r = prepare({}, "--check")
    expect(r.stdout).toContain("no git")
    expect(r.stdout).toContain("applied   0001-mini.patch")
    expect(r.status).toBe(0)
  })

  test("fails when a patch isn't applied", () => {
    const { copy, prepare } = copied(true)
    rmSync(join(copy, "src", "new.rs"))
    const r = prepare({}, "--check")
    expect(r.stdout).toContain("MISSING   0001-mini.patch")
    expect(r.status).toBe(1)
    writeFileSync(join(copy, "src", "new.rs"), "fn pumped() {}\n")
    expect(prepare({}, "--check").status).toBe(0)
  })

  test("fails in CI, where the submodule must be checked out", () => {
    const { prepare } = copied(true)
    const r = prepare({ CI: "true" }, "--check")
    expect(r.stdout).toContain("NO GIT")
    expect(r.status).toBe(1)
  })
})

describe("patch-lint", () => {
  test("finds a raw send_event, but not in pump_wake.rs, web code or wasm32-only functions", () => {
    const rune = join(tmp, "lint")
    const src = join(rune, "crates", "rune", "src")
    mkdirSync(join(src, "window"), { recursive: true })
    mkdirSync(join(src, "platform"), { recursive: true })
    writeFileSync(join(src, "window", "pump_wake.rs"), "fn send_wake(p: &P, e: WakeEvent) -> bool { p.send_event(e).is_ok() }\n")
    writeFileSync(join(src, "platform", "web.rs"), "fn wake(p: &P) { let _ = p.send_event(Wake::App); }\n")
    writeFileSync(
      join(src, "window", "event_loop.rs"),
      [
        "// proxy.send_event(WakeEvent::Turn) in a comment doesn't count",
        '#[cfg(target_arch = "wasm32")]',
        "fn web_only(p: &P) { let _ = p.send_event(WakeEvent::Turn); }",
        '#[cfg(not(target_arch = "wasm32"))]',
        "fn run_configured(p: &P) {",
        '    let s = "p.send_event(x)";',
        "    let turn = p.clone(); start(Arc::new(move || { let _ = turn.send_event(WakeEvent::Turn); }));",
        "}",
      ].join("\n"),
    )
    expect(rawWakes(rune)).toEqual([{ file: "crates/rune/src/window/event_loop.rs", line: 7, text: "let turn = p.clone(); start(Arc::new(move || { let _ = turn.send_event(WakeEvent::Turn); }));" }])
  })

  test("fingerprints the non-wasm32 definition, from fn to its closing brace", () => {
    const src = [
      '#[cfg(target_arch = "wasm32")]',
      "pub fn try_run(mut self) -> Result<(), String> { web(self) }",
      "",
      "/// Docs don't count.",
      '#[cfg(not(target_arch = "wasm32"))]',
      "pub fn try_run(mut self) -> Result<(), String> {",
      '    let brace = "}"; // nor do braces in strings',
      "    if x { y() } else { z() }",
      "}",
      "fn after() {}",
    ].join("\n")
    const [only, ...rest] = functionSources(src, "try_run")
    expect(rest).toEqual([])
    expect(only!.startsWith("pub fn try_run(mut self) -> Result<(), String> {\n")).toBe(true)
    expect(only!.endsWith("else { z() }\n}")).toBe(true)
    // Whitespace doesn't change it; code does.
    expect(fingerprint([only!])).toBe(fingerprint([only!.replace(/\n {4}/g, "\n\t\t")]))
    expect(fingerprint([only!])).not.toBe(fingerprint([only!.replace("z()", "w()")]))
  })

  test("codeOnly keeps lines and lifetimes, blanks comments and literals", () => {
    const src = "fn f<'a>(x: &'a str) -> char { /* } */ let c = '}'; \"{\" ; 'x' }\n// }"
    const code = codeOnly(src)
    expect(code.length).toBe(src.length)
    expect(code.split("\n").length).toBe(2)
    expect(code).toContain("<'a>")
    expect([...code].filter((c) => c === "}").length).toBe(1)
  })
})
