<!-- rune_kit's TextArea: a multi-line field. `<TextArea bind:value={notes} rows={4} />`. -->
<script lang="ts">
  import { TextEdit, type Tx } from "runex-js"
  import { TextArea } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  let {
    value = $bindable(""),
    label,
    placeholder,
    rows,
    auto_grow,
    max_height,
    disabled = false,
    invalid = false,
    spellcheck,
    oninput,
    onsubmit,
    ...rest
  }: {
    value?: string
    label?: string
    placeholder?: string
    rows?: number
    /** `[min_rows, max_rows]`: grows with its text between the two. */
    auto_grow?: [number, number]
    max_height?: number
    disabled?: boolean
    invalid?: boolean
    spellcheck?: boolean
    oninput?: (value: string) => void
    /** Return (Shift+Return breaks the line). */
    onsubmit?: (value: string, tx: Tx) => void
    [attr: string]: unknown
  } = $props()

  const edit = TextEdit.new(value)
  $effect.pre(() => {
    if (edit.text !== value) edit.replace_text(value)
  })

  const build = $derived.by(() => {
    const p = { value, label, placeholder, rows, auto_grow, max_height, disabled, invalid, spellcheck }
    return (ctx: BuildContext) => {
      let b = TextArea.new(edit)
      if (p.label) b = b.label(p.label)
      if (p.placeholder) b = b.placeholder(p.placeholder)
      if (p.rows) b = b.rows(p.rows)
      if (p.auto_grow) b = b.auto_grow(p.auto_grow[0], p.auto_grow[1])
      if (p.max_height) b = b.max_height(p.max_height)
      if (p.disabled) b = b.disabled(true)
      if (p.invalid) b = b.invalid(true)
      if (p.spellcheck !== undefined) b = b.spellcheck(p.spellcheck)
      b = b.on_edit(() => edit)
      b = b.on_change(ctx.handler(() => {
        if (edit.text === value) return
        value = edit.text
        oninput?.(value)
      }))
      if (onsubmit) {
        const f = onsubmit
        b = b.on_submit(ctx.handler((_s: unknown, tx: Tx) => {
          f(edit.text, tx)
        }))
      }
      return b.build(ctx.kit)
    }
  })
</script>

<raw attrs={rest} {build} />
