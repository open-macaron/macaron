<script lang="ts">
  import UsersIcon from "@lucide/svelte/icons/users";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
</script>

<PageHeader title="Users" description="Everyone with an account, and what each may ask the bot for." />

<Card.Root>
  <Card.Content>
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon"><UsersIcon /></Empty.Media>
        <Empty.Title>No users yet</Empty.Title>
        <Empty.Description>Users appear here after their first sign-in.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  </Card.Content>
</Card.Root>
