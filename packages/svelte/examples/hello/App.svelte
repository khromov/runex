<!--
  The smallest app, the Svelte twin of runex's examples/hello: one piece of state, a label and a
  switch that springs between its two positions. Rune attributes and CSS side by side.
-->
<script lang="ts">
  import { tok } from "runex-js"
  import { lights } from "./state.svelte.ts"

  const t = tok.theme(true)
  const { motion, type_ } = tok
</script>

<column w_full h_full center gap={16} fill={t.bg}>
  <text font={type_.TITLE} color={t.text}>{lights.on ? "Lights on" : "Lights off"}</text>
  <el
    key="switch"
    class="switch"
    role="switch"
    label="Lights"
    checked={lights.on}
    focusable
    fill={lights.on ? tok.accent(0, true) : t.control_off}
    motion={motion.SNAPPY}
    onpress={() => (lights.on = !lights.on)}
  >
    <el class="knob" fill={t.knob} absolute={[lights.on ? 18 : 2, 2]} />
  </el>
</column>

<style>
  .switch {
    width: 38px;
    height: 22px;
    border-radius: 11px;
  }
  .knob {
    width: 18px;
    height: 18px;
    border-radius: 9px;
  }
</style>
