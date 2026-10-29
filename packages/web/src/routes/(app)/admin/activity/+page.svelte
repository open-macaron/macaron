<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import * as NativeSelect from "#lib/components/ui/native-select/index.js";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { activityFiltersOf, runModeLabels, runStatusLabels } from "#lib/admin/forms.js";
  import RefusalsList from "./refusals-list.svelte";
  import RunsList from "./runs-list.svelte";
  import UserFilter from "./user-filter.svelte";

  const filters = $derived(activityFiltersOf(page.url.searchParams));
  const filtered = $derived(filters.user !== undefined || filters.repo !== undefined || filters.status !== undefined || filters.mode !== undefined);
  // Lists restart from their first page when the filters change.
  const key = $derived(JSON.stringify(filters));
  let tab = $state(page.url.searchParams.get("tab") === "refusals" ? "refusals" : "runs");

  /** Selects apply at once: the form is a plain GET, so the filters land in the URL. */
  function submit(event: Event): void {
    if (event.currentTarget instanceof HTMLSelectElement) event.currentTarget.form?.requestSubmit();
  }
</script>

<PageHeader title="Activity" description="Everything the bot was asked to do, who asked, what it cost, and the requests it refused." />

<form method="GET" class="flex flex-wrap items-end gap-3" aria-label="Filters">
  <input type="hidden" name="tab" value={tab} />
  <div class="grid gap-1.5">
    <Label for="filter-user">Asked by</Label>
    <UserFilter value={filters.user} onchange={submit} />
  </div>
  <div class="grid gap-1.5">
    <Label for="filter-repo">Repository</Label>
    <Input id="filter-repo" name="repo" class="w-56" placeholder="owner/name" value={filters.repo ?? ""} pattern="[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+" />
  </div>
  <div class="grid gap-1.5">
    <Label for="filter-status">Status</Label>
    <NativeSelect.Root id="filter-status" name="status" value={filters.status ?? ""} disabled={tab === "refusals"} onchange={submit}>
      <NativeSelect.Option value="">Any</NativeSelect.Option>
      {#each Object.entries(runStatusLabels) as [status, label] (status)}
        <NativeSelect.Option value={status}>{label}</NativeSelect.Option>
      {/each}
    </NativeSelect.Root>
  </div>
  <div class="grid gap-1.5">
    <Label for="filter-mode">Mode</Label>
    <NativeSelect.Root id="filter-mode" name="mode" value={filters.mode ?? ""} disabled={tab === "refusals"} onchange={submit}>
      <NativeSelect.Option value="">Any</NativeSelect.Option>
      {#each Object.entries(runModeLabels) as [mode, label] (mode)}
        <NativeSelect.Option value={mode}>{label}</NativeSelect.Option>
      {/each}
    </NativeSelect.Root>
  </div>
  <Button type="submit" variant="outline">Apply</Button>
  {#if filtered}
    <Button variant="ghost" href={resolve("/(app)/admin/activity")}>Clear filters</Button>
  {/if}
</form>

<Tabs.Root bind:value={tab}>
  <Tabs.List>
    <Tabs.Trigger value="runs">Runs</Tabs.Trigger>
    <Tabs.Trigger value="refusals">Refusals</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="runs" class="grid gap-4">
    {#key key}<RunsList {filters} {filtered} />{/key}
  </Tabs.Content>
  <Tabs.Content value="refusals">
    {#key key}<RefusalsList {filters} {filtered} />{/key}
  </Tabs.Content>
</Tabs.Root>
