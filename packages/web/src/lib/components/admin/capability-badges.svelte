<script lang="ts">
  import { Capability } from "@open-macaron/contracts/capability";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import { capabilityInfo } from "#lib/capabilities.js";

  let { capabilities }: { capabilities: readonly Capability[] } = $props();

  // Always in the enum's order, whatever order they were granted in.
  const ordered = $derived(Capability.options.filter((capability) => capabilities.includes(capability)));
</script>

{#if ordered.length === Capability.options.length}
  <Badge variant="secondary">All capabilities</Badge>
{:else}
  <div class="flex flex-wrap gap-1">
    {#each ordered as capability (capability)}
      {@const info = capabilityInfo[capability]}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Badge variant="outline" {...props}>
              <info.icon />
              {info.label}
            </Badge>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{info.description}</Tooltip.Content>
      </Tooltip.Root>
    {/each}
  </div>
{/if}
