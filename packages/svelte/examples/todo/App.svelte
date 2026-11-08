<!--
  A list with state, the Svelte twin of runex's examples/todo: keyed rows you can add, tick off and
  remove; the progress bar springs to its new width. Styled with a <style> block.
-->
<script lang="ts">
  import { Spring, tok } from "runex-js"
  import { todos, add } from "./state.svelte.ts"

  const t = tok.theme(true)
  const accent = tok.accent(0, true)
  const done = $derived(todos.items.filter((x) => x.done).length)
</script>

<column class="app" fill={t.bg} color={t.text}>
  <el class="track" fill={t.control_off}>
    <el class="bar" fill={accent} w_frac={done / Math.max(todos.items.length, 1)} motion={Spring.new(0.4, 0.2)} />
  </el>

  <column key="list" class="list" scroll={{ stick_bottom: true }}>
    {#each todos.items as todo (todo.id)}
      <row key="todo-{todo.id}" class="row" fill={t.card}>
        <el
          key="check-{todo.id}"
          class="check"
          fill={todo.done ? accent : t.control_off}
          onpress={() => (todo.done = !todo.done)}
        ></el>
        <text class="title" color={todo.done ? t.text_secondary : t.text}>{todo.title}</text>
        <text
          key="remove-{todo.id}"
          class="remove"
          color={t.text_secondary}
          onpress={() => (todos.items = todos.items.filter((x) => x.id !== todo.id))}>Remove</text
        >
      </row>
    {/each}
  </column>

  <row class="composer" fill={t.card}>
    <input
      key="draft"
      class="draft"
      placeholder="Something to do"
      value={todos.draft}
      oninput={(e) => (todos.draft = e.value ?? "")}
      onsubmit={() => add(todos.draft)}
    />
    <text key="add" class="add" color={accent} onpress={() => add(todos.draft || `Todo ${todos.next + 1}`)}>Add</text>
  </row>
</column>

<style>
  .app {
    width: 100%;
    height: 100%;
    padding: 24px;
    gap: 12px;
  }
  .track {
    width: 100%;
    height: 4px;
    border-radius: 2px;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
  }
  .list {
    gap: 4px;
    flex-shrink: 1;
    min-height: 0;
  }
  .row {
    height: 36px;
    padding: 0 12px;
    gap: 12px;
    align-items: center;
    border-radius: 6px;
  }
  .check {
    width: 16px;
    height: 16px;
    border-radius: 8px;
    cursor: pointer;
  }
  .title {
    flex-grow: 1;
  }
  .remove,
  .add {
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }
  .composer {
    height: 36px;
    padding: 0 12px;
    gap: 12px;
    align-items: center;
    border-radius: 6px;
  }
  .draft {
    flex-grow: 1;
  }
</style>
