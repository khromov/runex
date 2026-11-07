# golden-images

PNG baselines for runex's golden tests, one file per image at `<platform>/<sha256>.png`.
The hashes live in main, in test/golden/png/<platform>.json. scripts/golden.ts adds images
with `--update` (or `--accept`), pushes them with `--push-images` and rebuilds this branch
with only the referenced images with `--gc-images`. Nothing else should commit here.
