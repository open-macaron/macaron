<script lang="ts">
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import { runModeLabel, runStatusLabels, type AdminRun } from "#lib/admin/forms.js";
  import { formatDateTime, formatUsd } from "#lib/format.js";
  import AskerCell from "./asker-cell.svelte";

  /** Opened from a run's details button; `run` is the last one opened. */
  let { run, open = $bindable(false) }: { run: AdminRun | undefined; open?: boolean } = $props();
</script>

<Sheet.Root bind:open>
  <Sheet.Content class="w-full sm:max-w-xl">
    {#if run}
      <Sheet.Header>
        <Sheet.Title>{run.repo}#{run.number}</Sheet.Title>
        <Sheet.Description>{runModeLabel(run.mode)} · {runStatusLabels[run.status]} · {formatDateTime(run.createdAt)}</Sheet.Description>
      </Sheet.Header>
      <dl class="grid flex-1 content-start gap-5 overflow-y-auto px-4 text-sm">
        <div class="grid gap-1.5">
          <dt class="text-muted-foreground">Asked by</dt>
          <dd><AskerCell asker={run.asker} /></dd>
        </div>
        <div class="grid gap-1.5">
          <dt class="text-muted-foreground">Instruction</dt>
          <dd><blockquote class="border-s-2 ps-3 whitespace-pre-wrap">{run.instruction}</blockquote></dd>
        </div>
        <div class="grid grid-cols-2 gap-5">
          <div class="grid gap-1.5">
            <dt class="text-muted-foreground">Model</dt>
            <dd><code class="text-xs">{run.model}</code></dd>
          </div>
          <div class="grid gap-1.5">
            <dt class="text-muted-foreground">Cost</dt>
            <dd class="tabular-nums">{run.costUsd === null ? "Settling…" : formatUsd(run.costUsd)} of {formatUsd(run.limitUsd)}</dd>
          </div>
          <div class="grid gap-1.5">
            <dt class="text-muted-foreground">Finished</dt>
            <dd>{run.finishedAt === null ? "Not yet" : formatDateTime(run.finishedAt)}</dd>
          </div>
          {#if run.prNumber !== null}
            <div class="grid gap-1.5">
              <dt class="text-muted-foreground">Pull request</dt>
              <dd><a class="hover:underline" href="https://github.com/{run.repo}/pull/{run.prNumber}" target="_blank" rel="noopener noreferrer">#{run.prNumber}</a></dd>
            </div>
          {/if}
        </div>
        {#if run.failure !== null}
          <div class="grid gap-1.5">
            <dt class="text-muted-foreground">Failure</dt>
            <dd class="text-destructive whitespace-pre-wrap">{run.failure}</dd>
          </div>
        {/if}
        <div class="grid gap-1.5">
          <dt class="text-muted-foreground">Links</dt>
          <dd class="grid gap-1">
            <a class="inline-flex items-center gap-1.5 hover:underline" href={run.triggerUrl} target="_blank" rel="external noopener noreferrer"><ExternalLinkIcon class="size-3.5" />The comment that asked</a>
            {#if run.runUrl !== null}
              <a class="inline-flex items-center gap-1.5 hover:underline" href={run.runUrl} target="_blank" rel="external noopener noreferrer"><ExternalLinkIcon class="size-3.5" />The workflow run</a>
            {/if}
          </dd>
        </div>
      </dl>
    {/if}
  </Sheet.Content>
</Sheet.Root>
