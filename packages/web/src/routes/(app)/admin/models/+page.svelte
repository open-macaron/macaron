<script lang="ts">
  import ChartAreaIcon from "@lucide/svelte/icons/chart-area";
  import { modelStatsRangeLabels, ModelStatsRange } from "#lib/admin/forms.js";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import * as NativeSelect from "#lib/components/ui/native-select/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { formatMillions, formatUsd } from "#lib/format.js";
  import ModelBars from "./model-bars.svelte";
  import { getModelStats } from "./models.remote.ts";

  let range = $state<ModelStatsRange>("30d");
</script>

<PageHeader title="Models" description="What a run costs and how many tokens it uses, on average, for each model. Settled runs only." />

<div class="flex items-end gap-3">
  <div class="grid gap-1.5">
    <Label for="models-range">Period</Label>
    <NativeSelect.Root
      id="models-range"
      value={range}
      onchange={(event: Event) => {
        if (event.currentTarget instanceof HTMLSelectElement) range = ModelStatsRange.parse(event.currentTarget.value);
      }}
    >
      {#each Object.entries(modelStatsRangeLabels) as [value, label] (value)}
        <NativeSelect.Option {value}>{label}</NativeSelect.Option>
      {/each}
    </NativeSelect.Root>
  </div>
</div>

<svelte:boundary>
  {@const stats = await getModelStats(range)}
  {#if stats.models.length === 0}
    <Empty.Root class="border border-dashed">
      <Empty.Header>
        <Empty.Media variant="icon"><ChartAreaIcon /></Empty.Media>
        <Empty.Title>No settled runs</Empty.Title>
        <Empty.Description>No run settled over this period. Pick a longer one.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <div class="grid gap-4 xl:grid-cols-2">
      <Card.Root>
        <Card.Header>
          <Card.Title>Average cost per run</Card.Title>
          <Card.Description>At list prices: free models stay at $0.</Card.Description>
        </Card.Header>
        <Card.Content>
          <ModelBars models={stats.models} measure="cost" />
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header>
          <Card.Title>Average tokens per run</Card.Title>
          <Card.Description>As each run's key counted them.</Card.Description>
        </Card.Header>
        <Card.Content>
          <ModelBars models={stats.models} measure="tokens" />
        </Card.Content>
      </Card.Root>
    </div>

    <Card.Root class="pb-0">
      <Card.Header>
        <Card.Title>Every model</Card.Title>
        <Card.Description>{modelStatsRangeLabels[range]}, most runs first.</Card.Description>
      </Card.Header>
      <Card.Content class="px-0">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="ps-6">Model</Table.Head>
              <Table.Head class="text-end">Runs</Table.Head>
              <Table.Head class="text-end">Avg. cost</Table.Head>
              <Table.Head class="text-end">Avg. tokens</Table.Head>
              <Table.Head class="text-end">Total cost</Table.Head>
              <Table.Head class="pe-6 text-end">Total tokens</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each stats.models as model (model.model)}
              <Table.Row>
                <Table.Cell class="ps-6"><code class="text-xs">{model.model}</code></Table.Cell>
                <Table.Cell class="text-end tabular-nums">{model.runs}</Table.Cell>
                <Table.Cell class="text-end tabular-nums">{formatUsd(model.avgCostUsd)}</Table.Cell>
                <Table.Cell class="text-end tabular-nums">
                  {#if model.avgTokens === null}<span class="text-muted-foreground">—</span>{:else}{formatMillions(model.avgTokens)}{/if}
                </Table.Cell>
                <Table.Cell class="text-end tabular-nums">{formatUsd(model.totalCostUsd)}</Table.Cell>
                <Table.Cell class="pe-6 text-end tabular-nums">{formatMillions(model.totalTokens)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Content>
    </Card.Root>
  {/if}

  {#snippet pending()}
    <div class="grid gap-4 xl:grid-cols-2">
      {#each [1, 2] as card (card)}<Skeleton class="h-80 rounded-xl" />{/each}
    </div>
    <Card.Root class="py-0"><TableSkeleton rows={4} /></Card.Root>
  {/snippet}
  {#snippet failed(error, reset)}
    <Empty.Root>
      <Empty.Header>
        <Empty.Title>The models could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>
