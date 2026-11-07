// Per-example settings for scripts/compare.ts: skips (with a reason), extra Rune arguments,
// tolerances and tree paths to ignore. See `ExampleConfig` in compare.ts and scripts/README.md.
//
// Every other Rust example renders headless and byte-identically run to run (checked for all
// windows and scenes), including video (decoded on the virtual clock), the compositor examples
// (cursed-settings, lab, showreel) and the multi-window ones (launcher, overlay).
import type { CompareConfig } from "./compare.ts"

const config: CompareConfig = {
  examples: {
    "glass-card": {
      skip: "both windows set App::args(vec![]), which replaces Rune's tooling flags: --snap and " +
        "--list-scenes open real windows (and never exit) instead of rendering headless",
    },
    "site-scenes": {
      skip: "not a Rune app: a custom renderer CLI (--out DIR, --only NAME, --t SECONDS) that writes " +
        "its own PNGs and ignores Rune's tooling flags (--snap, --tree, --list-scenes)",
    },
    // Rust's f32 sin/cos call the platform's sinf/cosf, which on Linux (glibc) aren't correctly
    // rounded; the port rounds the f64 result (which matches macOS's libm here). At t = 0, 12 of
    // the 1,164 values differ by an ulp, and one (the waveform line's sin(19.32)) moves one pixel
    // by 1/255. The other moments checked (--at 0.25 to 7.3) are identical. docs/porting.md, Limits.
    "shapes": process.platform === "linux" ? { tolerance: { pixels: 2, delta: 1 } } : {},
    "video-player": {
      // At t = 0 the player still shows "Loading"; by 0.6 s the test clip has a decoded frame.
      scenes: { "(none)": { args: ["--at", "0.6"] } },
    },
  },
}

export default config
