<script lang="ts">
  import { toast } from "svelte-sonner";
  import CapabilityPicker from "#lib/components/admin/capability-picker.svelte";
  import UserCell from "#lib/components/admin/user-cell.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { CapabilitiesInput, type UserAccount } from "#lib/admin/forms.js";
  import { updateCapabilities } from "./users.remote.ts";

  /** Opened from the user's row actions. */
  let { user, open = $bindable(false) }: { user: UserAccount; open?: boolean } = $props();
  // One form instance per user: each sheet keeps its own fields and issues.
  const edit = $derived(updateCapabilities.for(user.id));
</script>

<Sheet.Root bind:open>
  <Sheet.Content class="w-full sm:max-w-xl">
    <form
      class="flex h-full flex-col"
      {...edit.preflight(CapabilitiesInput).enhance(async (form) => {
        if (!(await form.submit())) return;
        open = false;
        toast.success(`@${user.githubLogin}'s capabilities are updated`, { description: "They apply from their next mention of the bot." });
      })}
    >
      <Sheet.Header>
        <Sheet.Title>Edit capabilities</Sheet.Title>
        <Sheet.Description>What @{user.githubLogin} may ask the bot for.</Sheet.Description>
      </Sheet.Header>
      <div class="grid flex-1 content-start gap-6 overflow-y-auto px-4">
        <UserCell githubLogin={user.githubLogin} name={user.name} avatarUrl={user.avatarUrl ?? undefined} />
        <input {...edit.fields.userId.as("hidden", user.id)} />
        <CapabilityPicker idPrefix="edit-{user.id}" field={edit.fields.capabilities} initial={user.capabilities} />
      </div>
      <Sheet.Footer>
        <Button type="submit" disabled={edit.pending > 0}>
          {#if edit.pending > 0}<Spinner />{/if}
          Save capabilities
        </Button>
        <Sheet.Close>
          {#snippet child({ props })}
            <Button variant="outline" {...props}>Cancel</Button>
          {/snippet}
        </Sheet.Close>
      </Sheet.Footer>
    </form>
  </Sheet.Content>
</Sheet.Root>
