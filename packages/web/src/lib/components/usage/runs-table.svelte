<script lang="ts" module>
  import type { StatusTone } from "#lib/components/admin/status-badge.svelte";
  import type { UsageRun } from "#lib/admin/forms.js";

  const statusOf: Readonly<Record<UsageRun["status"], { label: string; tone: StatusTone }>> = {
    pending: { label: "Queued", tone: "pending" },
    dispatched: { label: "Starting", tone: "pending" },
    running: { label: "Running", tone: "pending" },
    completed: { label: "Completed", tone: "success" },
    failed: { label: "Failed", tone: "danger" },
    aborted: { label: "Stopped", tone: "inactive" },
  };
</script>

<script lang="ts">
  import StatusBadge from "#lib/components/admin/status-badge.svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { formatDate, formatUsd } from "#lib/format.js";

  let { runs }: { runs: readonly UsageRun[] } = $props();
</script>

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head class="ps-6">Date</Table.Head>
      <Table.Head>Thread</Table.Head>
      <Table.Head>Mode</Table.Head>
      <Table.Head>Model</Table.Head>
      <Table.Head>Status</Table.Head>
      <Table.Head class="pe-6 text-end">Cost</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each runs as run (run.id)}
      {@const status = statusOf[run.status]}
      <Table.Row>
        <Table.Cell class="ps-6 text-muted-foreground">{formatDate(run.createdAt)}</Table.Cell>
        <Table.Cell>
          <a class="font-medium hover:underline" href="https://github.com/{run.repo}/{run.kind === 'pull' ? 'pull' : 'issues'}/{run.number}" target="_blank" rel="noopener noreferrer">
            {run.repo}#{run.number}
          </a>
        </Table.Cell>
        <Table.Cell><Badge variant="outline">{run.mode.replace("_", " ")}</Badge></Table.Cell>
        <Table.Cell><code class="text-xs text-muted-foreground">{run.model}</code></Table.Cell>
        <Table.Cell><StatusBadge tone={status.tone} label={status.label} /></Table.Cell>
        <Table.Cell class="pe-6 text-end tabular-nums">
          {#if run.costUsd === null}<span class="text-muted-foreground">Settling…</span>{:else}{formatUsd(run.costUsd)}{/if}
        </Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
