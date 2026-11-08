# Notes for coding agents

This is a Svelte 5 app rendered by Rune (a GPU UI framework) through `@runex-js/svelte`, not a
browser app. There is no DOM.

- Run: `npm start` (window, hot reload on `.svelte` saves). Check a change visually without a
  window: `npx runex-svelte app.ts --snap out.png` and look at the PNG; `--tree out.json` prints
  the accessibility tree (roles, names, bounds, keys). `--script events.json` drives clicks and
  typing headless: `[{"t": 0.1, "key": "plus"}, {"t": 0.3, "type": "type", "text": "hi"}]`
  targets elements by their `key` attribute.
- Elements: `<column>` (not `<col>`, which is an HTML void element), `<row>`, `<el>`, `<text>`,
  `<input>`, `<textarea>`, `<icon icon={...}>`, `<spacer>`, `<raw build={(ctx) => El}>`, plus
  HTML boxes (`div` is a column, a row under `display: flex`) and text tags (`span`, `p`, `h1`...).
- Any `El` builder method is an attribute, by its Rust/runex name: `gap={8}`, `w_full`,
  `size={[38, 22]}`, `fill={t.bg}`, `motion={tok.motion.SNAPPY}`. `on_*` handlers are events:
  `onpress`, `onhover_change`, `onkey` (DOM spellings `onclick`, `onkeydown`, `oninput` work too).
- CSS: class and tag selectors, `:hover`/`:active` (background only), px/rem lengths, flexbox,
  colours, gradients, borders, radius, shadows, `var(--x)` with `set_css_vars`. Unsupported CSS is
  dropped with a warning on stderr; read it.
- Text inputs report through events: `<input value={v} oninput={(e) => (v = e.value)} />`. Kit
  components support `bind:value`/`bind:checked`/`bind:open`.
- State shared with `app.ts` (or kept across hot reloads) goes in a `.svelte.ts` module.
- Run `npm run check` after editing.
