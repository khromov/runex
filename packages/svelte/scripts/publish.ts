// `bun scripts/publish.ts pack [dest]` / `bun scripts/publish.ts publish [npm publish flags]`.
//
// What npm gets differs from the repo in three ways, so the package is staged in a temporary
// directory rather than packed in place:
// - Node refuses to strip types under node_modules, so src/*.ts is compiled to lib/*.js with
//   declarations beside it, and `exports` points there. The components ship as .svelte source
//   (the consumer's loader compiles them), with their `../x.ts` imports pointed at `../x.js`.
// - svelte is the custom-renderer build in vendor/, bundled (`bundleDependencies`), because the
//   registry has no such build. The workspace hoists it, so the stage installs it next to the
//   package itself, and the published manifest names a registry range (Bun refuses a `file:`
//   spec in a published manifest even when the bundle is there).
// - runex-js is a peer, installed by the app: two copies of the addon in one process would not
//   share classes.
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PUBLISHED_SVELTE = ">=5.56.0"
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const REPO = join(ROOT, "../..")

const [command, ...rest] = process.argv.slice(2)
if (command !== "pack" && command !== "publish") {
  console.error("usage: publish.ts pack [dest] | publish.ts publish [npm publish flags]")
  process.exit(2)
}

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`)
}

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
const vendored = readdirSync(join(ROOT, "vendor")).filter((f) => f.endsWith(".tgz"))
if (vendored.length !== 1) throw new Error(`expected one tarball in vendor/, found ${vendored.length}`)
if (manifest.dependencies.svelte !== `file:vendor/${vendored[0]}`) throw new Error(`package.json's svelte is ${manifest.dependencies.svelte}, not vendor/${vendored[0]}`)
const runex_version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version as string

const stage = mkdtempSync(join(tmpdir(), "runex-svelte-stage-"))
const pkg = join(stage, "package")
mkdirSync(pkg)

/** src/x.ts → lib/x.js: what an export or a component's import points at once published. */
const lib_path = (p: string) => p.replace(/^(\.\/)?src\//, "./lib/").replace(/\.ts$/, ".js")

function emit_lib() {
  const lib = join(ROOT, "lib")
  rmSync(lib, { recursive: true, force: true })
  run(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.lib.json"], ROOT)
  cpSync(lib, join(pkg, "lib"), { recursive: true })
  rmSync(lib, { recursive: true, force: true })
  // tsc copies no hand-written .d.ts, and leaves the declarations' `./x.ts` specifiers.
  cpSync(join(ROOT, "src/html.d.ts"), join(pkg, "lib/html.d.ts"))
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith(".d.ts")) writeFileSync(path, readFileSync(path, "utf8").replace(/(['"])(\.\.?\/[^'"]+)\.ts\1/g, "$1$2.js$1"))
    }
  }
  walk(join(pkg, "lib"))
  // The components: .svelte source, compiled by the app's loader, importing the compiled lib.
  mkdirSync(join(pkg, "lib/components"), { recursive: true })
  for (const name of readdirSync(join(ROOT, "src/components"))) {
    const source = readFileSync(join(ROOT, "src/components", name), "utf8")
    writeFileSync(join(pkg, "lib/components", name), source.replace(/(['"])(\.\.\/[^'"]+)\.ts\1/g, "$1$2.js$1"))
  }
  // kit.ts re-exports the components; its .d.ts needs `*.svelte` typed.
  writeFileSync(join(pkg, "lib/svelte-modules.d.ts"), readFileSync(join(ROOT, "types/svelte.d.ts"), "utf8"))
  const kit_dts = join(pkg, "lib/kit.d.ts")
  writeFileSync(kit_dts, `/// <reference path="./svelte-modules.d.ts" />\n` + readFileSync(kit_dts, "utf8"))
}

function published_manifest() {
  const out = structuredClone(manifest)
  out.main = lib_path(out.main)
  out.types = "./lib/index.d.ts"
  out.files = ["lib", "bin", "README.md", "LICENSE"]
  for (const [key, value] of Object.entries(out.exports as Record<string, unknown>)) {
    if (key === "./html") out.exports[key] = { types: "./lib/html.d.ts" }
    else if (key === "./components/*") out.exports[key] = "./lib/components/*"
    else if (typeof value === "string" && value.endsWith(".ts")) out.exports[key] = lib_path(value)
  }
  out.dependencies.svelte = PUBLISHED_SVELTE
  out.peerDependencies["runex-js"] = `>=${runex_version} <${next_minor(runex_version)}`
  delete out.devDependencies
  delete out.scripts
  return out
}

function next_minor(v: string) {
  const [major, minor] = v.split(".").map(Number)
  return major === 0 ? `0.${minor! + 1}.0` : `${major! + 1}.0.0`
}

try {
  emit_lib()
  cpSync(join(ROOT, "bin"), join(pkg, "bin"), { recursive: true })
  cpSync(join(ROOT, "README.md"), join(pkg, "README.md"))
  cpSync(join(REPO, "LICENSE"), join(pkg, "LICENSE"))

  // Install the vendored svelte (and acorn) next to the staged package, as npm bundles it from there.
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "stage", private: true, dependencies: { svelte: `file:${join(ROOT, "vendor", vendored[0]!)}`, acorn: manifest.dependencies.acorn } }),
  )
  // --no-dry-run: CI's dry-run release sets npm_config_dry_run for the whole job, which would make
  // this install a no-op; only the `npm publish` below should be dry.
  run("npm", ["install", "--no-dry-run", "--omit=dev", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund"], pkg)
  const installed = JSON.parse(readFileSync(join(pkg, "node_modules/svelte/package.json"), "utf8"))
  if (!installed.exports?.["./renderer"]) throw new Error("the staged svelte has no custom-renderer API")
  writeFileSync(join(pkg, "package.json"), JSON.stringify(published_manifest(), null, 2) + "\n")

  if (command === "pack") {
    const dest = resolve(rest[0] ?? ROOT)
    mkdirSync(dest, { recursive: true })
    run("npm", ["pack", "--pack-destination", dest], pkg)
  } else {
    run("npm", ["publish", "--access", "public", ...rest], pkg)
  }
} finally {
  if (process.env.RUNEX_SVELTE_KEEP_STAGE) console.log(`stage kept: ${relative(process.cwd(), stage) || stage}`)
  else rmSync(stage, { recursive: true, force: true })
}
