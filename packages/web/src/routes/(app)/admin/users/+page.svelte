<script lang="ts">
  import UsersIcon from "@lucide/svelte/icons/users";
  import CapabilityBadges from "#lib/components/admin/capability-badges.svelte";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import UserCell from "#lib/components/admin/user-cell.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { formatRelativeDays } from "#lib/format.js";
  import UserActions from "./user-actions.svelte";
  import { getUsers } from "./users.remote.ts";

</script>

<PageHeader title="Users" description="Everyone with an account, and what each may ask the bot for. Changes apply from their next mention." />

<Card.Root class="py-0">
  <svelte:boundary>
    {@const users = await getUsers()}
    {#if users.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><UsersIcon /></Empty.Media>
          <Empty.Title>No users yet</Empty.Title>
          <Empty.Description>Users appear here after their first sign-in.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="ps-6">User</Table.Head>
            <Table.Head>Role</Table.Head>
            <Table.Head>Capabilities</Table.Head>
            <Table.Head>Last sign-in</Table.Head>
            <Table.Head class="w-12 pe-6"><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each users as user (user.id)}
            <Table.Row>
              <Table.Cell class="ps-6"><UserCell githubLogin={user.githubLogin} name={user.name} avatarUrl={user.avatarUrl ?? undefined} /></Table.Cell>
              <Table.Cell><Badge variant={user.role === "admin" ? "default" : "outline"}>{user.role === "admin" ? "Admin" : "User"}</Badge></Table.Cell>
              <Table.Cell class="max-w-md whitespace-normal"><CapabilityBadges capabilities={user.capabilities} /></Table.Cell>
              <Table.Cell class="text-muted-foreground">{user.lastSignInAt === null ? "Never" : formatRelativeDays(user.lastSignInAt)}</Table.Cell>
              <Table.Cell class="pe-6 text-end">
                <UserActions {user} />
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
          <Empty.Title>The users could not be loaded</Empty.Title>
          <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
        </Empty.Header>
        <Empty.Content><button type="button" class="text-sm underline" onclick={reset}>Try again</button></Empty.Content>
      </Empty.Root>
    {/snippet}
  </svelte:boundary>
</Card.Root>
