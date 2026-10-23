<script lang="ts">
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import type { LlmKey } from "#lib/keys/forms.js";
  import { deleteKey } from "./key.remote.ts";
  import SignInAgain from "./sign-in-again.svelte";

  let { llmKey, freshUntil, onDeleted }: { llmKey: LlmKey; freshUntil: string; onDeleted: () => void } = $props();
  let open = $state(false);
  let stale = $state(false);

  function onOpenChange(next: boolean): void {
    if (next) stale = Date.now() > Date.parse(freshUntil);
  }

  async function remove(): Promise<void> {
    try {
      const { deleted } = await deleteKey();
      if (!deleted) {
        stale = true;
        return;
      }
      open = false;
      onDeleted();
      toast.success("Your key is deleted", { description: "The bot can't run for you until you save another." });
    } catch {
      toast.error("Your key could not be deleted", { description: "Try again in a moment." });
    }
  }
</script>

<AlertDialog.Root bind:open {onOpenChange}>
  <AlertDialog.Trigger>
    {#snippet child({ props })}
      <Button variant="outline" {...props}>
        <Trash2Icon />
        Delete
      </Button>
    {/snippet}
  </AlertDialog.Trigger>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete your key ending in {llmKey.last4}?</AlertDialog.Title>
      <AlertDialog.Description>It is erased from macaron. The bot then refuses the runs you ask for, until you save another key. Its history stays.</AlertDialog.Description>
    </AlertDialog.Header>
    {#if stale}
      <SignInAgain action="delete your key" />
    {/if}
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
      {#if !stale}
        <!-- A plain button: the dialog stays open if the controller asks for a fresh sign-in. -->
        <Button variant="destructive" onclick={remove}>Delete</Button>
      {/if}
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
