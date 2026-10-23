<script lang="ts">
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import CircleDollarSignIcon from "@lucide/svelte/icons/circle-dollar-sign";
  import InfoIcon from "@lucide/svelte/icons/info";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import { resolve } from "$app/paths";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Progress } from "#lib/components/ui/progress/index.js";
</script>

<PageHeader title="Overview" description="What the bot spent for you this month, your key, and your latest runs.">
  {#snippet actions()}
    <Button href={resolve("/(app)/usage")} variant="outline">
      Full usage
      <ArrowRightIcon />
    </Button>
  {/snippet}
</PageHeader>

<Alert.Root>
  <InfoIcon />
  <Alert.Title>Add your LLM key to start using the bot</Alert.Title>
  <Alert.Description>
    Every run is billed to the key of the person who mentioned the bot. Until you add one, your mentions are answered with a refusal.
  </Alert.Description>
</Alert.Root>

<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
  <Card.Root>
    <Card.Header>
      <Card.Description>Spend this month</Card.Description>
      <Card.Title class="text-3xl font-semibold tabular-nums">$0.00</Card.Title>
      <Card.Action>
        <CircleDollarSignIcon class="size-4 text-muted-foreground" />
      </Card.Action>
    </Card.Header>
    <Card.Content class="space-y-2">
      <Progress value={0} max={100} aria-label="Share of the monthly cap spent" />
      <p class="text-xs text-muted-foreground">No monthly cap set. Estimated at list prices.</p>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Description>Runs this month</Card.Description>
      <Card.Title class="text-3xl font-semibold tabular-nums">0</Card.Title>
      <Card.Action>
        <ActivityIcon class="size-4 text-muted-foreground" />
      </Card.Action>
    </Card.Header>
    <Card.Content>
      <p class="text-xs text-muted-foreground">Reviews, fixes and answers the bot ran because you mentioned it.</p>
    </Card.Content>
  </Card.Root>

  <Card.Root class="md:col-span-2 xl:col-span-1">
    <Card.Header>
      <Card.Description>LLM key</Card.Description>
      <Card.Title>
        <Badge variant="outline">Not configured</Badge>
      </Card.Title>
      <Card.Action>
        <KeyRoundIcon class="size-4 text-muted-foreground" />
      </Card.Action>
    </Card.Header>
    <Card.Content>
      <p class="text-xs text-muted-foreground">Pick an approved endpoint and paste your key. It is encrypted and never shown again.</p>
    </Card.Content>
    <Card.Footer>
      <Button href={resolve("/(app)/settings/key")} size="sm">Add your key</Button>
    </Card.Footer>
  </Card.Root>
</div>

<Card.Root>
  <Card.Header>
    <Card.Title>Recent runs</Card.Title>
    <Card.Description>The last runs billed to your key.</Card.Description>
  </Card.Header>
  <Card.Content>
    <Empty.Root class="border border-dashed">
      <Empty.Header>
        <Empty.Media variant="icon">
          <ActivityIcon />
        </Empty.Media>
        <Empty.Title>No runs yet</Empty.Title>
        <Empty.Description>Mention @macaron-bot on an issue or a pull request of a trusted repository. Its runs show up here.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  </Card.Content>
</Card.Root>
