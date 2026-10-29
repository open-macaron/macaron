<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import { toast } from "svelte-sonner";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import type { ActivityFilters, AdminRefusal } from "#lib/admin/forms.js";
  import { formatDate } from "#lib/format.js";
  import { getRefusals } from "./activity.remote.ts";

  const PAGE = 25;
  /** Keyed by the page on its filters: new filters start a new list. */
  let { filters, filtered }: { filters: ActivityFilters; filtered: boolean } = $props();
  const scope = $derived({ user: filters.user, repo: filters.repo });
  let older = $state.raw<readonly AdminRefusal[]>([]);
  let next = $state<string | null | undefined>(undefined);
  let loading = $state(false);

  async function loadMore(cursor: string): Promise<void> {
    loading = true;
    try {
      const page = await getRefusals({ ...scope, before: cursor, limit: PAGE });
      older = [...older, ...page.refusals];
      next = page.nextCursor;
    } catch {
      toast.error("More refusals could not be loaded", { description: "Try again in a moment." });
    } finally {
      loading = false;
    }
  }
</script>

<svelte:boundary>
  {@const first = await getRefusals({ ...scope, limit: PAGE })}
  {@const cursor = next === undefined ? first.nextCursor : next}
  <Card.Root class="py-0">
    {#if first.refusals.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><BanIcon /></Empty.Media>
          <Empty.Title>No refusals</Empty.Title>
          <Empty.Description>{filtered ? "No refused request matches these filters." : "The bot hasn't refused a request yet."}</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="ps-6">Date</Table.Head>
            <Table.Head>Asked by</Table.Head>
            <Table.Head>Thread</Table.Head>
            <Table.Head class="pe-6">Reason</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each [...first.refusals, ...older] as refusal (refusal.id)}
            <Table.Row>
              <Table.Cell class="ps-6 text-muted-foreground">{formatDate(refusal.createdAt)}</Table.Cell>
              <Table.Cell><a class="font-medium hover:underline" href="https://github.com/{refusal.author}" target="_blank" rel="noopener noreferrer">@{refusal.author}</a></Table.Cell>
              <Table.Cell>
                <a class="font-medium hover:underline" href={refusal.url} target="_blank" rel="external noopener noreferrer">{refusal.repo}#{refusal.number}</a>
              </Table.Cell>
              <Table.Cell class="max-w-xl pe-6 whitespace-normal">
                {#if refusal.reason === null}<span class="text-muted-foreground">Not recorded</span>{:else}{refusal.reason}{/if}
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
  </Card.Root>
  {#snippet pending()}
    <Card.Root class="py-0"><TableSkeleton rows={8} /></Card.Root>
  {/snippet}
  {#snippet failed(error, reset)}
    <Empty.Root>
      <Empty.Header>
        <Empty.Title>The refusals could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>
