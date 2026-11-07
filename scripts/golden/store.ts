// The golden image store: PNG bytes live outside main, in an orphan branch `golden-images`
// with one file per image at `<platform>/<sha256>.png`. Main only holds the hashes
// (test/golden/png/<platform>.json), so a re-record adds kilobytes to main, not megabytes.
//
//   const store = new ImageStore()
//   store.add([{ platform: "darwin-arm64-metal", hash, png }])  // one commit on the local branch
//   store.push()                                               // to origin, when there is one
//   store.get("darwin-arm64-metal", hash, { fetch: true })     // local branch, cache, then origin
//   store.export("linux-arm64-lavapipe", hashes, "out/images")  // a cache for a copy without .git
//
// Writes use plumbing only (hash-object, mktree, commit-tree, update-ref): the work tree, the
// index and HEAD are never touched. Reads go through `git cat-file`. Images fetched from origin
// (`git fetch --filter=blob:none --depth=1`, then one blob per image) are cached in
// ~/.cache/runex-golden (RUNEX_GOLDEN_CACHE or XDG_CACHE_HOME move it). Outside a git
// repository (scripts/golden-linux.sh's Docker copy) only the cache is read, so golden-linux.sh
// fills one with `export` first and points RUNEX_GOLDEN_CACHE at it.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { ROOT } from "../lib/proc.ts"

export const BRANCH = "golden-images"
const REF = `refs/heads/${BRANCH}`
const REMOTE_REF = `refs/remotes/origin/${BRANCH}`

/** An image to store: its bytes, or the file that holds them. */
export type Image = { platform: string; hash: string; png?: Buffer; file?: string }

/** `rgba:<hex>` hashes (masked images) become `rgba-<hex>.png`: no colons in file names. */
export const imageFile = (hash: string) => `${hash.replace(/:/g, "-")}.png`

const README = `# golden-images

PNG baselines for runex's golden tests, one file per image at \`<platform>/<sha256>.png\`.
The hashes live in main, in test/golden/png/<platform>.json. scripts/golden.ts adds images
with \`--update\` (or \`--accept\`), pushes them with \`--push-images\` and rebuilds this branch
with only the referenced images with \`--gc-images\`. Nothing else should commit here.
`

export function cacheDir(): string {
  if (process.env.RUNEX_GOLDEN_CACHE) return process.env.RUNEX_GOLDEN_CACHE
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
  return join(base, "runex-golden")
}

type Git = { code: number; stdout: Buffer; stderr: string }

export class ImageStore {
  constructor(readonly cwd = ROOT, readonly log: (line: string) => void = (l) => console.error(l)) {}

  private git(args: string[], input?: string | Buffer, env?: Record<string, string>): Git {
    const p = Bun.spawnSync(["git", ...args], {
      cwd: this.cwd, stdin: input === undefined ? "ignore" : Buffer.from(input), stdout: "pipe", stderr: "pipe",
      env: { ...process.env, ...env },
    })
    return { code: p.exitCode ?? -1, stdout: p.stdout, stderr: p.stderr.toString() }
  }

  private out(args: string[], input?: string | Buffer, env?: Record<string, string>): string {
    const r = this.git(args, input, env)
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`)
    return r.stdout.toString().trim()
  }

  private repo?: boolean

  /** Whether `cwd` is in a git repository at all (a copy without .git has only the cache). */
  available(): boolean {
    return (this.repo ??= this.git(["rev-parse", "--git-dir"]).code === 0)
  }

  private resolve(ref: string): string | undefined {
    const r = this.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    return r.code === 0 ? r.stdout.toString().trim() : undefined
  }

  remote(): string | undefined {
    const r = this.git(["remote", "get-url", "origin"])
    return r.code === 0 ? r.stdout.toString().trim() : undefined
  }

  /** Entries of `<commit>:<path>` as name -> "mode type sha". */
  private entries(commit: string | undefined, path = ""): Map<string, string> {
    const out = new Map<string, string>()
    if (!commit) return out
    const r = this.git(["ls-tree", `${commit}:${path}`])
    if (r.code !== 0) return out
    for (const line of r.stdout.toString().split("\n")) {
      const tab = line.indexOf("\t")
      if (tab > 0) out.set(line.slice(tab + 1), line.slice(0, tab))
    }
    return out
  }

  private mktree(entries: Map<string, string>): string {
    const text = [...entries].map(([name, head]) => `${head}\t${name}`).join("\n")
    return this.out(["mktree"], text ? `${text}\n` : "")
  }

  /** Who commits: the user's git identity, or a fixed one where none is set (CI). */
  private identity(): Record<string, string> {
    const name = this.git(["config", "user.name"]).stdout.toString().trim()
    const email = this.git(["config", "user.email"]).stdout.toString().trim()
    if (name && email) return {}
    return { GIT_AUTHOR_NAME: "runex golden", GIT_AUTHOR_EMAIL: "golden@runex.invalid", GIT_COMMITTER_NAME: "runex golden", GIT_COMMITTER_EMAIL: "golden@runex.invalid" }
  }

  /** Writes blobs for `images` and returns their ids, in order: files in one `--stdin-paths` call. */
  private blobs(images: Image[]): string[] {
    const files = images.filter((img) => img.file).map((img) => resolve(img.file!))
    const fromFiles = files.length ? this.out(["hash-object", "-w", "--stdin-paths"], `${files.join("\n")}\n`).split("\n") : []
    let i = 0
    return images.map((img) => (img.file ? fromFiles[i++]! : this.out(["hash-object", "-w", "--stdin"], img.png!)))
  }

  /** Builds a root tree from `base` (a commit, or nothing) plus `add`, keeping only `keep` when given. */
  private tree(base: string | undefined, add: Map<string, Map<string, string>>, keep?: Map<string, Set<string>>): string {
    const root = this.entries(base)
    if (!root.has("README.md")) root.set("README.md", `100644 blob ${this.out(["hash-object", "-w", "--stdin"], README)}`)
    const platforms = new Set([...[...root.keys()].filter((n) => root.get(n)!.startsWith("040000")), ...add.keys()])
    for (const platform of platforms) {
      const files = this.entries(base, platform)
      for (const [name, head] of add.get(platform) ?? []) files.set(name, head)
      if (keep) for (const name of [...files.keys()]) if (!keep.get(platform)?.has(name)) files.delete(name)
      if (files.size) root.set(platform, `040000 tree ${this.mktree(files)}`)
      else root.delete(platform)
    }
    return this.mktree(root)
  }

  /** The images in the local branch, as `<platform>/<file>`. */
  files(): Set<string> {
    const head = this.resolve(REF)
    if (!head) return new Set()
    const r = this.git(["ls-tree", "-r", "--name-only", head])
    return new Set(r.stdout.toString().split("\n").filter((l) => l.endsWith(".png")))
  }

  has(platform: string, hash: string): boolean {
    return this.files().has(`${platform}/${imageFile(hash)}`)
  }

  /** Adds the images the local branch doesn't have yet, in one commit. */
  add(images: Image[], message?: string): { added: number; commit?: string } {
    const head = this.resolve(REF)
    const have = this.files()
    const fresh = new Map<string, Image>()
    for (const img of images) {
      const path = `${img.platform}/${imageFile(img.hash)}`
      if (!have.has(path)) fresh.set(path, img)
    }
    if (!fresh.size) return { added: 0 }
    const list = [...fresh.values()]
    const ids = this.blobs(list)
    const add = new Map<string, Map<string, string>>()
    list.forEach((img, i) => {
      if (!add.has(img.platform)) add.set(img.platform, new Map())
      add.get(img.platform)!.set(imageFile(img.hash), `100644 blob ${ids[i]}`)
    })
    const tree = this.tree(head, add)
    const platforms = [...add.keys()].map((p) => `${p} +${add.get(p)!.size}`).join(", ")
    const commit = this.out(["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", message ?? `golden images: ${platforms}`], undefined, this.identity())
    this.out(["update-ref", "-m", "golden images", REF, commit, ...(head ? [head] : [])])
    return { added: list.length, commit }
  }

  /** Reads an image: the local branch, the cache, then (with `fetch`) origin's branch. Outside a repository, the cache only. */
  get(platform: string, hash: string, o: { fetch?: boolean } = {}): Buffer | undefined {
    const file = imageFile(hash)
    const repo = this.available()
    if (repo) {
      const local = this.git(["cat-file", "blob", `${REF}:${platform}/${file}`])
      if (local.code === 0) return local.stdout
    }
    const cached = join(cacheDir(), platform, file)
    if (existsSync(cached)) return readFileSync(cached)
    if (!repo || !o.fetch || !this.fetchBranch()) return undefined
    const r = this.git(["cat-file", "blob", `${REMOTE_REF}:${platform}/${file}`])
    if (r.code !== 0) return undefined
    mkdirSync(dirname(cached), { recursive: true })
    writeFileSync(cached, r.stdout)
    return r.stdout
  }

  /**
   * Copies the images `hashes` name into `<dir>/<platform>/`, the cache's layout, for a run that
   * has no store (pointed at `dir` with RUNEX_GOLDEN_CACHE). Images already there are kept: a
   * file's name is a hash of its content. Each is read as `get` reads it.
   */
  export(platform: string, hashes: Iterable<string>, dir: string, o: { fetch?: boolean } = {}): { copied: number; present: number; missing: string[] } {
    const into = join(dir, platform)
    mkdirSync(into, { recursive: true })
    let copied = 0
    let present = 0
    const missing: string[] = []
    for (const hash of new Set(hashes)) {
      const file = join(into, imageFile(hash))
      if (existsSync(file)) { present++; continue }
      const img = this.get(platform, hash, o)
      if (!img) { missing.push(hash); continue }
      // Written whole, then renamed: an interrupted copy leaves no truncated image behind.
      writeFileSync(`${file}.tmp`, img)
      renameSync(`${file}.tmp`, file)
      copied++
    }
    return { copied, present, missing }
  }

  private fetched?: boolean

  /**
   * Fetches origin's branch without blobs (`--filter=blob:none --depth=1`, which makes origin a
   * promisor remote), so each `cat-file` of an image downloads that one blob. Once per run.
   */
  fetchBranch(): boolean {
    if (this.fetched !== undefined) return this.fetched
    if (!this.remote()) {
      this.log(`golden images: no git remote "origin" to fetch ${BRANCH} from`)
      return (this.fetched = false)
    }
    const r = this.git(["fetch", "--no-tags", "--filter=blob:none", "--depth=1", "origin", `+${REF}:${REMOTE_REF}`])
    if (r.code !== 0) this.log(`golden images: git fetch origin ${BRANCH} failed: ${r.stderr.trim().split("\n").pop()}`)
    return (this.fetched = r.code === 0)
  }

  /** Pushes the local branch to origin. Without a remote, says where the images are instead. */
  push(o: { force?: boolean } = {}): { pushed: boolean; message: string } {
    const head = this.resolve(REF)
    if (!head) return { pushed: false, message: `no local ${BRANCH} branch: nothing to push (record images with --update)` }
    const count = this.count()
    if (!this.remote()) {
      return {
        pushed: false,
        message: `no git remote "origin": the ${count} images stay in the local ${BRANCH} branch; ` +
          "add the remote, then push them with `bun scripts/golden.ts --push-images`",
      }
    }
    const r = this.git(["push", ...(o.force ? ["--force"] : []), "origin", `${REF}:${REF}`])
    if (r.code !== 0) return { pushed: false, message: `git push origin ${BRANCH} failed: ${r.stderr.trim()}` }
    return { pushed: true, message: `pushed ${BRANCH} (${count} images) to origin` }
  }

  /** How many images the local branch holds. */
  count(): number {
    return this.files().size
  }

  /**
   * Rebuilds the branch as one parentless commit holding only `referenced` images (platform ->
   * hashes), then force-pushes it when there's a remote. Returns what was kept, dropped and missing.
   */
  gc(referenced: Map<string, Set<string>>, o: { push?: boolean } = {}): { kept: number; dropped: number; missing: string[]; message: string } {
    const head = this.resolve(REF)
    if (!head) return { kept: 0, dropped: 0, missing: [], message: `no local ${BRANCH} branch` }
    const keep = new Map([...referenced].map(([p, hashes]) => [p, new Set([...hashes].map(imageFile))]))
    const before = this.count()
    const tree = this.tree(head, new Map(), keep)
    const commit = this.out(["commit-tree", tree, "-m", "golden images (squashed by --gc-images)"], undefined, this.identity())
    this.out(["update-ref", "-m", "golden images gc", REF, commit, head])
    const kept = this.count()
    const have = this.files()
    const missing = [...referenced].flatMap(([p, hashes]) => [...hashes].map((h) => `${p}/${imageFile(h)}`).filter((f) => !have.has(f)))
    const pushed = o.push ? this.push({ force: true }).message : ""
    return { kept, dropped: before - kept, missing, message: [`${BRANCH}: kept ${kept} images, dropped ${before - kept}`, pushed].filter(Boolean).join("; ") }
  }
}
