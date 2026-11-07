#!/usr/bin/env bun
// Golden baselines: renders every ported example and the frozen fixtures headless (TypeScript
// side only, no cargo) and checks them against committed references, so a Rune change that
// moves pixels or layout shows up even when the Rust examples move with it (compare.ts can't
// see those: it checks the port against Rust at the same revision).
//
//   bun scripts/golden.ts [--tier quick|standard|full] [--runtime bun|node|bun,node] [filters...]
//   bun scripts/golden.ts --update [--push-images] [--tier full] [filters...]   # bless this platform
//   bun scripts/golden.ts --accept out/golden/proposed                          # bless a proposal (CI, Linux)
//   bun scripts/golden.ts --platform KEY --export-images DIR                    # expected PNGs for a copy
//
// What is checked (test/golden/, cases from config.ts and cases.ts):
//   trees/<case>.jsonl         the normalized `--tree` dump, shared by all platforms
//   trees/<case>.<os>.jsonl    a platform's override, only where its tree differs
//   png/<platform>.json        sha256 of each case's PNG on that platform (key: os-arch-backend)
//   traces/<case>.jsonl        the normalized `--trace` of a few short scripts
//   listings/<app>.txt         each app's windows and scenes
// PNG bytes live in the orphan branch golden-images (scripts/golden/store.ts), never in main. A
// copy without .git reads them from the cache only, which --export-images fills beforehand
// (scripts/golden-linux.sh does this for its Docker run).
//
// Sanity checks fail the run too: an app whose scenes all render the same (an ignored --scene),
// a script whose consecutive checkpoints match or whose target keys are missing, a listing that
// changed. Exit codes: 0 pass, 1 a mismatch or sanity failure, 2 a harness or tooling error.
// out/golden/report.json is always written; on failure also summary.md, out/golden/<case>/
// (actual.png, expected.png and diff.png when the image store has the expected one,
// tree.diff.txt) and proposed/, which `--accept` applies. See `--help` and docs/testing.md.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { type Case, expandCases, GOLDEN, goldenApps, onThisPlatform, type TraceCase } from "../test/golden/cases.ts"
import defaultConfig, { type GoldenConfig, type Mask, type Tier } from "../test/golden/config.ts"
import { defaultPlatform, platformEnv } from "./golden/platform.ts"
import { cacheDir, type Image, ImageStore, imageFile } from "./golden/store.ts"
import { formatListing, type Listing, listApp, listingChanges, NO_SCENE, parseListing } from "./lib/discover.ts"
import { comparePng, maskPng, sha256 } from "./lib/png.ts"
import { exec, failure, pool, ROOT, type Runtime, tsCommand } from "./lib/proc.ts"
import { render } from "./lib/render.ts"
import { compareTreeValues, type FieldSummary, maskedElements, normalizeTree, parseNormalized, summarizeDiffs, type TreeDiff } from "./lib/tree.ts"

// -------------------------------------------------------------------------------------------
// Options

export type GoldenOptions = {
  tier: Tier
  runtimes: Runtime[]
  platform: string
  /** Check PNG hashes (off: trees only, and no `--snap`). */
  png: boolean
  /** Render every case twice and fail the ones whose output varies. */
  selfCheck: boolean
  /** Rewrite this platform's baselines (trees, listings, manifest) and store new images locally. */
  update: boolean
  /** Push the golden-images branch to origin (after --update or --accept, or alone). */
  pushImages: boolean
  /** Rebuild golden-images with only the images the manifests reference. */
  gcImages: boolean
  /** Apply a proposed/ directory (from a failed run here, in CI or in Docker) instead of rendering. */
  accept?: string
  /** On failure, fetch expected images from origin's golden-images when they aren't local. */
  fetchImages: boolean
  /** Copy the images this platform's manifest names into DIR/<platform>/ (a cache) instead of rendering. */
  exportImages?: string
  jobs: number
  /** Seconds per render (a case's config can raise it). */
  timeout: number
  out: string
  /** Append the markdown summary to this file too (CI: $GITHUB_STEP_SUMMARY). */
  summary?: string
  /** Case-id prefixes or globs (`*`); a bare name selects an app. */
  filters: string[]
  /** Print the case ids and exit. */
  list: boolean
  config: GoldenConfig
  /** The baseline directory (test/golden). */
  golden: string
  log: (line: string) => void
}

export function defaultGoldenOptions(over: Partial<GoldenOptions> = {}): GoldenOptions {
  const tier = over.tier ?? "quick"
  return {
    tier,
    runtimes: tier === "full" ? ["bun", "node"] : ["bun"],
    platform: defaultPlatform(),
    png: true,
    selfCheck: false,
    update: false,
    pushImages: false,
    gcImages: false,
    fetchImages: false,
    jobs: Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2))),
    timeout: 120,
    out: join(ROOT, "out", "golden"),
    filters: [],
    list: false,
    config: defaultConfig,
    golden: GOLDEN,
    log: (line) => console.error(line),
    ...over,
  }
}

// -------------------------------------------------------------------------------------------
// Results

export type CaseStatus = "pass" | "fail" | "new" | "flaky" | "error"
export type Check = "same" | "changed" | "new" | "unchecked"

export type CaseResult = {
  id: string
  runtime: Runtime
  status: CaseStatus
  tree: Check
  png: Check
  hash?: string
  expectedHash?: string
  /** Tree differences: the total, grouped by field, and the first few with their paths. */
  treeDiffCount?: number
  treeFields?: FieldSummary[]
  treeDiffs?: TreeDiff[]
  /** Which override the expected tree came from, when it isn't the shared file. */
  treeFile?: string
  error?: string
  reason?: string
  ms: number
}

export type TraceResult = { id: string; status: CaseStatus; error?: string; bytes?: number; diffCount?: number }
export type ListingResult = { example: string; status: "same" | "changed" | "new"; changes: string[] }

export type GoldenReport = {
  startedAt: string
  ms: number
  tier: Tier
  runtimes: Runtime[]
  platform: string
  png: boolean
  update: boolean
  ok: boolean
  exit: 0 | 1 | 2
  counts: Record<CaseStatus, number>
  cases: CaseResult[]
  traces: TraceResult[]
  listings: ListingResult[]
  /** Sanity-check failures. */
  sanity: string[]
  /** Harness and tooling errors (exit 2). */
  errors: string[]
  skipped: { id: string; reason: string }[]
  notes: string[]
  /** What --update or --accept wrote, or where proposed/ is. */
  written: string[]
}

// -------------------------------------------------------------------------------------------
// Baseline files

type Manifest = { platform: string; env: Record<string, string>; cases: Record<string, string> }

const rel = (o: GoldenOptions, ...p: string[]) => join(o.golden, ...p)

function readText(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined
}

function readManifest(o: GoldenOptions): Manifest | undefined {
  const text = readText(rel(o, "png", `${o.platform}.json`))
  return text ? (JSON.parse(text) as Manifest) : undefined
}

function formatManifest(m: Manifest): string {
  const cases = Object.fromEntries(Object.keys(m.cases).sort().map((k) => [k, m.cases[k]!]))
  return `${JSON.stringify({ platform: m.platform, env: m.env, cases }, null, 2)}\n`
}

/** The expected tree (or trace) for this OS: its override when there is one, else the shared file. */
function expected(o: GoldenOptions, dir: "trees" | "traces", id: string): { text?: string; file?: string } {
  const override = rel(o, dir, `${id}.${process.platform}.jsonl`)
  if (existsSync(override)) return { text: readFileSync(override, "utf8"), file: relative(o.golden, override) }
  const shared = rel(o, dir, `${id}.jsonl`)
  return { text: readText(shared) }
}

// -------------------------------------------------------------------------------------------
// Rendering

type Rendered = {
  ok: boolean
  error?: string
  log?: string
  /** Normalized tree text. */
  tree?: string
  /** The PNG as checked (masked when a mask applies, `<stem>.masked.png`) and its hash. */
  pngFile?: string
  hash?: string
  /** Keys and paths in the tree, for the script-target check. */
  keys?: Set<string>
  ms: number
}

const MASK_FIELDS = ["text", "rect", "target", "moving"]

function activeMasks(masks: Mask[], tree: any) {
  const t = typeof tree?.t === "number" ? tree.t : 0
  return masks.filter((m) => m.when === "always" || t > 0).map((m) => ({ path: m.path, fields: m.fields ?? MASK_FIELDS, region: m.region }))
}

/** The rects to blank: each mask's region element, or the masked elements themselves. */
function maskRects(tree: any, masks: ReturnType<typeof activeMasks>): [number, number, number, number][] {
  return masks.flatMap((m) => {
    if (!m.region) return maskedElements(tree, [m]).flatMap((h) => (h.rect ? [h.rect] : []))
    const e = (tree.elements ?? []).find((x: any) => x?.path === m.region)
    return Array.isArray(e?.rect) ? [e.rect as [number, number, number, number]] : []
  })
}

async function renderCase(c: Case, runtime: Runtime, stem: string, o: GoldenOptions): Promise<Rendered> {
  mkdirSync(dirname(stem), { recursive: true })
  const side = { label: runtime, cmd: tsCommand(c.main, runtime), cwd: ROOT }
  const r = await render(side, c.args, stem, { png: o.png, timeout: c.timeout ?? o.timeout, env: c.env })
  if (!r.ok) return { ok: false, error: r.error, log: r.log, ms: r.ms }
  try {
    const treeObj = JSON.parse(readFileSync(r.tree!, "utf8"))
    const masks = activeMasks(c.masks, treeObj)
    const tree = normalizeTree(treeObj, masks)
    const keys = new Set<string>()
    for (const e of treeObj.elements ?? []) {
      if (typeof e.key === "string") keys.add(e.key)
      if (typeof e.path === "string") keys.add(e.path)
    }
    if (!o.png) return { ok: true, tree, keys, ms: r.ms }
    const bytes = readFileSync(r.png)
    if (!masks.length) return { ok: true, tree, keys, pngFile: r.png, hash: sha256(bytes), ms: r.ms }
    const m = maskPng(bytes, maskRects(treeObj, masks), typeof treeObj.scale === "number" ? treeObj.scale : 2)
    writeFileSync(`${stem}.masked.png`, m.png)
    return { ok: true, tree, keys, pngFile: `${stem}.masked.png`, hash: m.hash, ms: r.ms }
  } catch (e) {
    return { ok: false, error: `${runtime}: reading the render: ${e instanceof Error ? e.message : String(e)}`, ms: r.ms }
  }
}

/** A trace without wall-clock fields (`quality`), with HashMap-ordered `g` arrays sorted. */
export function normalizeTrace(text: string): string {
  const clean = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) {
      const items = v.map((x) => clean(x))
      return key === "g" ? items.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) : items
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) if (k !== "quality" && k !== "cpu_ms") out[k] = clean(x, k)
      return out
    }
    return v
  }
  return text.split("\n").filter(Boolean).map((l) => JSON.stringify(clean(JSON.parse(l)))).join("\n") + "\n"
}

async function renderTrace(tc: TraceCase, runtime: Runtime, file: string, o: GoldenOptions): Promise<{ ok: boolean; text?: string; error?: string }> {
  mkdirSync(dirname(file), { recursive: true })
  rmSync(file, { force: true })
  const timeout = tc.timeout ?? o.timeout
  const r = await exec([...tsCommand(tc.main, runtime), ...tc.args, "--trace", file], ROOT, tc.env, timeout)
  if (r.code !== 0 || r.timedOut || !existsSync(file)) {
    writeFileSync(`${file}.log`, `$ ${tc.args.join(" ")} --trace ${file}\n\n--- stderr\n${r.stderr}`)
    return { ok: false, error: `${runtime}: trace ${failure(r, timeout)}` }
  }
  try {
    return { ok: true, text: normalizeTrace(readFileSync(file, "utf8")) }
  } catch (e) {
    return { ok: false, error: `${runtime}: reading the trace: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// -------------------------------------------------------------------------------------------
// Filters

function globRe(glob: string): RegExp {
  return new RegExp(`^${glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
}

/** A filter selects a case when it equals the id, is a prefix ending at a `/` or `@`, or matches it as a glob. */
export function matchesFilter(filter: string, id: string): boolean {
  if (filter.includes("*")) return globRe(filter).test(id) || globRe(`${filter}/*`).test(id) || globRe(`${filter}@*`).test(id)
  return id === filter || id.startsWith(`${filter}/`) || id.startsWith(`${filter}@`)
}

const appOfFilter = (f: string) => f.split("/")[0]!

// -------------------------------------------------------------------------------------------
// Changes: what --update writes, what proposed/ holds, what --accept applies

type Changes = {
  /** Paths relative to test/golden: new contents, or null to delete. */
  files: Map<string, string | null>
  images: Image[]
}

function writeChanges(o: GoldenOptions, ch: Changes, store: ImageStore | undefined): string[] {
  const written: string[] = []
  for (const [p, content] of [...ch.files].sort(([a], [b]) => a.localeCompare(b))) {
    const file = rel(o, p)
    if (content === null) {
      if (existsSync(file)) { rmSync(file); written.push(`deleted ${p}`) }
      continue
    }
    if (readText(file) === content) continue
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
    written.push(`wrote ${p}`)
  }
  if (ch.images.length) {
    if (store?.available()) {
      const r = store.add(ch.images)
      written.push(`golden-images: ${r.added} new image${r.added === 1 ? "" : "s"} in the local branch${r.commit ? ` (${r.commit.slice(0, 10)})` : ""}`)
    } else {
      written.push(`golden-images: no git repository here; ${ch.images.length} images not stored`)
    }
  }
  return written
}

/** Writes a proposal: the changed files under proposed/, deletions in remove.txt, images under images/. */
function writeProposal(dir: string, ch: Changes): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const removed: string[] = []
  for (const [p, content] of ch.files) {
    if (content === null) { removed.push(p); continue }
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), content)
  }
  if (removed.length) writeFileSync(join(dir, "remove.txt"), `${removed.sort().join("\n")}\n`)
  for (const img of ch.images) {
    const f = join(dir, "images", img.platform, imageFile(img.hash))
    mkdirSync(dirname(f), { recursive: true })
    if (img.file) copyFileSync(img.file, f)
    else writeFileSync(f, img.png!)
  }
  writeFileSync(join(dir, "README.md"), [
    "# proposed golden baselines",
    "",
    "The trees, listings, traces and PNG manifest this run would bless, relative to test/golden/;",
    "remove.txt lists files to delete, images/<platform>/ the new PNGs for the golden-images branch.",
    "Apply with `bun scripts/golden.ts --accept <this directory>`, then review the git diff.",
    "",
  ].join("\n"))
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

function readProposal(dir: string): Changes {
  const ch: Changes = { files: new Map(), images: [] }
  for (const f of walk(dir)) {
    const p = relative(dir, f).split("\\").join("/")
    if (p === "README.md" || p === "remove.txt") continue
    if (p.startsWith("images/")) {
      const [, platform, file] = p.split("/")
      if (!platform || !file?.endsWith(".png")) continue
      const name = file.slice(0, -4)
      ch.images.push({ platform, hash: name.startsWith("rgba-") ? `rgba:${name.slice(5)}` : name, file: f })
      continue
    }
    if (!/^(trees|traces|listings|png)\//.test(p)) continue
    ch.files.set(p, readFileSync(f, "utf8"))
  }
  for (const p of (readText(join(dir, "remove.txt")) ?? "").split("\n").filter(Boolean)) ch.files.set(p, null)
  return ch
}

// -------------------------------------------------------------------------------------------
// The run

type Slot = { c: Case; runtime: Runtime; stem: string; r?: Rendered }

const emptyCounts = (): Record<CaseStatus, number> => ({ pass: 0, fail: 0, new: 0, flaky: 0, error: 0 })

/** Cases first that take longest, so the pool doesn't end on them. */
function weight(c: Case): number {
  const heavy = ["lab", "cursed-settings", "showreel"].includes(c.example) ? 4 : 0
  return heavy + (c.checkpoint ? 2 : 0)
}

/** Runs that don't render: --accept, --export-images, and --push-images or --gc-images without --update. */
const storeOnly = (o: GoldenOptions) => !!o.accept || !!o.exportImages || ((o.pushImages || o.gcImages) && !o.update)

export async function runGolden(over: Partial<GoldenOptions> = {}): Promise<GoldenReport> {
  const o = defaultGoldenOptions(over)
  const t0 = performance.now()
  const report: GoldenReport = {
    startedAt: new Date().toISOString(), ms: 0, tier: o.tier, runtimes: o.runtimes, platform: o.platform, png: o.png, update: o.update,
    ok: true, exit: 0, counts: emptyCounts(), cases: [], traces: [], listings: [], sanity: [], errors: [], skipped: [],
    notes: [...o.config.notes], written: [],
  }
  const store = new ImageStore(ROOT, o.log)
  const finish = (): GoldenReport => {
    report.ms = Math.round(performance.now() - t0)
    report.counts = emptyCounts()
    for (const c of report.cases) report.counts[c.status]++
    const failed = report.cases.some((c) => c.status !== "pass") || report.traces.some((t) => t.status !== "pass") ||
      report.sanity.length > 0 || report.listings.some((l) => l.status !== "same")
    report.exit = report.errors.length || report.cases.some((c) => c.status === "error") || report.traces.some((t) => t.status === "error")
      ? 2 : failed ? 1 : 0
    report.ok = report.exit === 0
    return report
  }

  // Store maintenance, --export-images and --accept don't render.
  if (storeOnly(o)) {
    if (o.accept) {
      const dir = resolve(o.accept)
      if (!existsSync(dir)) {
        report.errors.push(`--accept: no directory ${dir}`)
        return finish()
      }
      const ch = readProposal(dir)
      report.written.push(...writeChanges(o, ch, store))
      if (!report.written.length) report.written.push("nothing to accept: the proposal matches test/golden")
    }
    if (o.gcImages) {
      const referenced = new Map<string, Set<string>>()
      for (const f of walk(rel(o, "png")).filter((f) => f.endsWith(".json"))) {
        const m = JSON.parse(readFileSync(f, "utf8")) as Manifest
        referenced.set(m.platform, new Set(Object.values(m.cases)))
      }
      const r = store.gc(referenced, { push: !!store.remote() })
      report.written.push(r.message)
      if (r.missing.length) report.notes.push(`${r.missing.length} referenced images aren't in golden-images: ${r.missing.slice(0, 5).join(", ")}${r.missing.length > 5 ? ", ..." : ""}`)
    }
    if (o.pushImages) report.written.push(store.push().message)
    if (o.exportImages) {
      const m = readManifest(o)
      const dir = resolve(o.exportImages)
      if (!m) report.errors.push(`--export-images: no manifest ${rel(o, "png", `${o.platform}.json`)}`)
      else {
        const r = store.export(o.platform, Object.values(m.cases), dir, { fetch: o.fetchImages })
        report.written.push(`exported ${r.copied} ${o.platform} image${r.copied === 1 ? "" : "s"} to ${dir} (${r.present} already there)`)
        if (r.missing.length) report.notes.push(`${r.missing.length} of the manifest's images aren't in the local golden-images branch or the cache${o.fetchImages ? " or on origin" : "; --fetch-images gets them from origin"}`)
      }
    }
    return finish()
  }

  // 1. Listings, from the first runtime; compared with test/golden/listings/.
  const appFilters = o.filters.map(appOfFilter)
  const apps = goldenApps().filter((a) => !appFilters.length || appFilters.some((f) => matchesFilter(f, a.name)))
  if (!apps.length) {
    report.errors.push(`no app matches ${o.filters.join(", ")}`)
    return finish()
  }
  const listed = await pool(apps.map((a) => async () => {
    const ex = o.config.examples[a.name]
    if (ex?.skip) return { app: a.name, skip: ex.skip }
    return { app: a.name, ...(await listApp(tsCommand(a.main, o.runtimes[0]!), ROOT, ex?.args ?? [], ex?.env, o.timeout)) }
  }), o.jobs)
  const listings: Record<string, Listing> = {}
  for (const l of listed) {
    if ("skip" in l) continue
    if (!l.listing) {
      report.errors.push(`${l.app}: ${l.error}`)
      continue
    }
    listings[l.app] = l.listing
    const before = readText(rel(o, "listings", `${l.app}.txt`))
    if (before === undefined) report.listings.push({ example: l.app, status: "new", changes: ["no committed listing"] })
    else {
      const changes = listingChanges(parseListing(before), l.listing)
      report.listings.push({ example: l.app, status: changes.length ? "changed" : "same", changes })
    }
  }

  // 2. Cases.
  const expanded = expandCases({ config: o.config, listings, tier: o.tier, apps })
  report.skipped = expanded.skipped
  const selected = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !o.filters.length || o.filters.some((f) => matchesFilter(f, x.id)))
  // Every platform's ids (pruning must not drop another platform's cases), and this one's to render.
  const allIds = new Set([...selected(expanded.cases), ...selected(expanded.traces)].map((x) => x.id))
  const cases = selected(expanded.cases).filter(onThisPlatform)
  const traces = selected(expanded.traces).filter(onThisPlatform)
  for (const c of selected(expanded.cases).filter((c) => !onThisPlatform(c))) report.skipped.push({ id: c.id, reason: `only on ${c.platforms!.join(", ")}` })
  if (o.list) {
    for (const c of cases) console.log(c.id)
    for (const t of traces) console.log(`trace ${t.id}`)
    return finish()
  }
  if (!cases.length) {
    report.errors.push(`no cases in tier ${o.tier}${o.filters.length ? ` match ${o.filters.join(", ")}` : ""}`)
    return finish()
  }

  // 3. Render every case on every runtime, and the traces on the first.
  rmSync(o.out, { recursive: true, force: true })
  const work = join(o.out, ".work")
  const slots: Slot[] = o.runtimes.flatMap((runtime) => cases.map((c) => ({ c, runtime, stem: join(work, runtime, c.id) })))
  const order = [...slots].sort((a, b) => weight(b.c) - weight(a.c))
  const total = order.length + traces.length
  o.log(`golden: ${cases.length} cases × ${o.runtimes.join(", ")}${traces.length ? ` + ${traces.length} traces` : ""}, tier ${o.tier}, platform ${o.platform}${o.png ? "" : " (trees only)"}`)
  let done = 0, step = Math.max(25, Math.ceil(total / 10))
  const tick = () => { if (++done % step === 0 || done === total) o.log(`  ${done}/${total} rendered (${((performance.now() - t0) / 1000).toFixed(1)} s)`) }
  const traceOut: { text?: string; error?: string; ok: boolean }[] = new Array(traces.length)
  await pool<void>([
    ...order.map((s) => async () => { s.r = await renderCase(s.c, s.runtime, s.stem, o); tick() }),
    ...traces.map((t, i) => async () => { traceOut[i] = await renderTrace(t, o.runtimes[0]!, join(work, "traces", `${t.id}.jsonl`), o); tick() }),
  ], o.jobs)

  // 4. Compare with the baselines.
  const manifest = readManifest(o)
  if (o.png && !manifest && !o.update) report.notes.push(`no test/golden/png/${o.platform}.json: every PNG is new on this platform`)
  const first = o.runtimes[0]!
  const disagree = new Set<string>()
  const byId = new Map<string, Slot>()
  for (const s of slots) if (s.runtime === first) byId.set(s.c.id, s)
  for (const s of slots) {
    const r = s.r!
    const res: CaseResult = { id: s.c.id, runtime: s.runtime, status: "pass", tree: "unchecked", png: "unchecked", ms: r.ms }
    report.cases.push(res)
    if (!r.ok) {
      Object.assign(res, { status: "error", error: r.error, reason: r.log ? relative(ROOT, r.log) : undefined })
      continue
    }
    const exp = expected(o, "trees", s.c.id)
    if (exp.file) res.treeFile = exp.file
    if (exp.text === undefined) res.tree = "new"
    else if (exp.text === r.tree) res.tree = "same"
    else {
      res.tree = "changed"
      const d = compareTreeValues(parseNormalized(exp.text), parseNormalized(r.tree!), [], Infinity)
      res.treeDiffCount = d.count
      res.treeFields = summarizeDiffs(d.diffs)
      res.treeDiffs = d.diffs.slice(0, 8)
    }
    if (o.png) {
      res.hash = r.hash
      res.expectedHash = manifest?.cases[s.c.id]
      res.png = !res.expectedHash ? "new" : res.expectedHash === r.hash ? "same" : "changed"
    }
    const checks = [res.tree, res.png]
    res.status = checks.includes("changed") ? "fail" : checks.includes("new") ? "new" : "pass"
    // A second runtime must render what the first did, baseline or not.
    if (s.runtime !== first) {
      const f = byId.get(s.c.id)?.r
      if (f?.ok && (f.tree !== r.tree || f.hash !== r.hash)) {
        disagree.add(s.c.id)
        res.status = "fail"
        res.reason = `${s.runtime} renders differently from ${first} (${f.tree !== r.tree ? "tree" : "png"})`
      }
    }
  }

  // 5. Self-check: everything with --self-check; the changed and new cases before blessing or proposing.
  const firstResults = new Map(report.cases.filter((c) => c.runtime === first).map((c) => [c.id, c]))
  const changed = (id: string) => ["fail", "new"].includes(firstResults.get(id)?.status ?? "")
  const recheck = o.selfCheck ? cases : cases.filter((c) => changed(c.id))
  if (recheck.length) {
    o.log(`golden: self-check, rendering ${recheck.length} case${recheck.length === 1 ? "" : "s"} again`)
    const again = await pool(recheck.map((c) => () => renderCase(c, first, join(work, "again", c.id), o)), o.jobs)
    recheck.forEach((c, i) => {
      const a = again[i]!, r = byId.get(c.id)!.r!, res = firstResults.get(c.id)!
      if (!r.ok) return
      if (!a.ok) {
        Object.assign(res, { status: "error", error: `second render: ${a.error}` })
        return
      }
      if (a.tree !== r.tree || a.hash !== r.hash) {
        const d = compareTreeValues(parseNormalized(r.tree!), parseNormalized(a.tree!), [], 4)
        const fields = d.diffs.map((x) => x.path).join(", ")
        Object.assign(res, { status: "flaky", reason: `output varies between two renders (${a.tree !== r.tree ? `tree: ${fields}` : "png"}); mask it in test/golden/config.ts` })
      }
    })
  }

  // 6. Traces.
  traces.forEach((t, i) => {
    const r = traceOut[i]!
    if (!r.ok) return report.traces.push({ id: t.id, status: "error", error: r.error })
    const exp = expected(o, "traces", t.id)
    const status: CaseStatus = exp.text === undefined ? "new" : exp.text === r.text ? "pass" : "fail"
    const res: TraceResult = { id: t.id, status, bytes: r.text!.length }
    if (status === "fail") res.diffCount = diffLines(exp.text!, r.text!)
    report.traces.push(res)
    if (r.text!.length > 50_000) report.notes.push(`trace ${t.id} is ${(r.text!.length / 1000).toFixed(0)} KB: keep traces for short scripts (under 50 KB)`)
  })

  // 7. Sanity checks on the first runtime's renders.
  sanity(o, cases, byId, report)

  // 8. Bless, or propose.
  const ch = changes(o, cases, traces, traceOut, byId, firstResults, listings, manifest, disagree, allIds)
  if (o.update) {
    const blocked = report.cases.filter((c) => c.runtime === first && (c.status === "flaky" || c.status === "error"))
    if (blocked.length) report.notes.push(`--update left ${blocked.length} flaky or failing case${blocked.length === 1 ? "" : "s"} unblessed`)
    report.written.push(...writeChanges(o, ch, store))
    if (o.pushImages) report.written.push(store.push().message)
    // What --update wrote is now the baseline: it passes unless a case couldn't be blessed.
    for (const c of report.cases) if ((c.status === "new" || c.status === "fail") && !disagree.has(c.id)) c.status = "pass"
    for (const t of report.traces) if (t.status === "new" || t.status === "fail") t.status = "pass"
    for (const l of report.listings) l.status = "same"
  }
  finish()
  mkdirSync(o.out, { recursive: true })
  if (!report.ok && !o.update) {
    if (ch.files.size || ch.images.length) {
      writeProposal(join(o.out, "proposed"), ch)
      report.written.push(`proposed: ${relative(ROOT, join(o.out, "proposed"))} (apply with --accept)`)
    }
    artifacts(o, slots, report, manifest, store)
  }
  const summary = formatSummary(report, o)
  if (!report.ok) writeFileSync(join(o.out, "summary.md"), summary)
  if (o.summary) appendFileSync(o.summary, report.ok ? `golden (${o.platform}, ${o.tier}): ${report.cases.length} renders pass\n\n` : summary)
  writeFileSync(join(o.out, "report.json"), JSON.stringify(report, null, 2))
  return report
}

function diffLines(a: string, b: string): number {
  const x = a.split("\n"), y = b.split("\n")
  let n = Math.abs(x.length - y.length)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++
  return n
}

/** The element and accessibility lines of a normalized tree (without line 1: t, title, ...). */
const body = (tree?: string) => tree?.slice(tree.indexOf("\n") + 1)

function sanity(o: GoldenOptions, cases: Case[], byId: Map<string, Slot>, report: GoldenReport): void {
  const groups = new Map<string, Case[]>()
  for (const c of cases) {
    if (!groups.has(c.group)) groups.set(c.group, [])
    groups.get(c.group)!.push(c)
  }
  for (const [group, list] of groups) {
    const rendered = list.map((c) => ({ c, r: byId.get(c.id)?.r })).filter((x) => x.r?.ok)
    if (list[0]!.groupKind === "scenes") {
      const named = rendered.filter((x) => x.c.scene !== NO_SCENE)
      if (named.length >= 2 && new Set(named.map((x) => `${x.r!.tree}\0${x.r!.hash}`)).size === 1) {
        report.sanity.push(`${group}: all ${named.length} scenes render identically; is ${o.config.sceneFlag} ignored?`)
      }
      continue
    }
    for (let i = 1; i < rendered.length; i++) {
      const a = rendered[i - 1]!, b = rendered[i]!
      if (body(a.r!.tree) === body(b.r!.tree) && a.r!.hash === b.r!.hash) {
        report.sanity.push(`${group}: checkpoints ${a.c.checkpoint} and ${b.c.checkpoint} render identically; does the script still reach its targets?`)
      }
    }
    const keys = new Set(rendered.flatMap((x) => [...(x.r!.keys ?? [])]))
    const paths = [...keys]
    for (const k of list[0]!.scriptKeys ?? []) {
      if (rendered.length && !keys.has(k) && !paths.some((p) => p.endsWith(`/${k}`))) {
        report.sanity.push(`${group}: the script targets "${k}", which no checkpoint's tree has`)
      }
    }
  }
}

/** What blessing this run would change: trees and overrides, traces, listings, the manifest, new images. */
function changes(o: GoldenOptions, cases: Case[], traces: TraceCase[], traceOut: { text?: string; ok: boolean }[],
  byId: Map<string, Slot>, results: Map<string, CaseResult>, listings: Record<string, Listing>, manifest: Manifest | undefined,
  disagree: Set<string>, allIds: Set<string>): Changes {
  const ch: Changes = { files: new Map(), images: [] }
  const primary = process.platform === o.config.treePrimary
  const os = process.platform
  const put = (dir: "trees" | "traces", id: string, text: string) => {
    const shared = `${dir}/${id}.jsonl`, override = `${dir}/${id}.${os}.jsonl`
    const sharedText = readText(rel(o, shared))
    if (primary || sharedText === undefined) {
      ch.files.set(shared, text)
      if (existsSync(rel(o, override))) ch.files.set(override, null)
    } else if (sharedText === text) {
      if (existsSync(rel(o, override))) ch.files.set(override, null)
    } else ch.files.set(override, text)
  }
  const next: Manifest = { platform: o.platform, env: manifest?.env ?? {}, cases: { ...manifest?.cases } }
  let pngChanged = !manifest && o.png
  for (const c of cases) {
    const res = results.get(c.id)
    const r = byId.get(c.id)?.r
    if (!res || !r?.ok || res.status === "flaky" || res.status === "error" || disagree.has(c.id)) continue
    if (res.tree !== "same") put("trees", c.id, r.tree!)
    if (o.png && res.png !== "same" && r.hash) {
      next.cases[c.id] = r.hash
      pngChanged = true
      ch.images.push({ platform: o.platform, hash: r.hash, file: r.pngFile! })
    }
  }
  traces.forEach((t, i) => {
    const r = traceOut[i]
    if (r?.ok && r.text !== expected(o, "traces", t.id).text) put("traces", t.id, r.text!)
  })
  for (const [app, l] of Object.entries(listings)) {
    const text = formatListing(l)
    if (readText(rel(o, "listings", `${app}.txt`)) !== text) ch.files.set(`listings/${app}.txt`, text)
  }
  // A full, unfiltered run knows every case: drop baselines of cases that are gone. Only the
  // tree-primary platform drops shared files; another drops its own overrides.
  if (o.update && o.tier === "full" && !o.filters.length) {
    const ids = new Set(cases.map((c) => c.id))
    for (const id of Object.keys(next.cases)) if (!ids.has(id)) { delete next.cases[id]; pngChanged = true }
    for (const dir of ["trees", "traces"] as const) {
      for (const f of walk(rel(o, dir))) {
        const p = relative(rel(o, dir), f).split("\\").join("/")
        const m = /^(.*?)(?:\.(darwin|linux|win32))?\.jsonl$/.exec(p)
        if (!m || allIds.has(m[1]!)) continue
        if (primary || m[2] === os) ch.files.set(`${dir}/${p}`, null)
      }
    }
    for (const f of walk(rel(o, "listings"))) {
      const app = relative(rel(o, "listings"), f).replace(/\.txt$/, "")
      if (!listings[app]) ch.files.set(`listings/${app}.txt`, null)
    }
  }
  if (pngChanged && o.png) {
    next.env = platformEnv(o.runtimes)
    ch.files.set(`png/${o.platform}.json`, formatManifest(next))
  }
  return ch
}

/** out/golden/<case>/: actual.png, expected.png and diff.png (when the store has it), tree.diff.txt. */
function artifacts(o: GoldenOptions, slots: Slot[], report: GoldenReport, manifest: Manifest | undefined, store: ImageStore): void {
  const bySlot = new Map(slots.map((s) => [`${s.runtime}\0${s.c.id}`, s]))
  const first = o.runtimes[0]!
  let missingImages = 0
  for (const res of report.cases) {
    if (res.status === "pass" || res.status === "error") continue
    const s = bySlot.get(`${res.runtime}\0${res.id}`)!
    const r = s.r!
    const dir = join(o.out, res.id)
    const pre = res.runtime === first ? "" : `${res.runtime}.`
    mkdirSync(dir, { recursive: true })
    if (r.pngFile) copyFileSync(r.pngFile, join(dir, `${pre}actual.png`))
    writeFileSync(join(dir, `${pre}actual.jsonl`), r.tree!)
    const exp = expected(o, "trees", res.id).text
    if (exp !== undefined && exp !== r.tree) {
      writeFileSync(join(dir, `${pre}expected.jsonl`), exp)
      const lines = [
        `${res.id} [${res.runtime}]: ${res.treeDiffCount} tree difference${res.treeDiffCount === 1 ? "" : "s"}${res.treeFile ? ` (expected: ${res.treeFile})` : ""}`,
        ...(res.treeFields ?? []).map((f) => `  ${f.field}: ${f.count} ${f.kind}`),
        "",
        ...(res.treeDiffs ?? []).map((d) => `${d.path}: ${show(d.rust)} -> ${show(d.ts)}`),
        "",
        lineDiff(join(dir, `${pre}expected.jsonl`), join(dir, `${pre}actual.jsonl`)),
      ]
      writeFileSync(join(dir, `${pre}tree.diff.txt`), lines.join("\n"))
    }
    if (o.png && res.png === "changed" && manifest?.cases[res.id] && r.pngFile) {
      const img = store.get(o.platform, manifest.cases[res.id]!, { fetch: o.fetchImages })
      if (!img) { missingImages++; continue }
      writeFileSync(join(dir, `${pre}expected.png`), img)
      try {
        const d = comparePng(img, readFileSync(r.pngFile), join(dir, `${pre}diff.png`), {})
        if (d.bbox) res.reason = [res.reason, `${d.pixels} px differ (max Δ${d.maxDelta}) in ${d.bbox.join(",")}`].filter(Boolean).join("; ")
        else if (d.rustSize && d.tsSize) res.reason = [res.reason, `size ${d.rustSize.join("x")} -> ${d.tsSize.join("x")}`].filter(Boolean).join("; ")
      } catch {}
    }
  }
  if (missingImages) {
    // Without a repository only the cache was read (golden-linux.sh fills it with --export-images).
    const repo = store.available()
    const where = repo ? "the local golden-images branch or the cache" : `the cache (${cacheDir()}; no git repository here)`
    const hint = !repo ? "" : o.fetchImages ? " or on origin" : "; --fetch-images gets them from origin"
    report.notes.push(`${missingImages} expected image${missingImages === 1 ? " isn't" : "s aren't"} in ${where}${hint}`)
  }
}

/** A unified diff of two files in the same directory, with short names. */
function lineDiff(a: string, b: string): string {
  const p = Bun.spawnSync(["git", "diff", "--no-index", "--no-color", "-U1", "--", basename(a), basename(b)], { cwd: dirname(a), stdout: "pipe", stderr: "pipe" })
  const text = p.stdout.toString()
  const lines = text.split("\n")
  return lines.length > 400 ? `${lines.slice(0, 400).join("\n")}\n... ${lines.length - 400} more lines` : text
}

function show(v: unknown): string {
  const s = v === undefined ? "(absent)" : JSON.stringify(v)
  return s.length > 80 ? `${s.slice(0, 77)}...` : s
}

// -------------------------------------------------------------------------------------------
// Reporting

function formatSummary(r: GoldenReport, o: GoldenOptions): string {
  const out = [`## golden: ${r.ok ? "pass" : r.exit === 2 ? "error" : "FAILED"} (${r.platform}, tier ${r.tier}, ${r.runtimes.join(", ")})`, ""]
  const c = r.counts
  out.push(`${r.cases.length} renders: ${Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ")} in ${(r.ms / 1000).toFixed(1)} s`, "")
  if (r.errors.length) out.push("**Errors**", "", ...r.errors.map((e) => `- ${e}`), "")
  if (r.sanity.length) out.push("**Sanity checks**", "", ...r.sanity.map((e) => `- ${e}`), "")
  const lst = r.listings.filter((l) => l.status !== "same")
  if (lst.length) out.push("**Listings**", "", ...lst.map((l) => `- ${l.example}: ${l.changes.join("; ")}`), "")
  const bad = r.cases.filter((x) => x.status !== "pass")
  if (bad.length) {
    // Grouped by field across cases: one line for "rect changed in 1,240 elements across 41 cases".
    const fields = new Map<string, { n: number; cases: number }>()
    for (const x of bad) for (const f of x.treeFields ?? []) {
      const k = `${f.field} ${f.kind}`
      const v = fields.get(k) ?? { n: 0, cases: 0 }
      v.n += f.count; v.cases++
      fields.set(k, v)
    }
    if (fields.size) {
      out.push("**Tree changes by field**", "")
      for (const [k, v] of [...fields].sort((a, b) => b[1].cases - a[1].cases)) out.push(`- ${k} in ${v.n.toLocaleString("en")} places across ${v.cases} case${v.cases === 1 ? "" : "s"}`)
      out.push("")
    }
    out.push("| case | runtime | status | tree | png | detail |", "| --- | --- | --- | --- | --- | --- |")
    for (const x of bad.slice(0, 200)) {
      const tree = x.tree === "changed" ? `${x.treeDiffCount} diffs` : x.tree
      const detail = (x.error ?? x.reason ?? (x.treeDiffs?.[0] ? `${x.treeDiffs[0].path}: ${show(x.treeDiffs[0].rust)} -> ${show(x.treeDiffs[0].ts)}` : "")).replace(/\|/g, "\\|")
      out.push(`| ${x.id} | ${x.runtime} | ${x.status} | ${tree} | ${x.png} | ${detail} |`)
    }
    if (bad.length > 200) out.push(`| ... ${bad.length - 200} more | | | | | |`)
    out.push("")
  }
  const tr = r.traces.filter((t) => t.status !== "pass")
  if (tr.length) out.push("**Traces**", "", ...tr.map((t) => `- ${t.id}: ${t.status}${t.error ? `: ${t.error}` : t.diffCount ? ` (${t.diffCount} lines differ)` : ""}`), "")
  if (r.notes.length) out.push("**Notes**", "", ...r.notes.map((n) => `- ${n}`), "")
  if (!r.ok && !r.update) {
    out.push("Diffs: `out/golden/<case>/` (actual.png, expected.png, diff.png, tree.diff.txt).", "",
      "To bless after review: `bun scripts/golden.ts --update` on this platform, or",
      `\`bun scripts/golden.ts --accept ${relative(ROOT, join(o.out, "proposed"))}\` with this run's proposal.`, "")
  }
  return out.join("\n")
}

function formatConsole(r: GoldenReport, o: GoldenOptions): string {
  const out: string[] = []
  const bad = r.cases.filter((x) => x.status !== "pass")
  for (const x of bad.slice(0, 60)) {
    const what = x.error ?? x.reason ?? [x.tree !== "same" && x.tree !== "unchecked" ? `tree ${x.tree}${x.treeDiffCount ? ` (${x.treeDiffCount})` : ""}` : "", x.png !== "same" && x.png !== "unchecked" ? `png ${x.png}` : ""].filter(Boolean).join(", ")
    out.push(`${x.status.padEnd(5)} ${x.id}${o.runtimes.length > 1 ? ` [${x.runtime}]` : ""}: ${what}`)
    for (const d of (x.treeDiffs ?? []).slice(0, 3)) out.push(`        ${d.path}: ${show(d.rust)} -> ${show(d.ts)}`)
  }
  if (bad.length > 60) out.push(`... ${bad.length - 60} more (out/golden/report.json)`)
  for (const t of r.traces.filter((t) => t.status !== "pass")) out.push(`${t.status.padEnd(5)} trace ${t.id}${t.error ? `: ${t.error}` : ""}`)
  for (const l of r.listings.filter((l) => l.status !== "same")) out.push(`fail  listing ${l.example}: ${l.changes.join("; ")}`)
  for (const s of r.sanity) out.push(`fail  sanity: ${s}`)
  for (const e of r.errors) out.push(`error ${e}`)
  for (const w of r.written) out.push(w)
  for (const n of r.notes.filter((n) => !o.config.notes.includes(n))) out.push(`note: ${n}`)
  if (storeOnly(o)) {
    out.push(`golden ${o.accept ? "--accept" : "image store"}: ${r.ok ? "done" : "ERROR"}`)
    return out.join("\n")
  }
  const counts = Object.entries(r.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ")
  out.push(`golden ${r.platform} tier ${r.tier}: ${r.cases.length} renders${counts ? ` (${counts})` : ""}${r.traces.length ? `, ${r.traces.length} traces` : ""} in ${(r.ms / 1000).toFixed(1)} s: ${r.ok ? "pass" : r.exit === 2 ? "ERROR" : "FAILED"}`)
  if (!r.ok && !r.update && r.exit !== 2) out.push(`summary: ${relative(process.cwd(), join(o.out, "summary.md"))}`)
  return out.join("\n")
}

// -------------------------------------------------------------------------------------------
// CLI

const HELP = `usage: bun scripts/golden.ts [options] [filters...]

Renders the examples and fixtures headless and checks trees, PNG hashes, traces and listings
against test/golden/. Filters are case-id prefixes or globs: hello, kit-gallery/main/base,
'*/light/*'. Exit 0 pass, 1 mismatch or sanity failure, 2 harness or tooling error.

  --tier T          quick (default), standard or full
  --runtime R       bun, node or bun,node (default bun; full: bun,node)
  --platform KEY    PNG manifest key (default ${defaultPlatform()}; RUNEX_GOLDEN_PLATFORM)
  --no-png          trees only: no --snap, no manifest
  --self-check      render every case twice; varying output fails ("flaky")
  --update          bless: rewrite this platform's trees, listings, traces and manifest, and add
                    new PNGs to the local golden-images branch (changed cases are self-checked)
  --push-images     push golden-images to origin (with --update or --accept, or alone)
  --gc-images       rebuild golden-images with only the referenced images (force-pushed with a remote)
  --accept DIR      apply a proposal (out/golden/proposed, a CI artifact, Docker's) without rendering
  --fetch-images    on failure, fetch expected PNGs from origin's golden-images (partial fetch)
  --export-images DIR
                    copy the PNGs this platform's manifest names into DIR/<platform>/, without
                    rendering: a cache (RUNEX_GOLDEN_CACHE=DIR) for a copy without .git, such as
                    scripts/golden-linux.sh's Docker run
  --golden DIR      the baselines (default test/golden; golden-linux.sh passes its --tree's)
  --jobs N          renders at once (default ${defaultGoldenOptions().jobs})
  --timeout S       seconds per render (default 120)
  --out DIR         results (default out/golden)
  --summary FILE    append the markdown summary to FILE (e.g. $GITHUB_STEP_SUMMARY)
  --list            print the case ids and exit`

export function parseGoldenArgs(argv: string[]): Partial<GoldenOptions> {
  const o: Partial<GoldenOptions> & { filters: string[] } = { filters: [] }
  const usage = (msg: string): never => {
    console.error(`${msg}\n\n${HELP}`)
    process.exit(2)
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const val = () => argv[++i] ?? usage(`${a} needs a value`)
    switch (a) {
      case "--tier": {
        const t = val()
        if (t !== "quick" && t !== "standard" && t !== "full") usage(`unknown tier ${t}`)
        o.tier = t as Tier
        break
      }
      case "--runtime": {
        const rts = val().split(",").map((s) => s.trim()).filter(Boolean)
        for (const r of rts) if (r !== "bun" && r !== "node") usage(`unknown runtime ${r}`)
        o.runtimes = rts as Runtime[]
        break
      }
      case "--platform": o.platform = val(); break
      case "--no-png": o.png = false; break
      case "--self-check": o.selfCheck = true; break
      case "--update": o.update = true; break
      case "--push-images": o.pushImages = true; break
      case "--gc-images": o.gcImages = true; break
      case "--accept": o.accept = val(); break
      case "--fetch-images": o.fetchImages = true; break
      case "--export-images": o.exportImages = val(); break
      case "--golden": o.golden = resolve(val()); break
      case "--jobs": o.jobs = Math.max(1, Number(val()) || 1); break
      case "--timeout": o.timeout = Number(val()) || 120; break
      case "--out": o.out = resolve(val()); break
      case "--summary": o.summary = resolve(val()); break
      case "--list": o.list = true; break
      case "-h": case "--help": console.log(HELP); process.exit(0)
      default:
        if (a.startsWith("-")) usage(`unknown option ${a}`)
        o.filters.push(a.replace(/\/+$/, ""))
    }
  }
  if (o.tier === "full" && !o.runtimes) o.runtimes = ["bun", "node"]
  return o
}

async function main() {
  const over = parseGoldenArgs(process.argv.slice(2))
  let report: GoldenReport
  try {
    report = await runGolden(over)
  } catch (e) {
    console.error(`golden: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
    process.exit(2)
  }
  if (!over.list) console.log(formatConsole(report, defaultGoldenOptions(over)))
  process.exit(report.exit)
}

if (import.meta.main) await main()
