<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { page } from "$app/state";
  import AppHeader from "#lib/components/shell/app-header.svelte";
  import AppSidebar from "#lib/components/shell/app-sidebar.svelte";
  import * as Sidebar from "#lib/components/ui/sidebar/index.js";
  import { authClient } from "#lib/auth-client.js";
  import { navigation } from "#lib/navigation.js";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  // Keeps an active session alive: the server reads the session for every page but can't pass on
  // the cookie better-auth renews (once a day), so the browser asks the controller itself, once per
  // visit. Its Set-Cookie then reaches the browser directly (the edge routes /api/auth there).
  onMount(() => {
    void authClient.getSession();
  });

  const title = $derived(navigation.flatMap((section) => section.items).find((item) => item.route === page.route.id)?.title);
</script>

<svelte:head>
  <title>{title === undefined ? "macaron" : `${title} · macaron`}</title>
</svelte:head>

<Sidebar.Provider>
  <AppSidebar user={data.user} />
  <Sidebar.Inset>
    <AppHeader />
    <main class="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
      {@render children()}
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>
