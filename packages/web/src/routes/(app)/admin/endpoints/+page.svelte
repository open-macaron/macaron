<script lang="ts">
  import ServerIcon from "@lucide/svelte/icons/server";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
</script>

<PageHeader title="Endpoints" description="The LLM APIs users may send their key to. A base URL never changes: disable an endpoint and approve another." />

<Card.Root>
  <Card.Content>
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon"><ServerIcon /></Empty.Media>
        <Empty.Title>No endpoints</Empty.Title>
        <Empty.Description>Endpoints arrive with users' keys.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  </Card.Content>
</Card.Root>
