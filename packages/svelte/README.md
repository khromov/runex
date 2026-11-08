# @runex-js/svelte

Write [Rune](https://github.com/anomalyco/rune) apps as Svelte components. Rune is a GPU-rendered
Rust UI framework (wgpu + winit); [runex](https://www.npmjs.com/package/runex-js) binds it for
Node.js and Bun; this package is a Svelte custom renderer on top. Your components run in Node or
Bun, and Rune draws them in a native window.

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { tok } from "runex-js"
  let on = $state(false)
</script>

<column w_full h_full center gap={16} fill={tok.theme(true).bg}>
  <text font={tok.type_.TITLE}>{on ? "Lights on" : "Lights off"}</text>
  <el class="switch" fill={on ? "#3b82f6" : "#3f3f46"} motion={tok.motion.SNAPPY} onpress={() => (on = !on)}>
    <el class="knob" absolute={[on ? 18 : 2, 2]} />
  </el>
</column>

<style>
  .switch { width: 38px; height: 22px; border-radius: 11px; }
  .knob { width: 18px; height: 18px; border-radius: 9px; background: white; }
</style>
```

```ts
// app.ts
import { render_hot } from "@runex-js/svelte"

render_hot(new URL("./App.svelte", import.meta.url), { title: "Hello", size: [320, 200] })
```

```sh
npx runex-svelte app.ts                         # a window; saving App.svelte reloads it in place
npx runex-svelte app.ts --snap out.png          # one frame, headless, to a PNG
```

> [!WARNING]
> **Experimental.** This builds on Svelte's unreleased
> [custom renderer API](https://github.com/sveltejs/svelte/pull/18511), so each release bundles
> the exact Svelte build it was tested with (see [The Svelte version](#the-svelte-version)).

## Quick start

```sh
npm create runex-svelte@latest my-app
cd my-app
npm install
npm start
```

You need **Node.js 24+** or **Bun 1.4+**, on ARM64 macOS, Linux (glibc) or Windows, the platforms
runex ships its addon for. With Bun: `bun create runex-svelte my-app`, `bun install`, `bun run start`.

To add it to an existing project: `npm install @runex-js/svelte runex-js`, and run your entry
through the bin from `package.json` (`"start": "runex-svelte app.ts"`). The bin starts Node, or
Bun when it's launched by Bun or given `--bun` (`--node` forces Node). Before your entry loads, it
sets the `custom-renderer` export condition (without it `svelte` resolves to its server build and
there is no `mount()`) and installs the loader that compiles `.svelte` and `.svelte.ts` files.
Spelled out:

```sh
node --conditions custom-renderer --conditions development --import @runex-js/svelte/register app.ts
bun  --conditions custom-renderer --conditions development --preload @runex-js/svelte/plugin app.ts
```

Arguments after the entry go to your app, Rune's tooling flags included.

## How it works

Rune is immediate mode: an app's `view()` returns a fresh tree of `El` builders every frame it
draws, and Rune matches it to the previous one by key, which is what keeps hover, focus, scroll
positions, a field's caret and spring animations across frames. Svelte is fine-grained and
retained. This renderer keeps the tree Svelte builds as plain JavaScript objects, and the app's
`view()` walks it into `El` builders: elements become `el()`, `row()`, `col()`, `text()`,
`text_input()`...; attributes and CSS become builder calls; `on*` attributes become `on_*`
handlers. Every element gets a key unique for its lifetime (`n<id>`), so Rune sees the same
element frame after frame, even when a keyed `{#each}` moves it.

A handler Rune calls runs your Svelte code and flushes its effects before Rune builds the next
frame, so what it changed is in that frame. A change from anywhere else (a timer, a `fetch`, an
effect) asks Rune for a frame on the next microtask. An idle window draws nothing.

## Elements

| Tag | Builds | Notes |
| --- | --- | --- |
| `<el>` | `el()` | A box; children in a row, as in Rune. |
| `<row>`, `<column>` | `row()`, `col()` | `<col>` is an HTML void element to Svelte, so Rune's `col()` is `<column>`. |
| `<text>` | `text(content)` | Its text content, whitespace collapsed as in HTML. Nested elements contribute their text. |
| `<input>`, `<textarea>` | `text_input(edit, font)` | One line, and many. See [Text input](#text-input). |
| `<spacer>` | `spacer()` | Takes the free space along its parent's main axis. |
| `<icon icon={...} size={16}>` | `icon(i, size)` | Takes the inherited text colour. |
| `<rich content spans>` | `rich(content, spans)` | Styled spans of one text. |
| `<canvas shape={...}>` | `canvas(shape)` | |
| `<effect mark={1}>` | `effect(mark)` | An effect slot for a compositor. |
| `<raw build={(ctx) => El}>` | anything | See [`<raw>`](#raw-any-el-by-hand). |
| `div`, `section`, `header`, `main`, `footer`, `nav`, `article`, `aside`, `form`, `ul`, `ol`, `li`, `a` | `col()` | A column, as a block stacks its children, or a row under `display: flex` (CSS's default direction). |
| `button` | `col()` | Also `role("button")` and focusable. |
| `span`, `p`, `label`, `strong`, `b`, `em`, `i`, `small`, `code`, `h1`–`h6` | `text()` | With a type style: headings larger and bold, `strong` bold, `em` italic, `code` mono. |

Any other tag renders as a box, with a one-time warning.

## Attributes are El methods

Every builder method of Rune's `El` is an attribute with the same name, snake_case included:

```svelte
<row gap={8} w_full padding={12} radius={6} fill={t.card} motion={tok.motion.SNAPPY} />
```

- A method without arguments is a flag: `<el w_full center>`, or `w_full={cond}`.
- One argument is the value: `gap={8}`, `fill={color}`, `focusable={true}`, `cursor="Pointer"`.
- Several arguments are an array: `size={[38, 22]}`, `absolute={[x, y]}`, `border={[1, t.line]}`.
- A static attribute is a string, coerced by the parameter's type: `gap="8"` and `gap="8px"` are
  numbers, `size="38 22"` is two, `fill="#1e1e2e"` and `fill="rgb(30 30 46)"` are colours,
  `focusable` alone is `true`.
- Values held across frames are copied for each frame, so a non-`Copy` Rune value
  (`transition={t}`) can be passed as is.
- HTML spellings with a Rune counterpart work too: `aria-label` (`label`), `title` (`help`),
  `tabindex` (`tab_index`), `aria-expanded`, `aria-hidden`; kebab-case names are snake_case
  (`w-full` is `w_full`).

Four attributes are the renderer's own:

- `key`: Rune's identity for the element (default: unique per element). Set it where you need a
  stable name: a `--script` event targets elements by key, and an element keeps its Rune state
  (focus, scroll, animation) across remounts only under the same key. Keys must be unique among
  siblings.
- `color` and `font`: the text colour and type style (`font={tok.type_.TITLE}`) of the element
  and its descendants, inherited as in CSS.
- `attrs={rest}`: attributes and `on*` handlers forwarded as one object, the way a component
  passes its rest props on. Svelte drops functions from a `{...spread}` on a custom renderer's
  elements, so a spread loses handlers; `attrs` keeps them. The element's own attributes win.

The editor and `svelte-check` type every attribute from `El`'s own signatures (see
[TypeScript](#typescript)).

## Events

`on<name>` attaches Rune's `on_<name>`: `onpress`, `ondouble_press`, `onsecondary_press`,
`onhover_change`, `onkey`, `onkey_up`, `ondrag`, `ondrag_start`, `ondrag_end`, `ondrop_files`,
`onlayout`, `onvisible`, `onscroll_offset`, `onsubmit`, `onwheel`, `onlink`, ... (all 50 of them).
The DOM names map onto Rune's:

| DOM | Rune |
| --- | --- |
| `onclick` | `onpress` |
| `ondblclick` | `ondouble_press` |
| `oncontextmenu` | `onsecondary_press` |
| `onkeydown`, `onkeyup` | `onkey`, `onkey_up` |
| `onmouseenter`, `onmouseleave` | `onhover_change` (entering, leaving) |
| `onmousemove`, `onpointermove` | `onpointer_move_local` |
| `oninput`, `onchange` | `oninput_change` |
| `onscroll` | `onscroll_offset` |
| `ondrop` | `ondrop_files` |

The handler gets one event: `type`, `target` (the element's node), `tx` (Rune's `Tx` where the
handler has one: focus, clipboard, windows, `tx.quit()`), Rune's arguments by name (`hovered`,
`rect`, `paths`, `key`, `mods`, `drag`, ...) and in `args`, and `value` for text inputs. Key
handlers need a focusable element (`focusable`) and consume the key when they return `true` or
call `preventDefault()`; otherwise it goes on to the app.

Window-wide shortcuts: `on_window_key(handler)` (or `render`'s `on_key`) hears every key nothing
focused consumed.

## Styling with CSS

`<style>` blocks, the `style` attribute and `style:`/`class:` directives become the same builder
calls attributes make. Class rules apply weakest first (tags, then classes, then source order),
then `style`, then attributes.

- **Selectors:** class and tag compounds (`.card`, `button.primary`, `.a.b`), and `:hover` /
  `:active`, which can change `background` (Rune's `hover()` and `press()` fills; `:active` also
  takes `transform: scale()`). Combinators, `:global`, attribute selectors, at-rules and nesting
  are refused with a warning naming the file.
- **Lengths** are points: `px`, `rem` (16 px), or a bare number. `width` also takes `%` and
  `100%` heights are `h_full`. There is no `em`, `vh` or `vw`.
- **Box:** `width`, `height`, `min-*`, `max-*`, `padding` and `margin` (1–4 values and the
  longhands), `gap`, `row-gap`, `column-gap`, `aspect-ratio`.
- **Flexbox:** `display: flex` / `none`, `flex-direction`, `flex-wrap`, `flex`, `flex-grow`,
  `flex-shrink`, `align-items`, `align-self`, `justify-content`.
- **Position:** `position: absolute` with `top`/`right`/`bottom`/`left` or `inset`;
  `position: relative` with `left`/`top` offsets.
- **Paint:** `background` (colours and `linear-gradient()`), `border` (width, style and colour;
  `dashed` and `dotted` dash), `border-radius` (1–4 values; `50%` makes a circle or pill),
  `box-shadow`, `opacity`, `outline`, `filter: blur()`, `backdrop-filter: blur()`, `transform`
  (`scale`, `rotate`, `translate`), `visibility: hidden`.
- **Text (inherited):** `color`, `font-size`, `font-weight`, `font-family` (`monospace`, or a
  family the app loaded), `font-style`, `line-height`, `letter-spacing`, `text-align`; and
  `white-space`, `text-overflow: ellipsis`, `line-clamp`, `text-transform`, `word-break`.
- **Other:** `overflow` (`auto`/`scroll` scrolls, `hidden` clips), `cursor`, `pointer-events: none`,
  `user-select`.
- **Colours:** hex (3, 4, 6, 8 digits), `rgb()`, `hsl()`, `oklch()`, named colours,
  `transparent`.

Anything else is dropped with one warning on stderr naming it; `transition` and `animation`
point at Rune's `motion` attribute, which animates any change to an element with a spring.

**Theming:** `var(--name, fallback)` works anywhere, against variables you set with
`set_css_vars({ surface: "#111", accent: "#e5484d" })`. A theme switch is one call; the next frame
re-resolves every style that reads one.

## Text input

`<input>` and `<textarea>` hold a Rune `TextEdit` that Rune edits in place:

```svelte
<input value={draft} placeholder="Something to do" oninput={(e) => (draft = e.value)} onsubmit={() => add(draft)} />
```

Setting `value` replaces the text (clearing the field after a submit works), `oninput` reports
each edit with `e.value`, `onsubmit` runs on Return. `type="password"` hides the text; any `El`
method applies (`single_line`, `max_lines`, `read_only`, `spellcheck`...). There is no
`bind:value` on these elements; the kit's `TextField` and `TextArea` components have it.

## Kit components

`@runex-js/svelte/kit` has Svelte components for rune_kit's core controls. Each builds with the
window's kit (`Kit.neutral(true)` unless `render`'s `kit` option or `set_kit()` gives another),
and extra attributes (`w_full`, `key`, `class`, `style`...) apply to the control.

| Component | Props |
| --- | --- |
| `Button` | `label`, `variant` (`"Submit"`, `"Danger"`, `"Ghost"`...), `size`, `control_size`, `icon`, `disabled`, `help`, `shortcut`, `onpress(tx)` |
| `IconButton` | `icon`, `label`, `variant`, `size`, `control_size`, `disabled`, `help`, `shortcut`, `onpress(tx)` |
| `Switch` | `bind:checked`, `label`, `description`, `hide_label`, `disabled`, `control_size`, `look` (`"standard"`/`"web"`), `ontoggle(checked)` |
| `Checkbox` | `bind:checked`, `label`, `description`, `indeterminate`, `hide_label`, `disabled`, `ontoggle(checked)` |
| `TextField` | `bind:value`, `label`, `placeholder`, `error`, `hide_label`, `ghost`, `multiline`, `copyable`, `disabled`, `oninput(value)`, `onsubmit(value, tx)` |
| `TextArea` | `bind:value`, `label`, `placeholder`, `rows`, `auto_grow={[min, max]}`, `max_height`, `disabled`, `invalid`, `spellcheck`, `oninput(value)`, `onsubmit(value, tx)` |
| `Select` | `options` (strings or `[value, label]` pairs), `bind:value`, `bind:open`, `label`, `placeholder`, `width`, `appearance`, `placement`, `disabled`, `invalid`, `onchange(value)` |
| `SegmentedControl` | `segments`, `bind:selected`, `label`, `width`, `fit`, `onchange(index)` |
| `Progress` | `value` (0..1, or `null` for indeterminate), `label`, `show_value` |
| `Spinner` | `size`, `color` |
| `Tooltip` | `label`, `placement`, `appearance`, `open`; its children are the trigger |
| `Dialog` | `bind:open`, `title`, `description`, `width`, `fit`, `click_outside`, `onclose()`; its children are the body |

```svelte
<script lang="ts">
  import { Button, Dialog, Switch } from "@runex-js/svelte/kit"
  let wifi = $state(true)
  let confirm = $state(false)
</script>

<Switch label="Wi-Fi" bind:checked={wifi} />
<Button label="Delete…" variant="Danger" onpress={() => (confirm = true)} />
<Dialog title="Delete the file?" width={400} fit bind:open={confirm}>
  <row w_full padding={16} gap={8} justify_end>
    <Button label="Cancel" variant="Ghost" onpress={() => (confirm = false)} />
    <Button label="Delete" variant="Danger" onpress={() => (confirm = false)} />
  </row>
</Dialog>
```

`Dialog`, `Select` and `Tooltip` draw their overlays into the window's overlay layer, over
everything else.

## `<raw>`: any El by hand

For anything else in runex (the other kit components, `fx`, `motion`), `<raw>` builds an `El` with
runex's own API, and puts it where the element is:

```svelte
<script lang="ts">
  import { Badge } from "runex-js/kit"
  import type { BuildContext } from "@runex-js/svelte"

  let { count }: { count: number } = $props()
  // A new function when `count` changes: that is what tells the renderer to rebuild.
  const build = $derived.by(() => {
    const n = count
    return (ctx: BuildContext) => Badge.new(String(n)).build(ctx.kit)
  })
</script>

<raw {build} />
```

`ctx` has the `kit`, the overlay `layer` (for builders that take one), Rune's `cx`, the element's
built `children()`, the inherited `color` and `font`, and `handler(f)`, which wraps a callback you
give a Rune builder (`Button.new("Save").on_press(ctx.handler(() => save()))`) so the Svelte state
it changes reaches the next frame.

## Rendering

```ts
render(Component, options?): Promise<void>          // resolves when the app quits
render_hot(url | path, options?): Promise<void>     // the same, remounting on every .svelte save
```

| Option | |
| --- | --- |
| `title`, `size`, `min_size` | The window: title, first size (default 800 × 600), smallest size. |
| `props` | The component's props. |
| `background` | The root's fill under the component (a CSS colour or a `Color`). |
| `kit` | The `Kit` (or a function making one) the kit components build with. |
| `scenes` | `[name, () => void][]`: named states for `--scene name` snapshots. |
| `on_key` | Window-wide key handler (keys nothing focused consumed). |
| `fonts`, `families` | Font files replacing the built-in Inter, and the sans/mono family names. |
| `app` | `(app) => void`: configure Rune's `App` before it runs (`app.standard_menus()`, `app.on_close(...)`). |
| `args` | Rune's arguments instead of the process's. |
| `titlebar` | macOS: `"native"` (default), a standard titled window with the content below its titlebar; `"overlay"`, Rune's own frame, the content under a transparent titlebar with the traffic lights over its corner. |
| `keep_alive` | Keep the process running after the app quits. By default it exits once the code awaiting `render()` has run, so a leftover timer can't keep a closed app (or a headless `--snap`) alive. |

Also exported: `set_css_vars`, `set_kit`/`get_kit`, `on_window_key`, `app_handle()` (Rune's
`AppHandle`: `update((s, tx) => tx.set_title(...))`, `refresh()`), `handler`, `parse_color`,
`make_font`, and the types `RunexEvent`, `BuildContext`, `ShadowNode`.

**Hot reload:** `render_hot` watches the entry's directory and remounts the component into the
same window when a `.svelte` file changes. `.svelte.ts` modules load once per process, so state
kept in one survives a reload; editing one (or any `.ts`) needs a restart, and says so. Don't
combine it with `bun --hot`, which re-evaluates Svelte's runtime.

**State outside components** goes in a `.svelte.ts` module (`export const ui = $state({...})`),
which both `app.ts` (for `scenes`) and components import.

## Headless: snapshots, trees and scripted input

Rune's tooling flags work on any app: `--snap out.png` renders one frame to a PNG, `--tree
out.json` writes the accessibility tree (roles, names, bounds, keys), `--scene name` applies a
scene first, and `--script events.json` drives input on a virtual clock, targeting elements by
`key`:

```json
[
  { "t": 0.1, "key": "draft" },
  { "t": 0.2, "type": "type", "text": "Buy milk" },
  { "t": 0.8, "type": "key", "name": "Enter" },
  { "t": 1.0, "key": "check-1" }
]
```

```sh
npx runex-svelte app.ts --script events.json --snap after.png --tree after.json
```

That makes a test of any app: render, assert on the tree, look at the PNG.

## TypeScript

The package ships its declarations. For the editor and `svelte-check` to type your markup as
Rune's elements (every `El` method an attribute), your `tsconfig.json` needs the `runexHTML`
namespace and the export conditions, plus `paths` to the Svelte bundled in the package:

```jsonc
{
  "compilerOptions": {
    "module": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "customConditions": ["custom-renderer", "development"],
    "types": ["node", "@runex-js/svelte/html"],
    "skipLibCheck": true,
    "paths": {
      "svelte": ["./node_modules/@runex-js/svelte/node_modules/svelte"],
      "svelte/*": ["./node_modules/@runex-js/svelte/node_modules/svelte/*"]
    }
  },
  "svelteOptions": { "namespace": "runexHTML" }
}
```

You'll also want a `*.svelte` module declaration and a `svelte.config.js` that turns off Svelte's
DOM accessibility advice; the starter (`npm create runex-svelte`) has all of it.

## The Svelte version

The custom renderer API is an open Svelte pull request. Each release of this package **bundles**
the exact build of it that it was tested with, in `node_modules/@runex-js/svelte/node_modules/svelte`,
and the loaders point every `svelte` import, yours included, at that copy. Keep `svelte` out of
your own `dependencies`; upgrading this package can change the Svelte build under you.

## Limits

- `<col>` is a void element to Svelte: use `<column>`.
- Svelte drops function values from a `{...spread}` on this renderer's elements: forward handlers
  with `attrs={rest}`.
- A `class` passed to a component (`<Button class="x">`) carries no styles from the parent's
  `<style>`, as on the web without `:global`; style it with attributes or `style`.
- `:hover` and `:active` change the background only; there is no `:focus` or `:nth-child`.
- Svelte's `transition:`, `in:`, `out:` and `animate:` are DOM features; use Rune's `motion`
  (springs on any change), `child_exit`, `enter_delay` and the `live_*` values instead.
- `bind:value` on `<input>` isn't supported; use `value` and `oninput`, or the kit's `TextField`.
- No `{@html}`, no DOM APIs: there is no document.

## Developing this package

It lives in the [runex](https://github.com/khromov/runex) repository at `packages/svelte`, as a Bun
workspace using the repo's own `runex-js` (build it first: `bun run build` at the root).

```sh
bun run typecheck        # tsc + svelte-check
bun run test:unit        # CSS, colours, attributes, the compiler, the shadow tree
bun run test:golden      # every example, scene and script, headless, on Bun and Node
bun run golden:update    # bless after reading the diff
bun run test:windowed    # real windows: timer updates, hot reload
bun run test:pack        # the packed packages in an app scaffolded by create-runex-svelte
bun run demo [name]      # open the examples (hello, todo, kit, styles)
bun run gen              # regenerate src/gen/el.ts after a Rune update (test:unit checks it)
bun run vendor           # move the bundled Svelte to the PR's head
bun run pack             # the npm tarball (scripts/publish.ts)
```

## License

MIT
