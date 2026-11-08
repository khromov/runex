<!-- rune_kit's SegmentedControl: `<SegmentedControl segments={["Day", "Week"]} bind:selected={i} />`. -->
<script lang="ts">
  import { SegmentedControl } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  let {
    segments,
    selected = $bindable(0),
    label,
    width,
    fit = false,
    onchange,
    ...rest
  }: {
    segments: string[]
    /** The index of the selected segment, or null for none. */
    selected?: number | null
    label?: string
    width?: number
    /** Each segment as wide as its label, rather than equal widths. */
    fit?: boolean
    onchange?: (index: number) => void
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { segments, selected, label, width, fit }
    return (ctx: BuildContext) => {
      let b = SegmentedControl.new(p.segments, p.selected)
      if (p.label) b = b.label(p.label)
      if (p.width) b = b.width(p.width)
      if (p.fit) b = b.fit()
      b = b.on_pick(ctx.handler((_s: unknown, i: number) => {
        selected = i
        onchange?.(i)
      }))
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
