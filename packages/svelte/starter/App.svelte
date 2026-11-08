<!--
  Your app. Edit and save: the window reloads in place. Markup is Rune's elements (<column>, <row>,
  <el>, <text>, <input>) or HTML ones; style them with CSS or with Rune's builder methods as
  attributes (`gap={16}`, `w_full`, `fill="#111"`). Kit controls come from @runex-js/svelte/kit.
-->
<script lang="ts">
  import { Button } from "@runex-js/svelte/kit"

  let count = $state(0)
</script>

<column class="app">
  <column class="card">
    <text class="count">{count}</text>
    <row class="buttons">
      <Button key="minus" label="−" onpress={() => count--} />
      <Button key="plus" label="+" variant="Submit" onpress={() => count++} />
    </row>
    <text class="hint">Edit App.svelte and save: the window hot-reloads.</text>
  </column>
</column>

<style>
  .app {
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    background: #000000;
  }
  .card {
    padding: 32px 40px;
    gap: 20px;
    align-items: center;
    border-radius: 16px;
    border: 1px solid #242424;
    background: #0e0e0e;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  }
  .count {
    font-size: 56px;
    font-weight: 700;
    color: #ededed;
  }
  .buttons {
    gap: 10px;
  }
  .hint {
    font-size: 12px;
    color: #8f8f8f;
  }
</style>
