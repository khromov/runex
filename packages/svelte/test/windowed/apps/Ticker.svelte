<!-- Counts on a timer, outside any Rune handler, and reports what each built frame showed. -->
<script lang="ts">
  import { onMount } from "svelte"
  import { app_handle } from "@runex-js/svelte"
  import type { BuildContext } from "@runex-js/svelte"

  let { label = "tick" }: { label?: string } = $props()
  let count = $state(0)

  onMount(() => {
    const id = setInterval(() => {
      count++
      if (count === 5) {
        clearInterval(id)
        setTimeout(() => app_handle()?.update((_s, tx) => tx.quit()), 100)
      }
    }, 60)
    return () => clearInterval(id)
  })

  // Rebuilt with `count`: the view calls it each frame it builds, so it logs what reached Rune.
  const build = $derived.by(() => {
    const seen = `${label}:${count}`
    return (_ctx: BuildContext) => {
      console.log(`frame ${seen}`)
      return null
    }
  })
</script>

<column w_full h_full center>
  <text>{label} {count}</text>
  <raw {build} />
</column>
