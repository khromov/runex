// No window/pixel readback. Import/encode/submit CPU and GPU render-pass timestamp duration.
//
// Port of vendor/rune/examples/video-tiles/src/bench.rs, written against APIs runex doesn't
// expose yet (`rune::render`, `SurfaceRenderer`, `NativeSurface::set_observer`,
// `FrameTiming::completed_at`, `SurfaceDraw` literals and the `wgpu` crate): see docs/porting.md.
// Rust blocks this thread on the completion channel and sleeps between frames; JavaScript can't
// block on a callback from Rune's completion worker, so `run` is async and awaits both.
import { inspect } from "node:util"
// @ts-expect-error `rune::render` isn't bound (see docs/porting.md).
import { NativeSurface, native_surface, render } from "runex-js"
// @ts-expect-error the `wgpu` crate isn't bound (see docs/porting.md).
import * as wgpu from "runex-js/wgpu"
const { synthetic } = native_surface
const { Gpu, OFFSCREEN_FORMAT } = render

export async function run(): Promise<void> {
  const gpu = Gpu.new(Gpu.instance(), null)
  console.error(`adapter=${inspect(gpu.adapter.get_info())}`)
  for (const [tiles, w, h] of [[1, 1920, 1080], [4, 1920, 1080], [9, 1920, 1080], [1, 3840, 2160], [1, 5120, 2880]] as const) {
    const columns = Math.trunc(Math.fround(Math.sqrt(Math.fround(tiles))))
    const size: [number, number] = [w * columns, h * columns]
    const target = gpu.device.create_texture({
      label: "video benchmark",
      size: { width: size[0], height: size[1], depth_or_array_layers: 1 },
      mip_level_count: 1,
      sample_count: 1,
      dimension: "D2",
      format: OFFSCREEN_FORMAT,
      usage: wgpu.TextureUsages.RENDER_ATTACHMENT,
      view_formats: [],
    })
    const view = target.create_view({})
    // @ts-expect-error `rune::native_surface::SurfaceRenderer` isn't bound (see docs/porting.md).
    const renderer = native_surface.SurfaceRenderer.new(gpu.device, OFFSCREEN_FORMAT)
    const timings: number[] = []
    const [completed, completion] = channel<void>()
    const surfaces: NativeSurface[] = Array.from({ length: tiles }, () => NativeSurface.new())
    const times = timings
    // @ts-expect-error `NativeSurface::set_observer` isn't bound (see docs/porting.md).
    surfaces[0]!.set_observer((t: native_surface.FrameTiming) => {
      if (t.gpu_start_seconds !== null && t.gpu_end_seconds !== null) {
        times.push((t.gpu_end_seconds - t.gpu_start_seconds) * 1000.0)
      }
      // @ts-expect-error `FrameTiming::completed_at` isn't bound (see docs/porting.md).
      if (t.completed_at !== null) {
        completed.send()
      }
    })
    const draws = surfaces.map((s, i) => ({
      surface: s.clone(),
      fit: "Fit",
      before_instance: 0,
      rect: [Math.fround((i % columns) * w), Math.fround(Math.trunc(i / columns) * h), Math.fround(w), Math.fround(h)],
      radii: [0.0, 0.0, 0.0, 0.0],
      clip: render.NO_CLIP,
      fade: [0, 0, 0, 0],
      opacity: 1.0,
    }))
    // Three independent IOSurface buffers per tile model a decoder's recyclable output pool.
    // Fill only before timing: production import never accesses pixels on CPU.
    const buffers: native_surface.macos.PixelBuffer[][] = process.platform === "darwin"
      ? Array.from({ length: tiles }, () =>
        Array.from({ length: 3 }, (_, i) => native_surface.macos.PixelBuffer.from_bytes(synthetic(w, h, i))))
      : []
    const runs: Run[] = []
    for (let run = 0; run < 8; run++) {
      timings.length = 0
      const cpu: number[] = []
      for (let frame = 0; frame < 30; frame++) {
        const begin = performance.now()
        surfaces.forEach((s, i) => {
          if (process.platform === "darwin") {
            s.push(buffers[i]![frame % 3]!.clone(), run * 30 + frame)
          } else {
            s.push_bytes(synthetic(w, h, frame), run * 30 + frame)
          }
        })
        renderer.prepare(gpu.device, gpu.queue, draws, size)
        const encoder = gpu.device.create_command_encoder({})
        {
          const pass = encoder.begin_render_pass({
            label: "video benchmark",
            color_attachments: [{
              view,
              depth_slice: null,
              resolve_target: null,
              ops: {
                load: { Clear: wgpu.Color.BLACK },
                store: "Store",
              },
            }],
            depth_stencil_attachment: null,
            timestamp_writes: renderer.timestamp_writes(),
            occlusion_query_set: null,
            multiview_mask: null,
          })
          for (let i = 0; i < renderer.len(); i++) {
            renderer.draw(pass, i)
          }
          pass.end() // Rust ends the pass by dropping it at the end of this block
        }
        renderer.submit(gpu.queue, encoder)
        cpu.push(performance.now() - begin)
        await completion.recv_timeout(10, "final frame completion without another draw")
        // Pace actual submissions at 60 Hz; waiting is excluded from CPU cost.
        const wait = 1.0 / 60.0 - (performance.now() - begin) / 1000
        if (wait >= 0) {
          await sleep(wait)
        }
      }
      const gpu_ms = timings.slice()
      if (gpu.device.features().contains(wgpu.Features.TIMESTAMP_QUERY)) {
        assert_eq(gpu_ms.length, 30, "every submitted frame must have a valid GPU timestamp pair")
      }
      for (const s of surfaces) {
        assert_eq(s.last_error(), null)
      }
      if (run > 0) {
        runs.push({ cpu_p50_ms: median(cpu), cpu_p95_ms: percentile(cpu, 0.95), gpu_samples: gpu_ms.length, gpu_p50_ms: median(gpu_ms), gpu_p95_ms: percentile(gpu_ms, 0.95) })
      }
    }
    const cpu = runs.map((r) => unwrap(r.cpu_p50_ms))
    const gpu_ms = runs.map((r) => r.gpu_p50_ms).filter((v) => v !== null)
    console.log(json({
      tiles, source: [w, h], target: [size[0], size[1]], hz: 60, warmup_runs: 1, runs,
      cpu_median_ms: f64(median(cpu)), gpu_median_ms: f64(median(gpu_ms)),
      cpu_per_tile_ms: f64(opt_map(median(cpu), (v) => v / tiles)), gpu_per_tile_ms: f64(opt_map(median(gpu_ms), (v) => v / tiles)),
    }))
  }
}

type Run = { cpu_p50_ms: number | null; cpu_p95_ms: number | null; gpu_samples: number; gpu_p50_ms: number | null; gpu_p95_ms: number | null }

function median(xs: number[]): number | null {
  return percentile(xs, 0.5)
}
function percentile(xs: number[], p: number): number | null {
  const sorted = xs.slice()
  sorted.sort(total_cmp)
  return sorted[Math.trunc(sorted.length * p)] ?? null
}

// ---------------------------------------------------------------------------------------------
// Rust's std in JavaScript terms.

/** `Option::map`. */
function opt_map(v: number | null, f: (v: number) => number): number | null {
  return v === null ? null : f(v)
}

/** `Option::unwrap`. */
function unwrap<T>(v: T | null): T {
  if (v === null) throw new Error("called `Option::unwrap()` on a `None` value")
  return v
}

/** `f64::total_cmp`: -NaN < -inf < ... < -0 < +0 < ... < +inf < NaN. */
function total_cmp(a: number, b: number): number {
  const key = (x: number) => {
    const v = new DataView(new ArrayBuffer(8))
    v.setFloat64(0, x)
    const bits = v.getBigInt64(0)
    return bits ^ ((bits >> 63n) & 0x7fffffffffffffffn)
  }
  const ka = key(a), kb = key(b)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

function assert_eq<T>(left: T, right: T, message?: string) {
  if (left !== right) {
    throw new Error(`assertion \`left == right\` failed${message ? `: ${message}` : ""}\n  left: ${inspect(left)}\n right: ${inspect(right)}`)
  }
}

function sleep(secs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000))
}

/** `std::sync::mpsc::channel`: a sender for callbacks and a receiver to await. */
function channel<T>(): [{ send(v: T): void }, { recv_timeout(secs: number, expect: string): Promise<T> }] {
  const queue: T[] = []
  let waiting: ((v: T) => void) | null = null
  return [
    {
      send(v: T) {
        if (waiting) { const w = waiting; waiting = null; w(v) } else queue.push(v)
      },
    },
    {
      recv_timeout(secs: number, expect: string): Promise<T> {
        if (queue.length) return Promise.resolve(queue.shift()!)
        return new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => { waiting = null; reject(new Error(`${expect}: Timeout`)) }, secs * 1000)
          waiting = (v) => { clearTimeout(timer); resolve(v) }
        })
      },
    },
  ]
}

/** An `f64` for `json`: serde_json writes floats with a fraction (`1.0`), integers without. */
class F64 {
  v: number
  constructor(v: number) {
    this.v = v
  }
}
function f64(v: number | null): F64 | null {
  return v === null ? null : new F64(v)
}

/**
 * `serde_json::json!(..).to_string()`: compact, keys sorted (serde_json's map is a BTreeMap
 * without its `preserve_order` feature). `Run` objects hold `f64`s except `gpu_samples`.
 */
function json(v: unknown, float = false): string {
  if (v === null || v === undefined) return "null"
  if (v instanceof F64) return json(v.v, true)
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "null"
    if (!float) return String(v)
    // ryu, as serde_json prints an f64: `1.0`, `0.00001`, `9.9e-6`, `1e16` (exponent form below
    // 1e-5 and from 1e16 on, where JS's own switch is at 1e-6 and 1e21).
    if (Object.is(v, -0)) return "-0.0"
    if (v !== 0 && (Math.abs(v) < 1e-5 || Math.abs(v) >= 1e16)) return v.toExponential().replace("e+", "e")
    if (Number.isInteger(v)) return `${v}.0`
    return String(v)
  }
  if (typeof v === "string") return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map((x) => json(x)).join(",")}]`
  const o = v as Record<string, unknown>
  const isRun = "cpu_p50_ms" in o
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${json(o[k], isRun && k !== "gpu_samples")}`).join(",")}}`
}
