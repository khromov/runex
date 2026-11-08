<script lang="ts">
  let { ...rest }: Record<string, unknown> = $props()
</script>

<el key="fwd" attrs={rest} gap={2}></el>
