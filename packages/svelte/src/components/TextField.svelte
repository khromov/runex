<!--
  rune_kit's TextField: a labelled one-line field. `<TextField label="Name" bind:value={name} />`;
  `onsubmit` runs on Return.
-->
<script lang="ts">
  import { TextEdit, type Tx } from "runex-js"
  import { TextField } from "runex-js/kit"
  import { after_turn } from "../runtime.ts"
  import type { BuildContext } from "../types.ts"

  let {
    value = $bindable(""),
    label = "",
    placeholder,
    error,
    hide_label = false,
    ghost = false,
    multiline = false,
    copyable = false,
    disabled = false,
    oninput,
    onsubmit,
    ...rest
  }: {
    value?: string
    label?: string
    placeholder?: string
    /** Shown under the field, in the error colour. */
    error?: string
    hide_label?: boolean
    /** No border or fill until hovered or focused. */
    ghost?: boolean
    multiline?: boolean
    copyable?: boolean
    disabled?: boolean
    oninput?: (value: string) => void
    onsubmit?: (value: string, tx: Tx) => void
    [attr: string]: unknown
  } = $props()

  // Rune edits this in place; `value` follows it after each edit, and it follows `value`.
  const edit = TextEdit.new(value)
  $effect.pre(() => {
    if (edit.text !== value) edit.replace_text(value)
  })

  function after_edit() {
    if (edit.text === value) return
    value = edit.text
    oninput?.(value)
  }

  const build = $derived.by(() => {
    const p = { value, label, placeholder, error, hide_label, ghost, multiline, copyable, disabled }
    return (ctx: BuildContext) => {
      let b = TextField.new(p.label, edit)
      if (p.placeholder) b = b.placeholder(p.placeholder)
      if (p.error) b = b.error(p.error)
      if (p.hide_label || !p.label) b = b.hide_label()
      if (p.ghost) b = b.ghost()
      if (p.multiline) b = b.multiline()
      if (p.copyable) b = b.copyable()
      if (p.disabled) b = b.disabled(true)
      b = b.on_edit(() => {
        // Called before Rune applies the edit: read the text once this turn is over.
        after_turn(after_edit)
        return edit
      })
      if (onsubmit) {
        const f = onsubmit
        b = b.on_action(ctx.handler((_s: unknown, tx: Tx) => {
          after_edit()
          f(edit.text, tx)
        }))
      }
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
