<script lang="ts">
  import * as NativeSelect from "#lib/components/ui/native-select/index.js";
  import { getUsers } from "../users/users.remote.ts";

  /** The asker's GitHub id, from the URL. */
  let { value, onchange }: { value: number | undefined; onchange: (event: Event) => void } = $props();
</script>

<svelte:boundary>
  {@const users = await getUsers()}
  <NativeSelect.Root id="filter-user" name="user" value={value === undefined ? "" : String(value)} {onchange}>
    <NativeSelect.Option value="">Everyone</NativeSelect.Option>
    {#each users as user (user.id)}
      <NativeSelect.Option value={String(user.githubId)}>@{user.githubLogin}</NativeSelect.Option>
    {/each}
    <!-- A link to someone without an account (a review bot) still names them. -->
    {#if value !== undefined && !users.some((user) => user.githubId === value)}
      <NativeSelect.Option value={String(value)}>GitHub id {value}</NativeSelect.Option>
    {/if}
  </NativeSelect.Root>
  {#snippet pending()}
    <NativeSelect.Root id="filter-user" disabled><NativeSelect.Option value="">Everyone</NativeSelect.Option></NativeSelect.Root>
  {/snippet}
</svelte:boundary>
