<script lang="ts" module>
  import type { StatusTone } from "#lib/components/admin/status-badge.svelte";
  import { runStatusLabels, type RunStatus, type UsageRun } from "#lib/admin/forms.js";

  const toneOf: Readonly<Record<RunStatus, StatusTone>> = {
    pending: "pending",
    dispatched: "pending",
    running: "pending",
    completed: "success",
    failed: "danger",
    aborted: "inactive",
  };
</script>

<script lang="ts" generics="Run extends UsageRun">
  import PanelRightOpenIcon from "@lucide/svelte/icons/panel-right-open";
  import type { Snippet } from "svelte";
  import StatusBadge from "#lib/components/admin/status-badge.svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { formatDate, formatUsd } from "#lib/format.js";

  let {
    runs,
    asker,
    onselect,
  }: {
    runs: readonly Run[];
    /** The "Asked by" cell, on pages listing several users' runs. */
    asker?: Snippet<[Run]>;
    /** Shows a details button on each row. */
    onselect?: (run: Run) => void;
  } = $props();
</script>

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head class="ps-6">Date</Table.Head>
      {#if asker}<Table.Head>Asked by</Table.Head>{/if}
      <Table.Head>Thread</Table.Head>
      <Table.Head>Mode</Table.Head>
      <Table.Head>Model</Table.Head>
      <Table.Head>Status</Table.Head>
      <Table.Head class={["text-end", onselect === undefined && "pe-6"]}>Cost</Table.Head>
      {#if onselect}<Table.Head class="w-12 pe-6"><span class="sr-only">Details</span></Table.Head>{/if}
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each runs as run (run.id)}
      <Table.Row>
        <Table.Cell class="ps-6 text-muted-foreground">{formatDate(run.createdAt)}</Table.Cell>
        {#if asker}<Table.Cell>{@render asker(run)}</Table.Cell>{/if}
        <Table.Cell>
          <a class="font-medium hover:underline" href="https://github.com/{run.repo}/{run.kind === 'pull' ? 'pull' : 'issues'}/{run.number}" target="_blank" rel="noopener noreferrer">
            {run.repo}#{run.number}
          </a>
        </Table.Cell>
        <Table.Cell><Badge variant="outline">{run.mode.replace("_", " ")}</Badge></Table.Cell>
        <Table.Cell><code class="text-xs text-muted-foreground">{run.model}</code></Table.Cell>
        <Table.Cell><StatusBadge tone={toneOf[run.status]} label={runStatusLabels[run.status]} /></Table.Cell>
        <Table.Cell class={["text-end tabular-nums", onselect === undefined && "pe-6"]}>
          {#if run.costUsd === null}<span class="text-muted-foreground">Settling…</span>{:else}{formatUsd(run.costUsd)}{/if}
        </Table.Cell>
        {#if onselect}
          <Table.Cell class="pe-6 text-end">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Details of the run on {run.repo}#{run.number}"
              onclick={() => {
                onselect(run);
              }}
            >
              <PanelRightOpenIcon />
            </Button>
          </Table.Cell>
        {/if}
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
