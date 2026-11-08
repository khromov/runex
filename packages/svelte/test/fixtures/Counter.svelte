<script lang="ts">
  let { start = 0, onchange }: { start?: number; onchange?: (n: number) => void } = $props()
  // svelte-ignore state_referenced_locally
  let count = $state(start)
  let items = $state(["a", "b", "c"])
  export function reverse() {
    items = [...items].reverse()
  }
  export function drop(item: string) {
    items = items.filter((x) => x !== item)
  }
</script>

<column class="box" gap={8}>
  <text key="count">Count: {count}</text>
  <el key="inc" onpress={() => { count++; onchange?.(count) }} onclick={() => {}} class:active={count > 2}></el>
  {#if count > 1}
    <text key="big">big</text>
  {/if}
  {#each items as item (item)}
    <row key="item-{item}">{item}</row>
  {/each}
  <el key="hidden" style="display: none"></el>
</column>

<style>
  .box {
    padding: 4px 8px;
    background: #000;
  }
  el.active {
    opacity: 0.5;
  }
  .box :global(.x) {
    color: red;
  }
  el:hover {
    background: #fff;
  }
</style>
