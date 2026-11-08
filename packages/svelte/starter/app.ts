// `npm start` runs this through the runex-svelte bin, which installs the `.svelte` loader.
// Add `--snap app.png` to render one frame headless instead of opening a window.
import { render_hot } from "@runex-js/svelte"

await render_hot(new URL("./App.svelte", import.meta.url), {
  title: "runex-svelte starter",
  size: [480, 360],
})
