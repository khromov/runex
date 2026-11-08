# packages/svelte (@runex-js/svelte)

A Svelte custom renderer for runex, modeled on gpuix-svelte (github.com/khromov/gpuix-svelte),
whose CLAUDE.md explains the Svelte side (loaders, vendored build, compile options) at length. The
package README is the user-facing reference; this file is how it's built.

## Commands

Run from `packages/svelte`; the repo root must have a built `runex-js` (`bun run build`, or
`./scripts/dev-install.sh` + `bun run build:ts`), which the workspace links as `node_modules/runex-js`.

```sh
bun run typecheck        # tsc + svelte-check (namespace runexHTML)
bun run test:unit        # needs --conditions custom-renderer (the script passes it)
bun run test:golden      # examples × scenes × scripts, headless, Bun and Node; trees + darwin PNG manifest
bun run golden:update    # bless; read the tree diffs first
bun run test:windowed    # timer-driven updates and render_hot in real windows
bun run test:pack        # scripts/publish.ts pack → create-runex-svelte app → tsc, svelte-check, renders
node bin/runex-svelte.js [--bun|--node] examples/kit/main.ts --snap out.png [--scene x] [--script s.json] [--tree t.json]
bun run gen              # src/gen/el.ts from ../../tools/bindgen/surface.txt (after a Rune update)
bun run vendor [sha]     # move vendor/svelte-*.tgz to PR #18511's head
```

## Architecture

Rune is immediate mode, so unlike gpuix there are no native ids, mutation batches or destroy
bookkeeping: the shadow tree is the source of truth and `view()` rebuilds the El tree from it.

- `renderer.ts`: `createRenderer` over `ShadowNode`s (linked children). Every mutation calls
  `invalidate()`. `attrs` is what builds (own attributes over `attrs={...}`-forwarded ones), `own`
  is what Svelte set (what `getAttribute` returns).
- `runtime.ts`: `invalidate()` (microtask → `AppHandle.refresh()`), `run_handler` (catches, then
  `flushSync()` so a handler's changes are in the frame Rune builds next), `after_turn` (drained by
  `view()`; TextField reads its `TextEdit` there, since a headless script never yields to
  microtasks), the `<style>` sheets, the kit.
- `build.ts`: tag → constructor, `resolve()` (class rules, then `style`, then attributes → ops,
  cached on the node until an attribute changes or a `set_css_vars` generation passes), inherited
  text props (`color`, `font`, CSS text properties), `apply()` (clones class values; a failing op
  warns once and is skipped), `<input>` (a `TextEdit` per node), `<raw>`.
- `css.ts`: declarations → ops. `attrs.ts`: attribute → op via `gen/el.ts`'s parameter kinds.
  `events.ts`: Svelte event names → `on_*` (DOM aliases, `_tx` variants preferred), dispatch.
- `render.ts`: one `App` per process on `globalThis.__runex_svelte_host`; a second `render()`
  remounts. `hot.ts`: render_hot. `compile.ts`, `register.ts` (Node), `plugin.ts` (Bun).
- `components/*.svelte`: kit wrappers over `<raw attrs={rest} {build}>`, `build` a `$derived.by`
  closure so a prop change sets a new attribute (that's what invalidates).

## Invariants

- Rune callbacks taking the state must not return a value (it would replace Rune's state): give
  them block bodies. Bool-returning ones (`on_key`) return whether the event was consumed.
- Svelte's `set_attributes` (any element with a spread) drops function values on a custom
  renderer: components forward with `attrs={rest}`, never `{...rest}`.
- `<col>` is void to Svelte: the column tag is `<column>`.
- Keys: `n<id>` unless the element sets `key`. A kit component's built El keeps its own keys
  unless `key` is given (Select anchors its popup by key).
- TypeScript runs as-is in the repo (`exports` → `src/*.ts`); only the npm tarball has `lib/`
  (scripts/publish.ts, which also bundles the vendored svelte and rewrites the components'
  `../x.ts` imports). Keep sources erasable-syntax only, with explicit `.ts` specifiers.
- Renders a test spawns use `test/env.ts`'s `render_env()` (no RUNEX_PERF/RUNEX_TITLEBAR).
- A golden render must log nothing but `rune:` lines: a warning is a regression.
- Versions move in lockstep with runex-js (CI's publish job checks); the peer range is computed
  from the root version at pack time.
