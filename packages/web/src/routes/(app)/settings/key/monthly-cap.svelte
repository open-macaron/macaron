<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { formatUsd } from "#lib/format.js";
  import { CapInput, type MyMonth } from "#lib/keys/forms.js";
  import { setCap } from "./key.remote.ts";

  let { month }: { month: MyMonth } = $props();
  const fields = setCap.fields;
  const committed = $derived(month.spentUsd + month.reservedUsd);
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Monthly cap</Card.Title>
    <Card.Description>
      The most your key may be billed each calendar month (UTC). A run that could pass it is refused, with what's left. Project budgets apply as well.
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-6">
    <div class="grid gap-2">
      <div class="flex items-baseline justify-between text-sm">
        <span>
          <span class="font-medium tabular-nums">{formatUsd(month.spentUsd)}</span> billed this month{#if month.reservedUsd > 0}, {formatUsd(month.reservedUsd)} reserved by runs in progress{/if}
        </span>
        <span class="text-muted-foreground">{month.monthlyCapUsd === null ? "No cap" : `of ${formatUsd(month.monthlyCapUsd)}`}</span>
      </div>
      {#if month.monthlyCapUsd !== null}
        <Progress value={Math.min(100, (committed / month.monthlyCapUsd) * 100)} aria-label="Share of the monthly cap used" />
      {/if}
    </div>
    <form
      class="flex flex-wrap items-start gap-3"
      {...setCap.preflight(CapInput).enhance(async (form) => {
        if (!(await form.submit())) return;
        const cap = setCap.result?.monthlyCapUsd;
        toast.success(cap === null || cap === undefined ? "Your monthly cap is cleared" : `Your monthly cap is ${formatUsd(cap)}`);
      })}
    >
      <Field.Field class="w-56">
        <Field.Label for="monthly-cap" class="sr-only">Monthly cap in dollars</Field.Label>
        <Input id="monthly-cap" placeholder="No cap" step="0.01" {...fields.monthlyCapUsd.as("number")} value={month.monthlyCapUsd ?? undefined} />
        <Field.Error errors={fields.monthlyCapUsd.issues()} />
      </Field.Field>
      <Button type="submit" variant="outline" disabled={setCap.pending > 0}>
        {#if setCap.pending > 0}<Spinner />{/if}
        Save cap
      </Button>
    </form>
  </Card.Content>
</Card.Root>
