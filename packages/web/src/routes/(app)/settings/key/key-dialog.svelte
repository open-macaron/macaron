<script lang="ts">
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import { toast } from "svelte-sonner";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as NativeSelect from "#lib/components/ui/native-select/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { type EndpointChoice, KeyInput } from "#lib/keys/forms.js";
  import { saveKey } from "./key.remote.ts";
  import SignInAgain from "./sign-in-again.svelte";

  /** `replacing`: a key is saved already (the trigger reads "Replace"); `onSaved` runs after a key is stored. */
  let {
    endpoints,
    selected,
    freshUntil,
    replacing,
    onSaved,
  }: { endpoints: readonly EndpointChoice[]; selected: string | undefined; freshUntil: string; replacing: boolean; onSaved: () => void } = $props();

  let open = $state(false);
  // Decided when the dialog opens, and again if the controller says so: the sign-in may age meanwhile.
  let stale = $state(false);
  let endpointId = $derived(selected ?? endpoints[0]?.id);
  const chosen = $derived(endpoints.find((endpoint) => endpoint.id === endpointId));
  const fields = saveKey.fields;

  function onOpenChange(next: boolean): void {
    if (next) stale = Date.now() > Date.parse(freshUntil);
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Trigger>
    {#snippet child({ props })}
      {#if replacing}
        <Button variant="outline" {...props}><RefreshCwIcon />Replace</Button>
      {:else}
        <Button {...props}>Add a key</Button>
      {/if}
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Save your LLM key</Dialog.Title>
      <Dialog.Description>The runs you ask for are billed to this key. It replaces the one you saved before, if any.</Dialog.Description>
    </Dialog.Header>
    {#if stale}
      <SignInAgain action="save a key" />
    {:else}
      <form
        class="grid gap-6"
        {...saveKey.preflight(KeyInput).enhance(async (form) => {
          if (!(await form.submit())) return;
          const result = saveKey.result;
          if (result === undefined) return;
          if (!result.saved) {
            stale = true;
            return;
          }
          form.element.reset();
          open = false;
          onSaved();
          toast.success(`Your key for ${result.endpointName} is saved`, { description: `It ends in ${result.last4}.` });
          if (result.missingModels.length > 0) {
            toast.warning(`${result.endpointName} doesn't list every model the bot uses`, { description: `Missing: ${result.missingModels.join(", ")}. Runs that need them will fail.`, duration: 20_000 });
          }
        })}
      >
        <Field.Group>
          <Field.Field>
            <Field.Label for="key-endpoint">Endpoint</Field.Label>
            <NativeSelect.Root id="key-endpoint" class="w-full" {...fields.endpointId.as("select")} bind:value={endpointId}>
              {#each endpoints as endpoint (endpoint.id)}
                <NativeSelect.Option value={endpoint.id}>{endpoint.name} ({endpoint.baseUrl})</NativeSelect.Option>
              {/each}
            </NativeSelect.Root>
            {#if chosen?.pricingNote}
              <Field.Description>{chosen.pricingNote}</Field.Description>
            {/if}
            <Field.Error errors={fields.endpointId.issues()} />
          </Field.Field>
          <Field.Field>
            <Field.Label for="key-value">API key</Field.Label>
            <Input id="key-value" autocomplete="off" spellcheck={false} placeholder="Paste the key" {...fields._key.as("password")} />
            <Field.Description>It is checked with the endpoint before it is saved, then never shown again.</Field.Description>
            <Field.Error errors={fields._key.issues()} />
          </Field.Field>
        </Field.Group>
        {#each fields.issues() ?? [] as issue (issue.message)}
          <Alert.Root variant="destructive">
            <Alert.Description>{issue.message}</Alert.Description>
          </Alert.Root>
        {/each}
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button variant="outline" {...props}>Cancel</Button>
            {/snippet}
          </Dialog.Close>
          <Button type="submit" disabled={saveKey.pending > 0}>
            {#if saveKey.pending > 0}<Spinner />{/if}
            Check and save
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
