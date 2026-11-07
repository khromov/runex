// PNG helpers shared by scripts/compare.ts and scripts/golden.ts: hashing, masking and a
// pixel diff that writes the differences in magenta over the faded reference frame.
//
//   const r = comparePng("expected.png", "actual.png", "diff.png", { pixels: 0, delta: 0 })
//   if (!r.identical) console.log(`${r.pixels} px differ, max channel delta ${r.maxDelta}`)

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { PNG } from "pngjs"

/** How far a non-identical PNG may be from the reference and still pass (status "close"). */
export type Tolerance = {
  /** Differing pixels allowed (default 0). */
  pixels?: number
  /** Largest per-channel difference allowed, 0–255 (default 0). */
  delta?: number
}

/** `rust*` is the reference image (`a`), `ts*` the one checked against it (`b`). */
export type PngResult = {
  identical: boolean
  /** Bytes differ but every pixel matches. */
  samePixels?: boolean
  rustSize?: [number, number]
  tsSize?: [number, number]
  pixels?: number
  maxDelta?: number
  /** x, y, w, h in pixels. */
  bbox?: [number, number, number, number]
  diff?: string
  withinTolerance?: boolean
}

export function sha256(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex")
}

const read = (f: string | Buffer) => (typeof f === "string" ? readFileSync(f) : f)

/**
 * Compares two PNGs (paths or bytes): identical bytes pass at once; otherwise both are decoded,
 * and when any pixel differs `diffFile` gets the differences in magenta (brighter = larger) over
 * the reference frame faded to light grey.
 */
export function comparePng(rustFile: string | Buffer, tsFile: string | Buffer, diffFile: string, tol: Tolerance): PngResult {
  const a = read(rustFile)
  const b = read(tsFile)
  if (a.equals(b)) return { identical: true }
  const pa = PNG.sync.read(a)
  const pb = PNG.sync.read(b)
  const rustSize: [number, number] = [pa.width, pa.height]
  const tsSize: [number, number] = [pb.width, pb.height]
  if (pa.width !== pb.width || pa.height !== pb.height) return { identical: false, rustSize, tsSize, withinTolerance: false }
  const { width: w, height: h } = pa
  const diff = new PNG({ width: w, height: h })
  let pixels = 0, maxDelta = 0, x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let d = 0
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(pa.data[i + c]! - pb.data[i + c]!))
      if (d > 0) {
        pixels++
        maxDelta = Math.max(maxDelta, d)
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
        diff.data[i] = 255; diff.data[i + 1] = 0; diff.data[i + 2] = 128 + Math.round((127 * d) / 255); diff.data[i + 3] = 255
      } else {
        const l = 0.299 * pa.data[i]! + 0.587 * pa.data[i + 1]! + 0.114 * pa.data[i + 2]!
        const g = Math.round(255 - (255 - l) * 0.25 * (pa.data[i + 3]! / 255))
        diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = g; diff.data[i + 3] = 255
      }
    }
  }
  if (pixels === 0) return { identical: true, samePixels: true, rustSize, tsSize, pixels: 0, maxDelta: 0 }
  writeFileSync(diffFile, PNG.sync.write(diff))
  const withinTolerance = pixels <= (tol.pixels ?? 0) && maxDelta <= (tol.delta ?? 0)
  return { identical: false, rustSize, tsSize, pixels, maxDelta, bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], diff: diffFile, withinTolerance }
}

/** Width and height from the IHDR chunk, without decoding. */
export function pngSize(data: Buffer): [number, number] {
  return [data.readUInt32BE(16), data.readUInt32BE(20)]
}

/**
 * Blanks `rects` (x, y, w, h in points, times `scale`, grown by `margin` pixels) to transparent
 * black. Returns the masked PNG's bytes and the sha256 of its raw RGBA (prefixed `rgba:`), which
 * doesn't depend on the encoder.
 */
export function maskPng(data: Buffer, rects: [number, number, number, number][], scale: number, margin = 2): { png: Buffer; hash: string } {
  const p = PNG.sync.read(data)
  const { width: w, height: h } = p
  for (const [rx, ry, rw, rh] of rects) {
    const x0 = Math.max(0, Math.floor(rx * scale) - margin), y0 = Math.max(0, Math.floor(ry * scale) - margin)
    const x1 = Math.min(w, Math.ceil((rx + rw) * scale) + margin), y1 = Math.min(h, Math.ceil((ry + rh) * scale) + margin)
    for (let y = y0; y < y1; y++) p.data.fill(0, (y * w + x0) * 4, (y * w + x1) * 4)
  }
  const hash = `rgba:${createHash("sha256").update(`${w}x${h}\n`).update(p.data).digest("hex")}`
  return { png: PNG.sync.write(p), hash }
}
