// `bunx runex-svelte examples/styles/main.ts`; `--snap styles.png --scene light` renders headless.
import { render_hot } from "@runex-js/svelte"
import { apply_theme } from "./theme.svelte.ts"

apply_theme("dark")

render_hot(new URL("./App.svelte", import.meta.url), {
  title: "Styles",
  size: [760, 520],
  scenes: [["light", () => apply_theme("light")]],
})
