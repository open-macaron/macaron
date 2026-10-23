<script lang="ts">
  import ChartColumnIcon from "@lucide/svelte/icons/chart-column";
  import { toast } from "svelte-sonner";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import RunsTable from "#lib/components/usage/runs-table.svelte";
  import type { UsageRun } from "#lib/admin/forms.js";
  import { formatUsd } from "#lib/format.js";
  import { getUsage } from "../me.remote.ts";

  const PAGE = 25;
  // Pages after the first, appended by "Load more"; `next` is undefined until one was loaded.
  let older = $state.raw<readonly UsageRun[]>([]);
  let next = $state<string | null | undefined>(undefined);
  let loading = $state(false);

  async function loadMore(cursor: string): Promise<void> {
    loading = true;
    try {
      const page = await getUsage({ before: cursor, limit: PAGE });
      older = [...older, ...page.runs];
      next = page.nextCursor;
    } catch {
      toast.error("More runs could not be loaded", { description: "Try again in a moment." });
    } finally {
      loading = false;
    }
  }
</script>

<PageHeader title="Usage" description="Every run you asked for: thread, mode, model, status and estimated cost." />

<svelte:boundary>
  {@const first = await getUsage({ limit: PAGE })}
  {@const cursor = next === undefined ? first.nextCursor : next}
  <p class="text-sm text-muted-foreground">
    This month: <span class="font-medium text-foreground tabular-nums">{formatUsd(first.monthUsd)}</span> over
    <span class="font-medium text-foreground tabular-nums">{first.monthRuns}</span>
    {first.monthRuns === 1 ? "run" : "runs"}.
  </p>
  <Card.Root class="py-0">
    {#if first.runs.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><ChartColumnIcon /></Empty.Media>
          <Empty.Title>No usage yet</Empty.Title>
          <Empty.Description>Your history starts with the first run you ask the bot for.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <RunsTable runs={[...first.runs, ...older]} />
      {#if cursor !== null}
        <div class="flex justify-center border-t p-4">
          <Button variant="outline" disabled={loading} onclick={() => loadMore(cursor)}>
            {#if loading}<Spinner />{/if}
            Load more
          </Button>
        </div>
      {/if}
    {/if}
  </Card.Root>
  {#snippet pending()}
    <Card.Root class="py-0"><TableSkeleton rows={8} /></Card.Root>
  {/snippet}
  {#snippet failed(error, reset)}
    <Empty.Root>
      <Empty.Header>
        <Empty.Title>Your usage could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>
