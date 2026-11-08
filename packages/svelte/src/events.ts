// Svelte event attributes to El's `on_*` handlers. `onpress` is `.on_press`, any `on_x` Rune has
// is reachable as `onx` (`onhover_change`, `ondrop_files`), and the DOM names map onto Rune's:
// `onclick` → press, `onkeydown` → key, `oninput` → input_change, `onmouseenter`/`onmouseleave`
// → hover_change. Where Rune has a `_tx` variant the handler's event carries the `Tx`.
import type { El } from "runex-js"
import { EL_EVENTS } from "./gen/el.ts"
import { warn_once } from "./css.ts"
import { run_handler } from "./runtime.ts"
import type { EventHandler, RunexEvent, ShadowNode } from "./types.ts"

/** DOM event names → Rune's (the part after `on_`). */
const DOM: Record<string, string> = {
  click: "press",
  dblclick: "double_press",
  doubleclick: "double_press",
  contextmenu: "secondary_press",
  auxclick: "secondary_press",
  keydown: "key",
  keyup: "key_up",
  input: "input_change",
  change: "input_change",
  mouseenter: "hover_change",
  mouseleave: "hover_change",
  pointerenter: "hover_change",
  pointerleave: "hover_change",
  hover: "hover_change",
  mousemove: "pointer_move_local",
  pointermove: "pointer_move_local",
  scroll: "scroll_offset",
  dragstart: "drag_start",
  dragend: "drag_end",
  drop: "drop_files",
  wheel: "wheel",
}

/** Names for Rune's unnamed parameters (`v1`, `s1`, `items1`), per handler. */
const FIELDS: Record<string, string[]> = {
  on_hover_change: ["hovered"],
  on_hover_change_any: ["hovered"],
  on_layout: ["rect"],
  on_layout_tx: ["rect"],
  on_drawn_layout: ["rect"],
  on_drawn_layout_tx: ["rect"],
  on_screen_layout: ["rect"],
  on_visible: ["visible"],
  on_at_bottom: ["at_bottom"],
  on_drop_files: ["paths"],
  on_drop_rejected: ["paths"],
  on_drop_hover: ["hovering"],
  on_drop_rejected_hover: ["hovering"],
  on_link: ["url"],
  on_link_secondary: ["url"],
  on_paste: ["text"],
  on_step: ["value"],
  on_step_limit: ["at_limit"],
  on_window_focus: ["focused"],
  on_smart_magnify: ["x", "y"],
  on_visible_rows: ["range"],
}

/** The `on_*` method an event attaches to, or null if Rune has none. */
export function rune_method(type: string): string | null {
  const name = DOM[type] ?? type
  const tx = `on_${name}_tx`
  if (EL_EVENTS[tx]) return tx
  return EL_EVENTS[`on_${name}`] ? `on_${name}` : null
}

/** Whether an event fires for this call (`mouseenter` only on entering, `mouseleave` only on leaving). */
function passes(type: string, fields: Record<string, unknown>): boolean {
  if (type === "mouseenter" || type === "pointerenter") return fields.hovered === true
  if (type === "mouseleave" || type === "pointerleave") return fields.hovered === false
  return true
}

/**
 * Attaches every listener of `node` to `el`: one `on_*` call per Rune handler, which fans out to
 * every Svelte event that maps to it. `extra` adds fields (an input's `value`) at dispatch time.
 */
export function wire(el: El, node: ShadowNode, extra?: (method: string) => Record<string, unknown>): El {
  if (node.listeners.size === 0) return el
  const groups = new Map<string, string[]>()
  for (const [type, handlers] of node.listeners) {
    if (handlers.length === 0) continue
    const method = rune_method(type)
    if (!method) {
      warn_once(`event:${type}`, `<${node.name}> on${type}: Rune has no such event; ignored`)
      continue
    }
    let types = groups.get(method)
    if (!types) groups.set(method, (types = []))
    types.push(type)
  }
  let out = el as unknown as Record<string, (f: unknown) => El>
  for (const [method, types] of groups) {
    const spec = EL_EVENTS[method]!
    const callback = (...raw: unknown[]) => {
      const args = spec.state ? raw.slice(1) : raw
      const fields: Record<string, unknown> = {}
      const names = FIELDS[method] ?? []
      let unnamed = 0
      spec.args.forEach((name, i) => {
        const value = args[i]
        if (/^(v|s|items)\d$/.test(name)) fields[names[unnamed++] ?? name] = value
        else fields[name] = value
      })
      if (fields.key_event && typeof fields.key_event === "object") Object.assign(fields, { key: (fields.key_event as { key: unknown }).key, mods: (fields.key_event as { mods?: unknown }).mods })
      Object.assign(fields, extra?.(method))
      const consumed = dispatch(node, types, fields, args)
      return spec.returns === "boolean" ? consumed : undefined
    }
    out = out[method]!.call(out, callback) as unknown as Record<string, (f: unknown) => El>
  }
  return out as unknown as El
}

/** Runs the handlers of `types` on `node`; true when one consumed the event (returned true or prevented it). */
export function dispatch(node: ShadowNode, types: string[], fields: Record<string, unknown>, args: unknown[]): boolean {
  let consumed = false
  run_handler(() => {
    let stopped = false
    for (const type of types) {
      if (stopped) break
      const handlers = node.listeners.get(type)
      if (!handlers || !passes(type, fields)) continue
      let immediate = false
      const event: RunexEvent = {
        tx: null,
        ...fields,
        type,
        target: node,
        currentTarget: node,
        args,
        defaultPrevented: false,
        preventDefault() {
          event.defaultPrevented = true
        },
        stopPropagation() {
          stopped = true
        },
        stopImmediatePropagation() {
          stopped = true
          immediate = true
        },
      }
      for (const h of handlers.slice() as EventHandler[]) {
        const result = h.call(node, event)
        if (result === true || event.defaultPrevented) consumed = true
        if (immediate) break
      }
    }
  })
  return consumed
}
