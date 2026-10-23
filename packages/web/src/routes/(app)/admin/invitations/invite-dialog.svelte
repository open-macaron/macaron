<script lang="ts">
  import MailPlusIcon from "@lucide/svelte/icons/mail-plus";
  import { toast } from "svelte-sonner";
  import CapabilityPicker from "#lib/components/admin/capability-picker.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { InvitationInput } from "#lib/admin/forms.js";
  import { formatRelativeDays } from "#lib/format.js";
  import { createInvitation } from "./invitations.remote.ts";

  let open = $state(false);
  const fields = createInvitation.fields;
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button {...props}>
        <MailPlusIcon />
        Invite
      </Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="sm:max-w-2xl">
    <form
      class="grid gap-6"
      {...createInvitation.preflight(InvitationInput).enhance(async (form) => {
        if (!(await form.submit())) return;
        const result = createInvitation.result;
        form.element.reset();
        open = false;
        if (result !== undefined) toast.success(`@${result.githubLogin} is invited`, { description: `They can sign in with GitHub until the invitation expires ${formatRelativeDays(result.expiresAt)}.` });
      })}
    >
      <Dialog.Header>
        <Dialog.Title>Invite someone</Dialog.Title>
        <Dialog.Description>They create their account by signing in with this GitHub account within 7 days. Nothing is sent: share the app's address with them.</Dialog.Description>
      </Dialog.Header>
      <Field.Group>
        <Field.Field>
          <Field.Label for="invite-login">GitHub login</Field.Label>
          <Input id="invite-login" placeholder="octocat" autocomplete="off" spellcheck={false} {...fields.githubLogin.as("text")} />
          <Field.Error errors={fields.githubLogin.issues()} />
        </Field.Field>
        <CapabilityPicker idPrefix="invite" field={fields.capabilities} />
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button variant="outline" {...props}>Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button type="submit" disabled={createInvitation.pending > 0}>
          {#if createInvitation.pending > 0}<Spinner />{/if}
          Create invitation
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
