<!--
  rune_kit's Tooltip around its children: `<Tooltip label="Copy the link"><IconButton ... /></Tooltip>`.
  The tip shows while the pointer rests on the trigger.
-->
<script lang="ts">
  import type { Snippet } from "svelte"
  import { row } from "runex-js"
  import { Tooltip } from "runex-js/kit"
  import type { Placement, TooltipAppearance } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  const id = $props.id()

  let {
    label,
    placement,
    appearance,
    open,
    key = `tooltip-${id}`,
    children,
    ...rest
  }: {
    label: string
    placement?: Placement
    appearance?: TooltipAppearance
    /** Forces the tip open (true) or shut (false); unset, hover decides. */
    open?: boolean
    key?: string
    children?: Snippet
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { label, placement, appearance, open, key }
    return (ctx: BuildContext) => {
      const kids = ctx.children()
      const trigger = kids.length === 1 ? kids[0]! : row().children(kids)
      let b = Tooltip.new(p.key).label(p.label).trigger(trigger)
      if (p.placement) b = b.placement(p.placement)
      if (p.appearance) b = b.appearance(p.appearance)
      if (p.open !== undefined) b = b.open(p.open)
      return b.build(ctx.kit, ctx.layer)
    }
  })
</script>

<raw attrs={rest} {build}>{@render children?.()}</raw>
