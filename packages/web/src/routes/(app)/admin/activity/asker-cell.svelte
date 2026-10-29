<script lang="ts">
  import UserCell from "#lib/components/admin/user-cell.svelte";
  import type { AdminRun } from "#lib/admin/forms.js";

  let { asker }: { asker: AdminRun["asker"] } = $props();
</script>

{#if asker.hasAccount}
  <UserCell githubLogin={asker.login} name={asker.name ?? undefined} avatarUrl={asker.avatarUrl ?? undefined} />
{:else}
  <!-- A review bot, or someone whose account is gone: only the comment's login is known. -->
  <div class="grid leading-tight">
    <a class="font-medium hover:underline" href="https://github.com/{asker.login}" target="_blank" rel="noopener noreferrer">@{asker.login}</a>
    <span class="text-xs text-muted-foreground">No account</span>
  </div>
{/if}
