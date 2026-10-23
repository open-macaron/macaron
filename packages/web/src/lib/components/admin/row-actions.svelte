<script lang="ts">
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import type { Snippet } from "svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";

  /** `label` names the row for screen readers ("Actions for Company gateway"); `children` are the menu items. */
  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button variant="ghost" size="icon" class="size-8 text-muted-foreground data-[state=open]:bg-muted" {...props}>
        <EllipsisVerticalIcon />
        <span class="sr-only">{label}</span>
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-44">
    {@render children()}
  </DropdownMenu.Content>
</DropdownMenu.Root>
