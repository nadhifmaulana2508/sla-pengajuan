<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Popover } from 'bits-ui';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import {
		appendRecapSources, fetchAppendableRecapSources, fetchRecap, proposeRecapChanges, reviewRecapChanges, saveRecapRow, updateRecapSettings,
		type RecapDetail, type RecapRow, type RecapSources, type RecapTrackingField
	} from '#lib/features/recaps/recaps.api.js';
	import { formatDateTimeWib } from '#lib/utils/datetime.js';
	import { ArrowLeft, Check, ListFilter, Pencil, Plus, RotateCw, Send, X } from '@lucide/svelte';

	type EditTrackingDraft = Omit<RecapTrackingField, 'options'> & { options_text: string; isNew: boolean };

	const recapId = Number(page.params.id);
	let token = $state<string | null>(null);
	let detail = $state<RecapDetail | null>(null);
	let drafts = $state<Record<number, Record<string, string>>>({});
	let notes = $state<Record<number, string>>({});
	let reviewNotes = $state<Record<number, string>>({});
	let loading = $state(true);
	let savingId = $state<number | null>(null);
	let busyProposalId = $state<number | null>(null);
	let errorMessage = $state('');
	let rowMessages = $state<Record<number, string>>({});
	let appendOpen = $state(false);
	let appendLoading = $state(false);
	let appendSaving = $state(false);
	let appendData = $state<RecapSources | null>(null);
	let appendSelectedIds = $state<number[]>([]);
	let appendError = $state('');
	let appendMessage = $state('');
	let editOpen = $state(false);
	let editSaving = $state(false);
	let editTitle = $state('');
	let editVisibleKeys = $state<string[]>([]);
	let editTrackingFields = $state<EditTrackingDraft[]>([]);
	let editError = $state('');
	let editMessage = $state('');
	let rowSearch = $state('');
	let rowFiltersOpen = $state(false);
	let rowStatusFilter = $state('all');
	let rowOfficeFilter = $state('all');
	let rowWorkFilter = $state('all');
	let trackingFilters = $state<Record<string, string>>({});
	let statusOptions = $derived([...new Set((detail?.rows ?? []).map((row) => row.status))]);
	let officeOptions = $derived([...new Map((detail?.rows ?? []).map((row) => [row.kode_kantor, { kode: row.kode_kantor, nama: row.nama_kantor }])).values()]);
	let workOptions = $derived([...new Set((detail?.rows ?? []).map((row) => row.nama_pekerjaan))]);
	let selectTrackingFields = $derived((detail?.recap.tracking_fields ?? []).filter((field) => field.type === 'select'));
	let filteredRows = $derived.by(() => {
		if (!detail) return [];
		const query = rowSearch.trim().toLocaleLowerCase('id-ID');
		return detail.rows.filter((row) => {
			const searchable = [row.request_number, row.subject, row.nama_pekerjaan, row.nama_kantor, row.kode_kantor,
				...Object.values(row.source_values).map(valueText), ...Object.values(row.tracking_values).map(valueText)]
				.join(' ').toLocaleLowerCase('id-ID');
			if (query && !searchable.includes(query)) return false;
			if (rowStatusFilter !== 'all' && row.status !== rowStatusFilter) return false;
			if (rowOfficeFilter !== 'all' && row.kode_kantor !== rowOfficeFilter) return false;
			if (rowWorkFilter !== 'all' && row.nama_pekerjaan !== rowWorkFilter) return false;
			for (const field of selectTrackingFields) {
				const selected = trackingFilters[field.key];
				if (!selected) continue;
				const value = row.tracking_values[field.key];
				if (selected === '__blank__') {
					if (value !== null && value !== undefined && value !== '') return false;
				} else if (selected.startsWith('option:')) {
					const option = field.options?.[Number(selected.slice(7))];
					if (option === undefined || valueText(value) !== option) return false;
				}
			}
			return true;
		});
	});

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; });
		void load();
		return unsubscribe;
	});

	function valueText(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
		return String(value);
	}

	function initDrafts(data: RecapDetail): void {
		drafts = Object.fromEntries(data.rows.map((row) => [row.id,
			Object.fromEntries(data.recap.tracking_fields.map((field) => [field.key, valueText(row.tracking_values[field.key])]))
		]));
		notes = Object.fromEntries(data.rows.map((row) => [row.id, notes[row.id] ?? '']));
		rowMessages = {};
	}

	async function load(): Promise<void> {
		if (!token) { await goto('/'); return; }
		if (!Number.isSafeInteger(recapId) || recapId < 1) { errorMessage = 'Nomor rekap tidak valid.'; loading = false; return; }
		loading = true; errorMessage = '';
		try {
			detail = (await fetchRecap(token, recapId)).data;
			initDrafts(detail);
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Isi rekap belum dapat dimuat. Coba lagi.';
		} finally { loading = false; }
	}

	async function openAppendPanel(): Promise<void> {
		if (!token || !detail?.recap.is_division || detail.recap.status !== 'published') return;
		appendOpen = true; appendLoading = true; appendError = ''; appendMessage = ''; appendSelectedIds = [];
		try { appendData = (await fetchAppendableRecapSources(token, recapId)).data; }
		catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			appendError = error instanceof ApiError ? error.message : 'Daftar tiket belum dapat dimuat.';
		} finally { appendLoading = false; }
	}

	function toggleAppendRequest(requestId: number, checked: boolean): void {
		appendSelectedIds = checked ? [...appendSelectedIds, requestId] : appendSelectedIds.filter((id) => id !== requestId);
	}

	function selectAllAppendRequests(checked: boolean): void {
		appendSelectedIds = checked ? (appendData?.requests ?? []).map((item) => item.id) : [];
	}

	async function addSelectedRequests(): Promise<void> {
		if (!token || !appendSelectedIds.length || appendSaving) return;
		appendSaving = true; appendError = ''; appendMessage = '';
		try {
			const result = await appendRecapSources(token, recapId, appendSelectedIds);
			appendMessage = `${result.data.source_request_count} tiket ditambahkan sebagai ${result.data.row_count} baris.`;
			appendSelectedIds = [];
			await load();
			try { appendData = (await fetchAppendableRecapSources(token, recapId)).data; }
			catch (error) {
				if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
				appendError = 'Tiket sudah ditambahkan, tetapi daftar sumber berikutnya belum dapat dimuat. Tutup panel lalu coba lagi.';
			}
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			appendError = error instanceof ApiError ? error.message : 'Tiket belum dapat ditambahkan.';
		} finally { appendSaving = false; }
	}

	function sourceFields(): RecapDetail['recap']['source_fields'] {
		if (!detail) return [];
		const visible = new Set(detail.recap.visible_source_keys);
		return detail.recap.source_fields.filter((field) => visible.has(field.key));
	}

	function openEditSettings(): void {
		if (!detail?.recap.is_division || detail.recap.status !== 'published') return;
		editTitle = detail.recap.title;
		editVisibleKeys = [...detail.recap.visible_source_keys];
		editTrackingFields = detail.recap.tracking_fields.map((field) => ({
			...field, options_text: field.options?.join('\n') ?? '', isNew: false
		}));
		editError = '';
		editMessage = '';
		editOpen = true;
	}

	function addEditTrackingField(): void {
		if (editTrackingFields.length >= 40) return;
		let number = editTrackingFields.length + 1;
		while (editTrackingFields.some((field) => field.key === `tracking_field_${number}`)) number += 1;
		editTrackingFields = [...editTrackingFields, {
			key: `tracking_field_${number}`, label: '', type: 'text', editable_by_branch: false, options_text: '', isNew: true
		}];
	}

	function removeEditTrackingField(key: string): void {
		editTrackingFields = editTrackingFields.filter((field) => field.key !== key || !field.isNew);
	}

	async function saveEditSettings(): Promise<void> {
		if (!token || !detail || editSaving) return;
		editError = '';
		if (!editTitle.trim() || editVisibleKeys.length === 0) {
			editError = 'Isi nama rekap dan tampilkan sedikitnya satu kolom form.';
			return;
		}
		const fields: RecapTrackingField[] = editTrackingFields.map((field) => ({
			key: field.key, label: field.label, type: field.type, editable_by_branch: field.editable_by_branch,
			...(field.type === 'select' ? { options: field.options_text.split('\n').map((option) => option.trim()).filter(Boolean) } : {})
		}));
		editSaving = true;
		try {
			await updateRecapSettings(token, recapId, { title: editTitle.trim(), visible_source_keys: editVisibleKeys, tracking_fields: fields });
			editOpen = false;
			editMessage = 'Pengaturan rekap berhasil disimpan.';
			trackingFilters = {};
			await load();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			editError = error instanceof ApiError ? error.message : 'Pengaturan rekap belum dapat disimpan.';
		} finally { editSaving = false; }
	}

	function resetRowFilters(): void {
		rowSearch = '';
		rowStatusFilter = 'all';
		rowOfficeFilter = 'all';
		rowWorkFilter = 'all';
		trackingFilters = {};
	}

	function submitRowFilters(event: SubmitEvent): void {
		event.preventDefault();
		rowFiltersOpen = false;
	}

	function showActions(): boolean {
		return Boolean(detail && detail.recap.tracking_fields.length > 0 &&
			(detail.recap.is_division ? detail.recap.status === 'published' : detail.recap.branch_editable_keys.length > 0));
	}

	function updateDraft(rowId: number, fieldKey: string, value: string): void {
		drafts[rowId] = { ...(drafts[rowId] ?? {}), [fieldKey]: value };
	}

	function rowChanges(row: RecapRow): Record<string, string | number | null> {
		if (!detail) return {};
		const changes: Record<string, string | number | null> = {};
		for (const field of detail.recap.tracking_fields) {
			const value = drafts[row.id]?.[field.key] ?? '';
			if (value === valueText(row.tracking_values[field.key])) continue;
			changes[field.key] = value === '' ? null : field.type === 'number' ? Number(value) : value;
		}
		return changes;
	}

	function fieldLabel(key: string): string {
		return detail?.recap.tracking_fields.find((field) => field.key === key)?.label ?? key;
	}

	function displayStatus(status: string): string {
		const labels: Record<string, string> = {
			waiting_korwil: 'Menunggu Korwil', in_progress_korwil: 'Diproses Korwil', waiting_central: 'Menunggu Divisi',
			in_progress_central: 'Diproses Divisi', waiting_branch_revision: 'Menunggu Cabang', completed: 'Selesai', rejected: 'Ditolak'
		};
		return labels[status] ?? status;
	}

	async function saveRow(row: RecapRow): Promise<void> {
		if (!token || !detail || savingId !== null) return;
		const changes = rowChanges(row);
		if (!Object.keys(changes).length) { rowMessages[row.id] = 'Tidak ada perubahan untuk disimpan.'; return; }
		savingId = row.id; rowMessages[row.id] = '';
		try {
			await saveRecapRow(token, recapId, row.id, changes);
			await load();
			rowMessages[row.id] = 'Perubahan Divisi tersimpan.';
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			rowMessages[row.id] = error instanceof ApiError ? error.message : 'Perubahan belum dapat disimpan.';
		} finally { savingId = null; }
	}

	async function proposeRow(row: RecapRow): Promise<void> {
		if (!token || !detail || savingId !== null) return;
		const changes = rowChanges(row);
		if (!Object.keys(changes).length) { rowMessages[row.id] = 'Ubah sedikitnya satu kolom sebelum mengirim.'; return; }
		if (!(notes[row.id] ?? '').trim()) { rowMessages[row.id] = 'Tulis alasan perubahan untuk Divisi.'; return; }
		savingId = row.id; rowMessages[row.id] = '';
		try {
			await proposeRecapChanges(token, recapId, row.id, changes, notes[row.id] ?? '');
			notes[row.id] = '';
			await load();
			rowMessages[row.id] = 'Perubahan dikirim ke Divisi untuk ditinjau.';
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			rowMessages[row.id] = error instanceof ApiError ? error.message : 'Perubahan belum dapat dikirim.';
		} finally { savingId = null; }
	}

	async function reviewProposal(row: RecapRow, proposalId: number, outcome: 'approved' | 'rejected'): Promise<void> {
		if (!token || busyProposalId !== null) return;
		const note = reviewNotes[proposalId] ?? '';
		if (outcome === 'rejected' && !note.trim()) { rowMessages[row.id] = 'Tulis alasan sebelum menolak usulan.'; return; }
		busyProposalId = proposalId; rowMessages[row.id] = '';
		try {
			await reviewRecapChanges(token, recapId, proposalId, outcome, note);
			await load();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			rowMessages[row.id] = error instanceof ApiError ? error.message : 'Usulan belum dapat ditinjau.';
		} finally { busyProposalId = null; }
	}

	function trackingDisplay(field: RecapTrackingField, value: string | number | null | undefined): string {
		if (value === null || value === undefined || value === '') return 'Belum diisi';
		if (field.type === 'date') {
			const [year, month, day] = String(value).split('-');
			return year && month && day ? `${day}/${month}/${year}` : String(value);
		}
		return String(value);
	}
</script>

<svelte:head><title>{detail?.recap.title ?? 'Rekap'} | Sistem SLA</title></svelte:head>

<section class="app-page-stack" aria-labelledby="page-title">
	<AppPageHeading eyebrow={detail?.recap.nama_pekerjaan ?? 'Rekap'} title={detail?.recap.title ?? 'Rekap'} description={detail ? `${detail.recap.nama_divisi} · ${detail.rows.length} baris yang dapat kamu lihat.` : 'Memuat baris pemantauan.'} flush>
		{#snippet actions()}<div class="heading-actions">{#if detail?.recap.is_division && detail.recap.status === 'published'}<Button variant="outline" class="min-h-11" onclick={openEditSettings}><Pencil class="size-4" aria-hidden="true" />Edit rekap</Button><Button variant="outline" class="min-h-11" onclick={() => void openAppendPanel()}><Plus class="size-4" aria-hidden="true" />Tambah tiket</Button>{/if}<Button variant="outline" class="min-h-11" href="/recaps"><ArrowLeft class="size-4" aria-hidden="true" />Daftar rekap</Button></div>{/snippet}
	</AppPageHeading>
	{#if editMessage}<p class="edit-success" role="status">{editMessage}</p>{/if}
	{#if detail?.recap.is_division && editOpen}
		<Card.Root>
			<Card.Header><Card.Title>Edit pengaturan rekap</Card.Title><Card.Description>Ubah nama dan kolom yang ditampilkan. Kolom lama dan tipenya tetap agar snapshot serta riwayat nilai tidak hilang; kolom baru bisa ditambahkan.</Card.Description></Card.Header>
			<Card.Content class="edit-panel">
				{#if editError}<Alert.Root variant="destructive"><Alert.Title>Pengaturan belum tersimpan</Alert.Title><Alert.Description>{editError}</Alert.Description></Alert.Root>{/if}
				<label class="edit-label"><span>Nama rekap</span><Input bind:value={editTitle} maxlength={160} class="edit-control" /></label>
				<section class="edit-section" aria-labelledby="source-columns-title">
					<div><h2 id="source-columns-title">Kolom form yang ditampilkan</h2><p>Pilihan ini hanya mengatur tampilan, bukan menghapus snapshot jawaban.</p></div>
					<div class="edit-source-fields">{#each detail.recap.source_fields as field (field.key)}<label class="edit-check"><Checkbox checked={editVisibleKeys.includes(field.key)} onCheckedChange={(checked) => { editVisibleKeys = checked ? [...editVisibleKeys, field.key] : editVisibleKeys.filter((key) => key !== field.key); }} /><span>{field.label}</span></label>{/each}</div>
				</section>
				<section class="edit-section" aria-labelledby="tracking-columns-title">
					<div class="edit-section-heading"><div><h2 id="tracking-columns-title">Kolom pemantauan</h2><p>Nama dan pilihan dropdown bisa disesuaikan. Tipe serta izin Cabang yang punya usulan menunggu tetap dijaga backend.</p></div><Button type="button" variant="outline" class="min-h-11" disabled={editTrackingFields.length >= 40} onclick={addEditTrackingField}><Plus class="size-4" aria-hidden="true" />Tambah kolom</Button></div>
					<div class="edit-tracking-list">{#each editTrackingFields as field (field.key)}
						<div class="edit-tracking-field">
							<label class="edit-label"><span>Nama kolom</span><Input bind:value={field.label} maxlength={100} class="edit-control" /></label>
							<div class="edit-label"><span>Tipe</span><Select.Root type="single" bind:value={field.type} disabled={!field.isNew}><Select.Trigger class="min-h-11 w-full" aria-label="Tipe kolom pemantauan"><Select.Value /></Select.Trigger><Select.Content align="start"><Select.Item value="text">Teks</Select.Item><Select.Item value="number">Angka</Select.Item><Select.Item value="date">Tanggal</Select.Item><Select.Item value="select">Dropdown</Select.Item></Select.Content></Select.Root></div>
							{#if field.type === 'select'}<label class="edit-label edit-options"><span>Pilihan, satu per baris</span><Textarea bind:value={field.options_text} rows={3} class="edit-control" /></label>{/if}
							<label class="edit-check branch-permission"><Checkbox bind:checked={field.editable_by_branch} /><span>Cabang boleh mengusulkan perubahan</span></label>
							{#if field.isNew}<Button type="button" variant="ghost" class="min-h-11" onclick={() => removeEditTrackingField(field.key)}><X class="size-4" aria-hidden="true" />Hapus kolom baru</Button>{:else}<span class="locked-note">Kolom lama dipertahankan</span>{/if}
						</div>
					{/each}</div>
				</section>
				<div class="edit-actions"><Button variant="ghost" class="min-h-11" disabled={editSaving} onclick={() => (editOpen = false)}>Batal</Button><Button class="min-h-11" disabled={editSaving} onclick={() => void saveEditSettings()}>{#if editSaving}<RotateCw class="size-4 animate-spin" aria-hidden="true" />Menyimpan…{:else}<Check class="size-4" aria-hidden="true" />Simpan pengaturan{/if}</Button></div>
			</Card.Content>
		</Card.Root>
	{/if}
	{#if detail?.recap.is_division && appendOpen}
		<Card.Root>
			<Card.Header><Card.Title>Tambah tiket ke rekap</Card.Title><Card.Description>Tiket dari jenis pekerjaan lain dapat ditambahkan jika memakai template form yang sama. Tiket yang sudah masuk ke rekap mana pun atau berstatus ditolak tidak muncul.</Card.Description></Card.Header>
			<Card.Content class="append-panel">
				{#if appendMessage}<p class="append-success" role="status">{appendMessage}</p>{/if}
				{#if appendError}<Alert.Root variant="destructive"><Alert.Title>Tiket belum dapat dimuat atau ditambahkan</Alert.Title><Alert.Description>{appendError}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void openAppendPanel()}>Coba lagi</Button></Alert.Action></Alert.Root>{/if}
				{#if appendLoading}<p class="append-empty" role="status">Memuat tiket dengan template form yang sama…</p>
				{:else if appendData?.requests.length}
					<label class="append-option append-select-all"><Checkbox checked={appendSelectedIds.length === appendData.requests.length} indeterminate={appendSelectedIds.length > 0 && appendSelectedIds.length < appendData.requests.length} onCheckedChange={(checked) => selectAllAppendRequests(checked)} /><span>Pilih semua {appendData.requests.length} tiket yang tersedia</span></label>
					<div class="append-list">{#each appendData.requests as item (item.id)}
						<label class="append-option"><Checkbox checked={appendSelectedIds.includes(item.id)} onCheckedChange={(checked) => toggleAppendRequest(item.id, checked)} /><span class="append-copy"><strong>{item.request_number} · {item.subject}</strong><small>{item.nama_pekerjaan} · {item.nama_kantor} ({item.kode_kantor}) · {item.entry_count} baris · {formatDateTimeWib(item.submitted_at)}</small></span></label>
					{/each}</div>
				{:else if appendData}<p class="append-empty">Tidak ada tiket baru dengan template form yang sama di divisi ini.</p>{/if}
				<div class="append-actions"><Button variant="ghost" class="min-h-11" onclick={() => (appendOpen = false)}>Tutup</Button><Button class="min-h-11" disabled={appendSelectedIds.length === 0 || appendSaving} onclick={() => void addSelectedRequests()}>{#if appendSaving}<RotateCw class="size-4 animate-spin" aria-hidden="true" />Menambahkan…{:else}<Plus class="size-4" aria-hidden="true" />Tambahkan {appendSelectedIds.length} tiket{/if}</Button></div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if errorMessage}<Alert.Root variant="destructive"><Alert.Title>Rekap belum dapat dimuat</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void load()}>Coba lagi</Button></Alert.Action></Alert.Root>
	{:else if loading}<Card.Root role="status"><Card.Content class="state-panel">Memuat baris rekap…</Card.Content></Card.Root>
	{:else if detail}
		<Card.Root>
			<Card.Header><Card.Title>Data pemantauan</Card.Title><Card.Description>{detail.recap.is_division ? 'Nilai form adalah snapshot saat tiket dipilih. Kolom pemantauan dapat diperbarui Divisi.' : 'Tiket yang ditampilkan berasal dari kantor kamu. Usulan perubahan berlaku setelah disetujui Divisi.'}</Card.Description></Card.Header>
			<Card.Content>
				{#if detail.recap.status === 'archived'}<p class="archived-note">Rekap sudah diarsipkan dan hanya dapat dilihat.</p>{/if}
				{#if detail.rows.length > 0}
					<div class="row-toolbar">
						<Input class="row-search" type="search" bind:value={rowSearch} aria-label="Cari nomor pengajuan atau isi rekap" placeholder="Cari nomor, debitur, atau isi kolom" />
					<Popover.Root bind:open={rowFiltersOpen}>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button {...props} type="button" variant="outline" class="filter-trigger min-h-11" aria-haspopup="dialog" aria-expanded={rowFiltersOpen}><ListFilter class="size-4" aria-hidden="true" />Filter</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Portal>
							<Popover.Content class="app-filter-popover" side="top" align="end" sideOffset={8} trapFocus={false} aria-labelledby="recap-row-filter-title" aria-describedby="recap-row-filter-description">
								<div class="app-filter-popover-header">
									<h2 id="recap-row-filter-title" class="app-filter-popover-title">Filter baris rekap</h2>
								<p id="recap-row-filter-description" class="app-filter-popover-description">Saring baris berdasarkan status, kantor, dan kolom pemantauan.</p>
								</div>
								<form class="app-filter-popover-form" onsubmit={submitRowFilters}>
									<div class="app-filter-popover-fields">
									<div class="row-filter-fields">
								<div class="filter-field"><span>Status tiket</span><Select.Root type="single" bind:value={rowStatusFilter}><Select.Trigger class="min-h-11 w-full" aria-label="Status tiket"><Select.Value /></Select.Trigger><Select.Content align="start"><Select.Item value="all">Semua status</Select.Item>{#each statusOptions as status (status)}<Select.Item value={status}>{displayStatus(status)}</Select.Item>{/each}</Select.Content></Select.Root></div>
								{#if officeOptions.length > 1}<div class="filter-field"><span>Kantor</span><Select.Root type="single" bind:value={rowOfficeFilter}><Select.Trigger class="min-h-11 w-full" aria-label="Kantor"><Select.Value /></Select.Trigger><Select.Content align="start" class="max-h-[min(20rem,55dvh)]"><Select.Item value="all">Semua kantor</Select.Item>{#each officeOptions as office (office.kode)}<Select.Item value={office.kode}>{office.nama} ({office.kode})</Select.Item>{/each}</Select.Content></Select.Root></div>{/if}
								{#if workOptions.length > 1}<div class="filter-field"><span>Jenis pekerjaan</span><Select.Root type="single" bind:value={rowWorkFilter}><Select.Trigger class="min-h-11 w-full" aria-label="Jenis pekerjaan"><Select.Value /></Select.Trigger><Select.Content align="start" class="max-h-[min(20rem,55dvh)]"><Select.Item value="all">Semua pekerjaan</Select.Item>{#each workOptions as work (work)}<Select.Item value={work}>{work}</Select.Item>{/each}</Select.Content></Select.Root></div>{/if}
								{#each selectTrackingFields as field (field.key)}<div class="filter-field"><span>{field.label}</span><Select.Root type="single" value={trackingFilters[field.key] ?? 'all'} onValueChange={(value) => { trackingFilters = { ...trackingFilters, [field.key]: value === 'all' ? '' : value }; }}><Select.Trigger class="min-h-11 w-full" aria-label={field.label}><Select.Value /></Select.Trigger><Select.Content align="start" class="max-h-[min(20rem,55dvh)]"><Select.Item value="all">Semua nilai</Select.Item><Select.Item value="__blank__">Belum diisi</Select.Item>{#each field.options ?? [] as option, index (`${field.key}-${index}`)}<Select.Item value={`option:${index}`}>{option}</Select.Item>{/each}</Select.Content></Select.Root></div>{/each}
							</div>
								</div>
								<div class="app-filter-popover-actions">
									<Button type="button" variant="outline" class="min-h-11" disabled={!rowSearch && rowStatusFilter === 'all' && rowOfficeFilter === 'all' && rowWorkFilter === 'all' && Object.values(trackingFilters).every((value) => !value)} onclick={() => { resetRowFilters(); rowFiltersOpen = false; }}>Reset</Button>
									<Button type="submit" class="min-h-11">Terapkan</Button>
								</div>
							</form>
							</Popover.Content>
						</Popover.Portal>
					</Popover.Root>
					</div>
					<p class="filter-count">Menampilkan {filteredRows.length} dari {detail.rows.length} baris</p>
				{/if}
				{#if detail.rows.length === 0}<div class="empty-panel">Belum ada baris dari kantor kamu di rekap ini.</div>
				{:else if filteredRows.length === 0}<div class="empty-panel">Tidak ada baris yang cocok dengan filter.</div>
				{:else}
						<Table.Root label="Tabel data rekap; geser mendatar untuk melihat semua kolom" class="table-scroll" tableClass="recap-table">
							<Table.Header><Table.Row><Table.Head scope="col">Pengajuan</Table.Head><Table.Head scope="col">Kantor</Table.Head>{#if detail.rows.some((row) => row.form_entry_index !== null)}<Table.Head scope="col">Baris form</Table.Head>{/if}{#each sourceFields() as field (field.key)}<Table.Head scope="col">{field.label}</Table.Head>{/each}{#each detail.recap.tracking_fields as field (field.key)}<Table.Head scope="col">{field.label}</Table.Head>{/each}{#if showActions()}<Table.Head scope="col">Aksi dan riwayat</Table.Head>{/if}</Table.Row></Table.Header>
							<Table.Body>
								{#each filteredRows as row (row.id)}
									<Table.Row>
										<Table.Cell class="request-cell"><a href={`/requests/${row.source_request_id}`}>{row.request_number}</a><span>{row.subject}</span><small>{row.nama_pekerjaan} · {displayStatus(row.status)}</small></Table.Cell>
										<Table.Cell>{row.nama_kantor}<small>{row.kode_kantor}</small></Table.Cell>
										{#if detail.rows.some((item) => item.form_entry_index !== null)}<Table.Cell>{row.form_entry_index === null ? 'Tidak berulang' : row.form_entry_index + 1}</Table.Cell>{/if}
										{#each sourceFields() as field (field.key)}<Table.Cell>{valueText(row.source_values[field.key]) || 'Kosong'}</Table.Cell>{/each}
										{#each detail.recap.tracking_fields as field (field.key)}
											<Table.Cell class="tracking-cell">
												{#if detail.recap.is_division && detail.recap.status === 'published'}
													{#if field.type === 'select'}<Select.Root type="single" value={drafts[row.id]?.[field.key] || '__empty__'} onValueChange={(value) => updateDraft(row.id, field.key, value === '__empty__' ? '' : value)}><Select.Trigger aria-label={`${field.label}, ${row.request_number}`} class="table-control min-h-11 w-full"><Select.Value placeholder="Kosong" /></Select.Trigger><Select.Content align="start"><Select.Item value="__empty__">Kosong</Select.Item>{#each field.options ?? [] as option (option)}<Select.Item value={option}>{option}</Select.Item>{/each}</Select.Content></Select.Root>
													{:else}<Input aria-label={`${field.label}, ${row.request_number}`} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={drafts[row.id]?.[field.key] ?? ''} oninput={(event) => updateDraft(row.id, field.key, event.currentTarget.value)} class="table-input" />{/if}
												{:else if detail.recap.branch_editable_keys.includes(field.key)}
													{#if field.type === 'select'}<Select.Root type="single" value={drafts[row.id]?.[field.key] || '__empty__'} onValueChange={(value) => updateDraft(row.id, field.key, value === '__empty__' ? '' : value)}><Select.Trigger aria-label={`${field.label}, ${row.request_number}`} class="table-control min-h-11 w-full"><Select.Value placeholder="Kosong" /></Select.Trigger><Select.Content align="start"><Select.Item value="__empty__">Kosong</Select.Item>{#each field.options ?? [] as option (option)}<Select.Item value={option}>{option}</Select.Item>{/each}</Select.Content></Select.Root>
													{:else}<Input aria-label={`${field.label}, ${row.request_number}`} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={drafts[row.id]?.[field.key] ?? ''} oninput={(event) => updateDraft(row.id, field.key, event.currentTarget.value)} class="table-input" />{/if}
												{:else}{trackingDisplay(field, row.tracking_values[field.key])}{/if}
											</Table.Cell>
										{/each}
										{#if showActions()}
											<Table.Cell class="actions-cell">
												{#if detail.recap.is_division && detail.recap.status === 'published'}<Button class="min-h-11" disabled={savingId !== null} onclick={() => void saveRow(row)}>{#if savingId === row.id}<RotateCw class="size-4 animate-spin" aria-hidden="true" />{:else}<Check class="size-4" aria-hidden="true" />{/if}Simpan nilai</Button>
												{:else if detail.recap.branch_editable_keys.length > 0}<Textarea aria-label={`Alasan perubahan untuk ${row.request_number}`} rows={2} placeholder="Alasan perubahan untuk Divisi" value={notes[row.id] ?? ''} oninput={(event) => { notes[row.id] = event.currentTarget.value; }} class="note-input" /><Button variant="outline" class="min-h-11" disabled={savingId !== null || row.proposals.some((proposal) => proposal.status === 'pending')} onclick={() => void proposeRow(row)}><Send class="size-4" aria-hidden="true" />Ajukan perubahan</Button>{/if}
												{#if rowMessages[row.id]}<small class="row-message" role="status">{rowMessages[row.id]}</small>{/if}
											</Table.Cell>
										{/if}
									</Table.Row>
									{#if row.proposals.length > 0}
										<Table.Row class="history-row"><Table.Cell colspan={2 + sourceFields().length + detail.recap.tracking_fields.length + (detail.rows.some((item) => item.form_entry_index !== null) ? 1 : 0) + (showActions() ? 1 : 0)}>
											<div class="proposal-list"><strong>Riwayat perubahan · {row.request_number}</strong>
												{#each row.proposals as proposal (proposal.id)}
													<div class="proposal-item"><div class="proposal-copy"><span><b>{proposal.proposer_name ?? 'Pengguna Cabang'}</b> · {proposal.status === 'pending' ? 'Menunggu Divisi' : proposal.status === 'approved' ? 'Disetujui' : 'Ditolak'} · {formatDateTimeWib(proposal.created_at)}</span><p>{proposal.note}</p><ul>{#each Object.entries(proposal.changes) as [key, value] (key)}<li>{fieldLabel(key)}: {valueText(value) || 'Kosong'}</li>{/each}</ul>{#if proposal.review_note}<small>Catatan Divisi: {proposal.review_note}</small>{/if}</div>
												{#if detail.recap.is_division && detail.recap.status === 'published' && proposal.status === 'pending'}<div class="proposal-review"><Textarea aria-label={`Catatan untuk usulan ${proposal.id}`} rows={2} placeholder="Alasan jika ditolak" value={reviewNotes[proposal.id] ?? ''} oninput={(event) => { reviewNotes[proposal.id] = event.currentTarget.value; }} class="note-input" /><div class="review-actions"><Button class="min-h-11" disabled={busyProposalId !== null} onclick={() => void reviewProposal(row, proposal.id, 'approved')}><Check class="size-4" aria-hidden="true" />Setujui</Button><Button variant="outline" class="min-h-11" disabled={busyProposalId !== null} onclick={() => void reviewProposal(row, proposal.id, 'rejected')}><X class="size-4" aria-hidden="true" />Tolak</Button></div></div>{/if}
													</div>
												{/each}
											</div>
										</Table.Cell></Table.Row>
									{/if}
								{/each}
							</Table.Body>
						</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</section>

<style>
	.heading-actions { display:flex; flex-wrap:wrap; gap:.5rem; }
	.edit-success { margin:0; color:var(--primary); font-size:var(--type-sm); }
	:global(.edit-panel) { display:grid; gap:1.1rem; }
	.edit-label,.filter-field { display:grid; min-width:0; gap:.4rem; font-size:var(--type-sm); font-weight:560; }
	:global(.edit-control) { width:100%; min-width:0; min-height:2.75rem; }
	:global(textarea.edit-control) { min-height:5rem; resize:vertical; }
	.edit-section { display:grid; gap:.75rem; border-top:1px solid var(--border); padding-top:1rem; }
	.edit-section h2 { margin:0; font-size:var(--type-base); font-weight:650; }
	.edit-section p { margin:.2rem 0 0; color:var(--muted-foreground); font-size:var(--type-sm); line-height:1.5; }
	.edit-section-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
	.edit-source-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr)); gap:.35rem .75rem; }
	.edit-check { display:flex; min-width:0; min-height:2.75rem; align-items:center; gap:.55rem; cursor:pointer; font-size:var(--type-sm); }
	.edit-check :global([data-slot='checkbox']) { flex:0 0 auto; }
	.edit-tracking-list { display:grid; gap:.65rem; }
	.edit-tracking-field { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(9rem,.7fr) minmax(0,1.4fr); align-items:end; gap:.7rem; border:1px solid var(--border); border-radius:.75rem; padding:.8rem; }
	.edit-options { grid-column:1 / -1; }
	.branch-permission { align-self:center; }
	.locked-note { align-self:center; color:var(--muted-foreground); font-size:var(--type-xs); }
	.edit-actions { display:flex; justify-content:flex-end; gap:.5rem; border-top:1px solid var(--border); padding-top:.8rem; }
	:global(.append-panel) { display:grid; gap:.75rem; }
	.append-list { display:grid; max-height:22rem; overflow:auto; border:1px solid var(--border); border-radius:.8rem; }
	.append-option { display:flex; min-width:0; min-height:2.75rem; align-items:flex-start; gap:.7rem; padding:.75rem .8rem; cursor:pointer; }
	.append-list .append-option + .append-option { border-top:1px solid var(--border); }
	.append-select-all { border:1px solid var(--border); border-radius:.8rem; font-weight:600; }
	.append-option :global([data-slot='checkbox']) { flex:0 0 auto; margin-top:.15rem; }
	.append-copy { display:grid; min-width:0; gap:.15rem; }
	.append-copy strong { overflow-wrap:anywhere; font-size:var(--type-sm); }
	.append-copy small { color:var(--muted-foreground); font-size:var(--type-xs); }
	.append-actions { display:flex; justify-content:flex-end; gap:.5rem; border-top:1px solid var(--border); padding-top:.75rem; }
	.append-empty { margin:0; min-height:3rem; display:grid; place-items:center; color:var(--muted-foreground); text-align:center; }
	.append-success { margin:0; color:var(--primary); font-size:var(--type-sm); }
	.row-toolbar { display:flex; min-width:0; align-items:center; justify-content:flex-end; gap:.5rem; margin-bottom:.7rem; }
	:global(.row-search) { width:min(24rem, 42vw); min-width:12rem; }
	.row-filter-fields { display:grid; gap:.75rem; }
	.filter-count { margin:0 0 .7rem; color:var(--muted-foreground); font-size:var(--type-sm); }
	:global(.state-panel) { min-height:8rem; display:grid; place-items:center; color:var(--muted-foreground); }
	.empty-panel { padding:2rem 1rem; color:var(--muted-foreground); text-align:center; }
	.archived-note { margin:0 0 .8rem; color:var(--muted-foreground); font-size:var(--type-sm); }
	:global(.table-scroll) { max-width:100%; overflow:auto; border:1px solid var(--border); border-radius:.75rem; }
	:global(.table-scroll:focus-visible) { outline:2px solid var(--ring); outline-offset:2px; }
	:global(.recap-table) { width:100%; min-width:50rem; border-collapse:separate; border-spacing:0; font-size:var(--type-sm); }
	:global(.recap-table th),:global(.recap-table td) { min-width:8rem; max-width:19rem; border-bottom:1px solid var(--border); padding:.7rem; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
	:global(.recap-table th) { position:sticky; top:0; z-index:1; background:var(--muted); font-weight:650; }
	:global(.recap-table th:first-child),:global(.recap-table td:first-child) { min-width:12rem; }
	:global(.recap-table tbody tr:last-child > td) { border-bottom:0; }
	:global(.request-cell) { display:grid; gap:.25rem; }
	:global(.request-cell a) { color:var(--primary); font-weight:650; text-decoration:underline; text-underline-offset:3px; }
	:global(.request-cell span),:global(.request-cell small),:global(td small) { color:var(--muted-foreground); }
	:global(.request-cell span) { max-width:18rem; }
	:global(.tracking-cell) { min-width:11rem; }
	:global(.table-control),:global(.table-input) { width:100%; min-width:8rem; min-height:2.75rem; }
	:global(.note-input) { min-width:12rem; min-height:4.5rem; }
	:global(.actions-cell) { min-width:15rem; }
	:global(.actions-cell) :global(button) { width:100%; }
	.row-message { display:block; max-width:16rem; margin-top:.4rem; color:var(--muted-foreground); }
	:global(.history-row > td) { background:color-mix(in srgb,var(--muted) 48%,var(--background)); }
	.proposal-list { display:grid; gap:.65rem; }
	.proposal-list > strong { font-size:var(--type-sm); }
	.proposal-item { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; border-top:1px solid var(--border); padding-top:.65rem; }
	.proposal-copy { min-width:0; }
	.proposal-copy span,.proposal-copy small { color:var(--muted-foreground); font-size:var(--type-xs); }
	.proposal-copy p { margin:.3rem 0; }
	.proposal-copy ul { margin:.2rem 0; padding-left:1.2rem; color:var(--muted-foreground); }
	.proposal-review { display:grid; width:min(23rem,45%); gap:.4rem; }
	.review-actions { display:flex; gap:.4rem; }
	.review-actions :global(button) { flex:1; }
	@media(max-width:640px) {
		.row-toolbar { display:grid; grid-template-columns:minmax(0,1fr) auto; }
		:global(.row-search) { width:100%; min-width:0; }
		.heading-actions { width:100%; flex-direction:column; }
		.heading-actions :global(button) { width:100%; }
		.edit-section-heading,.edit-actions { flex-direction:column; align-items:stretch; }
		.edit-tracking-field { grid-template-columns:1fr 1fr; }
		.edit-options { grid-column:1 / -1; }
		.locked-note { grid-column:1 / -1; }
		.append-actions { flex-direction:column-reverse; }
		.proposal-item { flex-direction:column; }
		.proposal-review { width:100%; }
		:global(.recap-table th),:global(.recap-table td) { padding:.55rem; }
	}
</style>
