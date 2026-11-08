<!--
  rune_kit's Button: `<Button label="Save" variant="Submit" onpress={save} />`. Extra attributes
  (`w_full`, `class`, `style`, ...) apply to the built El.
-->
<script lang="ts">
  import { Button } from "runex-js/kit"
  import type { ButtonSize, ButtonVariant, ControlSize } from "runex-js/kit"
  import type { Icon, Tx } from "runex-js"
  import type { BuildContext } from "../types.ts"

  let {
    label,
    variant,
    size,
    control_size,
    icon,
    disabled = false,
    expanded,
    help,
    shortcut,
    onpress,
    ...rest
  }: {
    label: string
    variant?: ButtonVariant
    size?: ButtonSize
    control_size?: ControlSize
    icon?: Icon
    disabled?: boolean
    expanded?: boolean
    help?: string
    /** A shortcut hint drawn in the button (`"⌘S"`); it doesn't bind the key. */
    shortcut?: string
    onpress?: (tx: Tx) => void
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { label, variant, size, control_size, icon, disabled, expanded, help, shortcut, onpress }
    return (ctx: BuildContext) => {
      let b = Button.new(p.label)
      if (p.variant) b = b.variant(p.variant)
      if (p.size) b = b.size(p.size)
      if (p.control_size) b = b.control_size(p.control_size)
      if (p.icon) b = b.icon(p.icon)
      if (p.disabled) b = b.disabled(true)
      if (p.expanded !== undefined) b = b.expanded(p.expanded)
      if (p.help) b = b.help(p.help)
      if (p.shortcut) b = b.shortcut(p.shortcut)
      if (p.onpress) {
        const f = p.onpress
        b = b.on_press_tx(ctx.handler((_s: unknown, tx: Tx) => {
          f(tx)
        }))
      }
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
