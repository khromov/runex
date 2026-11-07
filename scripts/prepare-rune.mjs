// Applies runex's patches to the Rune submodule (vendor/rune), once, and checks that they are.
//
//   node scripts/prepare-rune.mjs            apply what isn't applied yet
//   node scripts/prepare-rune.mjs --check    exit 1 unless vendor/rune is exactly its pinned
//                                            revision plus patches/ (see below); changes nothing
//   node scripts/prepare-rune.mjs --reapply  rebuild vendor/rune from its pinned revision and
//                                            patches/, as after a patch changed: what vendor/rune
//                                            holds beyond the pin is saved to out/prepare-rune/
//                                            first, then reverted, then the patches are applied
//   ... --rune DIR                           a Rune checkout other than vendor/rune
//   ... --patches DIR                        patches other than patches/
//
// Rune's `App::run` blocks the main thread in winit's event loop; runex needs to turn that loop
// from JavaScript's (`patches/0001-pump-event-loop.patch` adds `App::start` and `Pump`).
//
// --check tests, without touching the work tree or any real index:
// - that vendor/rune's HEAD is the revision the superproject records (`git ls-files -s
//   vendor/rune`); scripts/update-rune.ts sets RUNEX_RUNE_BUMP=<sha> while it moves the pin;
// - that the work tree is the pin plus the patches and nothing else: the tree of HEAD with every
//   patch applied (`apply --cached` into a throwaway GIT_INDEX_FILE) must equal the tree of the
//   work tree (`add -A` into another, so .gitignore'd files like target/ don't count). On a
//   mismatch it prints `diff-tree --stat` between the two.
//
// A copy without .git in the Rune checkout (scripts/linux-docker.sh's Docker copy) has no pin to
// compare and no history to build the expected tree from. There --check says so and tests only
// that each patch is applied (`git apply --reverse --check`, kept from finding any enclosing
// repository). Applying works as usual there; --reapply needs git. With CI set, a missing .git
// fails --check instead: CI checks out the submodule, so the full check must run there.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  if (!args[i + 1] || args[i + 1].startsWith("--")) fail(`${name} needs a directory`)
  return resolve(args[i + 1])
}
const rune = option("--rune", join(root, "vendor", "rune"))
const patches = option("--patches", join(root, "patches"))
const isVendor = rune === join(root, "vendor", "rune")
const check = args.includes("--check")
const reapply = args.includes("--reapply")

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!existsSync(join(rune, "Cargo.toml"))) {
  if (!isVendor) fail(`${rune} has no Cargo.toml: not a Rune checkout`)
  console.log("vendor/rune is empty: fetching the submodule")
  execFileSync("git", ["submodule", "update", "--init", "--depth", "1", "vendor/rune"], { cwd: root, stdio: "inherit" })
}

// Without its own .git, git mustn't find a repository above the checkout (the superproject, or
// whatever holds the copy): `git apply` would then take paths relative to that one.
const hasGit = existsSync(join(rune, ".git"))
const gitEnv = hasGit ? process.env : { ...process.env, GIT_CEILING_DIRECTORIES: dirname(rune) }

/** Runs git in the Rune checkout; false on failure, with git's stderr kept in `gitError`. */
let gitError = ""
const git = (...a) => {
  try {
    execFileSync("git", ["-C", rune, ...a], { stdio: "pipe", env: gitEnv })
    return true
  } catch (error) {
    gitError = String(error.stderr ?? error.message).trim()
    return false
  }
}
/** Runs git in the Rune checkout and returns its stdout; exits on failure. */
const gitOut = (a, env) => {
  try {
    return execFileSync("git", ["-C", rune, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...gitEnv, ...env }, maxBuffer: 1 << 28 }).trimEnd()
  } catch (error) {
    fail(`git ${a.join(" ")} failed in ${rune}:\n${String(error.stderr ?? error.message).trim()}`)
  }
}

const files = readdirSync(patches).filter((f) => f.endsWith(".patch")).sort().map((name) => ({ name, file: join(patches, name) }))

/**
 * The tree of HEAD with every patch applied, and the tree the work tree holds, each built in a
 * throwaway index. `expected` is null when a patch doesn't apply to HEAD.
 */
function trees() {
  const tmp = mkdtempSync(join(tmpdir(), "runex-prepare-"))
  try {
    const expectedIndex = { GIT_INDEX_FILE: join(tmp, "expected") }
    const actualIndex = { GIT_INDEX_FILE: join(tmp, "actual") }
    gitOut(["read-tree", "HEAD"], expectedIndex)
    let expected = null
    let broken = ""
    for (const { name, file } of files) {
      try {
        execFileSync("git", ["-C", rune, "apply", "--cached", file], { stdio: "pipe", env: { ...process.env, ...expectedIndex } })
      } catch (error) {
        broken = `${name}: ${String(error.stderr ?? error.message).trim()}`
        break
      }
    }
    if (!broken) expected = gitOut(["write-tree"], expectedIndex)
    gitOut(["read-tree", "HEAD"], actualIndex)
    gitOut(["add", "-A"], actualIndex)
    const actual = gitOut(["write-tree"], actualIndex)
    return { expected, actual, head: gitOut(["rev-parse", "HEAD^{tree}"]), broken }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (check) process.exit((hasGit ? runCheck() : runCopyCheck()) ? 0 : 1)

if (reapply) {
  if (!hasGit) fail(`--reapply needs git: ${rune} has no .git`)
  const t = trees()
  if (t.expected && t.expected === t.actual) {
    console.log("vendor/rune is already its pinned revision plus patches/")
  } else if (t.actual !== t.head) {
    // Save what the work tree holds beyond HEAD, then revert exactly that.
    const saved = join(root, "out", "prepare-rune", `${rune.split(/[\\/]/).pop()}-${new Date().toISOString().replace(/[:.]/g, "-")}.diff`)
    mkdirSync(dirname(saved), { recursive: true })
    writeFileSync(saved, gitOut(["diff-tree", "-p", "--binary", "--full-index", t.head, t.actual]) + "\n")
    if (!git("apply", "--reverse", "--binary", saved)) fail(`couldn't revert the work tree to HEAD (its changes are in ${saved})\n${gitError}`)
    console.log(`reverted vendor/rune to its pinned revision; what it held is in ${saved}`)
  }
}

// Apply what isn't applied yet.
for (const { name, file } of files) {
  if (git("apply", "--reverse", "--check", file)) {
    console.log(`applied   ${name}`)
    continue
  }
  if (!git("apply", "--check", file)) {
    fail(`${name} doesn't apply to ${isVendor ? "vendor/rune" : rune}: was the submodule moved to another revision, or did the patch change? \`node scripts/prepare-rune.mjs --reapply\` rebuilds it from its pinned revision and patches/.\n${gitError}`)
  }
  if (!git("apply", file)) fail(`${name}: git apply failed after --check passed\n${gitError}`)
  console.log(`applying  ${name}`)
}
if (reapply) process.exit(runCheck() ? 0 : 1)
process.exit(0)

/** --check in a copy without .git: only that each patch is applied. Prints what fails; whether all pass. */
function runCopyCheck() {
  const where = isVendor ? "vendor/rune" : rune
  if (process.env.CI) {
    console.log(`NO GIT    ${where} has no .git: in CI the submodule must be checked out, so its pin and edits can be checked`)
    return false
  }
  console.log(`no git    ${where} has no .git (a copy, like scripts/linux-docker.sh's): checking only that the patches are applied; its revision and edits beyond the patches go unchecked`)
  let ok = true
  for (const { name, file } of files) {
    if (git("apply", "--reverse", "--check", file)) console.log(`applied   ${name}`)
    else {
      console.log(`MISSING   ${name}: ${gitError.split("\n")[0]}`)
      ok = false
    }
  }
  return ok
}

/** The --check tests; prints what fails and returns whether all pass. */
function runCheck() {
  let ok = true
  // (a) HEAD is the pinned revision.
  const head = gitOut(["rev-parse", "HEAD"])
  if (isVendor) {
    const entry = execFileSync("git", ["ls-files", "-s", "vendor/rune"], { cwd: root, encoding: "utf8" }).trim()
    const pinned = /^160000 ([0-9a-f]{40}) /.exec(entry)?.[1]
    const bump = process.env.RUNEX_RUNE_BUMP
    if (!pinned) {
      console.log(`MISSING   the superproject records no revision for vendor/rune (git ls-files -s vendor/rune: ${JSON.stringify(entry)})`)
      ok = false
    } else if (head === pinned) {
      console.log(`pinned    vendor/rune at ${head.slice(0, 8)}`)
    } else if (bump && head.startsWith(bump)) {
      console.log(`pinned    vendor/rune at ${head.slice(0, 8)}: a bump in progress (the superproject records ${pinned.slice(0, 8)}; \`git add vendor/rune\` records the new one)`)
    } else {
      console.log(`MOVED     vendor/rune is at ${head.slice(0, 8)}, the superproject records ${pinned.slice(0, 8)}: \`git submodule update vendor/rune\` goes back, \`git add vendor/rune\` records the move`)
      ok = false
    }
  }
  // Each patch, as before (informative; the tree test below is the strict one).
  for (const { name, file } of files) {
    if (git("apply", "--reverse", "--check", file)) console.log(`applied   ${name}`)
    else {
      console.log(`MISSING   ${name}`)
      ok = false
    }
  }
  // (b) The work tree is exactly the pin plus the patches.
  const t = trees()
  if (!t.expected) {
    console.log(`BROKEN    the patches don't apply to ${head.slice(0, 8)}: ${t.broken}`)
    ok = false
  } else if (t.expected === t.actual) {
    console.log(`exact     work tree = ${head.slice(0, 8)} + ${files.length} patch${files.length === 1 ? "" : "es"} (tree ${t.actual.slice(0, 12)})`)
  } else {
    console.log(`DRIFT     the work tree isn't ${head.slice(0, 8)} plus patches/; from what it should be to what it is:`)
    console.log(gitOut(["diff-tree", "-r", "--stat=120", t.expected, t.actual]).split("\n").map((l) => `  ${l}`).join("\n"))
    console.log(`  (\`git -C ${isVendor ? "vendor/rune" : rune} diff\` shows the edits; \`node scripts/prepare-rune.mjs --reapply\` rebuilds it from the pin and patches/, saving them first)`)
    ok = false
  }
  return ok
}
