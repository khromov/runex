// Static exit samples on a real native overlay, for capsule/filter integration review.
//
// (vendor/rune/examples/overlay-lab/src/bin/layer-filter-overlay.rs)
import {
  App, type AppSpec, Color, type Cx, type El, type OverlayCreated, OverlayOptions, OverlaySpec, WindowSpec, el,
  run_windows_with, text,
} from "runex-js"

const INK: Color = new Color({ r: 0.06, g: 0.32, b: 1.0, a: 1.0 })
const SURFACE: Color = new Color({ r: 0.035, g: 0.035, b: 0.035, a: 1.0 })

/** Rust's `()` state, as an empty object, as the glass-card port does (nothing reads it). */
type Unit = Record<string, never>

function view(_: Unit, _cx: Cx): El {
  let root = el().size(620.0, 176.0)
  for (const [label, y, clipped] of [["Unmasked", 32.0, false], ["Clipped", 112.0, true]] as const) {
    let capsule = el().size(400.0, 40.0).absolute(112.0, y).radius(20.0).fill(SURFACE)
    if (clipped) capsule = capsule.clip_rounded(20.0)
    // Shared background stays outside the dissolve; blur is on the leaving state.
    const state = el().size(72.0, 28.0).absolute(370.0, 6.0).opacity(0.65).blur(1.5)
      .radius(8.0).fill(INK).child(text("Leaving").absolute(8.0, 6.0))
    root = root.child(text(label).absolute(12.0, y + 11.0))
      .child(capsule.child(el().size(400.0, 40.0).dissolve().child(state)))
  }
  return root
}

function main() {
  const spec: AppSpec<Unit> = {
    title: "Layer filter overlay", size: [620.0, 176.0], min_size: null,
    init: () => ({}), view, scenes: [], fonts: [], families: ["sans-serif", "monospace"],
    setup: null, poll: null, on_key: null,
  }
  void run_windows_with({ accessory: true }, (_) => {
    const app = App.new(spec).windowless()
    const pill = app.overlay(OverlaySpec.new("Layer filter capsule proof", [620.0, 176.0], view)
      .options(new OverlayOptions({
        display: "Primary", input: "None",
        level: "AboveOverlays", exclude_from_capture: false, prewarm: true,
      }))
      .on_created((created) => console.error(`filter-overlay created ${debug_created(created as OverlayCreated)}`)), {})
    pill.show()
    const handle = app.handle()
    // The probe owns stdin and closes it even on capture failure. No persistent GUI job.
    spawn(async () => {
      await read_line()
      handle.quit()
    })
    return [WindowSpec.from_app("filter-proof", app)]
  })
}

// Rust's thread, as an async function.
function spawn(f: () => Promise<void>) { void f() }

/**
 * `std::io::stdin().read_line(..)`, its result ignored: done at the first newline, at the end
 * of input or on an error. Like the thread blocked on it, it doesn't keep the process alive.
 */
function read_line(): Promise<void> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    const done = () => {
      stdin.off("data", data).off("end", done).off("error", done)
      stdin.pause()
      resolve()
    }
    const data = (chunk: Buffer | string) => { if (String(chunk).includes("\n")) done() }
    stdin.on("data", data).on("end", done).on("error", done)
    ;(stdin as { unref?: () => void }).unref?.()
  })
}

// Rust's `{:?}` of `OverlayCreated`, which the filter probe matches.
function debug_option(v: number | null | undefined): string {
  return v == null ? "None" : `Some(${v})`
}
function debug_created(c: OverlayCreated): string {
  const caps = c.capabilities
  return `OverlayCreated { window_number: ${debug_option(c.window_number)}, capabilities: OverlayCapabilities { ` +
    `capture_exclusion: ${caps.capture_exclusion}, nonactivating_keys: ${caps.nonactivating_keys}, global_pointer: ${caps.global_pointer} } }`
}

main()
