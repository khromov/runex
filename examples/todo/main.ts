// A list with state: keyed rows you can add, tick off and remove. Rows animate in and out on
// their own and the progress bar springs to its new width; the view only says where things are.
// `bun examples/todo/main.ts -- --snap todo.png`.

import { AppSpec, type Cx, type El, Spring, col, el, row, run, text, tok } from "runex-js"
const { radius, type_ } = tok
type Theme = tok.Theme

type Todo = { id: number; title: string; done: boolean }

type State = { todos: Todo[]; next: number }

function State_default(): State {
  const titles = ["Write the view", "Run it headless", "Ship it"]
  const todos = titles.map((title, id): Todo => ({ id, title, done: id === 0 }))
  return { todos, next: 3 }
}

function view(s: State, _: Cx): El {
  const t = tok.theme(true)
  let list = col().key("list").gap(4.0)
  for (const todo of s.todos) {
    const id = todo.id
    const check = el().key("check").size(16.0, 16.0).radius(8.0)
      .fill(todo.done ? tok.accent(0, true) : t.control_off)
      .on_press((s: State) => {
        const t = s.todos.find((t) => t.id === id)
        if (t) t.done = !t.done
      })
    const title = text(todo.title).font(type_.BODY).grow(1.0)
      .color(todo.done ? t.text_secondary : t.text)
    const remove = text("Remove").font(type_.LABEL).color(t.text_secondary)
      .on_press((s: State) => { s.todos = s.todos.filter((t) => t.id !== id) })
    list = list.child(
      row().key(`todo-${id}`).h(36.0).px(12.0).gap(12.0).center_y()
        .radius(radius.SM).fill(t.card)
        .child(check).child(title).child(remove),
    )
  }
  const add = text("Add a todo").key("add").font(type_.LABEL).color(tok.accent(0, true))
    .on_press((s: State) => {
      s.todos.push({ id: s.next, title: `Todo ${s.next + 1}`, done: false })
      s.next += 1
    })
  const done = s.todos.filter((t) => t.done).length
  return col().w_full().h_full().padding(24.0).gap(12.0).fill(t.bg)
    .child(progress(done, s.todos.length, t))
    // Past what the window holds, the list scrolls, following new rows, and "Add" stays.
    .child(list.scroll({ stick_bottom: true }).shrink().min_h(0.0))
    .child(add)
}

function progress(done: number, total: number, t: Theme): El {
  const width = Math.fround(Math.fround(312.0 * done) / Math.max(total, 1))
  return el().key("track").w_full().h(4.0).radius(2.0).fill(t.control_off).child(
    el().key("bar").w(width).h(4.0).radius(2.0).fill(tok.accent(0, true))
      .motion(Spring.new(0.4, 0.2)),
  )
}

run(AppSpec.new<State>("Todo", [360.0, 240.0], State_default, view))
