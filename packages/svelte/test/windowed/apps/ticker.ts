import { render_hot } from "@runex-js/svelte"

const entry = process.argv[2] ? new URL(`file://${process.argv[2]}`) : new URL("./Ticker.svelte", import.meta.url)
await render_hot(entry, { title: "Ticker", size: [240, 120] })
console.log("quit")
