// An overlay above other apps (`App.overlay` with a `ConfiguredOverlay`): its window is created,
// it shows and draws, and it hides, with no failure reported.
//
//   bun test/windowed/fixtures/overlay.ts
//
// The overlay starts hidden. Once the app's window is up the fixture shows it, waits, hides it,
// waits and quits. RESULT: what the overlay's handle reported at each step, how often the
// overlay's `on_created` ran and how many overlay frames polled while it was shown.
import { App, AppSpec, ConfiguredOverlay, OverlaySpec, col, oklch, row, text, tok } from "runex-js"
import { corner, deadline, result } from "./common.ts"

deadline(20000)

let created = 0
let overlayPolls = 0
const steps: Record<string, unknown>[] = []

const app = App.new(AppSpec.new("Overlay host", [260, 140], () => ({}), () => {
  const t = tok.theme(true)
  return col().key("root").w_full().h_full().center().fill(t.bg).child(text("Overlay host").color(t.text))
}))
  .window_options(corner())
  .args([])
const spec = new OverlaySpec<number>({
  name: "runex-test-overlay",
  size: [200, 40],
  edge: "Bottom",
  margin: 24,
  view: (n) => row().key("pill").w_full().h_full().center().radius(20).fill(oklch(0.25, 0, 0)).child(text(`overlay ${n}`).color(oklch(0.95, 0, 0))),
})
const overlay = app.overlay(
  new ConfiguredOverlay(spec)
    .on_created(() => { created++ })
    .poll(() => {
      overlayPolls++
      return false
    }),
  0,
)
const handle = app.handle()

function record(step: string) {
  steps.push({ step, availability: overlay.availability(), failure: overlay.failure(), window: overlay.window_number() !== null, created, overlayPolls })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
void (async () => {
  await sleep(500)
  record("before show")
  overlay.show()
  overlay.update((n: number) => n + 1)
  await sleep(600)
  record("shown")
  overlay.hide()
  await sleep(400)
  record("hidden")
  handle.quit()
})()
await app.run()
result({ steps })
