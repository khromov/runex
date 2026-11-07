// The PNG platform key and the environment a manifest records.
//
// The key is `${os}-${arch}-${backend}`: darwin-arm64-metal, linux-arm64-lavapipe,
// win32-arm64-warp. macOS in CI gets `-ci` (its GPU is paravirtual, so its pixels are its own).
// RUNEX_GOLDEN_PLATFORM overrides the key; so does `--platform`.

import { existsSync, readdirSync } from "node:fs"
import { cpus, release } from "node:os"
import { RUNE } from "../lib/proc.ts"

function linuxBackend(): string {
  const icd = process.env.VK_ICD_FILENAMES ?? process.env.VK_DRIVER_FILES ?? ""
  if (/lvp/.test(icd)) return "lavapipe"
  if (icd) return "vulkan"
  // No GPU driver but Mesa's software one installed: wgpu ends up on lavapipe.
  const dir = "/usr/share/vulkan/icd.d"
  const drivers = existsSync(dir) ? readdirSync(dir) : []
  return drivers.length > 0 && drivers.every((d) => d.startsWith("lvp")) ? "lavapipe" : "vulkan"
}

export function defaultPlatform(): string {
  if (process.env.RUNEX_GOLDEN_PLATFORM) return process.env.RUNEX_GOLDEN_PLATFORM
  const os = process.platform
  const backend = os === "darwin" ? "metal" : os === "linux" ? linuxBackend() : os === "win32" ? "warp" : "gpu"
  const ci = os === "darwin" && process.env.CI ? "-ci" : ""
  return `${os}-${process.arch}-${backend}${ci}`
}

function run(cmd: string[], cwd?: string): string | undefined {
  try {
    const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
    return p.exitCode === 0 ? p.stdout.toString().trim() : undefined
  } catch {
    return undefined
  }
}

/** What a manifest records about the machine that wrote it. */
export function platformEnv(runtimes: string[]): Record<string, string> {
  const env: Record<string, string> = {
    os: `${process.platform} ${release()} ${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
  }
  if (process.platform === "linux") {
    const mesa = run(["dpkg-query", "-W", "-f=${Version}", "mesa-vulkan-drivers"])
    if (mesa) env.mesa = mesa
    const distro = run(["sh", "-c", ". /etc/os-release && echo \"$PRETTY_NAME\""])
    if (distro) env.distro = distro
  }
  if (runtimes.includes("bun")) env.bun = Bun.version
  if (runtimes.includes("node")) env.node = run(["node", "--version"])?.replace(/^v/, "") ?? "unknown"
  // In a copy without .git (scripts/golden-linux.sh), the host passes the revision.
  const rune = process.env.RUNEX_GOLDEN_RUNE_REV ?? run(["git", "rev-parse", "HEAD"], RUNE)
  if (rune) env.rune = rune.slice(0, 12)
  return env
}
