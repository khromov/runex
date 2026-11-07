// The environment the harness starts renders with: this process's, without the variables runex
// reads that change what an app draws. A shell's RUNEX_PERF or RUNEX_TITLEBAR would otherwise
// reach every render a test, golden.ts or compare.ts starts. A test that checks one sets it for
// that run. Plain TypeScript, no Bun APIs: test/unit/lib/spawn.ts loads it under Node too.
//
//   Bun.spawn(cmd, { env: renderEnv({ FIXTURE_MS: "50" }) })

/** RUNEX_PERF adds the performance overlay; RUNEX_TITLEBAR changes the frame and `cx.titlebar_inset()`. */
export const RENDER_VARS: readonly string[] = ["RUNEX_PERF", "RUNEX_TITLEBAR"]

/**
 * This process's environment without RENDER_VARS and `drop`, then `set` (an undefined value
 * removes that variable).
 */
export function renderEnv(set: Record<string, string | undefined> = {}, drop: readonly string[] = []): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !RENDER_VARS.includes(k) && !drop.includes(k)) env[k] = v
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return env
}
