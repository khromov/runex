// The list, in a runes module so it survives hot reloads and the scenes in main.ts can set it.
export type Todo = { id: number; title: string; done: boolean }

export const todos = $state({
  items: ["Write the view", "Run it headless", "Ship it"].map((title, id): Todo => ({ id, title, done: id === 0 })),
  next: 3,
  draft: "",
})

export function add(title: string) {
  const t = title.trim()
  if (!t) return
  todos.items.push({ id: todos.next++, title: t, done: false })
  todos.draft = ""
}
