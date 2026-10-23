<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";

  let { rows = 4 }: { rows?: number } = $props();
</script>

<div class="grid gap-4 p-6" aria-busy="true" aria-label="Loading">
  {#each { length: rows }, row (row)}
    <div class="flex items-center gap-4">
      <Skeleton class="size-8 rounded-full" />
      <Skeleton class="h-4 w-40" />
      <Skeleton class="h-4 flex-1" />
      <Skeleton class="h-4 w-20" />
    </div>
  {/each}
</div>
