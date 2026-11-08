// Editor-only: the language server compiles `.svelte` itself without src/compile.ts's options, so
// it would report DOM accessibility advice that doesn't apply to Rune. Nothing at runtime reads this.
export default {
  compilerOptions: {
    experimental: { customRenderer: "@runex-js/svelte/renderer" },
    warningFilter: (warning) => !warning.code.startsWith("a11y_"),
  },
}
