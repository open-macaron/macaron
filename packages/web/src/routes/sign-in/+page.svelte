<script lang="ts">
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import { page } from "$app/state";
  import MacaronMark from "#lib/components/brand/macaron-mark.svelte";
  import GithubIcon from "#lib/components/icons/github-mark.svelte";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { authClient } from "#lib/auth-client.js";

  // What a refused sign-in comes back with (?error=…). Only these codes are shown, in our words:
  // nothing from the URL is ever displayed as is.
  const refusals: Readonly<Record<string, { title: string; description: string }>> = {
    not_invited: { title: "This GitHub account isn't invited", description: "Ask an administrator to invite it, then sign in again within 7 days." },
    account_not_linked: { title: "This GitHub account can't be added", description: "You are already signed up with another GitHub account." },
  };
  const fallback = { title: "Sign-in didn't complete", description: "Try again. If it keeps failing, ask an administrator." };

  const code = $derived(page.url.searchParams.get("error"));
  const refusal = $derived(code === null ? undefined : (refusals[code] ?? fallback));
  let redirecting = $state(false);

  async function signIn(): Promise<void> {
    redirecting = true;
    const { error } = await authClient.signIn.social({ provider: "github", callbackURL: "/", errorCallbackURL: "/sign-in" });
    // On success the browser is already on its way to GitHub.
    if (error !== null) redirecting = false;
  }
</script>

<svelte:head>
  <title>Sign in · macaron</title>
</svelte:head>

<main class="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
  <div class="flex w-full max-w-sm flex-col gap-6">
    <div class="flex items-center gap-2 self-center font-semibold">
      <MacaronMark class="size-8" />
      macaron
    </div>
    <Card.Root>
      <Card.Header class="text-center">
        <Card.Title class="text-xl">Sign in to macaron</Card.Title>
        <Card.Description>Sign in with the GitHub account you were invited with.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        {#if refusal !== undefined}
          <Alert.Root variant="destructive">
            <CircleAlertIcon />
            <Alert.Title>{refusal.title}</Alert.Title>
            <Alert.Description>{refusal.description}</Alert.Description>
          </Alert.Root>
        {/if}
        <Button type="button" variant="outline" class="w-full" disabled={redirecting} onclick={signIn}>
          {#if redirecting}<Spinner />{:else}<GithubIcon />{/if}
          Continue with GitHub
        </Button>
        <p class="text-center text-xs text-balance text-muted-foreground">
          Access is by invitation only. macaron reads your public GitHub profile and nothing else: no repository access, no stored GitHub token.
        </p>
      </Card.Content>
    </Card.Root>
  </div>
</main>
