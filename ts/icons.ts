// `rune::text::set_icon_swap` (src/manual/icons.rs). `rune::text` has no namespace of its own
// here: the `text()` element takes the name, so this is exported from runex-js itself.
import native from "./native.js"
import type { Icon } from "./gen/types.js"

/**
 * Draws each icon `swap` gives another for as that one, and every icon as itself with `null`
 * (`rune::text::set_icon_swap`): an alternative icon set an app's setting turns on, such as
 * Desktop's New icons (`new_icons.new_icon` from runex-js/theme-opencode). Every window draws its
 * next frame with it; an icon keeps its element's size either way. Rust takes a `fn` pointer:
 * each distinct function takes one of 16 slots.
 */
export const set_icon_swap: (swap: ((icon: Icon) => Icon | null) | null) => void = native.set_icon_swap as any
