<script lang="ts">
  import ChartColumnIcon from "@lucide/svelte/icons/chart-column";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
</script>

<PageHeader title="Usage" description="Every run billed to your key: repository, mode, model, status and estimated cost." />

<Card.Root>
  <Card.Content>
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon">
          <ChartColumnIcon />
        </Empty.Media>
        <Empty.Title>No usage yet</Empty.Title>
        <Empty.Description>Your history starts with the first run billed to your key.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  </Card.Content>
</Card.Root>
