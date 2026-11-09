<script lang="ts">
  import { getChartContext, Tooltip } from "layerchart";
  import { z } from "zod";
  import { measures, type Measure } from "./measures.ts";

  let { measure }: { measure: Measure } = $props();

  const spec = $derived(measures[measure]);

  // The hovered bar's row, as model-bars.svelte built it: LayerChart types it `any`.
  const Row = z.object({ model: z.string(), runs: z.int(), value: z.number() });
  const chart = getChartContext();
  const row = $derived(Row.safeParse(chart.tooltip.data).data);
</script>

<Tooltip.Root variant="none">
  {#if row}
    <div class="grid min-w-40 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div class="font-medium">{row.model}</div>
      <div class="flex items-center gap-2">
        <div class="size-2.5 shrink-0 rounded-[2px] bg-(--chart-2)"></div>
        <span class="flex-1 text-muted-foreground">{spec.label}</span>
        <span class="font-mono font-medium text-foreground tabular-nums">{spec.format(row.value)}</span>
      </div>
      <div class="text-muted-foreground">{row.runs} {row.runs === 1 ? "run" : "runs"}</div>
    </div>
  {/if}
</Tooltip.Root>
