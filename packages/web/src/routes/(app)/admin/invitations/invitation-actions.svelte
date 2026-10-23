<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import { toast } from "svelte-sonner";
  import RowActions from "#lib/components/admin/row-actions.svelte";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import type { Invitation } from "#lib/admin/forms.js";
  import { revokeInvitation } from "./invitations.remote.ts";

  let { invitation }: { invitation: Invitation } = $props();
  let confirming = $state(false);

  async function revoke(): Promise<void> {
    confirming = false;
    try {
      await revokeInvitation({ id: invitation.id });
      toast.success(`The invitation of @${invitation.githubLogin} is revoked`);
    } catch {
      toast.error("The invitation could not be revoked", { description: "Try again in a moment." });
    }
  }
</script>

<RowActions label="Actions for the invitation of @{invitation.githubLogin}">
  <DropdownMenu.Item>
    {#snippet child({ props })}
      <a href="https://github.com/{invitation.githubLogin}" target="_blank" rel="noopener noreferrer" {...props}>
        <ExternalLinkIcon />
        View on GitHub
      </a>
    {/snippet}
  </DropdownMenu.Item>
  {#if invitation.status === "pending"}
    <DropdownMenu.Separator />
    <DropdownMenu.Item variant="destructive" onSelect={() => (confirming = true)}>
      <BanIcon />
      Revoke
    </DropdownMenu.Item>
  {/if}
</RowActions>

<AlertDialog.Root bind:open={confirming}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Revoke the invitation of @{invitation.githubLogin}?</AlertDialog.Title>
      <AlertDialog.Description>They can no longer create an account with it. You can invite them again later.</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={revoke}>Revoke</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
