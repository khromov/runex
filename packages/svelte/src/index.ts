// @runex-js/svelte: Svelte components rendered by Rune, through runex.
//
//   import { render_hot } from "@runex-js/svelte"
//   render_hot(new URL("./App.svelte", import.meta.url), { title: "My app", size: [640, 480] })
//
// Run it through the bin (`runex-svelte app.ts`), which installs the `.svelte` loader and the
// export conditions Svelte's custom renderer needs.
import { set_vars } from "./css.ts"
import { invalidate } from "./runtime.ts"

export { render, on_window_key, type RenderOptions } from "./render.ts"
export { render_hot } from "./hot.ts"
export { get_kit, set_kit, get_handle as app_handle, handler } from "./runtime.ts"
export { parse_color } from "./color.ts"
export { make_font } from "./build.ts"
export type { AnyComponent, BuildContext, RunexEvent, ShadowNode, TextProps } from "./types.ts"

/**
 * Sets CSS variables for `var(--name)` in `<style>` blocks and `style` attributes:
 * `set_css_vars({ surface: "#111", accent: "#e5484d" })`. A theme switch is one call; the next
 * frame re-resolves every style that read one. `null` removes a variable.
 */
export function set_css_vars(vars: Record<string, string | number | null | undefined>) {
  if (set_vars(vars)) invalidate()
}

/** True under this renderer: lets a component shared with a DOM build tell where it runs. */
export const IS_RUNEX = true
