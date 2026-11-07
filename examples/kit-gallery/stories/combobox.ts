// Rune's own combobox scenes; there is no Storybook story to match.

import type { El, Tx } from "runex-js"
import { Combobox, ComboboxOption, type Kit } from "runex-js/kit"

import type { G } from "../main.ts"

export function searchable(s: G, k: Kit, layer: El[]): El {
  return models(s, false).build(k, layer)
}

/** The same list, crossfading each keystroke's rows and springing the popover's height. */
export function animated_filter(s: G, k: Kit, layer: El[]): El {
  return models(s, true).build(k, layer)
}

function models(s: G, animate: boolean): Combobox {
  const options = Array.from({ length: 200 }, (_, i) =>
    ComboboxOption.new(`model-${i}`, `Model ${String(i).padStart(3, "0")}`)
  )
  return Combobox.new("model", s.combo, options, (s: G) => s.combo)
    .label("Model").placeholder("Choose model").current(s.pick.get("model") ?? null)
    .animate_filtering(animate)
    .on_choose((s: G, id: string, _: Tx) => { s.pick.set("model", id) })
}
