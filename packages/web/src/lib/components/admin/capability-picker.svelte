<script lang="ts">
  import { Capability } from "@open-macaron/contracts/capability";
  import type { RemoteFormField } from "$app/server";
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { capabilityInfo } from "#lib/capabilities.js";

  interface Props {
    /** The remote form's capabilities field. */
    field: RemoteFormField<Capability[]>;
    /** What is checked when the form opens or resets. */
    initial?: readonly Capability[];
    idPrefix: string;
  }
  let { field, initial = [], idPrefix }: Props = $props();
</script>

<!-- Columns follow the picker's own width: two in a dialog, one in a narrow sheet. -->
<Field.Set class="@container">
  <Field.Legend variant="label">Capabilities</Field.Legend>
  <Field.Description>What this person may ask the bot for. Every run is billed to their own key.</Field.Description>
  <Field.Group class="grid gap-3 @md:grid-cols-2">
    {#each Capability.options as capability (capability)}
      {@const info = capabilityInfo[capability]}
      {@const attrs = field.as("checkbox", capability, initial.includes(capability))}
      <Field.Label for="{idPrefix}-{capability}" class="has-data-checked:border-primary/40 has-data-checked:bg-primary/5">
        <Field.Field orientation="horizontal">
          <Checkbox id="{idPrefix}-{capability}" name={attrs.name} value={capability} checked={attrs.checked} aria-invalid={attrs["aria-invalid"]} />
          <Field.Content>
            <Field.Title>
              <info.icon class="size-4 text-muted-foreground" />
              {info.label}
            </Field.Title>
            <Field.Description>{info.description}</Field.Description>
          </Field.Content>
        </Field.Field>
      </Field.Label>
    {/each}
  </Field.Group>
  <Field.Error errors={field.issues()} />
</Field.Set>
