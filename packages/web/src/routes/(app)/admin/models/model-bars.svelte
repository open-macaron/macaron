<script lang="ts">
  import { scaleBand } from "d3-scale";
  import { BarChart } from "layerchart";
  import * as Chart from "#lib/components/ui/chart/index.js";
  import { measures, type Measure, type ModelRow } from "./measures.ts";
  import ModelTooltip from "./model-tooltip.svelte";

  let { models, measure }: { models: readonly ModelRow[]; measure: Measure } = $props();

  const spec = $derived(measures[measure]);
  const ROW = 36;
  // Longest first; a provider's path ("rits/deepseek-ai/…") only takes room on the axis, the tooltip names it in full.
  const data = $derived(
    models
      .flatMap((model) => {
        const length = spec.value(model);
        return length === null ? [] : [{ ...model, name: model.model.split("/").at(-1) ?? model.model, value: length }];
      })
      .sort((a, b) => b.value - a.value),
  );
  // The axis' labels aren't measured by the chart: room for the longest name, at about 6.5px a character.
  const left = $derived(Math.min(240, Math.max(0, ...data.map((row) => row.name.length)) * 6.5 + 20));
  const config = $derived({ value: { label: spec.label, color: "var(--chart-2)" } } satisfies Chart.ChartConfig);
</script>

<!-- Anew for each period: LayerChart would keep showing the hovered row of the last one. -->
{#key models}
  <Chart.Container {config} class="aspect-auto w-full" style="height: {data.length * ROW + 8}px">
    <BarChart
      {data}
      orientation="horizontal"
      y="name"
      x="value"
      yScale={scaleBand().padding(0.3)}
      series={[{ key: "value", label: spec.label, color: "var(--chart-2)" }]}
      axis="y"
      grid={false}
      rule={false}
      padding={{ left, right: 64 }}
      labels={{ placement: "outside", format: (length: number) => spec.format(length) }}
      props={{
        bars: { stroke: "none", radius: 4, rounded: "edge" },
        highlight: { area: { fill: "none" } },
        yAxis: { tickLength: 0, tickLabelProps: { dx: -8 } },
      }}
    >
      {#snippet tooltip()}
        <ModelTooltip {measure} />
      {/snippet}
    </BarChart>
  </Chart.Container>
{/key}
