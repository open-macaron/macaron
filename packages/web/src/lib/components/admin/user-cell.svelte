<script lang="ts">
  import * as Avatar from "#lib/components/ui/avatar/index.js";

  let { githubLogin, name, avatarUrl }: { githubLogin: string; name?: string; avatarUrl?: string } = $props();
</script>

<div class="flex items-center gap-3">
  <Avatar.Root class="size-8">
    <Avatar.Image src={avatarUrl ?? `https://avatars.githubusercontent.com/${githubLogin}`} alt="" />
    <Avatar.Fallback>{githubLogin.slice(0, 2).toUpperCase()}</Avatar.Fallback>
  </Avatar.Root>
  <div class="grid leading-tight">
    <span class="font-medium">{name ?? githubLogin}</span>
    <a class="text-xs text-muted-foreground hover:underline" href="https://github.com/{githubLogin}" target="_blank" rel="noopener noreferrer">@{githubLogin}</a>
  </div>
</div>
