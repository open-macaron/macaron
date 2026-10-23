<script lang="ts">
  import LogInIcon from "@lucide/svelte/icons/log-in";
  import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
  import { resolve } from "$app/paths";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { authClient } from "#lib/auth-client.js";

  /** `action` says what the fresh sign-in is for: "save a key", "delete your key". */
  let { action }: { action: string } = $props();
  let redirecting = $state(false);

  async function signInAgain(): Promise<void> {
    redirecting = true;
    // GitHub sends the user straight back when they already authorised the app: a new session, created now.
    const { error } = await authClient.signIn.social({ provider: "github", callbackURL: resolve("/(app)/settings/key"), errorCallbackURL: resolve("/sign-in") });
    if (error !== null) redirecting = false;
  }
</script>

<Alert.Root>
  <ShieldAlertIcon />
  <Alert.Title>Confirm it's you</Alert.Title>
  <Alert.Description>
    <p>To {action}, sign in again: your last sign-in is over 10 minutes old. You come back to this page.</p>
    <Button type="button" size="sm" class="mt-2" disabled={redirecting} onclick={signInAgain}>
      {#if redirecting}<Spinner />{:else}<LogInIcon />{/if}
      Sign in again
    </Button>
  </Alert.Description>
</Alert.Root>
