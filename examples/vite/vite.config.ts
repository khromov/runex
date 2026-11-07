// `vite` (from this directory) opens the app's window from the dev server and hot-swaps its view
// on every save; `vite build` bundles it to `dist/main.mjs` for `node dist/main.mjs`.
import { defineConfig } from "vite"
import runex from "runex-js/vite"

export default defineConfig({
  plugins: [runex({ entry: "./main.ts" })],
})
