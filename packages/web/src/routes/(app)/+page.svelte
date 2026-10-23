<script lang="ts">
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import CircleDollarSignIcon from "@lucide/svelte/icons/circle-dollar-sign";
  import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
  import { resolve } from "$app/paths";
  import CapabilityBadges from "#lib/components/admin/capability-badges.svelte";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import RunsTable from "#lib/components/usage/runs-table.svelte";
  import { formatUsd } from "#lib/format.js";
  import type { MyLlmKey } from "#lib/keys/forms.js";
  import { getMe, getUsage } from "./me.remote.ts";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import { getMonth, getMyKey } from "./settings/key/key.remote.ts";

  /** Why the bot can't run for this user now, or undefined when their key is usable. */
  function keyProblem(mine: MyLlmKey): string | undefined {
    if (mine.key === null) return "Every run is billed to the LLM key of whoever asks for it, and you haven't saved one.";
    if (!mine.key.endpoint.enabled) return `An administrator disabled ${mine.key.endpoint.name}, the endpoint of your key.`;
    if (mine.key.status === "rejected") return `${mine.key.endpoint.name} refused your key.`;
    return undefined;
  }
</script>

<PageHeader title="Overview" description="What you asked the bot for this month, what it cost, and what you may ask for.">
  {#snippet actions()}
    <Button href={resolve("/(app)/usage")} variant="outline">
      Full usage
      <ArrowRightIcon />
    </Button>
  {/snippet}
</PageHeader>

<svelte:boundary>
  {@const [me, usage, mine, month] = await Promise.all([getMe(), getUsage({ limit: 5 }), getMyKey(), getMonth()])}
  {@const problem = keyProblem(mine)}
  {#if problem !== undefined}
    <Alert.Root variant="destructive">
      <KeyRoundIcon />
      <Alert.Title>The bot can't run for you yet</Alert.Title>
      <Alert.Description>{problem} Until you save a working key, it answers your mentions with a refusal.</Alert.Description>
      <Button href={resolve("/(app)/settings/key")} size="sm" class="col-start-2 mt-2 w-fit">Save your key</Button>
    </Alert.Root>
  {/if}
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <Card.Root>
      <Card.Header>
        <Card.Description>Spend this month</Card.Description>
        <Card.Title class="text-3xl font-semibold tabular-nums">{formatUsd(month.spentUsd)}</Card.Title>
        <Card.Action><CircleDollarSignIcon class="size-4 text-muted-foreground" /></Card.Action>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#if month.monthlyCapUsd !== null}
          <Progress value={Math.min(100, ((month.spentUsd + month.reservedUsd) / month.monthlyCapUsd) * 100)} aria-label="Share of your monthly cap used" />
          <p class="text-xs text-muted-foreground">Of your {formatUsd(month.monthlyCapUsd)} monthly cap, estimated at list prices.</p>
        {:else}
          <p class="text-xs text-muted-foreground">Billed to your key, estimated at list prices. <a class="underline underline-offset-4" href={resolve("/(app)/settings/key")}>Set a monthly cap</a>.</p>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Description>Runs this month</Card.Description>
        <Card.Title class="text-3xl font-semibold tabular-nums">{usage.monthRuns}</Card.Title>
        <Card.Action><ActivityIcon class="size-4 text-muted-foreground" /></Card.Action>
      </Card.Header>
      <Card.Content>
        <p class="text-xs text-muted-foreground">Reviews, plans, fixes and answers the bot ran because you mentioned it.</p>
      </Card.Content>
    </Card.Root>

    <Card.Root class="md:col-span-2 xl:col-span-1">
      <Card.Header>
        <Card.Description>What you can ask for</Card.Description>
        <Card.Action><ShieldCheckIcon class="size-4 text-muted-foreground" /></Card.Action>
      </Card.Header>
      <Card.Content class="space-y-2">
        <CapabilityBadges capabilities={me.capabilities} />
        <p class="text-xs text-muted-foreground">Granted by an administrator.</p>
      </Card.Content>
    </Card.Root>
  </div>

  <Card.Root class="pb-0">
    <Card.Header>
      <Card.Title>Recent runs</Card.Title>
      <Card.Description>Your latest requests to the bot.</Card.Description>
    </Card.Header>
    <Card.Content class="px-0">
      {#if usage.runs.length === 0}
        <Empty.Root class="mx-6 mb-6 border border-dashed">
          <Empty.Header>
            <Empty.Media variant="icon"><ActivityIcon /></Empty.Media>
            <Empty.Title>No runs yet</Empty.Title>
            <Empty.Description>Mention @macaron-bot on an issue or a pull request of a trusted repository. Its runs show up here.</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <RunsTable runs={usage.runs} />
      {/if}
    </Card.Content>
  </Card.Root>

  {#snippet pending()}
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each [1, 2, 3] as card (card)}<Skeleton class="h-36 rounded-xl" />{/each}
    </div>
    <Card.Root class="py-0"><TableSkeleton rows={5} /></Card.Root>
  {/snippet}
  {#snippet failed(error, reset)}
    <Empty.Root>
      <Empty.Header>
        <Empty.Title>Your overview could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>
