<script lang="ts">
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import { toast } from "svelte-sonner";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import RunsTable from "#lib/components/usage/runs-table.svelte";
  import type { ActivityFilters, AdminRun } from "#lib/admin/forms.js";
  import { formatUsd } from "#lib/format.js";
  import { getRuns } from "./activity.remote.ts";
  import AskerCell from "./asker-cell.svelte";
  import RunDetails from "./run-details.svelte";

  const PAGE = 25;
  /** Keyed by the page on its filters: new filters start a new list. */
  let { filters, filtered }: { filters: ActivityFilters; filtered: boolean } = $props();
  // Pages after the first, appended by "Load more"; `next` is undefined until one was loaded.
  let older = $state.raw<readonly AdminRun[]>([]);
  let next = $state<string | null | undefined>(undefined);
  let loading = $state(false);
  let selected = $state.raw<AdminRun | undefined>(undefined);
  let open = $state(false);

  async function loadMore(cursor: string): Promise<void> {
    loading = true;
    try {
      const page = await getRuns({ ...filters, before: cursor, limit: PAGE });
      older = [...older, ...page.runs];
      next = page.nextCursor;
    } catch {
      toast.error("More runs could not be loaded", { description: "Try again in a moment." });
    } finally {
      loading = false;
    }
  }

  function show(run: AdminRun): void {
    selected = run;
    open = true;
  }
</script>

<svelte:boundary>
  {@const first = await getRuns({ ...filters, limit: PAGE })}
  {@const cursor = next === undefined ? first.nextCursor : next}
  <p class="text-sm text-muted-foreground">
    This month{filtered ? ", under these filters" : ""}:
    <span class="font-medium text-foreground tabular-nums">{first.monthRuns}</span>
    {first.monthRuns === 1 ? "run" : "runs"},
    <span class="font-medium text-foreground tabular-nums">{first.monthFailed}</span> failed,
    <span class="font-medium text-foreground tabular-nums">{formatUsd(first.monthUsd)}</span> settled.
  </p>
  <Card.Root class="py-0">
    {#if first.runs.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><ActivityIcon /></Empty.Media>
          <Empty.Title>No runs</Empty.Title>
          <Empty.Description>{filtered ? "No run matches these filters." : "The bot hasn't run yet."}</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <RunsTable runs={[...first.runs, ...older]} onselect={show}>
        {#snippet asker(run: AdminRun)}<AskerCell asker={run.asker} />{/snippet}
      </RunsTable>
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
        <Empty.Title>The runs could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>

<RunDetails run={selected} bind:open />
