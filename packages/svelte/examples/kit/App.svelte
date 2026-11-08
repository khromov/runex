<!--
  The kit's core controls, as Svelte components, bound to one state object. Every control here is
  a rune_kit builder underneath; the layout around them is plain markup and CSS.
-->
<script lang="ts">
  import { get_kit } from "@runex-js/svelte"
  import { Button, Checkbox, Dialog, Progress, SegmentedControl, Select, Spinner, Switch, TextArea, TextField, Tooltip } from "@runex-js/svelte/kit"
  import { ui } from "./state.svelte.ts"

  const c = get_kit().c
</script>

<column class="page" fill={c.page} color={c.text_base}>
  <h2>Kit</h2>

  <row class="cards">
    <column class="card" fill={c.layer_01} border={[1, c.border_muted]}>
      <text class="heading" color={c.text_muted}>Toggles</text>
      <Switch key="wifi" label="Wi-Fi" bind:checked={ui.wifi} />
      <Switch key="bluetooth" label="Bluetooth" description="Off saves battery" bind:checked={ui.bluetooth} />
      <Checkbox key="remember" label="Remember me" bind:checked={ui.remember} />
      <Checkbox key="newsletter" label="Send me the newsletter" bind:checked={ui.newsletter} />
    </column>

    <column class="card" fill={c.layer_01} border={[1, c.border_muted]}>
      <text class="heading" color={c.text_muted}>Fields</text>
      <TextField key="name" label="Name" placeholder="Your name" bind:value={ui.name} w_full />
      <text key="greeting" color={c.text_muted}>Hello, {ui.name || "stranger"}!</text>
      <TextArea key="notes" placeholder="Notes" rows={3} bind:value={ui.notes} w_full />
      <Select key="size" label="Size" options={["Small", "Medium", "Large"]} bind:value={ui.size} bind:open={ui.size_open} />
    </column>
  </row>

  <column class="card wide" fill={c.layer_01} border={[1, c.border_muted]}>
    <text class="heading" color={c.text_muted}>Actions</text>
    <SegmentedControl key="view" segments={["List", "Grid", "Board"]} bind:selected={ui.view} />
    <row class="actions">
      <Button key="press" label="Pressed {ui.presses} times" onpress={() => ui.presses++} />
      <Tooltip label="Opens a dialog">
        <Button key="delete" label="Delete…" variant="Danger" onpress={() => (ui.confirm = true)} />
      </Tooltip>
      <Spinner size={16} />
    </row>
    <Progress value={ui.progress} label="Upload" show_value w_full />
  </column>

  <Dialog key="confirm" title="Delete the file?" description="This can't be undone." width={400} fit bind:open={ui.confirm}>
    <row class="dialog-actions">
      <Button key="cancel" label="Cancel" variant="Ghost" onpress={() => (ui.confirm = false)} />
      <Button key="really" label="Delete" variant="Danger" onpress={() => (ui.confirm = false)} />
    </row>
  </Dialog>
</column>

<style>
  .page {
    width: 100%;
    height: 100%;
    padding: 24px;
    gap: 16px;
  }
  .cards {
    gap: 16px;
  }
  .card {
    flex: 1;
    padding: 16px;
    gap: 12px;
    border-radius: 10px;
  }
  .wide {
    flex: none;
  }
  .heading {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .actions {
    gap: 8px;
    align-items: center;
  }
  .dialog-actions {
    width: 100%;
    padding: 16px;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
