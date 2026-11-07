#!/bin/sh
# Golden baselines on Linux: runs scripts/golden.ts in CI's canonical pixel platform (Ubuntu
# 22.04 with Mesa's lavapipe, scripts/linux-docker.sh's image and cached volumes) and checks, or
# with --update blesses, test/golden/png/linux-arm64-lavapipe.json and the Linux tree overrides.
#
#   scripts/golden-linux.sh [--tree DIR] [--update] [golden.ts options and filters...]
#   scripts/golden-linux.sh                               # quick tier, bun
#   scripts/golden-linux.sh --update --tier full --runtime bun,node
#
# --tree DIR renders another checkout or a staged copy (linux-docker.sh's --tree); results and
# the accepted proposal still go to this checkout.
#
# linux-docker.sh copies the tree into a Docker volume without .git and builds the Linux addon
# there (cold about 11 min, warm a few), then this runs
# `bun scripts/golden.ts --platform linux-arm64-lavapipe --out /out/golden ...` in the copy.
# Without .git the copy has no golden-images branch either. So first the PNGs the tree's Linux
# manifest names are copied, from this checkout's branch and cache, to out/golden-linux/images
# (`golden.ts --export-images`, only the ones not there yet; with --fetch-images, missing ones
# come from origin). The run reads that directory as its cache (RUNEX_GOLDEN_CACHE), so each
# failing case gets expected.png and diff.png beside actual.png.
#
# The copy can't write the baselines or the image store, so a failing run leaves its proposal
# in out/golden-linux/golden/proposed, and --update applies it here with
# `bun scripts/golden.ts --accept` (trees, overrides, listings and the manifest into test/golden,
# the PNGs into the local golden-images branch). Review the git diff, then re-run to confirm.
#
# Results: out/golden-linux/golden/ (report.json, summary.md, per-case diffs, proposed/) and
# out/golden-linux/run.log; the expected images stay in out/golden-linux/images/. Environment:
# RUNEX_DOCKER_PREFIX and CARGO_BUILD_JOBS, as for linux-docker.sh. Exit codes are golden.ts's:
# 0 pass, 1 mismatch, 2 harness or tooling error.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
tree=$here
update=0
while [ $# -gt 0 ]; do
  case $1 in
    --tree) tree=$(cd "$2" && pwd); shift 2 ;;
    --update) update=1; shift ;;
    -h | --help) sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) break ;;
  esac
done
out=$here/out/golden-linux
platform=linux-arm64-lavapipe
rm -rf "$out/golden"
mkdir -p "$out"
# The copy has no .git: pass the Rune revision for the manifest's environment.
rev=$(git -C "$here/vendor/rune" rev-parse HEAD 2>/dev/null || echo unknown)

# Nor a golden-images branch: give it the expected images as a cache, /out/images in the container.
fetch=
for a in "$@"; do case $a in --fetch-images) fetch=--fetch-images ;; esac; done
echo "== expected images ($platform)"
(cd "$here" && bun scripts/golden.ts --platform "$platform" --golden "$tree/test/golden" --export-images "$out/images" $fetch) ||
  echo "golden on Linux: couldn't copy the expected images; failures will have actual.png only" >&2

set +e
sh "$here/scripts/linux-docker.sh" --tree "$tree" --out "$out" run \
  env RUNEX_GOLDEN_RUNE_REV="$rev" RUNEX_GOLDEN_CACHE=/out/images \
  bun scripts/golden.ts --platform "$platform" --out /out/golden "$@"
code=$?
set -e
# No report: linux-docker.sh failed before golden.ts ran (build, patches, Docker).
if [ ! -f "$out/golden/report.json" ]; then
  echo "golden on Linux: the Docker run failed before golden.ts (exit $code); see $out/run.log and the output above" >&2
  exit 2
fi

if [ "$update" = 1 ]; then
  if [ "$code" = 1 ] && [ -d "$out/golden/proposed" ]; then
    echo
    echo "== accept the Linux proposal"
    (cd "$here" && bun scripts/golden.ts --accept "$out/golden/proposed")
    echo "accepted; review the diff, then run scripts/golden-linux.sh (same options) to confirm"
    exit 0
  fi
  [ "$code" = 0 ] && echo "Linux baselines are up to date: nothing to accept"
fi
[ "$code" = 0 ] || echo "golden on Linux: exit $code (summary: $out/golden/summary.md)"
exit "$code"
