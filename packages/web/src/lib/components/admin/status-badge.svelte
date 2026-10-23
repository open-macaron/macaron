<script lang="ts" module>
  /** How a status reads at a glance; the label says what it is. */
  export type StatusTone = "success" | "pending" | "inactive" | "danger";
</script>

<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleMinusIcon from "@lucide/svelte/icons/circle-minus";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import LoaderIcon from "@lucide/svelte/icons/loader";
  import { Badge } from "#lib/components/ui/badge/index.js";

  let { tone, label }: { tone: StatusTone; label: string } = $props();
</script>

<!-- The dashboard block's status cell: an outline badge, the icon carrying the colour. -->
<Badge variant="outline" class="px-1.5 text-muted-foreground">
  {#if tone === "success"}
    <CircleCheckIcon class="fill-green-500 stroke-background dark:fill-green-400" />
  {:else if tone === "pending"}
    <LoaderIcon />
  {:else if tone === "danger"}
    <CircleXIcon class="fill-destructive stroke-background" />
  {:else}
    <CircleMinusIcon />
  {/if}
  {label}
</Badge>
