// `bunx runex-svelte examples/hello/main.ts` opens the window; add `--snap hello.png --scene on`
// to render it headless.
import { render_hot } from "@runex-js/svelte"
import { lights } from "./state.svelte.ts"

render_hot(new URL("./App.svelte", import.meta.url), {
  title: "Hello",
  size: [320, 200],
  scenes: [["on", () => (lights.on = true)]],
})
