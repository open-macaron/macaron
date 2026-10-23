<script lang="ts">
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
  import RowActions from "#lib/components/admin/row-actions.svelte";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import type { UserAccount } from "#lib/admin/forms.js";
  import EditCapabilities from "./edit-capabilities.svelte";

  let { user }: { user: UserAccount } = $props();
  let editing = $state(false);
</script>

<RowActions label="Actions for @{user.githubLogin}">
  <!-- Admins hold every capability: nothing to edit. -->
  {#if user.role !== "admin"}
    <DropdownMenu.Item onSelect={() => (editing = true)}>
      <ShieldCheckIcon />
      Edit capabilities
    </DropdownMenu.Item>
  {/if}
  <DropdownMenu.Item>
    {#snippet child({ props })}
      <a href="https://github.com/{user.githubLogin}" target="_blank" rel="noopener noreferrer" {...props}>
        <ExternalLinkIcon />
        View on GitHub
      </a>
    {/snippet}
  </DropdownMenu.Item>
</RowActions>

{#if user.role !== "admin"}
  <EditCapabilities {user} bind:open={editing} />
{/if}
