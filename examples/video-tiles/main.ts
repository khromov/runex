// Copy this producer/view boundary into a VideoToolbox application.
//
// Port of vendor/rune/examples/video-tiles/src/main.rs (and bench.rs as ./bench.ts). Rust's
// `#[cfg(target_os = "macos")]` is a runtime `process.platform === "darwin"` check here.
import { AppSpec, type Cx, type El, NativeSurface, type Waker, col, el, native_surface, row, run } from "runex-js"
const { synthetic } = native_surface
type ByteFrame = native_surface.ByteFrame

function push(surface: NativeSurface, bytes: ByteFrame, id: number) {
  if (process.platform === "darwin") {
    surface.push(native_surface.macos.PixelBuffer.from_bytes(bytes), id)
  } else {
    surface
      .push_bytes(
        // Rust's `ByteFrame` struct literal. ByteFrame is a class (it isn't Clone), and push_bytes
        // takes it by value, so it has to be an instance: a plain object throws "expected a ByteFrame".
        new native_surface.ByteFrame({
          width: bytes.width,
          height: bytes.height,
          format: bytes.format,
          color: bytes.color,
          planes: bytes.planes.map((p) => p.slice()),
        }),
        id,
      )
  }
}
type Tiles = {
  surfaces: NativeSurface[]
}
function state(): Tiles {
  const surfaces: NativeSurface[] = Array.from({ length: 4 }, () => NativeSurface.new())
  const bytes = synthetic(640, 360, 0)
  for (const s of surfaces) {
    push(s, bytes, 0)
  }
  return { surfaces }
}
function setup(s: Tiles, wake: Waker) {
  for (const surface of s.surfaces) {
    surface.set_waker(wake) // runex hands Rune a clone of the waker, as `wake.clone()` does
  }
  // Headless scenes use the deterministic initial frame, not a wall-clock producer.
  if (process.argv.slice(2).some((v) => ["--snap", "--frames", "--first-pixels", "--tree", "--trace", "--strip"].includes(v))) {
    return
  }
  const surfaces = s.surfaces.map((surface) => surface.clone())
  // Rust's producer thread: push frame `id`, sleep 16 ms, repeat.
  let id = 1
  const produce = () => {
    const bytes = synthetic(640, 360, id)
    for (const s of surfaces) {
      push(s, bytes, id)
    }
    id += 1
    setTimeout(produce, 16)
  }
  produce()
}
function view(s: Tiles, _: Cx): El {
  return col().key("tiles").gap(8.0).padding(8.0).children([0, 1].map((y) =>
    row().gap(8.0).children([0, 1].map((x) =>
      el().key(`tile-${x}-${y}`)
        .w(320.0)
        .h(180.0)
        .radius(8.0)
        .native_surface(s.surfaces[y * 2 + x]!, "Fit")))))
}

if (process.argv.slice(2).some((a) => a === "--bench-native")) {
  // `mod bench;` is loaded only for the benchmark: it needs Rune's GPU internals and wgpu,
  // which runex doesn't expose yet (docs/porting.md), and the app itself doesn't.
  const bench = await import("./bench.ts")
  await bench.run()
} else {
  run({ ...AppSpec.new<Tiles>("Video tiles", [664.0, 384.0], state, view), setup })
}
