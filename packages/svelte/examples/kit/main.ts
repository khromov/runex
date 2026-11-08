// `bunx runex-svelte examples/kit/main.ts`; `--snap kit.png --scene dialog` renders headless.
import { render_hot } from "@runex-js/svelte"
import { ui } from "./state.svelte.ts"

render_hot(new URL("./App.svelte", import.meta.url), {
  title: "Kit",
  size: [720, 560],
  scenes: [
    ["dialog", () => (ui.confirm = true)],
    ["select", () => (ui.size_open = true)],
  ],
})
