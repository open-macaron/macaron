<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleMinusIcon from "@lucide/svelte/icons/circle-minus";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import { toast } from "svelte-sonner";
  import RowActions from "#lib/components/admin/row-actions.svelte";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import type { Endpoint } from "#lib/admin/forms.js";
  import { copyToClipboard } from "#lib/clipboard.js";
  import { setEndpointEnabled } from "./endpoints.remote.ts";

  let { endpoint }: { endpoint: Endpoint } = $props();
  let confirming = $state(false);

  async function setEnabled(enabled: boolean): Promise<void> {
    confirming = false;
    try {
      const result = await setEndpointEnabled({ id: endpoint.id, enabled });
      toast.success(`${result.name} is ${result.enabled ? "enabled" : "disabled"}`);
    } catch {
      toast.error(`${endpoint.name} could not be ${enabled ? "enabled" : "disabled"}`, { description: "Try again in a moment." });
    }
  }
</script>

<RowActions label="Actions for {endpoint.name}">
  <DropdownMenu.Item onSelect={() => copyToClipboard(endpoint.baseUrl, "The base URL")}>
    <CopyIcon />
    Copy base URL
  </DropdownMenu.Item>
  <DropdownMenu.Separator />
  {#if endpoint.enabled}
    <DropdownMenu.Item variant="destructive" onSelect={() => (confirming = true)}>
      <CircleMinusIcon />
      Disable
    </DropdownMenu.Item>
  {:else}
    <DropdownMenu.Item onSelect={() => setEnabled(true)}>
      <CircleCheckIcon />
      Enable
    </DropdownMenu.Item>
  {/if}
</RowActions>

<AlertDialog.Root bind:open={confirming}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Disable {endpoint.name}?</AlertDialog.Title>
      <AlertDialog.Description>Users can no longer choose it for a new key. You can enable it again later.</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Keep it enabled</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={() => setEnabled(false)}>Disable</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
