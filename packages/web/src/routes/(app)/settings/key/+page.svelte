<script lang="ts">
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
</script>

<PageHeader title="LLM key" description="The endpoint and key that pay for the runs you trigger, and your monthly cap." />

<Card.Root>
  <Card.Content>
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon">
          <KeyRoundIcon />
        </Empty.Media>
        <Empty.Title>No key yet</Empty.Title>
        <Empty.Description>Choose one of the endpoints your administrators approved, then paste a key for it.</Empty.Description>
      </Empty.Header>
      <Empty.Content>
        <Button disabled>Add a key</Button>
      </Empty.Content>
    </Empty.Root>
  </Card.Content>
</Card.Root>

<Alert.Root>
  <ShieldCheckIcon />
  <Alert.Title>How your key is protected</Alert.Title>
  <Alert.Description>
    It is encrypted before it is stored, never shown again, never logged, and never given to the machines that run the bot: each run gets a short-lived key with its own budget.
  </Alert.Description>
</Alert.Root>
