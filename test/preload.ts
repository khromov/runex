// Loaded before every `bun test` file (bunfig.toml): the variables that change what runex draws
// (scripts/lib/env.ts) leave this process's environment. Runs in this process read RUNEX_TITLEBAR
// as runex loads and RUNEX_PERF as an app starts, and every process a test starts inherits them,
// so a shell's settings would change trees and PNGs. A test that checks one sets it for that run.
import { RENDER_VARS } from "../scripts/lib/env.ts"

for (const k of RENDER_VARS) delete process.env[k]
