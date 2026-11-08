<!-- rune_kit's Checkbox: `<Checkbox label="Remember me" bind:checked={remember} />`. -->
<script lang="ts">
  import { Checkbox } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  let {
    checked = $bindable(false),
    label,
    description,
    indeterminate = false,
    hide_label = false,
    disabled = false,
    ontoggle,
    ...rest
  }: {
    checked?: boolean
    label?: string
    description?: string
    /** Drawn as a dash, as for a "some selected" parent. */
    indeterminate?: boolean
    hide_label?: boolean
    disabled?: boolean
    ontoggle?: (checked: boolean) => void
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { checked, label, description, indeterminate, hide_label, disabled }
    return (ctx: BuildContext) => {
      let b = Checkbox.new(p.checked)
      if (p.label) b = b.label(p.label)
      if (p.description) b = b.description(p.description)
      if (p.indeterminate) b = b.indeterminate(true)
      if (p.hide_label) b = b.hide_label()
      if (p.disabled) b = b.disabled(true)
      b = b.on_toggle(ctx.handler(() => {
        checked = !checked
        ontoggle?.(checked)
      }))
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
