#!/usr/bin/env node
// One-time setup for npm trusted publishing (OIDC), run by a maintainer, not CI:
//
//   npm login                                   # an account in the runex-js org, with 2FA
//   node scripts/npm-bootstrap.mjs --dry-run    # what it would do
//   node scripts/npm-bootstrap.mjs
//
// A trusted publisher can only be configured for a package that already exists on npm, so for
// each of the six packages CI publishes this
//   1. publishes a placeholder (0.0.0-bootstrap.0, dist-tag `bootstrap`, deprecated) when the
//      name isn't on the registry yet, and
//   2. makes khromov/runex's .github/workflows/ci.yml its trusted publisher, allowed to publish.
// Both steps are skipped where they're already done. Then set the repository variable
// NPM_TRUSTED_PUBLISHING to `true` (the last line printed says how), and the next v* tag publishes
// for real. Needs npm 11.15.0 or later (`npm trust`); npm asks for a 2FA code as it goes.
//
// npm expires a new trusted publisher that hasn't published within 2 days, so run this when the
// release tag is ready to push. An expired one has to be revoked (`npm trust list <package>`, then
// `npm trust revoke <package> --id <id>`) before this script can create it again.
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const REPO = "khromov/runex"
const WORKFLOW = "ci.yml"
const PLACEHOLDER = "0.0.0-bootstrap.0"
const dry = process.argv.includes("--dry-run")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

const manifests = [
  "package.json",
  ...readdirSync(join(ROOT, "npm")).map((dir) => `npm/${dir}/package.json`),
  "packages/svelte/package.json",
  "packages/create-runex-svelte/package.json",
].map((path) => ({ path, json: JSON.parse(readFileSync(join(ROOT, path), "utf8")) }))

const [major, minor] = execFileSync(npm, ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).trim().split(".").map(Number)
if (major < 11 || (major === 11 && minor < 15)) {
  console.error(`npm ${major}.${minor} has no \`npm trust\`: npm install -g npm@latest`)
  process.exit(1)
}

const windows = process.platform === "win32"
// npm.cmd only runs through a shell, which splits arguments on spaces: quote them there.
const quote = (args) => (windows ? args.map((a) => (/[\s;&|<>^"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args)

/** Runs npm with the terminal attached, so it can ask for a 2FA code. */
function run(args, cwd = ROOT) {
  console.log(`  $ npm ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`)
  if (dry) return true
  return spawnSync(npm, quote(args), { cwd, stdio: "inherit", shell: windows }).status === 0
}

/** npm's answer as text, or null when it fails (an unknown package is a 404, a missing 2FA code an EOTP). */
function ask(args) {
  const r = spawnSync(npm, quote(args), { cwd: ROOT, encoding: "utf8", shell: windows })
  return r.status === 0 ? r.stdout.trim() : null
}

/**
 * The package's trusted publishers as npm lists them. The listing can need a 2FA code, which npm
 * only asks for on a terminal: then it runs once with the terminal attached, and npm's 2FA window
 * lets the second, captured listing through.
 */
function trust_list(name) {
  let out = ask(["trust", "list", name, "--json"])
  if (out === null && ask(["view", name, "name"]) !== null) {
    spawnSync(npm, quote(["trust", "list", name]), { cwd: ROOT, stdio: "inherit", shell: windows })
    out = ask(["trust", "list", name, "--json"])
  }
  if (out === null) return null
  return parse_objects(out)
}

/**
 * `npm trust list --json` prints one pretty-printed object per configuration, one after another
 * (nothing at all when there are none): `{ id, type, file, repository, permissions }`.
 */
function parse_objects(text) {
  const out = []
  let chunk = ""
  for (const line of text.split(/\r?\n/)) {
    if (!chunk && !line.startsWith("{")) continue
    chunk += line + "\n"
    if (line === "}") {
      try {
        out.push(JSON.parse(chunk))
      } catch {
        return null
      }
      chunk = ""
    }
  }
  return chunk ? null : out
}

/**
 * Whether a listed trust relationship is this repository's ci.yml, allowed to publish: npm's
 * `createPackage` permission (`createStagedPackage` alone only stages).
 */
function is_ours(entry) {
  return (
    String(entry.repository).toLowerCase() === REPO.toLowerCase() &&
    String(entry.file).replace(/^.*\//, "") === WORKFLOW &&
    Array.isArray(entry.permissions) &&
    entry.permissions.includes("createPackage")
  )
}

const user = ask(["whoami"])
if (!user && !dry) {
  console.error("Not logged in to npm: run `npm login` first.")
  process.exit(1)
}
console.log(`npm user: ${user ?? "(not logged in)"}${dry ? " (dry run: nothing is published or changed)" : ""}\n`)

let failed = 0
for (const { path, json } of manifests) {
  const { name, repository } = json
  console.log(`${name} (${path})`)
  if (!repository?.url?.includes(`github.com/${REPO}`)) {
    console.error(`  ${path} has no repository.url for ${REPO}; trusted publishing would refuse it`)
    failed++
    continue
  }

  if (ask(["view", name, "name"]) !== null) {
    console.log("  on npm already")
  } else {
    const dir = mkdtempSync(join(tmpdir(), "runex-bootstrap-"))
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name,
          version: PLACEHOLDER,
          description: `Placeholder claiming the name; ${name} is published from ${REPO}'s CI.`,
          license: json.license ?? "MIT",
          repository,
          publishConfig: { access: "public" },
        },
        null,
        2,
      ),
    )
    writeFileSync(join(dir, "README.md"), `# ${name}\n\nA placeholder: the real releases are published from https://github.com/${REPO}.\n`)
    const ok = run(["publish", "--tag", "bootstrap", "--access", "public"], dir)
    rmSync(dir, { recursive: true, force: true })
    if (!ok) {
      console.error(`  publishing the placeholder for ${name} failed`)
      failed++
      continue
    }
  }

  // Deprecated, so nobody installs it by accident; checked on every run, so a missed 2FA prompt is retried.
  const placeholder = dry ? null : ask(["view", `${name}@${PLACEHOLDER}`, "version"])
  if (dry || (placeholder && !ask(["view", `${name}@${PLACEHOLDER}`, "deprecated"]))) {
    if (!run(["deprecate", `${name}@${PLACEHOLDER}`, `Placeholder; install a real release of ${name}.`])) {
      console.error(`  deprecating the placeholder of ${name} failed`)
      failed++
    }
  }

  const trusted = dry ? [] : trust_list(name)
  if (trusted === null) {
    console.error(`  couldn't list ${name}'s trusted publishers (npm trust list ${name})`)
    failed++
  } else if (trusted.some(is_ours)) {
    console.log(`  trusted publisher already set (${REPO}, ${WORKFLOW}, publish)`)
  } else if (trusted.length > 0) {
    // npm keeps one per package: another (another workflow, staged-only, expired) has to go first.
    console.error(`  ${name} has a different trusted publisher:\n    ${JSON.stringify(trusted)}\n  revoke it (npm trust revoke ${name} --id <id>) and run this again`)
    failed++
  } else if (!run(["trust", "github", name, "--file", WORKFLOW, "--repo", REPO, "--allow-publish", "--yes"])) {
    console.error(`  configuring the trusted publisher for ${name} failed`)
    failed++
  }
  console.log()
}

if (failed > 0) {
  console.error(`${failed} package(s) failed; fix them and run this again (finished steps are skipped).`)
  process.exit(1)
}
console.log(`All ${manifests.length} packages can be published by ${REPO}'s ${WORKFLOW}. Turn on real publishing:\n`)
console.log(`  gh variable set NPM_TRUSTED_PUBLISHING --body true --repo ${REPO}`)
if (!dry) {
  const deadline = new Date(Date.now() + 2 * 24 * 3600 * 1000)
  console.log(`\nPush the release tag before ${deadline.toISOString()}: npm expires a new trusted publisher that`)
  console.log("hasn't published within 2 days (one that already published stays).")
}
