#!/bin/sh
# Builds and checks runex on Linux in Docker: CI's Linux leg (Ubuntu 22.04, ARM64 on Apple Silicon)
# on your machine, rendering headless with Mesa's lavapipe software Vulkan driver.
#
#   scripts/linux-docker.sh [--tree DIR] [--out DIR] [build|smoke|test|compare [args...]|run CMD...|shell]
#
#   build     `bun run build:native` and `bun run build:ts` (the default; every command starts here)
#   smoke     examples/hello --snap --scene on, with Bun and with Node (two 640x400 PNGs)
#   test      bun run test:unit (the unit tests, test/unit)
#   compare   bun scripts/compare.ts [args...] --runtime bun,node --release --json ...: examples
#             or options (--all, --self-check, --timeout S, ...); --out DIR/compare holds the results
#   run       CMD in the built copy, without a terminal (run.log): e.g.
#             run bash -c 'RUNEX_PERF=1 node examples/todo/main.ts --tree /out/todo.json'
#   shell     an interactive shell in the built copy
#
# The tree (--tree, default this checkout) is copied into a Docker volume first, without .git,
# target/, node_modules/, out/, dist/ and *.node: nothing builds in, or writes to, the source
# tree. Cargo's registry and target directory, Bun's cache and the copy's node_modules stay in
# volumes, so later runs are incremental. Results (the addon, PNGs, logs, compare's report.json)
# go to --out (default <tree>/out/linux), the only host directory the container sees.
#
# The image is docker/linux-arm64.Dockerfile with rust-toolchain.toml's channel (Docker caches it
# after the first build). Environment: CARGO_BUILD_JOBS (default 4, for the Docker VM's memory;
# lower it if rustc is killed), RUNEX_DOCKER_PREFIX (default runexlx: names the image, volumes
# and containers).
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
tree=$here
out=
while [ $# -gt 0 ]; do
  case $1 in
    --tree) tree=$(cd "$2" && pwd); shift 2 ;;
    --out) out=$2; shift 2 ;;
    -h | --help) sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) break ;;
  esac
done
cmd=${1:-build}
[ $# -gt 0 ] && shift
case $cmd in
  build | smoke | test | compare | shell) ;;
  run) [ $# -gt 0 ] || { echo "run: name a command (see --help)" >&2; exit 2; } ;;
  *) echo "unknown command: $cmd (see --help)" >&2; exit 2 ;;
esac
out=${out:-$tree/out/linux}
mkdir -p "$out"
out=$(cd "$out" && pwd)

p=${RUNEX_DOCKER_PREFIX:-runexlx}
rust=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$tree/rust-toolchain.toml")
image=$p-linux:rust-$rust
echo "image $image (the first build takes a few minutes)"
docker build -q -t "$image" --build-arg RUST_TOOLCHAIN="$rust" -f "$here/docker/linux-arm64.Dockerfile" "$here/docker" >/dev/null

echo "copy $tree"
(cd "$tree" && COPYFILE_DISABLE=1 tar --no-xattrs -cf - --exclude=./.git --exclude=./vendor/rune/.git \
  --exclude=./target --exclude=./vendor/rune/target --exclude=./node_modules --exclude=./out \
  --exclude=./dist --exclude='*.node' .) |
  docker run --rm -i --name "$p-sync-$$" -v "$p-work:/work" "$image" sh -c \
    'mkdir -p /work/src && cd /work/src && find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + && tar -xf - --no-same-owner'

# Runs in the container, in the copy: `bash -c "$inner" inner <command> [args...]`. Its case
# patterns are written `(name)`: macOS's sh (bash 3.2) misparses `name)` inside $(...).
inner=$(cat <<'EOF'
set -euo pipefail
cmd=$1; shift
trap 'chown -R "$HOST_UID:$HOST_GID" /out' EXIT
icd=(/usr/share/vulkan/icd.d/lvp_icd*.json)
export VK_ICD_FILENAMES=${icd[0]} # lavapipe only
export XDG_RUNTIME_DIR=/tmp/xdg && mkdir -p -m 700 "$XDG_RUNTIME_DIR" # else libwayland complains while probing for a display
step() { printf '\n== %s\n' "$*"; }

step "patches"; node scripts/prepare-rune.mjs --check
step "bun install"; bun install --frozen-lockfile
step "build:native (CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS)"
start=$(date +%s)
CARGO_TARGET_DIR=/target/runex bun run build:native 2>&1 | tee /out/build.log
echo "build:native took $(($(date +%s) - start)) s" | tee -a /out/build.log
step "build:ts"; bun run build:ts
cp runex.*.node /out/ && ls -l runex.*.node

case $cmd in
  (smoke)
    step "smoke"
    bun examples/hello/main.ts --snap /out/hello-bun.png --scene on 2>&1 | tee /out/smoke.log
    node examples/hello/main.ts --snap /out/hello-node.png --scene on 2>&1 | tee -a /out/smoke.log
    node -e '
      const { readFileSync } = require("node:fs"), { createHash } = require("node:crypto")
      for (const f of process.argv.slice(1)) {
        const png = readFileSync(f), [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)]
        console.log(f, `${w}x${h}`, png.length, "bytes, md5", createHash("md5").update(png).digest("hex"))
        if (png.subarray(1, 4).toString() !== "PNG" || w !== 640 || h !== 400) { console.error(`${f}: expected a 640x400 PNG`); process.exit(1) }
      }' /out/hello-bun.png /out/hello-node.png 2>&1 | tee -a /out/smoke.log
    if cmp -s /out/hello-bun.png /out/hello-node.png; then same=identical; else same=different; fi
    echo "bun and node snapshots: $same" | tee -a /out/smoke.log ;;
  (test)
    step "test"
    bun run test:unit 2>&1 | tee /out/test.log ;;
  (compare)
    step "compare $*"
    # The Rust examples build in vendor/rune's own workspace: a target directory of their own.
    CARGO_TARGET_DIR=/target/rune bun scripts/compare.ts "$@" --runtime bun,node --release \
      --out /out/compare --json /out/compare/report.json 2>&1 | tee /out/compare.log ;;
  (run)
    step "run $*"
    "$@" 2>&1 | tee /out/run.log ;;
  (shell)
    exec bash ;;
esac
EOF
)

tty=
[ "$cmd" = shell ] && tty=-it
trap 'docker rm -f "$p-run-$$" >/dev/null 2>&1 || true' INT TERM
echo "run $cmd $*  (results: $out)"
docker run --rm --init $tty --name "$p-run-$$" \
  -v "$p-work:/work" -v "$p-target:/target" -v "$p-bun:/root/.bun/install/cache" \
  -v "$p-cargo-registry:/opt/cargo/registry" -v "$p-cargo-git:/opt/cargo/git" -v "$out:/out" \
  -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" -e CARGO_INCREMENTAL=0 -e CARGO_TERM_COLOR=never \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -w /work/src \
  "$image" bash -c "$inner" inner "$cmd" "$@"
