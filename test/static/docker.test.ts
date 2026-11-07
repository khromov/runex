// docker/linux-arm64.Dockerfile (scripts/linux-docker.sh, scripts/golden-linux.sh) is the canonical
// golden platform on your machine, so it must start from the image and install the lavapipe that
// ci.yml and full.yml pin: the golden pixels are that Mesa's. `bun test ./test/static`.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const all = (text: string, re: RegExp) => [...new Set([...text.matchAll(re)].map((m) => m[1]))]

const IMAGE = /(ubuntu:22\.04@sha256:[0-9a-f]{64})/g
const LAVAPIPE = /LAVAPIPE_VERSION[:=] *"?([^\s"]+)/g

test("the Dockerfile pins the image and lavapipe the workflows pin", () => {
  const docker = read("docker/linux-arm64.Dockerfile")
  for (const wf of [".github/workflows/ci.yml", ".github/workflows/full.yml"]) {
    const text = read(wf)
    expect({ wf, image: all(text, IMAGE), lavapipe: all(text, LAVAPIPE) })
      .toEqual({ wf, image: all(docker, IMAGE), lavapipe: all(docker, LAVAPIPE) })
  }
  expect(all(docker, /^FROM (.+)$/gm)).toEqual(all(docker, IMAGE))
  expect(docker).toContain('"mesa-vulkan-drivers=$LAVAPIPE_VERSION"')
})

// The golden manifests record the runtimes they were made with, and the fast tier's snapshots
// run on them: CI uses the Node and Bun the Dockerfile installs.
test("the workflows pin the Node and Bun the Dockerfile installs", () => {
  const docker = read("docker/linux-arm64.Dockerfile")
  const pin = (text: string, name: string) => all(text, new RegExp(`${name}[:=] *"?([0-9][^\\s"]*)`, "g"))
  for (const wf of [".github/workflows/ci.yml", ".github/workflows/full.yml"]) {
    const text = read(wf)
    expect({ wf, node: pin(text, "NODE_VERSION"), bun: pin(text, "BUN_VERSION") })
      .toEqual({ wf, node: pin(docker, "NODE_VERSION"), bun: pin(docker, "BUN_VERSION") })
    // Every setup-bun step uses the pin rather than "latest".
    const setups = text.split("oven-sh/setup-bun@").length - 1
    expect({ wf, pinned: text.split("bun-version: ${{ env.BUN_VERSION }}").length - 1 }).toEqual({ wf, pinned: setups })
  }
})
