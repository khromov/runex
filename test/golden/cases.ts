// Expands test/golden/config.ts and the apps' listings into the cases scripts/golden.ts renders.
//
//   const { cases, traces, skipped } = expandCases({ config, listings, tier: "standard" })
//
// The examples are the ported ones (examples/<name>/main.ts with a vendor/rune twin); the
// fixtures are test/golden/fixtures/<name>.ts, as `fixture-<name>`. Listings map each app to its
// windows and their scenes (scripts/lib/discover.ts `listApp`). A case renders one window and
// scene with `--snap` and `--tree`, plus its variant's arguments, or replays a script to one
// checkpoint (`--at`). Ids are stable: `<example>/<window>/<variant>/<scene>[@<checkpoint>]`.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileStem, type Listing, NO_SCENE, portedExamples, portPath } from "../../scripts/lib/discover.ts"
import type { GoldenConfig, Mask, Tier } from "./config.ts"

export const GOLDEN = resolve(import.meta.dir)
export const FIXTURES = join(GOLDEN, "fixtures")
export const SCRIPTS = join(GOLDEN, "scripts")
export const FIXTURE_PREFIX = "fixture-"

const TIERS: Tier[] = ["quick", "standard", "full"]
export const inTier = (caseTier: Tier, run: Tier) => TIERS.indexOf(caseTier) <= TIERS.indexOf(run)

export type Case = {
  id: string
  example: string
  /** The entry point: examples/<name>/main.ts or test/golden/fixtures/<name>.ts. */
  main: string
  window: string
  scene: string
  /** "base", a variant's name or a script case's name. */
  variant: string
  checkpoint?: string
  /** Rune and app arguments, without --snap and --tree. */
  args: string[]
  tier: Tier
  masks: Mask[]
  /** Absolute path of the replayed script. */
  script?: string
  /** Keys and paths the script targets: each must be in one of the case's trees. */
  scriptKeys?: string[]
  /** Cases of a scene group render one window and variant across scenes; a checkpoint group is one script's checkpoints, in order. */
  group: string
  groupKind: "scenes" | "checkpoints"
  env?: Record<string, string>
  timeout?: number
  /** Only rendered on these OSes (every OS when absent). */
  platforms?: NodeJS.Platform[]
}

/** The normalized `--trace` of a whole scripted run. */
export type TraceCase = {
  id: string; example: string; main: string; args: string[]; tier: Tier; env?: Record<string, string>; timeout?: number; platforms?: NodeJS.Platform[]
}

/** Whether a case renders on this OS. */
export const onThisPlatform = (c: { platforms?: NodeJS.Platform[] }) => !c.platforms || c.platforms.includes(process.platform)

export type Expanded = { cases: Case[]; traces: TraceCase[]; skipped: { id: string; reason: string }[] }

/** Every app golden renders: the ported examples, then the fixtures. */
export function goldenApps(): { name: string; main: string }[] {
  const fixtures = existsSync(FIXTURES)
    ? readdirSync(FIXTURES).filter((f) => f.endsWith(".ts")).sort().map((f) => ({ name: FIXTURE_PREFIX + f.slice(0, -3), main: join(FIXTURES, f) }))
    : []
  const examples = portedExamples()
  // Without the vendor/rune submodule no example counts as ported, and every example case would
  // drop out of the run without a word: a check that passes on fixtures alone.
  if (!examples.length) throw new Error("golden: no ported examples found: is the vendor/rune submodule checked out? (git submodule update --init)")
  return [...examples.map((name) => ({ name, main: portPath(name) })), ...fixtures]
}

export const isFixture = (name: string) => name.startsWith(FIXTURE_PREFIX)

const checkpointStem = (c: string) => c.replace(/:/g, "-").replace(/[^\w.@+-]+/g, "_")

export function caseId(example: string, window: string, variant: string, scene: string, checkpoint?: string): string {
  return `${example}/${fileStem(window)}/${variant}/${fileStem(scene)}${checkpoint ? `@${checkpointStem(checkpoint)}` : ""}`
}

/** The keys and paths a script's events target. */
export function scriptKeys(file: string): string[] {
  const raw = JSON.parse(readFileSync(file, "utf8"))
  const events: any[] = Array.isArray(raw) ? raw : raw.events ?? []
  const keys = new Set<string>()
  for (const e of events) {
    for (const k of [e?.key, e?.drag_files?.key, e?.drop_files?.key]) if (typeof k === "string") keys.add(k)
  }
  return [...keys]
}

export function expandCases(o: { config: GoldenConfig; listings: Record<string, Listing>; tier: Tier; apps?: { name: string; main: string }[] }): Expanded {
  const { config, listings, tier } = o
  const apps = o.apps ?? goldenApps()
  const cases: Case[] = []
  const traces: TraceCase[] = []
  const skipped: { id: string; reason: string }[] = []
  const flag = config.sceneFlag

  for (const app of apps) {
    const ex = config.examples[app.name] ?? {}
    const listing = listings[app.name]
    if (ex.skip) {
      skipped.push({ id: `${app.name}/*`, reason: ex.skip })
      continue
    }
    if (!listing) continue
    const multi = listing.windows.length > 1
    const masks = ex.masks ?? []
    const common = { example: app.name, main: app.main, masks, env: ex.env, timeout: ex.timeout }

    const render = (window: string, scene: string, variant: string, variantArgs: string[], caseTier: Tier) => {
      const id = caseId(app.name, window, variant, scene)
      const sc = ex.scenes?.[scene]
      if (sc?.skip) return skipped.push({ id, reason: sc.skip })
      cases.push({
        ...common, id, window, scene, variant, tier: caseTier,
        args: [...(multi ? ["--window", window] : []), ...(scene === NO_SCENE ? [] : [flag, scene]), ...(ex.args ?? []), ...(sc?.args ?? []), ...variantArgs],
        group: `${app.name}/${fileStem(window)}/${variant}`, groupKind: "scenes",
      })
    }

    // Base: every window × (none and each scene); quick takes (none) and the first scene.
    for (const w of listing.windows) {
      const scenes = listing.scenes[w] ?? []
      ;[NO_SCENE, ...scenes].forEach((scene, i) => {
        render(w, scene, "base", [], isFixture(app.name) || i <= 1 ? "quick" : "standard")
      })
    }

    // Variants (full tier).
    for (const v of config.variants) {
      const pick = v.examples[app.name] ?? v.examples["*"]
      if (!pick) continue
      for (const w of listing.windows) {
        const all = [NO_SCENE, ...(listing.scenes[w] ?? [])]
        const scenes = (pick === "all" ? all : pick.filter((s) => all.includes(s))).filter((s) => !v.except?.[app.name]?.includes(s))
        if (pick !== "all") {
          for (const s of pick.filter((s) => !all.includes(s))) skipped.push({ id: caseId(app.name, w, v.name, s), reason: `no scene ${s} in the listing` })
        }
        for (const scene of scenes) render(w, scene, v.name, v.args, "full")
      }
    }

    // Scripted and timed cases.
    for (const s of config.scripts.filter((s) => s.example === app.name)) {
      const window = s.window ?? listing.windows[0]!
      const scene = s.scene ?? NO_SCENE
      const script = s.script ? join(SCRIPTS, s.script) : undefined
      const base = [
        ...(multi ? ["--window", window] : []), ...(scene === NO_SCENE ? [] : [flag, scene]), ...(ex.args ?? []), ...config.scriptArgs,
        ...(s.args ?? []), ...(script ? ["--script", script] : []),
      ]
      const timeout = s.timeout ?? Math.max(ex.timeout ?? 0, config.scriptTimeout)
      const keys = script && existsSync(script) ? scriptKeys(script) : undefined
      for (const cp of s.checkpoints) {
        cases.push({
          ...common, id: caseId(app.name, window, s.name, scene, cp), window, scene, variant: s.name, checkpoint: cp, tier: s.tier,
          args: [...base, "--at", cp], script, scriptKeys: keys, timeout, platforms: s.platforms,
          group: caseId(app.name, window, s.name, scene), groupKind: "checkpoints",
        })
      }
      if (s.trace && script) traces.push({ ...common, id: caseId(app.name, window, s.name, scene), args: base, tier: s.tier, timeout, platforms: s.platforms })
    }
  }

  const seen = new Set<string>()
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`two cases share the id ${c.id}: rename a scene or variant`)
    seen.add(c.id)
  }
  return {
    cases: cases.filter((c) => inTier(c.tier, tier)),
    traces: traces.filter((t) => inTier(t.tier, tier)),
    skipped,
  }
}
