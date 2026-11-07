#!/bin/sh
# Debug build of the addon, installed by rename so running processes keep the file they mapped
# (examples and the compare harness may be running against it), then the TypeScript build.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
npx napi build --platform --js native.cjs --dts native.d.cts -o target/napi-out "$@"
for f in target/napi-out/*.node native.cjs native.d.cts; do
  name=$(basename "$f")
  src=target/napi-out/$name
  cp "$src" "$name.new" && mv -f "$name.new" "$name"
done
node scripts/fix-dts.mjs
npx tsc -p tsconfig.build.json
