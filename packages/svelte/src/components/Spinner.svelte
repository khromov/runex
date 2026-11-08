<!-- rune_kit's Spinner: `<Spinner size={20} />`. -->
<script lang="ts">
  import { Spinner } from "runex-js/kit"
  import { parse_color } from "../color.ts"
  import type { Color } from "runex-js"
  import type { BuildContext } from "../types.ts"

  let {
    size,
    color,
    ...rest
  }: {
    size?: number
    color?: Color | string
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { size, color }
    return (ctx: BuildContext) => {
      let b = Spinner.new()
      if (p.size) b = b.size(p.size)
      const c = typeof p.color === "string" ? parse_color(p.color) : p.color
      if (c) b = b.color(c)
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
