<script lang="ts">
  import HistoryIcon from "@lucide/svelte/icons/history";
  import { toast } from "svelte-sonner";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { formatDateTime } from "#lib/format.js";
  import { HISTORY_PAGE, type LlmKeyEvent } from "#lib/keys/forms.js";
  import { getKeyEvents } from "./key.remote.ts";

  const labels: Readonly<Record<LlmKeyEvent["kind"], { label: string; variant: "outline" | "destructive" }>> = {
    created: { label: "Saved", variant: "outline" },
    replaced: { label: "Replaced", variant: "outline" },
    deleted: { label: "Deleted", variant: "outline" },
    used: { label: "Used by a run", variant: "outline" },
    rejected: { label: "Refused by the endpoint", variant: "destructive" },
    unreachable: { label: "Couldn't be checked", variant: "outline" },
  };

  let older = $state.raw<readonly LlmKeyEvent[]>([]);
  let next = $state<string | null | undefined>(undefined);
  let loading = $state(false);

  async function loadMore(cursor: string): Promise<void> {
    loading = true;
    try {
      const page = await getKeyEvents({ before: cursor, limit: HISTORY_PAGE });
      older = [...older, ...page.events];
      next = page.nextCursor;
    } catch {
      toast.error("More events could not be loaded", { description: "Try again in a moment." });
    } finally {
      loading = false;
    }
  }
</script>

<svelte:boundary>
  {@const first = await getKeyEvents({ limit: HISTORY_PAGE })}
  {@const cursor = next === undefined ? first.nextCursor : next}
  {#if first.events.length === 0}
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon"><HistoryIcon /></Empty.Media>
        <Empty.Title>No history yet</Empty.Title>
        <Empty.Description>Every change to your key, and every run it pays for, is listed here.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="ps-6">When</Table.Head>
          <Table.Head>Event</Table.Head>
          <Table.Head>Key</Table.Head>
          <Table.Head>Endpoint</Table.Head>
          <Table.Head class="pe-6">Details</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each [...first.events, ...older] as event (event.id)}
          {@const kind = labels[event.kind]}
          <Table.Row>
            <Table.Cell class="ps-6 text-muted-foreground tabular-nums">{formatDateTime(event.at)}</Table.Cell>
            <Table.Cell><Badge variant={kind.variant}>{kind.label}</Badge></Table.Cell>
            <Table.Cell class="font-mono text-xs">{event.last4 === null ? "" : `…${event.last4}`}</Table.Cell>
            <Table.Cell>{event.endpointName ?? ""}</Table.Cell>
            <Table.Cell class="pe-6 whitespace-normal text-muted-foreground">
              {#if event.thread !== null}
                <a class="underline-offset-4 hover:underline" href="https://github.com/{event.thread.repo}/{event.thread.kind === 'pull' ? 'pull' : 'issues'}/{event.thread.number}" target="_blank" rel="noopener noreferrer">{event.thread.repo}#{event.thread.number}</a>
              {/if}
              {event.detail ?? ""}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
    {#if cursor !== null}
      <div class="flex justify-center border-t p-4">
        <Button variant="outline" disabled={loading} onclick={() => loadMore(cursor)}>
          {#if loading}<Spinner />{/if}
          Load more
        </Button>
      </div>
    {/if}
  {/if}
  {#snippet pending()}
    <TableSkeleton rows={4} />
  {/snippet}
  {#snippet failed(error, reset)}
    <Empty.Root>
      <Empty.Header>
        <Empty.Title>The history could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>
