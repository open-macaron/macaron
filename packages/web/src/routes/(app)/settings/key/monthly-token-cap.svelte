<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { formatTokens } from "#lib/format.js";
  import { type MyMonth, TokenCapInput } from "#lib/keys/forms.js";
  import { setTokenCap } from "./key.remote.ts";

  let { month }: { month: MyMonth } = $props();
  const fields = setTokenCap.fields;
  const committed = $derived(month.tokensUsed + month.tokensReserved);
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Monthly token cap</Card.Title>
    <Card.Description>
      The most tokens your runs on free models may use each calendar month (UTC): they cost $0, so the dollar cap can't bound them. A run that could pass it is refused, with what's left.
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-6">
    <div class="grid gap-2">
      <div class="flex items-baseline justify-between text-sm">
        <span>
          <span class="font-medium tabular-nums">{formatTokens(month.tokensUsed)}</span> tokens used this month{#if month.tokensReserved > 0}, {formatTokens(month.tokensReserved)} reserved by runs in progress{/if}
        </span>
        <span class="text-muted-foreground">{month.monthlyTokenCap === null ? "No cap" : `of ${formatTokens(month.monthlyTokenCap)}`}</span>
      </div>
      {#if month.monthlyTokenCap !== null}
        <Progress value={Math.min(100, (committed / month.monthlyTokenCap) * 100)} aria-label="Share of the monthly token cap used" />
      {/if}
    </div>
    <form
      class="flex flex-wrap items-start gap-3"
      {...setTokenCap.preflight(TokenCapInput).enhance(async (form) => {
        if (!(await form.submit())) return;
        const cap = setTokenCap.result?.monthlyTokenCap;
        toast.success(cap === null || cap === undefined ? "Your monthly token cap is cleared" : `Your monthly token cap is ${formatTokens(cap)} tokens`);
      })}
    >
      <Field.Field class="w-56">
        <Field.Label for="monthly-token-cap" class="sr-only">Monthly token cap in millions of tokens</Field.Label>
        <Input id="monthly-token-cap" placeholder="No cap" step="1" {...fields.monthlyTokenCapMillions.as("number")} value={month.monthlyTokenCap === null ? undefined : month.monthlyTokenCap / 1_000_000} />
        <Field.Description>In millions of tokens.</Field.Description>
        <Field.Error errors={fields.monthlyTokenCapMillions.issues()} />
      </Field.Field>
      <Button type="submit" variant="outline" disabled={setTokenCap.pending > 0}>
        {#if setTokenCap.pending > 0}<Spinner />{/if}
        Save token cap
      </Button>
    </form>
  </Card.Content>
</Card.Root>
