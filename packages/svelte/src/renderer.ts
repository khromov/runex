// The custom renderer every compiled component imports (`import $renderer from
// "@runex-js/svelte/renderer"`). Svelte hands it DOM-shaped operations; it keeps them in a plain
// JavaScript tree and marks the window dirty. Nothing native happens here: Rune is immediate
// mode, so `view()` (build.ts) reads the whole tree into El builders whenever Rune draws.
import { createRenderer } from "svelte/renderer"
import { invalidate } from "./runtime.ts"
import type { EventHandler, NodeKind, ShadowNode } from "./types.ts"

export { define_styles } from "./runtime.ts"

let next_id = 0

export function node(kind: NodeKind, name: string, data: string): ShadowNode {
  return {
    kind,
    id: ++next_id,
    name,
    data,
    attrs: {},
    own: {},
    forwarded: null,
    listeners: new Map(),
    parent: null,
    first: null,
    last: null,
    prev: null,
    next: null,
    resolved: null,
    edit: null,
  }
}

function link(parent: ShadowNode, child: ShadowNode, anchor: ShadowNode | null) {
  child.parent = parent
  if (anchor == null) {
    child.prev = parent.last
    child.next = null
    if (parent.last) parent.last.next = child
    else parent.first = child
    parent.last = child
  } else {
    child.prev = anchor.prev
    child.next = anchor
    if (anchor.prev) anchor.prev.next = child
    else parent.first = child
    anchor.prev = child
  }
}

function unlink(child: ShadowNode) {
  const parent = child.parent
  if (!parent) return
  if (child.prev) child.prev.next = child.next
  else parent.first = child.next
  if (child.next) child.next.prev = child.prev
  else parent.last = child.prev
  child.parent = null
  child.prev = null
  child.next = null
}

const is_event = (key: string, value: unknown) => key.startsWith("on") && typeof value === "function"

function add_listener(target: ShadowNode, type: string, handler: EventHandler) {
  let handlers = target.listeners.get(type)
  if (!handlers) target.listeners.set(type, (handlers = []))
  handlers.push(handler)
}

function remove_listener(target: ShadowNode, type: string, handler: EventHandler) {
  const handlers = target.listeners.get(type)
  if (!handlers) return
  const index = handlers.indexOf(handler)
  if (index !== -1) handlers.splice(index, 1)
  if (handlers.length === 0) target.listeners.delete(type)
}

/**
 * `attrs={rest}`: attributes and `on*` handlers forwarded as one object. Svelte drops functions from
 * a spread (`{...rest}`) on a custom renderer's element, so components forward this way; an
 * attribute set on the element itself wins over a forwarded one.
 */
function set_forwarded(el: ShadowNode, next: Record<string, unknown> | null) {
  for (const [k, v] of Object.entries(el.forwarded ?? {})) {
    if (is_event(k, v)) remove_listener(el, k.slice(2), v as EventHandler)
    else if (!(k in el.own)) delete el.attrs[k]
  }
  el.forwarded = next
  for (const [k, v] of Object.entries(next ?? {})) {
    if (v === undefined) continue
    if (is_event(k, v)) add_listener(el, k.slice(2), v as EventHandler)
    else if (!(k in el.own)) el.attrs[k] = v
  }
}

/** An attribute changed: the node's style is re-resolved, and an input's edit follows `value`. */
function changed(el: ShadowNode, key: string) {
  el.resolved = null
  if (key === "value" && el.edit) {
    const value = el.attrs.value
    const text = value == null ? "" : String(value)
    if (el.edit.text !== text) el.edit.replace_text(text)
  }
  invalidate()
}

type Nodes = { fragment: ShadowNode; element: ShadowNode; text: ShadowNode; comment: ShadowNode }
type RunexSvelteRenderer = ReturnType<typeof createRenderer<Nodes>>

const renderer: RunexSvelteRenderer = createRenderer<Nodes>({
  createFragment: () => node("fragment", "", ""),
  createElement: (name) => node("element", name, ""),
  createTextNode: (data) => node("text", "", data),
  createComment: (data) => node("comment", "", data),

  nodeType: (n) => n.kind,

  getNodeValue(n) {
    // Load-bearing for comments too: Svelte skips a leading comment only when this returns "",
    // and seeds its text diff from it.
    if (n.kind === "text" || n.kind === "comment") return n.data
    return null
  },

  getAttribute(el, name) {
    const value = el.own[name]
    if (value == null) return null
    return typeof value === "string" ? value : String(value)
  },

  setAttribute(el, key, value) {
    if (value == null) {
      renderer.removeAttribute(el, key)
      return
    }
    // Raw values, untouched: Svelte reads `style` back to merge `style:` directives into it.
    if (el.own[key] === value) return
    el.own[key] = value
    if (key === "attrs") set_forwarded(el, typeof value === "object" ? (value as Record<string, unknown>) : null)
    else el.attrs[key] = value
    changed(el, key)
  },

  removeAttribute(el, name) {
    if (!(name in el.own)) return
    delete el.own[name]
    if (name === "attrs") set_forwarded(el, null)
    else if (el.forwarded && name in el.forwarded && !is_event(name, el.forwarded[name])) el.attrs[name] = el.forwarded[name]
    else delete el.attrs[name]
    changed(el, name)
  },

  hasAttribute: (el, name) => name in el.own,

  setText(n, text) {
    if (n.kind === "element") {
      // `textContent =`: the element's children become one text node.
      while (n.first) unlink(n.first)
      if (text !== "") link(n, node("text", "", text), null)
    } else {
      if (n.data === text) return
      n.data = text
    }
    invalidate()
  },

  getFirstChild: (n) => n.first,
  getLastChild: (n) => n.last,
  getNextSibling: (n) => n.next,
  getParent: (n) => n.parent,

  insert(parent, n, anchor) {
    if (n.kind === "fragment") {
      // Inserting a fragment inserts its children, which leaves it empty, as in the DOM.
      for (let c = n.first, next: ShadowNode | null; c; c = next) {
        next = c.next
        renderer.insert(parent, c, anchor)
      }
      return
    }
    if (n.parent) unlink(n) // insert doubles as move
    link(parent, n, anchor)
    invalidate()
  },

  remove(n) {
    if (n.parent === null) return
    unlink(n)
    invalidate()
  },

  addEventListener(target, type, handler: EventHandler) {
    add_listener(target, type, handler)
    invalidate()
  },

  removeEventListener(target, type, handler: EventHandler) {
    remove_listener(target, type, handler)
    invalidate()
  },
})

export default renderer

/** The node an app's component mounts under; `view()` builds its children. */
export function create_root(): ShadowNode {
  return node("element", "root", "")
}

/** For tests and `<raw>` code: the text an input holds right now. */
export function input_value(n: ShadowNode): string {
  return n.edit?.text ?? String(n.attrs.value ?? "")
}
