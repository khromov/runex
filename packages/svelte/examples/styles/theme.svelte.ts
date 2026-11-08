// Two palettes as CSS variables: `set_css_vars` swaps every `var(--...)` in one call.
import { set_css_vars } from "@runex-js/svelte"

export const PALETTES = {
  dark: { bg: "#0b0d12", card: "#151922", border: "#262c3a", text: "#e8ebf2", muted: "#8b93a7", accent: "#7c5cff", accent2: "#00c2ff" },
  light: { bg: "#f4f5f8", card: "#ffffff", border: "#e1e4ec", text: "#141824", muted: "#5d6578", accent: "#6a4cff", accent2: "#0090d6" },
} as const

export const theme = $state({ name: "dark" as keyof typeof PALETTES })

export function apply_theme(name: keyof typeof PALETTES) {
  theme.name = name
  set_css_vars(PALETTES[name])
}
