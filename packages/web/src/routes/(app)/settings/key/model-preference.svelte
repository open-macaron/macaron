<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import * as NativeSelect from "#lib/components/ui/native-select/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { ModelPreferenceInput, type MyModels } from "#lib/keys/forms.js";
  import { setModels } from "./key.remote.ts";

  let { models }: { models: MyModels } = $props();
  const fields = setModels.fields;

  // Read once: after a save the selects already show what was saved.
  function initial(): { model: string; fastModel: string } {
    return { model: models.preference.model ?? "", fastModel: models.preference.fastModel ?? "" };
  }
  const start = initial();
  // Blank means the configuration's choice.
  let model = $state(start.model);
  let fastModel = $state(start.fastModel);

  function label(option: string): string {
    return models.free.includes(option) ? `${option} (free, capped by tokens)` : option;
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Models</Card.Title>
    <Card.Description>
      The models your runs use, among the ones the gateway prices or serves for free. They replace the configuration's defaults for the runs you pay for; a mode the configuration gives its own model (reviews) keeps it. Runs on a free model are capped by tokens instead of dollars.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form
      class="grid gap-6"
      {...setModels.preflight(ModelPreferenceInput).enhance(async (form) => {
        if (!(await form.submit())) return;
        toast.success("Your model choices are saved");
      })}
    >
      <Field.Group class="grid gap-4 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="model-default">Default model</Field.Label>
          <NativeSelect.Root id="model-default" {...fields.model.as("select")} bind:value={model}>
            <NativeSelect.Option value="">The configuration's default</NativeSelect.Option>
            {#each models.models as option (option)}
              <NativeSelect.Option value={option}>{label(option)}</NativeSelect.Option>
            {/each}
          </NativeSelect.Root>
          <Field.Error errors={fields.model.issues()} />
        </Field.Field>
        <Field.Field>
          <Field.Label for="model-fast">Fast model</Field.Label>
          <NativeSelect.Root id="model-fast" {...fields.fastModel.as("select")} bind:value={fastModel}>
            <NativeSelect.Option value="">The configuration's fast model</NativeSelect.Option>
            {#each models.models as option (option)}
              <NativeSelect.Option value={option}>{label(option)}</NativeSelect.Option>
            {/each}
          </NativeSelect.Root>
          <Field.Description>For quick chores: titles, summaries. The run's model when the configuration has none set apart.</Field.Description>
          <Field.Error errors={fields.fastModel.issues()} />
        </Field.Field>
      </Field.Group>

      <div>
        <Button type="submit" disabled={setModels.pending > 0}>
          {#if setModels.pending > 0}<Spinner />{/if}
          Save models
        </Button>
      </div>
    </form>
  </Card.Content>
</Card.Root>
