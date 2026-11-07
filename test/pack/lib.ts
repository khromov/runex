// Helpers for the packaging tests (test/pack/*.test.ts): the package's metadata, a command runner,
// temporary directories, and `npm pack` run once per test file on a copy of the publishable files.
//
// pack() never writes in the repo. It asks npm what it would publish from the repo
// (`npm pack --dry-run`, which writes nothing), copies exactly those files to a temporary
// directory along with what prepack's `fix-dts --publish` reads (ts/ and the script), runs
// `fix-dts --publish` there, as the publish job does, and packs the copy. Test files call
// cleanup() in afterAll to remove it and the other temporary directories.
import { parseTriple } from "@napi-rs/cli"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderEnv } from "../../scripts/lib/env.ts"

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

type Export = string | { types?: string; default?: string }

export type Package = {
  name: string
  version: string
  description: string
  license: string
  main: string
  types: string
  exports: Record<string, Export>
  files: string[]
  engines: Record<string, string>
  napi: { binaryName: string; packageName: string; targets: string[] }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export const pkg: Package = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))

export type Entry = {
  /** The key in package.json `exports`: ".", "./kit", ... */
  subpath: string
  /** What a consumer imports: "runex-js", "runex-js/kit", ... */
  specifier: string
  /** Package-relative files: "dist/kit.d.ts" and "dist/kit.js". */
  types: string
  js: string
}

/** The package's entry points, from `exports` (leaving out "./package.json"). */
export function entries(): Entry[] {
  const out: Entry[] = []
  for (const [subpath, value] of Object.entries(pkg.exports)) {
    if (typeof value === "string") continue
    if (!value.types || !value.default) throw new Error(`package.json exports["${subpath}"] needs "types" and "default"`)
    out.push({
      subpath,
      specifier: subpath === "." ? pkg.name : pkg.name + subpath.slice(1),
      types: value.types.replace(/^\.\//, ""),
      js: value.default.replace(/^\.\//, ""),
    })
  }
  return out
}

/** The `npm/<dir>` suffix napi-rs uses for a Rust target triple: `linux-arm64-gnu`. */
export function platformOf(triple: string) {
  return parseTriple(triple)
}

/** The addon file this machine loads (`runex.darwin-arm64.node`), from napi.targets. */
export function addonFile(): string | undefined {
  for (const triple of pkg.napi.targets) {
    const t = parseTriple(triple)
    if (t.platform === process.platform && t.arch === process.arch) return `${pkg.napi.binaryName}.${t.platformArchABI}.node`
  }
  return undefined
}

/**
 * Runs a command and returns its stdout; throws with its output when it fails. Its environment is
 * the test's without RUNEX_PERF and RUNEX_TITLEBAR (scripts/lib/env.ts), plus `env`.
 */
export function run(cmd: string, args: string[], opts: { cwd: string; env?: Record<string, string> }): string {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: renderEnv(opts.env),
    // npm is npm.cmd on Windows, which only a shell runs.
    shell: process.platform === "win32" && cmd === "npm",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) {
    const why = r.error ? String(r.error) : `exit ${r.status ?? r.signal}`
    throw new Error(`${cmd} ${args.join(" ")} (in ${opts.cwd}): ${why}\n${r.stdout ?? ""}\n${r.stderr ?? ""}`)
  }
  return r.stdout
}

const temps: string[] = []

/** A new temporary directory, removed by cleanup(). */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `runex-${prefix}-`))
  temps.push(dir)
  return dir
}

/**
 * Removes every temporary directory and forgets the packed tarball. Each test file that uses them
 * runs it in afterAll (bun test doesn't emit process "exit"); the next file packs again.
 */
export function cleanup() {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  packed = undefined
}

export function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

export type Packed = {
  /** The copy npm packed (its own package.json, dist/, native.d.cts after `fix-dts --publish`). */
  copy: string
  /** The .tgz. */
  tarball: string
  /** The tarball's files, package-relative and sorted. */
  files: string[]
  /** What `npm pack --dry-run` lists in the repo itself, sorted. */
  listed: string[]
  /** Bytes: the tarball, and its files unpacked. */
  size: number
  unpackedSize: number
  /** Whether the repo's native.d.cts was the same before and after (it must be). */
  repoUntouched: boolean
}

type PackJson = { filename: string; size: number; unpackedSize: number; files: { path: string }[] }[]

let packed: Packed | undefined

/** Packs the package, once until cleanup() (about 2 s); see the header. */
export function pack(): Packed {
  if (packed) return packed
  const dts = join(ROOT, "native.d.cts")
  if (!existsSync(dts)) throw new Error("no native.d.cts in the repo: build the addon first (bun run build:native, or scripts/dev-install.sh)")
  const before = sha256(dts)

  const dry = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT })) as PackJson
  const listed = dry[0]!.files.map((f) => f.path).sort()

  const dir = tempDir("pack")
  const copy = join(dir, "package")
  for (const file of [...listed, ".gitignore", "scripts/fix-dts.mjs"]) {
    if (!existsSync(join(ROOT, file))) continue
    mkdirSync(dirname(join(copy, file)), { recursive: true })
    copyFileSync(join(ROOT, file), join(copy, file))
  }
  // fix-dts reads the facade's sources to find which entry point exports each type.
  cpSync(join(ROOT, "ts"), join(copy, "ts"), { recursive: true })
  run("node", [join(copy, "scripts", "fix-dts.mjs"), "--publish"], { cwd: copy })

  const out = (JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", dir], { cwd: copy })) as PackJson)[0]!
  packed = {
    copy,
    tarball: join(dir, out.filename),
    files: out.files.map((f) => f.path).sort(),
    listed,
    size: out.size,
    unpackedSize: out.unpackedSize,
    repoUntouched: sha256(dts) === before,
  }
  return packed
}
