# runex-svelte app

A Svelte app rendered by [Rune](https://github.com/anomalyco/rune) through
[runex](https://www.npmjs.com/package/runex-js): GPU-drawn, in a native window.

```sh
npm install
npm start        # opens the window; edit App.svelte and save to hot-reload
npm run snap     # renders one frame headless to app.png
npm run check    # tsc + svelte-check
```

Needs Node 24+ or Bun 1.4+, on ARM64 macOS, Linux or Windows. With Bun: `bun install`, `bun run start`.

The markup is Rune's elements (`<column>`, `<row>`, `<el>`, `<text>`, `<input>`, `<icon>`) or
HTML ones, styled with CSS in `<style>` or with Rune's builder methods as attributes
(`gap={16}`, `w_full`, `fill="#111"`, `motion={tok.motion.SNAPPY}`). The kit's controls are in
`@runex-js/svelte/kit`. See the
[@runex-js/svelte README](https://www.npmjs.com/package/@runex-js/svelte) for the details.
