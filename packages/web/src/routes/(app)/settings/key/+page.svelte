<script lang="ts">
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import ServerOffIcon from "@lucide/svelte/icons/server-off";
  import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
  import StatusBadge from "#lib/components/admin/status-badge.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { formatDate } from "#lib/format.js";
  import DeleteKey from "./delete-key.svelte";
  import KeyDialog from "./key-dialog.svelte";
  import KeyHistory from "./key-history.svelte";
  import { getMyKey } from "./key.remote.ts";

  // Bumped after a change: the history starts again from its newest page.
  let historyVersion = $state(0);
  const changed = (): void => {
    historyVersion += 1;
  };
</script>

<PageHeader title="LLM key" description="The endpoint and key that pay for the runs you ask for." />

<svelte:boundary>
  {@const mine = await getMyKey()}
  {#if !mine.storage}
    <Alert.Root variant="destructive">
      <ServerOffIcon />
      <Alert.Title>Keys can't be saved yet</Alert.Title>
      <Alert.Description>This deployment has no encryption key for users' keys. Ask an administrator.</Alert.Description>
    </Alert.Root>
  {/if}
  <Card.Root>
    {#if mine.key === null}
      <Card.Content>
        <Empty.Root>
          <Empty.Header>
            <Empty.Media variant="icon"><KeyRoundIcon /></Empty.Media>
            <Empty.Title>No key yet</Empty.Title>
            <Empty.Description>
              {mine.endpoints.length === 0 ? "No endpoint is approved yet: ask an administrator to approve one." : "Choose one of the endpoints your administrators approved, then paste a key for it."}
            </Empty.Description>
          </Empty.Header>
          {#if mine.storage && mine.endpoints.length > 0}
            <Empty.Content>
              <KeyDialog endpoints={mine.endpoints} selected={undefined} freshUntil={mine.freshUntil} replacing={false} onSaved={changed} />
            </Empty.Content>
          {/if}
        </Empty.Root>
      </Card.Content>
    {:else}
      {@const llmKey = mine.key}
      <Card.Header>
        <Card.Title>{llmKey.endpoint.name}</Card.Title>
        <Card.Description class="font-mono text-xs">{llmKey.endpoint.baseUrl}</Card.Description>
        <Card.Action class="flex gap-2">
          {#if mine.storage && mine.endpoints.length > 0}
            <KeyDialog endpoints={mine.endpoints} selected={llmKey.endpoint.enabled ? llmKey.endpoint.id : undefined} freshUntil={mine.freshUntil} replacing={true} onSaved={changed} />
          {/if}
          <DeleteKey {llmKey} freshUntil={mine.freshUntil} onDeleted={changed} />
        </Card.Action>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <dl class="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <div class="grid gap-1">
            <dt class="text-muted-foreground">Key</dt>
            <dd class="font-mono">••••••••{llmKey.last4}</dd>
          </div>
          <div class="grid gap-1">
            <dt class="text-muted-foreground">Status</dt>
            <dd>
              {#if !llmKey.endpoint.enabled}
                <StatusBadge tone="inactive" label="Endpoint disabled" />
              {:else if llmKey.status === "rejected"}
                <StatusBadge tone="danger" label="Refused by the endpoint" />
              {:else}
                <StatusBadge tone="success" label="Valid" />
              {/if}
            </dd>
          </div>
          <div class="grid gap-1">
            <dt class="text-muted-foreground">Last checked</dt>
            <dd>{formatDate(llmKey.validatedAt)}</dd>
          </div>
        </dl>
        {#if !llmKey.endpoint.enabled}
          <Alert.Root variant="destructive">
            <Alert.Description>An administrator disabled {llmKey.endpoint.name}: the bot can't use this key. Save a key for another endpoint.</Alert.Description>
          </Alert.Root>
        {:else if llmKey.status === "rejected"}
          <Alert.Root variant="destructive">
            <Alert.Description>{llmKey.endpoint.name} refused this key during a run. Save it again, or another one.</Alert.Description>
          </Alert.Root>
        {/if}
        {#if llmKey.endpoint.pricingNote !== null}
          <p class="text-sm text-muted-foreground">{llmKey.endpoint.pricingNote}</p>
        {/if}
      </Card.Content>
    {/if}
  </Card.Root>
  {#snippet pending()}
    <Card.Root><Card.Content class="grid gap-3"><Skeleton class="h-5 w-48" /><Skeleton class="h-4 w-72" /></Card.Content></Card.Root>
  {/snippet}
  {#snippet failed(error, reset)}
    <Empty.Root>
      <Empty.Header>
        <Empty.Title>Your key could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>

<Alert.Root>
  <ShieldCheckIcon />
  <Alert.Title>How your key is protected</Alert.Title>
  <Alert.Description>
    <p>
      It is encrypted (AES-256-GCM) before it is stored, under a key kept outside the database. It is never shown again, never logged, and never given to the machines that run the bot: each run gets a short-lived key with its own budget.
    </p>
    <p>The administrators of the cluster macaron runs on can read its secrets, so they could decrypt it. Use a key you may revoke, and revoke it if you stop using macaron.</p>
  </Alert.Description>
</Alert.Root>

<Card.Root class="gap-0 py-0">
  <Card.Header class="border-b py-4">
    <Card.Title>History</Card.Title>
    <Card.Description>Every change to your key, and every run it paid for.</Card.Description>
  </Card.Header>
  {#key historyVersion}
    <KeyHistory />
  {/key}
</Card.Root>
