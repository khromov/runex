<!-- rune_kit's Progress bar: `<Progress value={0.4} label="Uploading" show_value />`; no value is indeterminate. -->
<script lang="ts">
  import { Progress } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  let {
    value = null,
    label,
    show_value = false,
    ...rest
  }: {
    /** 0..1, or null for an indeterminate bar. */
    value?: number | null
    label?: string
    show_value?: boolean
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { value, label, show_value }
    return (ctx: BuildContext) => {
      let b = Progress.new(p.value)
      if (p.label) b = b.label(p.label)
      if (p.show_value) b = b.show_value()
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
