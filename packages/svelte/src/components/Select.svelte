<!--
  rune_kit's Select: a trigger and a popup list. `<Select options={["Small", "Large"]} bind:value={size} />`.
  `options` can also be `[value, label]` pairs.
-->
<script lang="ts">
  import { Select } from "runex-js/kit"
  import type { Placement, SelectAppearance } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  const id = $props.id()

  let {
    options,
    value = $bindable(null),
    open = $bindable(false),
    label,
    placeholder,
    width,
    appearance,
    placement,
    disabled = false,
    invalid = false,
    key = `select-${id}`,
    onchange,
    ...rest
  }: {
    options: string[] | [value: string, label: string][]
    value?: string | null
    open?: boolean
    label?: string
    placeholder?: string
    width?: number
    appearance?: SelectAppearance
    placement?: Placement
    disabled?: boolean
    invalid?: boolean
    /** The popup anchors to the trigger by this key; unique per window. */
    key?: string
    onchange?: (value: string) => void
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { options, value, open, label, placeholder, width, appearance, placement, disabled, invalid, key }
    return (ctx: BuildContext) => {
      const pairs = p.options.length > 0 && Array.isArray(p.options[0])
      let b = pairs ? Select.grouped(p.key, p.options as [string, string][]) : Select.new(p.key, p.options as string[])
      b = b.current(p.value).open(p.open)
      if (p.label) b = b.label(p.label)
      if (p.placeholder) b = b.placeholder(p.placeholder)
      if (p.width) b = b.width(p.width)
      if (p.appearance) b = b.appearance(p.appearance)
      if (p.placement) b = b.placement(p.placement)
      if (p.disabled) b = b.disabled(true)
      if (p.invalid) b = b.invalid(true)
      b = b
        .on_toggle(ctx.handler(() => {
          open = !open
        }))
        .on_close(ctx.handler(() => {
          open = false
        }))
        .on_choose(ctx.handler((_s: unknown, choice: string) => {
          value = choice
          open = false
          onchange?.(choice)
        }))
      return b.build(ctx.kit, ctx.layer)
    }
  })
</script>

<raw attrs={rest} {build} />
