// `bunx runex-svelte examples/todo/main.ts`; `--snap todo.png --scene all-done` renders headless.
import { render_hot } from "@runex-js/svelte"
import { todos } from "./state.svelte.ts"

render_hot(new URL("./App.svelte", import.meta.url), {
  title: "Todo",
  size: [360, 280],
  scenes: [
    ["all-done", () => todos.items.forEach((t) => (t.done = true))],
    ["empty", () => (todos.items = [])],
  ],
})
