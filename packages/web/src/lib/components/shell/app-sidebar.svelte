<script lang="ts">
  import BotIcon from "@lucide/svelte/icons/bot";
  import type { ComponentProps } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import * as Sidebar from "#lib/components/ui/sidebar/index.js";
  import { navigation } from "#lib/navigation.js";
  import type { ShellUser } from "#lib/session.js";
  import NavUser from "./nav-user.svelte";

  type Props = ComponentProps<typeof Sidebar.Root> & { user: ShellUser };
  let { ref = $bindable(null), user, ...restProps }: Props = $props();

  const sections = $derived(navigation.filter((section) => section.adminOnly !== true || user.isAdmin));
</script>

<Sidebar.Root bind:ref collapsible="icon" {...restProps}>
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg">
          {#snippet child({ props })}
            <a href={resolve("/(app)")} {...props}>
              <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <BotIcon class="size-4" />
              </div>
              <div class="grid flex-1 text-start text-sm leading-tight">
                <span class="truncate font-semibold">macaron</span>
                <span class="truncate text-xs text-muted-foreground">AI contributor console</span>
              </div>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>
  <Sidebar.Content>
    {#each sections as section (section.label)}
      <Sidebar.Group>
        <Sidebar.GroupLabel>{section.label}</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each section.items as item (item.route)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton isActive={page.route.id === item.route} tooltipContent={item.title}>
                {#snippet child({ props })}
                  <a href={resolve(item.route)} {...props}>
                    <item.icon />
                    <span>{item.title}</span>
                  </a>
                {/snippet}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/each}
  </Sidebar.Content>
  <Sidebar.Footer>
    <NavUser {user} />
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>
