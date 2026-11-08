// The environment for every render a test spawns: without RUNEX_PERF and RUNEX_TITLEBAR, which
// change what an app draws (runex's scripts/lib/env.ts does the same for its own renders).
export function render_env(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUNEX_PERF" && k !== "RUNEX_TITLEBAR") env[k] = v
  return env
}
