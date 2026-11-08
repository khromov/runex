// How runex's tools run cargo on vendor/rune (compare.ts, update-rune.ts, demos.ts), so builds of
// Rune don't fill the disk. runex never edits Rune, so its builds keep neither incremental caches
// (Rune's release profile turns them on) nor debug info (on macOS a dev build keeps every object
// file for it: about 30 GB for the examples compare builds). Panics still name their file and line,
// which Rust embeds whatever the debug info, and backtraces their functions.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** The environment for a cargo build of vendor/rune: `base` with cargo on PATH and the above. */
export function runeCargoEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env = Object.fromEntries(Object.entries(base).filter((e): e is [string, string] => e[1] !== undefined))
  env.PATH = `${join(homedir(), ".cargo", "bin")}:${env.PATH ?? ""}`
  env.CARGO_INCREMENTAL ??= "0"
  env.CARGO_PROFILE_DEV_DEBUG ??= "0"
  env.CARGO_PROFILE_RELEASE_DEBUG ??= "0"
  return env
}

/**
 * The profile directories cargo has built in `targetDir`, as `cargo clean` selects them:
 * `debug` and `release` for the host, and the same under each `--target` triple (napi's release
 * builds pass one).
 */
function builtProfiles(targetDir: string): { profile: "dev" | "release"; target?: string }[] {
  const out: { profile: "dev" | "release"; target?: string }[] = []
  const add = (dir: string, target?: string) => {
    if (existsSync(join(dir, "debug"))) out.push({ profile: "dev", target })
    if (existsSync(join(dir, "release"))) out.push({ profile: "release", target })
  }
  if (!existsSync(targetDir)) return out
  add(targetDir)
  for (const e of readdirSync(targetDir, { withFileTypes: true })) {
    if (e.isDirectory() && /^[a-z0-9_]+-[a-z0-9_]+-[a-z0-9_]+(-[a-z0-9_]+)?$/.test(e.name)) add(join(targetDir, e.name), e.name)
  }
  return out
}

/** Rune's own crates: vendor/rune's workspace members (`cargo metadata --no-deps`, no download). */
function runePackages(runeDir: string, env: Record<string, string>): string[] {
  const r = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], { cwd: runeDir, env, encoding: "utf8", maxBuffer: 1 << 28 })
  if (r.status !== 0) return []
  return [...new Set((JSON.parse(r.stdout) as { packages: { name: string }[] }).packages.map((p) => p.name))].sort()
}

/** The path (non-registry) packages `manifestDir`'s Cargo.lock holds: what `cargo clean -p` can name there. */
function lockedPathPackages(manifestDir: string): Set<string> {
  const lock = join(manifestDir, "Cargo.lock")
  if (!existsSync(lock)) return new Set()
  const names = new Set<string>()
  for (const block of readFileSync(lock, "utf8").split("[[package]]").slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1]
    if (name && !/^source = /m.test(block)) names.add(name)
  }
  return names
}

/**
 * Removes every build of Rune's own crates (vendor/rune's workspace) from the target directory of
 * the workspace at `manifestDir`, in each profile and target it has built, with `cargo clean -p`.
 * Cargo never deletes an artifact a newer build replaced, so each Rune revision (and each change
 * to the patches) would otherwise leave a full set of Rune's crates behind. Third-party
 * dependencies, which a Rune bump rarely changes, stay cached. Returns the commands it ran.
 */
export function cleanRuneCrates(manifestDir: string, runeDir: string, targetDir = join(manifestDir, "target")): { cmd: string; code: number }[] {
  const env = runeCargoEnv()
  const local = lockedPathPackages(manifestDir)
  const pkgs = runePackages(runeDir, env).filter((p) => local.has(p))
  if (!pkgs.length) return []
  const ran: { cmd: string; code: number }[] = []
  // Cargo cleans only a directory it tagged; napi makes target/ (target/napi-out) before cargo
  // runs, so its root has no tag. Write the one cargo writes.
  const tag = join(targetDir, "CACHEDIR.TAG")
  if (existsSync(targetDir) && !existsSync(tag)) writeFileSync(tag, "Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n# For information about cache directory tags see https://bford.info/cachedir/\n")
  for (const { profile, target } of builtProfiles(targetDir)) {
    const args = ["clean", "--target-dir", targetDir, ...(profile === "release" ? ["--release"] : []), ...(target ? ["--target", target] : []), ...pkgs.flatMap((p) => ["-p", p])]
    const r = spawnSync("cargo", args, { cwd: manifestDir, env, encoding: "utf8" })
    ran.push({ cmd: `cargo clean ${profile === "release" ? "--release " : ""}${target ? `--target ${target} ` : ""}-p (${pkgs.length} Rune crates) in ${manifestDir}`, code: r.status ?? 1 })
  }
  return ran
}
