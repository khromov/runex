<!--
  rune_kit's Dialog: a modal over the window while `open`. Its children are the body.
  `<Dialog title="Delete file?" bind:open>...<Button label="Delete" /></Dialog>`
-->
<script lang="ts">
  import type { Snippet } from "svelte"
  import { col } from "runex-js"
  import { Dialog } from "runex-js/kit"
  import type { BuildContext } from "../types.ts"

  const id = $props.id()

  let {
    open = $bindable(false),
    title,
    description,
    width,
    fit = false,
    click_outside = true,
    key = `dialog-${id}`,
    onclose,
    children,
    ...rest
  }: {
    open?: boolean
    title: string
    description?: string
    width?: number
    /** As wide as its body rather than the kit's dialog width. */
    fit?: boolean
    /** A click outside closes it (default true). */
    click_outside?: boolean
    key?: string
    onclose?: () => void
    children?: Snippet
    [attr: string]: unknown
  } = $props()

  const build = $derived.by(() => {
    const p = { open, title, description, width, fit, click_outside, key }
    return (ctx: BuildContext) => {
      let d = Dialog.new(p.key, p.title).open(p.open).click_outside(p.click_outside)
      if (p.description) d = d.description(p.description)
      if (p.width) d = d.width(p.width)
      if (p.fit) d = d.fit()
      d = d.on_close(ctx.handler(() => {
        open = false
        onclose?.()
      }))
      d = d.child(col().gap(12).children(ctx.children()))
      // The dialog draws into the overlay layer; in place it builds nothing.
      d.build(ctx.kit, ctx.layer)
      return null
    }
  })
</script>

<raw attrs={rest} {build}>{@render children?.()}</raw>
