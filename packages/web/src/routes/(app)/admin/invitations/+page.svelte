<script lang="ts">
  import MailPlusIcon from "@lucide/svelte/icons/mail-plus";
  import CapabilityBadges from "#lib/components/admin/capability-badges.svelte";
  import StatusBadge, { type StatusTone } from "#lib/components/admin/status-badge.svelte";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import UserCell from "#lib/components/admin/user-cell.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import type { InvitationStatus } from "#lib/admin/forms.js";
  import { formatDate, formatRelativeDays } from "#lib/format.js";
  import InviteDialog from "./invite-dialog.svelte";
  import { getInvitations } from "./invitations.remote.ts";
  import InvitationActions from "./invitation-actions.svelte";

  const statusBadge: Readonly<Record<InvitationStatus, { label: string; tone: StatusTone }>> = {
    pending: { label: "Pending", tone: "pending" },
    accepted: { label: "Accepted", tone: "success" },
    revoked: { label: "Revoked", tone: "danger" },
    expired: { label: "Expired", tone: "inactive" },
  };
</script>

<PageHeader title="Invitations" description="Who may create an account, and with which capabilities. Only invited GitHub accounts can sign in for the first time.">
  {#snippet actions()}
    <InviteDialog />
  {/snippet}
</PageHeader>

<Card.Root class="py-0">
  <svelte:boundary>
    {@const invitations = await getInvitations()}
    {#if invitations.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><MailPlusIcon /></Empty.Media>
          <Empty.Title>No invitations yet</Empty.Title>
          <Empty.Description>Invite a GitHub account to let it sign in.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="ps-6">GitHub account</Table.Head>
            <Table.Head>Capabilities</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Invited</Table.Head>
            <Table.Head class="w-12 pe-6"><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each invitations as invitation (invitation.id)}
            {@const status = statusBadge[invitation.status]}
            <Table.Row>
              <Table.Cell class="ps-6"><UserCell githubLogin={invitation.githubLogin} /></Table.Cell>
              <Table.Cell class="max-w-md whitespace-normal"><CapabilityBadges capabilities={invitation.capabilities} /></Table.Cell>
              <Table.Cell>
                <div class="grid justify-items-start gap-1">
                  <StatusBadge tone={status.tone} label={status.label} />
                  {#if invitation.status === "pending"}
                    <span class="text-xs text-muted-foreground">Expires {formatRelativeDays(invitation.expiresAt)}</span>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Cell class="text-muted-foreground">{formatDate(invitation.createdAt)} by @{invitation.invitedBy}</Table.Cell>
              <Table.Cell class="pe-6 text-end">
                <InvitationActions {invitation} />
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
          <Empty.Title>The invitations could not be loaded</Empty.Title>
          <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
        </Empty.Header>
        <Empty.Content><button type="button" class="text-sm underline" onclick={reset}>Try again</button></Empty.Content>
      </Empty.Root>
    {/snippet}
  </svelte:boundary>
</Card.Root>
