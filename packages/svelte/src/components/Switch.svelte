<!-- rune_kit's Switch: `<Switch label="Wi-Fi" bind:checked={wifi} />`. -->
<script lang="ts">
  import { Switch } from "runex-js/kit"
  import type { ControlSize } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  let {
    checked = $bindable(false),
    label,
    description,
    hide_label = false,
    disabled = false,
    control_size,
    /** `"standard"` (the default) or `"web"`, the kit's two looks. */
    look,
    ontoggle,
    ...rest
  }: {
    checked?: boolean
    label?: string
    description?: string
    hide_label?: boolean
    disabled?: boolean
    control_size?: ControlSize
    look?: "standard" | "web"
    ontoggle?: (checked: boolean) => void
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { checked, label, description, hide_label, disabled, control_size, look }
    return (ctx: BuildContext) => {
      let b = Switch.new(p.checked)
      if (p.label) b = b.label(p.label)
      if (p.description) b = b.description(p.description)
      if (p.hide_label) b = b.hide_label()
      if (p.disabled) b = b.disabled(true)
      if (p.control_size) b = b.control_size(p.control_size)
      if (p.look === "web") b = b.web()
      else if (p.look === "standard") b = b.standard()
      b = b.on_toggle(ctx.handler(() => {
        checked = !checked
        ontoggle?.(checked)
      }))
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
