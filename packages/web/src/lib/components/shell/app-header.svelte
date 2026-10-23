<script lang="ts">
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import SunIcon from "@lucide/svelte/icons/sun";
  import { toggleMode } from "mode-watcher";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Sidebar from "#lib/components/ui/sidebar/index.js";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
</script>

<header class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
  <Sidebar.Trigger class="-ms-1" />
  <div class="ms-auto flex items-center gap-1">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" href="https://github.com/open-macaron/macaron#readme" target="_blank" rel="noopener noreferrer" aria-label="Documentation" {...props}>
            <BookOpenIcon />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Documentation</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" onclick={toggleMode} aria-label="Toggle theme" {...props}>
            <SunIcon class="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <MoonIcon class="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Toggle theme</Tooltip.Content>
    </Tooltip.Root>
  </div>
</header>
