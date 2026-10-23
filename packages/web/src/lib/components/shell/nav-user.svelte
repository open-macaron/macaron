<script lang="ts">
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import GithubIcon from "#lib/components/icons/github-mark.svelte";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import MonitorIcon from "@lucide/svelte/icons/monitor";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import SunIcon from "@lucide/svelte/icons/sun";
  import type { LucideIcon } from "@lucide/svelte";
  import { setMode, userPrefersMode } from "mode-watcher";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { authClient } from "#lib/auth-client.js";
  import * as Avatar from "#lib/components/ui/avatar/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import * as Sidebar from "#lib/components/ui/sidebar/index.js";
  import { useSidebar } from "#lib/components/ui/sidebar/index.js";
  import type { ShellUser } from "#lib/session.js";

  let { user }: { user: ShellUser } = $props();
  const sidebar = useSidebar();

  async function signOut(): Promise<void> {
    await authClient.signOut();
    await goto(resolve("/sign-in"), { refreshAll: true });
  }

  const initials = $derived(user.githubLogin.slice(0, 2).toUpperCase());
  const themes: readonly { value: "light" | "dark" | "system"; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
    { value: "system", label: "System", icon: MonitorIcon },
  ];
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Sidebar.MenuButton size="lg" class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground" {...props}>
            <Avatar.Root class="size-8 rounded-lg">
              <Avatar.Image src={user.avatarUrl} alt="" />
              <Avatar.Fallback class="rounded-lg">{initials}</Avatar.Fallback>
            </Avatar.Root>
            <div class="grid flex-1 text-start text-sm leading-tight">
              <span class="truncate font-medium">{user.name}</span>
              <span class="truncate text-xs text-muted-foreground">@{user.githubLogin}</span>
            </div>
            <ChevronsUpDownIcon class="ms-auto size-4" />
          </Sidebar.MenuButton>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg" side={sidebar.isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
        <DropdownMenu.Label class="text-xs text-muted-foreground">Theme</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={userPrefersMode.current}
          onValueChange={(value) => {
            const theme = themes.find((candidate) => candidate.value === value);
            if (theme !== undefined) setMode(theme.value);
          }}
        >
          {#each themes as theme (theme.value)}
            <DropdownMenu.RadioItem value={theme.value}>
              <theme.icon />
              {theme.label}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Item>
          {#snippet child({ props })}
            <a href="https://github.com/{user.githubLogin}" target="_blank" rel="noopener noreferrer" {...props}>
              <GithubIcon />
              GitHub profile
            </a>
          {/snippet}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" onSelect={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Sidebar.MenuItem>
</Sidebar.Menu>
