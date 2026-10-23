<script lang="ts">
  import ServerIcon from "@lucide/svelte/icons/server";
  import StatusBadge from "#lib/components/admin/status-badge.svelte";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { formatDate } from "#lib/format.js";
  import ApproveDialog from "./approve-dialog.svelte";
  import EndpointActions from "./endpoint-actions.svelte";
  import { getEndpoints } from "./endpoints.remote.ts";
</script>

<PageHeader title="Endpoints" description="The LLM APIs users may send their key to. A base URL never changes: disable an endpoint and approve another.">
  {#snippet actions()}
    <ApproveDialog />
  {/snippet}
</PageHeader>

<Card.Root class="py-0">
  <svelte:boundary>
    {@const endpoints = await getEndpoints()}
    {#if endpoints.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><ServerIcon /></Empty.Media>
          <Empty.Title>No endpoints yet</Empty.Title>
          <Empty.Description>Approve an endpoint so that users can save their key for it.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="ps-6">Name</Table.Head>
            <Table.Head>Base URL</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Approved</Table.Head>
            <Table.Head class="w-12 pe-6"><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each endpoints as endpoint (endpoint.id)}
            <Table.Row>
              <Table.Cell class="ps-6">
                <div class="grid gap-0.5">
                  <span class="font-medium">{endpoint.name}</span>
                  {#if endpoint.pricingNote !== null}
                    <span class="max-w-sm text-xs whitespace-normal text-muted-foreground">{endpoint.pricingNote}</span>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Cell class="font-mono text-xs">{endpoint.baseUrl}</Table.Cell>
              <Table.Cell>
                <StatusBadge tone={endpoint.enabled ? "success" : "inactive"} label={endpoint.enabled ? "Enabled" : "Disabled"} />
              </Table.Cell>
              <Table.Cell class="text-muted-foreground">
                {formatDate(endpoint.createdAt)}
                {endpoint.createdBy === null ? "from the deployment's defaults" : `by @${endpoint.createdBy}`}
              </Table.Cell>
              <Table.Cell class="pe-6 text-end">
                <EndpointActions {endpoint} />
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
    {#snippet pending()}
      <TableSkeleton />
    {/snippet}
    {#snippet failed(error, reset)}
      <Empty.Root>
        <Empty.Header>
          <Empty.Title>The endpoints could not be loaded</Empty.Title>
          <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
        </Empty.Header>
        <Empty.Content><button type="button" class="text-sm underline" onclick={reset}>Try again</button></Empty.Content>
      </Empty.Root>
    {/snippet}
  </svelte:boundary>
</Card.Root>
