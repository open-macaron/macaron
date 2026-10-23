<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { Textarea } from "#lib/components/ui/textarea/index.js";
  import { EndpointInput } from "#lib/admin/forms.js";
  import { approveEndpoint } from "./endpoints.remote.ts";

  let open = $state(false);
  const fields = approveEndpoint.fields;
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button {...props}>
        <PlusIcon />
        Approve endpoint
      </Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="sm:max-w-xl">
    <form
      class="grid gap-6"
      {...approveEndpoint.preflight(EndpointInput).enhance(async (form) => {
        if (!(await form.submit())) return;
        const result = approveEndpoint.result;
        form.element.reset();
        open = false;
        if (result !== undefined) toast.success(`${result.name} is approved`, { description: `Users can now save a key for ${result.baseUrl}.` });
      })}
    >
      <Dialog.Header>
        <Dialog.Title>Approve an endpoint</Dialog.Title>
        <Dialog.Description>An API speaking Anthropic's Messages API. Users' keys are only ever sent to its base URL, which can't be changed afterwards.</Dialog.Description>
      </Dialog.Header>
      <Field.Group>
        <Field.Field>
          <Field.Label for="endpoint-name">Name</Field.Label>
          <Input id="endpoint-name" placeholder="Company gateway" autocomplete="off" {...fields.name.as("text")} />
          <Field.Error errors={fields.name.issues()} />
        </Field.Field>
        <Field.Field>
          <Field.Label for="endpoint-base-url">Base URL</Field.Label>
          <Input id="endpoint-base-url" placeholder="https://api.anthropic.com" autocomplete="off" spellcheck={false} {...fields.baseUrl.as("url")} />
          <Field.Description>https only. Its host must resolve to public addresses.</Field.Description>
          <Field.Error errors={fields.baseUrl.issues()} />
        </Field.Field>
        <Field.Field>
          <Field.Label for="endpoint-pricing-note">Pricing note <span class="font-normal text-muted-foreground">(optional)</span></Field.Label>
          <Textarea id="endpoint-pricing-note" rows={3} placeholder="Billed by the company at a negotiated rate: costs shown are list-price estimates." {...fields.pricingNote.as("text")} />
          <Field.Description>Shown to users next to their estimated costs.</Field.Description>
          <Field.Error errors={fields.pricingNote.issues()} />
        </Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button variant="outline" {...props}>Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button type="submit" disabled={approveEndpoint.pending > 0}>
          {#if approveEndpoint.pending > 0}<Spinner />{/if}
          Approve
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
