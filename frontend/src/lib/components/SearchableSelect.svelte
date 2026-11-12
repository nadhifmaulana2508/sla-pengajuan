<script lang="ts">
	import { Popover } from 'bits-ui';
	import { Check, ChevronsUpDown, Search } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';

	export type SearchableSelectOption = { value: string; label: string; keywords?: string[] };

	type Props = {
		id?: string;
		label: string;
		options: SearchableSelectOption[];
		value?: string;
		onValueChange?: (value: string) => void;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyMessage?: string;
		disabled?: boolean;
		class?: string;
	};

	let {
		id,
		label,
		options,
		value = '',
		onValueChange = () => {},
		placeholder = 'Pilih pilihan',
		searchPlaceholder = 'Cari pilihan...',
		emptyMessage = 'Tidak ada pilihan yang cocok.',
		disabled = false,
		class: className = ''
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let searchInput: HTMLInputElement | null = $state(null);
	let selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? '');
	let filteredOptions = $derived.by(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase('id-ID');
		if (!normalizedQuery) return options;
		return options.filter((option) =>
			[option.label, option.value, ...(option.keywords ?? [])]
				.join(' ')
				.toLocaleLowerCase('id-ID')
				.includes(normalizedQuery)
		);
	});

	$effect(() => {
		if (!open) query = '';
	});

	function choose(value: string): void {
		onValueChange(value);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				{id}
				variant="outline"
				class={`min-h-11 w-full min-w-0 justify-between border-input font-normal ${className}`}
				disabled={disabled}
				aria-label={selectedLabel ? `${label}: ${selectedLabel}` : label}
				title={selectedLabel || placeholder}
			>
				<span class="truncate">{selectedLabel || placeholder}</span>
				<ChevronsUpDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		sideOffset={4}
		class="z-50 w-(--bits-popover-anchor-width) min-w-(--bits-popover-anchor-width) rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			searchInput?.focus({ preventScroll: true });
		}}
	>
		<div class="searchable-select-search">
			<Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<Input
				bind:ref={searchInput}
				bind:value={query}
				class="h-9 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
				placeholder={searchPlaceholder}
				aria-label={searchPlaceholder}
			/>
		</div>
		<div class="searchable-select-options" role="group" aria-label={`Pilihan ${label}`}>
			{#each filteredOptions as option (option.value)}
				{@const isSelected = option.value === value}
				<button
					type="button"
					class="searchable-select-option"
					class:searchable-select-option--selected={isSelected}
					aria-pressed={isSelected}
					onclick={() => choose(option.value)}
				>
					<span class="min-w-0 truncate">{option.label}</span>
					{#if isSelected}<Check class="size-4 shrink-0 text-ring" aria-hidden="true" />{/if}
				</button>
			{:else}
				<p class="searchable-select-empty" role="status">{emptyMessage}</p>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>

<style>
	.searchable-select-search { display:flex; align-items:center; gap:.5rem; padding:0 .5rem; border-bottom:1px solid var(--border); }
	.searchable-select-options { display:grid; max-height:min(18rem, 45vh); overflow-y:auto; gap:.15rem; padding:.3rem; }
	.searchable-select-option { display:flex; min-height:2.75rem; min-width:0; align-items:center; justify-content:space-between; gap:.65rem; padding:.45rem .65rem; border:0; border-radius:calc(var(--radius) - 2px); background:transparent; color:var(--foreground); font:inherit; font-size:var(--type-sm); text-align:left; cursor:pointer; }
	.searchable-select-option:hover, .searchable-select-option:focus-visible { background:var(--secondary); color:var(--foreground); outline:none; }
	.searchable-select-option:focus-visible { box-shadow:0 0 0 2px var(--ring); }
	.searchable-select-option--selected { background:var(--secondary); box-shadow:inset 3px 0 0 var(--ring); color:var(--ring); font-weight:650; }
	.searchable-select-empty { margin:0; padding:.9rem .65rem; color:var(--muted-foreground); font-size:var(--type-sm); text-align:center; }
</style>
