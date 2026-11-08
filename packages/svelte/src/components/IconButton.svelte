<!-- rune_kit's IconButton: `<IconButton icon={icons.PLUS} label="Add" onpress={add} />`. -->
<script lang="ts">
  import { IconButton } from "runex-js/kit"
  import type { ButtonSize, ControlSize, IconButtonVariant } from "runex-js/kit"
  import type { Icon, Tx } from "runex-js"
  import type { BuildContext } from "../types.ts"

  let {
    icon,
    label,
    variant,
    size,
    control_size,
    disabled = false,
    help,
    shortcut,
    onpress,
    ...rest
  }: {
    icon: Icon
    /** What a screen reader says for it. */
    label?: string
    variant?: IconButtonVariant
    size?: ButtonSize
    control_size?: ControlSize
    disabled?: boolean
    help?: string
    shortcut?: string
    onpress?: (tx: Tx) => void
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { icon, label, variant, size, control_size, disabled, help, shortcut, onpress }
    return (ctx: BuildContext) => {
      let b = IconButton.new(p.icon)
      if (p.label) b = b.label(p.label)
      if (p.variant) b = b.variant(p.variant)
      if (p.size) b = b.size(p.size)
      if (p.control_size) b = b.control_size(p.control_size)
      if (p.disabled) b = b.disabled(true)
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
