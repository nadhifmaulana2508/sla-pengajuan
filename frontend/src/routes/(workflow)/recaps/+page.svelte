<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Popover } from 'bits-ui';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import {
		createRecap, fetchRecapCatalogs, fetchRecaps, fetchRecapSources,
		type RecapListItem, type RecapSourceField, type RecapSourceRequest,
		type RecapSources, type RecapTrackingField
	} from '#lib/features/recaps/recaps.api.js';
	import { formatDateTimeWib } from '#lib/utils/datetime.js';
	import { ArrowRight, ClipboardCheck, Info, ListFilter, Plus, RotateCw, X } from '@lucide/svelte';

	type TrackingDraft = Omit<RecapTrackingField, 'options'> & { options_text: string };

	let token = $state<string | null>(null);
	let role = $state<string | null>(null);
	let recaps = $state<RecapListItem[]>([]);
	let catalogs = $state<Array<{ id: number; nama_pekerjaan: string; compatible_work_catalogs: string[]; eligible_count: number }>>([]);
	let sourceData = $state<RecapSources | null>(null);
	let title = $state('');
	let catalogId = $state('');
	let selectedRequestIds = $state<number[]>([]);
	let visibleKeys = $state<string[]>([]);
	let trackingFields = $state<TrackingDraft[]>([]);
	let loading = $state(true);
	let createHelpOpen = $state(false);
	let sourcesLoading = $state(false);
	let submitting = $state(false);
	let errorMessage = $state('');
	let sourceError = $state('');
	let canRetryLoad = $state(false);
	let recapSearch = $state('');
	let recapStatusFilter = $state('all');
	let recapFiltersOpen = $state(false);
	let recapView = $state<'create' | 'list'>('create');
	let filteredRecaps = $derived(recaps.filter((item) => {
		const query = recapSearch.trim().toLocaleLowerCase('id-ID');
		const matchesSearch = !query || `${item.title} ${item.nama_pekerjaan} ${item.nama_divisi}`.toLocaleLowerCase('id-ID').includes(query);
		return matchesSearch && (recapStatusFilter === 'all' || item.status === recapStatusFilter);
	}));

	function resetRecapFilters(): void {
		recapSearch = '';
		recapStatusFilter = 'all';
	}

	function submitRecapFilters(event: SubmitEvent): void {
		event.preventDefault();
		recapFiltersOpen = false;
	}

	onMount(() => {
		let loadedSession = '';
		const unsubscribe = authSession.subscribe((session) => {
			token = session.token;
			role = session.profile?.sla_access.role ?? null;
			const sessionKey = `${session.token ?? ''}:${role ?? ''}`;
			if (token && role && loadedSession !== sessionKey) {
				loadedSession = sessionKey;
				void load();
			}
		});
		return unsubscribe;
	});

	async function load(): Promise<void> {
		if (!token) { await goto('/'); return; }
		loading = true; errorMessage = ''; canRetryLoad = false;
		try {
			const [list, catalogData] = await Promise.all([
				fetchRecaps(token),
				role === 'division_staff' ? fetchRecapCatalogs(token) : Promise.resolve(null)
			]);
			recaps = list.data.recaps;
			catalogs = catalogData?.data.catalogs ?? [];
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Daftar rekap belum dapat dimuat. Periksa koneksi lalu coba lagi.';
			canRetryLoad = true;
		} finally { loading = false; }
	}

	async function loadSources(): Promise<void> {
		if (!token || !catalogId) { sourceData = null; return; }
		sourcesLoading = true; sourceError = ''; sourceData = null; selectedRequestIds = []; visibleKeys = [];
		try { sourceData = (await fetchRecapSources(token, Number(catalogId))).data; }
		catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			sourceError = error instanceof ApiError ? error.message : 'Tiket sumber belum dapat dimuat. Coba lagi.';
		} finally { sourcesLoading = false; }
	}

	async function chooseCatalog(value: string): Promise<void> {
		catalogId = value;
		await loadSources();
	}

	function selectedSourceFields(): RecapSourceField[] {
		if (!sourceData) return [];
		const keys = new Set(sourceData.requests.filter((item) => selectedRequestIds.includes(item.id)).flatMap((item) => item.field_keys));
		return sourceData.source_fields.filter((field) => keys.has(field.key));
	}

	function toggleRequest(item: RecapSourceRequest, checked: boolean): void {
		selectedRequestIds = checked
			? [...selectedRequestIds, item.id]
			: selectedRequestIds.filter((id) => id !== item.id);
		const available = selectedSourceFields();
		const nextKeys = new Set(available.map((field) => field.key));
		visibleKeys = [
			...visibleKeys.filter((key) => nextKeys.has(key)),
			...available.map((field) => field.key).filter((key) => !visibleKeys.includes(key))
		];
	}

	function selectAllRequests(checked: boolean): void {
		if (!sourceData) return;
		selectedRequestIds = checked ? sourceData.requests.map((item) => item.id) : [];
		visibleKeys = checked ? sourceData.source_fields.map((field) => field.key) : [];
	}

	function addTrackingField(): void {
		let number = trackingFields.length + 1;
		while (trackingFields.some((field) => field.key === `tracking_field_${number}`)) number += 1;
		trackingFields = [...trackingFields, {
			key: `tracking_field_${number}`, label: '', type: 'text', editable_by_branch: false, options_text: ''
		}];
	}

	function removeTrackingField(index: number): void {
		trackingFields = trackingFields.filter((_, fieldIndex) => fieldIndex !== index);
	}

	async function publishRecap(): Promise<void> {
		if (!token || submitting) return;
		errorMessage = ''; canRetryLoad = false;
		if (!title.trim() || !catalogId || selectedRequestIds.length === 0 || visibleKeys.length === 0) {
			errorMessage = 'Isi nama rekap, pilih pekerjaan, tiket sumber, dan sedikitnya satu kolom form.';
			return;
		}
		const fields: RecapTrackingField[] = trackingFields.map((field) => ({
			key: field.key, label: field.label, type: field.type, editable_by_branch: field.editable_by_branch,
			...(field.type === 'select' ? { options: field.options_text.split('\n').map((option) => option.trim()).filter(Boolean) } : {})
		}));
		submitting = true;
		try {
			const result = await createRecap(token, {
				title: title.trim(), work_catalog_id: Number(catalogId), request_ids: selectedRequestIds,
				visible_source_keys: visibleKeys, tracking_fields: fields
			});
			await goto(`/recaps/${result.data.id}`);
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Rekap belum dapat diterbitkan. Periksa isian lalu coba lagi.';
			canRetryLoad = false;
		} finally { submitting = false; }
	}
</script>

<svelte:head><title>Rekap | Sistem SLA</title></svelte:head>

<section class="app-page-stack" aria-labelledby="page-title">
	<AppPageHeading eyebrow={role === 'division_staff' ? 'Divisi Pusat' : 'Cabang'} title="Rekap" description={role === 'division_staff' ? 'Susun daftar pemantauan dari pengajuan yang pernah masuk ke divisi ini.' : 'Lihat rekap yang dibagikan Divisi untuk kantor kamu.'} flush />

	{#if errorMessage && !submitting}<Alert.Root variant="destructive"><Alert.Title>{canRetryLoad ? 'Daftar rekap belum dapat dimuat' : 'Perlu diperiksa'}</Alert.Title><Alert.Description>{errorMessage}</Alert.Description>{#if canRetryLoad}<Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void load()}>Coba lagi</Button></Alert.Action>{/if}</Alert.Root>{/if}

	{#if role === 'division_staff'}
		<div class="recap-view-switch" role="group" aria-label="Tampilan rekap">
			<Button type="button" variant={recapView === 'create' ? 'secondary' : 'ghost'} class="min-h-11" aria-pressed={recapView === 'create'} onclick={() => (recapView = 'create')}><Plus class="size-4" aria-hidden="true" />Buat rekap</Button>
			<Button type="button" variant={recapView === 'list' ? 'secondary' : 'ghost'} class="min-h-11" aria-pressed={recapView === 'list'} onclick={() => (recapView = 'list')}><ClipboardCheck class="size-4" aria-hidden="true" />Rekap tersedia</Button>
		</div>
	{/if}

	{#if role === 'division_staff' && recapView === 'create'}
		<Card.Root size="sm" class="recap-create-card">
			<Card.Header class="recap-create-header"><div class="recap-create-title"><Card.Title>Buat rekap</Card.Title><Dialog.Root bind:open={createHelpOpen}><Dialog.Trigger>
				{#snippet child({ props })}<Button {...props} type="button" variant="ghost" class="recap-help-trigger size-11 min-h-11 min-w-11" aria-label="Panduan membuat rekap" aria-haspopup="dialog" aria-expanded={createHelpOpen}><Info class="size-4" aria-hidden="true" /></Button>{/snippet}
			</Dialog.Trigger><Dialog.Content class="recap-help-dialog"><Dialog.Header><Dialog.Title>Panduan membuat rekap</Dialog.Title><Dialog.Description>Pilih template form untuk menyatukan tiket dari pekerjaan berbeda dengan struktur yang sama. Satu tiket hanya dapat masuk ke satu rekap, dan setiap baris form berulang menjadi baris rekap tersendiri.</Dialog.Description></Dialog.Header></Dialog.Content></Dialog.Root></div></Card.Header>
			<Card.Content class="recap-builder">
				<div class="recap-basics">
					<label class="form-field"><span>Nama rekap</span><Input bind:value={title} maxlength={160} placeholder="Contoh: Pemantauan Gugatan Sederhana" /></label>
					<div class="form-field"><span>Jenis pekerjaan</span><Select.Root type="single" value={catalogId} onValueChange={chooseCatalog}>
						<Select.Trigger class="min-h-11 w-full" aria-label="Jenis pekerjaan"><Select.Value placeholder="Pilih jenis pekerjaan" /></Select.Trigger>
						<Select.Content align="start" class="max-h-[min(20rem,55dvh)] w-(--bits-select-anchor-width)">
							{#each catalogs as item (item.id)}<Select.Item value={String(item.id)}>{item.nama_pekerjaan}{item.compatible_work_catalogs.length > 1 ? ` + ${item.compatible_work_catalogs.length - 1} pekerjaan` : ''} · {item.eligible_count} tiket</Select.Item>{/each}
						</Select.Content>
					</Select.Root></div>
				</div>
				{#if catalogs.length === 0 && !loading}<p class="muted-note">Belum ada tiket yang memenuhi syarat. Tiket ditolak atau belum pernah masuk ke divisi ini tidak ditampilkan.</p>{/if}

				{#if catalogId}
					<section class="builder-section" aria-labelledby="source-title">
						<div class="section-title-row"><div><h2 id="source-title">Pilih tiket sumber</h2><p>Daftar menggabungkan nama pekerjaan berbeda dengan template form yang sama. Tiket harus pernah masuk ke divisi ini dan belum ditolak.</p></div>{#if sourceData}<span class="count-label">{selectedRequestIds.length} dipilih</span>{/if}</div>
						{#if sourcesLoading}<p class="muted-note" role="status">Memuat tiket sumber…</p>
						{:else if sourceError}<Alert.Root variant="destructive"><Alert.Description>{sourceError}</Alert.Description></Alert.Root>
						{:else if sourceData?.requests.length}
							<label class="source-option source-select-all"><Checkbox checked={selectedRequestIds.length === sourceData.requests.length} indeterminate={selectedRequestIds.length > 0 && selectedRequestIds.length < sourceData.requests.length} onCheckedChange={(checked) => selectAllRequests(checked)} /><span>Pilih semua {sourceData.requests.length} tiket yang tersedia</span></label>
							<div class="source-list">
								{#each sourceData.requests as item (item.id)}
									<label class="source-option"><Checkbox checked={selectedRequestIds.includes(item.id)} onCheckedChange={(checked) => toggleRequest(item, checked)} /><span class="source-copy"><strong>{item.request_number} · {item.subject}</strong><small>{item.nama_pekerjaan} · {item.nama_kantor} ({item.kode_kantor}) · {item.entry_count} baris · {formatDateTimeWib(item.submitted_at)}</small></span></label>
								{/each}
							</div>
						{:else}<p class="muted-note">Belum ada pengajuan yang memakai template form ini dan memenuhi syarat rekap.</p>{/if}
					</section>
				{/if}

				{#if selectedRequestIds.length > 0}
					<section class="builder-section" aria-labelledby="columns-title">
						<div class="section-title-row"><div><h2 id="columns-title">Kolom form yang ditampilkan</h2><p>Kolom ini berasal dari snapshot versi form tiket terpilih.</p></div></div>
						<div class="field-checks">
							{#each selectedSourceFields() as field (field.key)}
								<label class="field-check"><Checkbox checked={visibleKeys.includes(field.key)} onCheckedChange={(checked) => { visibleKeys = checked ? [...visibleKeys, field.key] : visibleKeys.filter((key) => key !== field.key); }} /><span>{field.label}</span></label>
							{/each}
						</div>
					</section>

					<section class="builder-section" aria-labelledby="tracking-title">
						<div class="section-title-row"><div><h2 id="tracking-title">Kolom pemantauan Divisi</h2><p>Cabang hanya dapat mengusulkan perubahan pada kolom yang kamu izinkan.</p></div><Button type="button" variant="outline" class="min-h-11" onclick={addTrackingField}><Plus class="size-4" aria-hidden="true" />Tambah kolom</Button></div>
						{#if trackingFields.length === 0}<p class="muted-note">Belum ada kolom tambahan. Kamu bisa menerbitkan rekap dengan kolom form saja.</p>{/if}
						<div class="tracking-builder">
							{#each trackingFields as field, index (field.key)}
								<div class="tracking-field">
									<label class="form-field"><span>Nama kolom</span><Input bind:value={field.label} maxlength={100} placeholder="Contoh: Tahap gugatan" /></label>
									<div class="form-field"><span>Tipe</span><Select.Root type="single" bind:value={field.type}><Select.Trigger class="min-h-11 w-full" aria-label="Tipe kolom pemantauan"><Select.Value /></Select.Trigger><Select.Content align="start"><Select.Item value="text">Teks</Select.Item><Select.Item value="number">Angka</Select.Item><Select.Item value="date">Tanggal</Select.Item><Select.Item value="select">Dropdown</Select.Item></Select.Content></Select.Root></div>
									{#if field.type === 'select'}<label class="form-field options-field"><span>Pilihan, satu per baris</span><Textarea class="min-h-20 resize-y" bind:value={field.options_text} rows={3} placeholder={'Persiapan\nSidang\nSelesai'} /></label>{/if}
									<label class="editable-toggle"><Checkbox bind:checked={field.editable_by_branch} /><span>Cabang boleh mengusulkan perubahan</span></label>
									<Button type="button" variant="ghost" class="remove-field" aria-label={`Hapus kolom ${field.label || index + 1}`} onclick={() => removeTrackingField(index)}><X class="size-4" aria-hidden="true" />Hapus</Button>
								</div>
							{/each}
						</div>
					</section>

					<div class="publish-row"><span class="muted-note">Saat diterbitkan, tiket terpilih langsung masuk ke rekap.</span><Button class="min-h-11" disabled={submitting} onclick={() => void publishRecap()}>{#if submitting}<RotateCw class="size-4 animate-spin" aria-hidden="true" />Menerbitkan…{:else}<ClipboardCheck class="size-4" aria-hidden="true" />Terbitkan rekap{/if}</Button></div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if role !== 'division_staff' || recapView === 'list'}
	<Card.Root size="sm">
		<Card.Header class="recap-list-header">
			<div><Card.Title>Rekap tersedia</Card.Title><Card.Description>{role === 'division_staff' ? 'Semua rekap dalam cakupan divisi kamu.' : 'Rekap yang memuat pengajuan dari kantor kamu.'}</Card.Description></div>
			<div class="recap-list-actions">
				<Input class="recap-search" type="search" bind:value={recapSearch} aria-label="Cari rekap, pekerjaan, atau divisi" placeholder="Cari rekap atau pekerjaan" />
			<Popover.Root bind:open={recapFiltersOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button {...props} type="button" variant="outline" class="filter-trigger min-h-11" aria-haspopup="dialog" aria-expanded={recapFiltersOpen}><ListFilter class="size-4" aria-hidden="true" />Filter</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content class="app-filter-popover" side="top" align="end" sideOffset={8} trapFocus={false} aria-labelledby="recap-filter-title" aria-describedby="recap-filter-description">
						<div class="app-filter-popover-header">
							<h2 id="recap-filter-title" class="app-filter-popover-title">Filter rekap</h2>
							<p id="recap-filter-description" class="app-filter-popover-description">Saring rekap berdasarkan status.</p>
						</div>
						<form class="app-filter-popover-form" onsubmit={submitRecapFilters}>
							<div class="app-filter-popover-fields">
			<div class="recap-filter-fields"><div class="form-field"><span>Status rekap</span><Select.Root type="single" bind:value={recapStatusFilter}><Select.Trigger class="min-h-11 w-full" aria-label="Status rekap"><Select.Value /></Select.Trigger><Select.Content align="start"><Select.Item value="all">Semua status</Select.Item><Select.Item value="published">Terbit</Select.Item><Select.Item value="archived">Diarsipkan</Select.Item></Select.Content></Select.Root></div></div>
					</div>
						<div class="app-filter-popover-actions">
							<Button type="button" variant="outline" class="min-h-11" disabled={!recapSearch && recapStatusFilter === 'all'} onclick={() => { resetRecapFilters(); recapFiltersOpen = false; }}>Reset</Button>
							<Button type="submit" class="min-h-11">Terapkan</Button>
						</div>
					</form>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
			</div>
		</Card.Header>
		<Card.Content>
			{#if loading}<div class="state-panel" role="status">Memuat daftar rekap…</div>
			{:else if recaps.length === 0}<div class="empty-panel"><ClipboardCheck class="size-5" aria-hidden="true" /><h2>Belum ada rekap</h2><p>{role === 'division_staff' ? 'Pilih tiket sumber di atas untuk menerbitkan rekap pertama.' : 'Rekap yang dibagikan Divisi akan muncul di sini.'}</p></div>
			{:else}
				<p class="filter-count">{filteredRecaps.length} dari {recaps.length} rekap</p>
				{#if filteredRecaps.length === 0}<div class="empty-panel"><p>Tidak ada rekap yang cocok dengan filter.</p><Button variant="outline" class="min-h-11" onclick={resetRecapFilters}>Reset filter</Button></div>
				{:else}<div class="recap-list">{#each filteredRecaps as item (item.id)}
				<Card.Root size="sm" class="recap-item"><div class="recap-item-copy"><strong>{item.title}</strong><span>{item.work_catalog_count > 1 ? `${item.work_catalog_count} jenis pekerjaan, satu template form` : item.nama_pekerjaan} · {item.nama_divisi}</span><small>{item.row_count} baris · diterbitkan {formatDateTimeWib(item.published_at)}{#if role === 'division_staff' && item.pending_count > 0} · {item.pending_count} perubahan menunggu{/if}</small></div><Button variant="outline" size="sm" class="min-h-11" href={`/recaps/${item.id}`}>Buka rekap <ArrowRight class="size-4" aria-hidden="true" /></Button></Card.Root>
				{/each}</div>{/if}
			{/if}
		</Card.Content>
	</Card.Root>
	{/if}
</section>

<style>
	.recap-view-switch { display:flex; width:max-content; max-width:100%; gap:.2rem; border-bottom:1px solid var(--border); }
	.recap-view-switch :global(button) { min-width:0; justify-content:center; }
	.recap-view-switch :global(button[aria-pressed='true']) { box-shadow:0 1px 2px rgb(0 0 0 / .12); }
	:global(.recap-create-card[data-slot='card']) { --card-spacing:.75rem; }
	:global(.recap-create-header[data-slot='card-header']) { gap:.3rem; padding:.75rem 1rem .2rem; }
	.recap-create-title { display:flex; min-width:0; align-items:center; gap:.15rem; }
	:global(.recap-help-trigger) { padding:0; color:var(--muted-foreground); box-shadow:none; }
	:global(.recap-help-trigger:hover) { color:var(--foreground); }
	:global(.recap-help-dialog[data-slot='dialog-content']) { width:min(30rem,calc(100vw - 1.5rem)); }
	:global(.recap-builder[data-slot='card-content']) { display:grid; gap:.8rem; padding:.7rem 1rem 1rem; }
	.recap-basics { display:grid; max-width:70rem; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; }
	.form-field { display:grid; min-width:0; gap:.35rem; font-weight:560; }
	.builder-section { display:grid; gap:.75rem; border-top:1px solid var(--border); padding-top:1.1rem; }
	.section-title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
	.section-title-row h2 { margin:0; font-size:var(--type-base); font-weight:650; }
	.section-title-row p,.muted-note { margin:.2rem 0 0; color:var(--muted-foreground); font-size:var(--type-sm); line-height:1.55; }
	.count-label { flex:0 0 auto; color:var(--muted-foreground); font-size:var(--type-sm); }
	.source-list { display:grid; max-height:22rem; overflow:auto; border:1px solid var(--border); border-radius:.8rem; }
	.source-option { display:flex; min-width:0; min-height:2.75rem; align-items:flex-start; gap:.7rem; padding:.75rem .8rem; cursor:pointer; }
	.source-list .source-option + .source-option { border-top:1px solid var(--border); }
	.source-select-all { border:1px solid var(--border); border-radius:.8rem; font-weight:600; }
	.source-option :global([data-slot='checkbox']) { margin-top:.15rem; }
	.source-copy { display:grid; min-width:0; gap:.15rem; }
	.source-copy strong { overflow-wrap:anywhere; font-size:var(--type-sm); }
	.source-copy small { color:var(--muted-foreground); font-size:var(--type-xs); }
	.field-checks { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr)); gap:.45rem .8rem; }
	.field-check,.editable-toggle { display:flex; min-height:2.75rem; align-items:center; gap:.55rem; color:var(--foreground); font-size:var(--type-sm); cursor:pointer; }
	.tracking-builder { display:grid; gap:.7rem; }
	.tracking-field { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(8rem,.8fr) minmax(0,2fr) auto; align-items:end; gap:.75rem; border:1px solid var(--border); border-radius:.8rem; padding:.85rem; }
	.tracking-field:has(.options-field) { grid-template-columns:minmax(0,1.1fr) minmax(8rem,.7fr) minmax(0,1.6fr) auto; }
	.tracking-field:not(:has(.options-field)) .editable-toggle { grid-column:1 / span 2; }
	:global(.remove-field) { min-height:2.75rem; }
	.publish-row { display:flex; align-items:center; justify-content:space-between; gap:1rem; border-top:1px solid var(--border); padding-top:1rem; }
	.recap-list { display:grid; gap:.65rem; }
	.recap-filter-fields { display:grid; gap:.75rem; }
	:global(.recap-list-header[data-slot='card-header']) { display:flex; flex-direction:row; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:.75rem 1rem; }
	:global(.recap-list-header[data-slot='card-header'] > div) { min-width:0; flex:1 1 16rem; }
	.recap-list-actions { display:flex; min-width:0; flex:0 1 auto; align-items:center; gap:.5rem; }
	:global(.recap-search) { width:min(21rem, 34vw); min-width:12rem; }
	.filter-count { margin:0 0 .55rem; color:var(--muted-foreground); font-size:var(--type-sm); }
	:global(.recap-item[data-slot='card']) { display:flex; min-width:0; flex-direction:row; align-items:center; justify-content:space-between; gap:1rem; padding:1rem; }
	.recap-item-copy { display:grid; min-width:0; gap:.2rem; }
	.recap-item-copy strong { overflow-wrap:anywhere; }
	.recap-item-copy span,.recap-item-copy small { color:var(--muted-foreground); font-size:var(--type-sm); }
	.empty-panel { display:grid; min-height:10rem; align-content:center; justify-items:center; gap:.4rem; text-align:center; color:var(--muted-foreground); }
	.empty-panel h2 { margin:0; color:var(--foreground); font-size:var(--type-base); }
	.empty-panel p { margin:0; max-width:30rem; font-size:var(--type-sm); }
	.state-panel { min-height:6rem; display:grid; place-items:center; color:var(--muted-foreground); }
	@media(max-width:760px) {
		.recap-basics { grid-template-columns:minmax(0,1fr); gap:.65rem; }
		.tracking-field,.tracking-field:has(.options-field) { grid-template-columns:repeat(2,minmax(0,1fr)); }
		.options-field { grid-column:1 / -1; }
		.tracking-field:not(:has(.options-field)) .editable-toggle { grid-column:1 / -1; }
	}
	@media(max-width:520px) {
		.recap-view-switch { display:grid; width:100%; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.25rem; padding:.25rem; border:1px solid var(--border); border-radius:var(--radius); background:color-mix(in srgb,var(--muted) 72%,var(--card)); }
		.recap-view-switch :global(button) { width:100%; min-width:0; border-radius:calc(var(--radius) - .2rem); }
		.section-title-row,.publish-row { flex-direction:column; align-items:stretch; }
		:global(.recap-list-header[data-slot='card-header']) { align-items:stretch; flex-direction:column; gap:.7rem; }
		:global(.recap-list-header[data-slot='card-header'] > div:first-child) { flex:auto; }
		.recap-list-actions { display:grid; width:100%; grid-template-columns:minmax(0,1fr) auto; gap:.5rem; }
		:global(.recap-search) { width:100%; min-width:0; }
		:global(.recap-item[data-slot='card']) { align-items:flex-start; flex-direction:column; gap:.65rem; padding:.8rem; }
		:global(.recap-item [data-slot='button']) { align-self:flex-end; white-space:nowrap; }
		.tracking-field,.tracking-field:has(.options-field) { grid-template-columns:minmax(0,1fr); }
		.options-field,.tracking-field:not(:has(.options-field)) .editable-toggle { grid-column:auto; }
	}
	@media(max-width:24rem) {
		:global(.recap-list-header[data-slot='card-header']) { gap:.55rem; }
		.recap-list-actions { gap:.35rem; }
	}
</style>
