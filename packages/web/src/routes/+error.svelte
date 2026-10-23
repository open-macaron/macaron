<script lang="ts">
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
</script>

<svelte:head>
  <title>{page.status} · macaron</title>
</svelte:head>

<main class="flex min-h-svh items-center justify-center p-6">
  <Empty.Root>
    <Empty.Header>
      <Empty.Media variant="icon">
        <TriangleAlertIcon />
      </Empty.Media>
      <Empty.Title>{page.status === 404 ? "Page not found" : "Something went wrong"}</Empty.Title>
      <Empty.Description>{page.error?.message}</Empty.Description>
    </Empty.Header>
    <Empty.Content>
      <Button href={resolve("/(app)")} variant="outline">Back to the overview</Button>
    </Empty.Content>
  </Empty.Root>
</main>
