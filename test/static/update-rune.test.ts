// update-rune's patch step with several patches, on a throwaway Rune with three of them: 0001
// (no header), 0002 (a header), and 0003 (on top of a file 0001 adds).
// - At the pin each patch applies, in name order, as a commit, so HEAD is the next one's base.
// - Upstream conflicts with 0001: the run stops there, with 0001's conflict; 0002 applies without
//   it, 0003 doesn't. Following the printed command rewrites 0001 alone; the others stay as they
//   were, byte for byte, and the rebased set applies.
// - Upstream conflicts with 0002: the rewritten 0002 keeps its header and holds only its own
//   change, not 0001's (what `git diff --cached <new rev>` used to fold in).
// `bun test ./test/static`.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { patchHeader, prepareRebase, tryPatches } from "../../scripts/update-rune.ts"

const tmp = mkdtempSync(join(tmpdir(), "runex-update-rune-test-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const gitIn = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
  return r.stdout
}
const HEADER = "Why 0002 exists: b must call c.\n\nTo drop it: delete this file.\n\n"

const repo = join(tmp, "rune")
const patchDir = join(tmp, "patches")
const read = (f: string) => readFileSync(join(repo, f), "utf8")
const write = (f: string, text: string) => writeFileSync(join(repo, f), text)

/** The pin, two upstream revisions on it (`new-a` conflicts with 0001, `new-b` with 0002), and the three patches. */
function setup() {
  mkdirSync(join(repo, "src"), { recursive: true })
  mkdirSync(patchDir)
  write("src/a.rs", "fn a() {}\n")
  write("src/b.rs", "fn b() {}\n")
  gitIn(repo, "init", "-q")
  gitIn(repo, "config", "core.autocrlf", "false")
  gitIn(repo, "add", "-A")
  gitIn(repo, "commit", "-qm", "pin")
  gitIn(repo, "tag", "pin")
  // Each patch on the one before, as they're applied.
  const stage = (name: string, header: string, edit: () => void) => {
    edit()
    gitIn(repo, "add", "-A")
    writeFileSync(join(patchDir, name), header + gitIn(repo, "diff", "--cached", "HEAD"))
    gitIn(repo, "commit", "-qm", name)
  }
  gitIn(repo, "checkout", "-q", "--detach", "pin")
  stage("0001-a.patch", "", () => {
    write("src/a.rs", "fn a() { pumped() }\n")
    write("src/pump.rs", "fn pumped() {}\n")
  })
  stage("0002-b.patch", HEADER, () => write("src/b.rs", "fn b() { c() }\n"))
  stage("0003-pump.patch", "", () => write("src/pump.rs", "fn pumped() { more() }\n"))
  for (const [tag, file, text] of [["new-a", "src/a.rs", "fn a() { upstream() }\n"], ["new-b", "src/b.rs", "fn b() { upstream() }\n"]] as const) {
    gitIn(repo, "checkout", "-q", "--detach", "pin")
    write(file, text)
    gitIn(repo, "commit", "-qam", tag)
    gitIn(repo, "tag", tag)
  }
  gitIn(repo, "checkout", "-q", "--detach", "pin")
}
setup()
const patches = readdirSync(patchDir).sort().map((f) => join(patchDir, f))
const original = (name: string) => readFileSync(join(patchDir, name), "utf8")
const subjects = (base: string) => gitIn(repo, "log", "--format=%s", `${base}..HEAD`).trim().split("\n").filter(Boolean).reverse()
const sh = (cmd: string) => spawnSync("sh", ["-c", cmd], { encoding: "utf8" })

describe("update-rune: several patches", () => {
  test("patchHeader: the text before the first diff --git, or nothing", () => {
    expect(patchHeader(original("0002-b.patch"))).toBe(HEADER)
    expect(patchHeader(original("0001-a.patch"))).toBe("")
  })

  test("at the pin every patch applies, in order, a commit each", () => {
    const tries = tryPatches(repo, "pin", patches)
    expect(tries.map((t) => [t.name, t.status])).toEqual([["0001-a.patch", "applied"], ["0002-b.patch", "applied"], ["0003-pump.patch", "applied"]])
    expect(subjects("pin")).toEqual(["0001-a.patch", "0002-b.patch", "0003-pump.patch"])
    expect([read("src/a.rs"), read("src/b.rs"), read("src/pump.rs")]).toEqual(["fn a() { pumped() }\n", "fn b() { c() }\n", "fn pumped() { more() }\n"])
    expect(gitIn(repo, "status", "--porcelain")).toBe("")
  })

  test.skipIf(process.platform === "win32")("0001 conflicts: the run stops there; 0002 applies without it, 0003 doesn't; the rebase rewrites 0001 alone", () => {
    const tries = tryPatches(repo, "new-a", patches)
    expect(tries.map((t) => [t.name, t.status, t.applies])).toEqual([["0001-a.patch", "conflict", undefined], ["0002-b.patch", "after", true], ["0003-pump.patch", "after", false]])
    expect(tries[0]!.failed).toEqual([{ file: "src/a.rs", line: 1 }])
    expect(tries[0]!.conflicts).toEqual([{ file: "src/a.rs", lines: [1] }])
    expect(tries[2]!.failed).toEqual([{ file: "src/pump.rs" }])
    // Nothing after the conflict was applied, and HEAD is the conflicting patch's base.
    expect(subjects("new-a")).toEqual([])
    expect(read("src/b.rs")).toBe("fn b() {}\n")

    const out = join(tmp, "rebased-a")
    const r = prepareRebase(repo, tries, out, join(tmp, "headers-a"))
    expect(r.notes).toEqual([])
    expect(readdirSync(out).sort()).toEqual(["0001-a.patch", "0002-b.patch", "0003-pump.patch"])
    expect(existsSync(join(tmp, "headers-a"))).toBe(false)
    write("src/a.rs", "fn a() { upstream(); pumped() }\n")
    const w = sh(r.write)
    expect(w.stderr).toBe("")
    expect(w.status).toBe(0)
    const rebased = readFileSync(join(out, "0001-a.patch"), "utf8")
    expect(rebased).toContain("+fn a() { upstream(); pumped() }")
    expect(rebased).toContain("+fn pumped() {}")
    for (const n of ["0002-b.patch", "0003-pump.patch"]) expect(readFileSync(join(out, n), "utf8")).toBe(original(n))

    const again = tryPatches(repo, "new-a", readdirSync(out).sort().map((f) => join(out, f)))
    expect(again.map((t) => t.status)).toEqual(["applied", "applied", "applied"])
    expect(read("src/pump.rs")).toBe("fn pumped() { more() }\n")
  })

  test.skipIf(process.platform === "win32")("0002 conflicts: its rebased file keeps its header and only its own change", () => {
    const tries = tryPatches(repo, "new-b", patches)
    expect(tries.map((t) => [t.name, t.status, t.applies])).toEqual([["0001-a.patch", "applied", undefined], ["0002-b.patch", "conflict", undefined], ["0003-pump.patch", "after", true]])
    expect(subjects("new-b")).toEqual(["0001-a.patch"])

    const out = join(tmp, "rebased-b")
    const headers = join(tmp, "headers-b")
    const r = prepareRebase(repo, tries, out, headers)
    expect(readFileSync(join(headers, "0002-b.patch"), "utf8")).toBe(HEADER)
    write("src/b.rs", "fn b() { upstream(); c() }\n")
    expect(sh(r.write).status).toBe(0)
    const rebased = readFileSync(join(out, "0002-b.patch"), "utf8")
    expect(rebased.startsWith(`${HEADER}diff --git a/src/b.rs b/src/b.rs\n`)).toBe(true)
    expect([...rebased.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1])).toEqual(["src/b.rs"])
    expect(rebased).toContain("+fn b() { upstream(); c() }")
    for (const n of ["0001-a.patch", "0003-pump.patch"]) expect(readFileSync(join(out, n), "utf8")).toBe(original(n))

    // Running it again from patches/ keeps the rebased copy and says so.
    const rerun = tryPatches(repo, "new-b", patches)
    const notes = prepareRebase(repo, rerun, out, headers).notes
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain("0002-b.patch differs")
    expect(readFileSync(join(out, "0002-b.patch"), "utf8")).toBe(rebased)

    const again = tryPatches(repo, "new-b", readdirSync(out).sort().map((f) => join(out, f)))
    expect(again.map((t) => t.status)).toEqual(["applied", "applied", "applied"])
    expect(subjects("new-b")).toEqual(["0001-a.patch", "0002-b.patch", "0003-pump.patch"])
    expect(read("src/b.rs")).toBe("fn b() { upstream(); c() }\n")
  })
})
