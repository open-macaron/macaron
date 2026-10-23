<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, description, actions }: { title: string; description: string; actions?: Snippet } = $props();
</script>

<div class="flex flex-wrap items-end justify-between gap-4">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
    <p class="text-sm text-muted-foreground">{description}</p>
  </div>
  {#if actions}
    <div class="flex items-center gap-2">{@render actions()}</div>
  {/if}
</div>
