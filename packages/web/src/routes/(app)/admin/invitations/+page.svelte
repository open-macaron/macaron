<script lang="ts">
  import MailPlusIcon from "@lucide/svelte/icons/mail-plus";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
</script>

<PageHeader title="Invitations" description="Who may create an account, and with which capabilities. Only invited GitHub accounts can sign in for the first time." />

<Card.Root>
  <Card.Content>
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon"><MailPlusIcon /></Empty.Media>
        <Empty.Title>No invitations yet</Empty.Title>
        <Empty.Description>Invitations arrive with sign-in.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  </Card.Content>
</Card.Root>
