<script lang="ts">
  import BotIcon from "@lucide/svelte/icons/bot";
  import GithubIcon from "#lib/components/icons/github-mark.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
</script>

<svelte:head>
  <title>Sign in · macaron</title>
</svelte:head>

<main class="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
  <div class="flex w-full max-w-sm flex-col gap-6">
    <div class="flex items-center gap-2 self-center font-semibold">
      <div class="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BotIcon class="size-4" />
      </div>
      macaron
    </div>
    <Card.Root>
      <Card.Header class="text-center">
        <Card.Title class="text-xl">Sign in to macaron</Card.Title>
        <Card.Description>Sign in with the GitHub account you were invited with.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <Button type="button" variant="outline" class="w-full">
          <GithubIcon />
          Continue with GitHub
        </Button>
        <p class="text-center text-xs text-balance text-muted-foreground">
          Access is by invitation only. macaron reads your public GitHub profile and nothing else: no repository access, no stored GitHub token.
        </p>
      </Card.Content>
    </Card.Root>
  </div>
</main>
