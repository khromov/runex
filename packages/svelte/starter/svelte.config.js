// Editor-only: the language server compiles components without the renderer's options, and
// would report DOM accessibility advice that doesn't apply to Rune. Nothing at runtime reads this.
export default {
  compilerOptions: {
    experimental: { customRenderer: "@runex-js/svelte/renderer" },
    warningFilter: (warning) => !warning.code.startsWith("a11y_"),
  },
}
