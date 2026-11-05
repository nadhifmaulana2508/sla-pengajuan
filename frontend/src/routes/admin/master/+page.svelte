<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Checkbox from '#lib/components/ui/checkbox/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import { BriefcaseBusiness, Plus, Search } from '@lucide/svelte';
	import {
		createWorkCatalog,
		fetchAdminMasterData,
		updateWorkCatalog,
		type AdminDivision,
		type WorkCatalog,
		type WorkCatalogInput
	} from '#lib/features/admin/admin.api.js';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import {
		authSession,
		clearAuthenticatedSession,
		updateProfile
	} from '#lib/features/auth/auth.store.js';

	type CatalogForm = {
		divisi_id: string;
		nama_pekerjaan: string;
		deskripsi: string;
		target_sla_hours: string;
		is_active: boolean;
	};

	function emptyForm(): CatalogForm {
		return {
			divisi_id: '',
			nama_pekerjaan: '',
			deskripsi: '',
			target_sla_hours: '',
			is_active: true
		};
	}

	let divisions = $state<AdminDivision[]>([]);
	let workCatalogs = $state<WorkCatalog[]>([]);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let loadError = $state('');
	let formError = $state('');
	let statusMessage = $state('');
	let formOpen = $state(false);
	let editingId = $state<number | null>(null);
	let form = $state<CatalogForm>(emptyForm());
	let divisionFilter = $state('all');
	let searchQuery = $state('');
	let divisionFilterItems = $derived.by(() => [
		{ value: 'all', label: 'Semua divisi' },
		...divisions.map((division) => ({ value: String(division.id), label: division.nama_divisi }))
	]);
	let activeDivisionItems = $derived.by(() => divisions
		.filter((division) => division.is_active)
		.map((division) => ({ value: String(division.id), label: division.nama_divisi })));

	let filteredCatalogs = $derived.by(() => {
		const query = searchQuery.trim().toLocaleLowerCase('id-ID');
		return workCatalogs.filter((item) => {
			const matchesDivision = divisionFilter === 'all' || String(item.divisi_id) === divisionFilter;
			const matchesQuery = !query || `${item.nama_pekerjaan} ${item.nama_divisi}`
				.toLocaleLowerCase('id-ID').includes(query);
			return matchesDivision && matchesQuery;
		});
	});

	onMount(() => {
		let token: string | null = null;
		const unsubscribe = authSession.subscribe((session) => {
			token = session.token;
		});
		void verifyAdminSession(() => token);
		return unsubscribe;
	});

	async function verifyAdminSession(readToken: () => string | null): Promise<void> {
		const token = readToken();
		if (!token) {
			await goto('/');
			return;
		}

		isLoading = true;
		loadError = '';
		try {
			const profile = await fetchCurrentProfile(token);
			updateProfile(profile);
			if (profile.sla_access.role !== 'admin' || profile.sla_access.scope !== 'all') {
				await goto('/dashboard');
				return;
			}

			const data = await fetchAdminMasterData(token);
			divisions = data.divisions;
			workCatalogs = data.work_catalogs;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			loadError = error instanceof ApiError
				? error.message
				: 'Master belum dapat dimuat. Periksa koneksi lalu coba lagi.';
		} finally {
			isLoading = false;
		}
	}

	async function reloadMasterData(): Promise<void> {
		const token = $authSession.token;
		if (!token) {
			clearAuthenticatedSession();
			await goto('/');
			return;
		}

		isLoading = true;
		loadError = '';
		try {
			const data = await fetchAdminMasterData(token);
			divisions = data.divisions;
			workCatalogs = data.work_catalogs;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			loadError = error instanceof ApiError ? error.message : 'Master belum dapat dimuat. Coba lagi.';
		} finally {
			isLoading = false;
		}
	}

	function startNewWorkCatalog(): void {
		editingId = null;
		form = { ...emptyForm(), divisi_id: String(divisions.find((division) => division.is_active)?.id ?? '') };
		formError = '';
		statusMessage = '';
		formOpen = true;
	}

	function editWorkCatalog(item: WorkCatalog): void {
		editingId = item.id;
		form = {
			divisi_id: String(item.divisi_id),
			nama_pekerjaan: item.nama_pekerjaan,
			deskripsi: item.deskripsi ?? '',
			target_sla_hours: item.target_sla_minutes === null ? '' : String(item.target_sla_minutes / 60),
			is_active: item.is_active
		};
		formError = '';
		statusMessage = '';
		formOpen = true;
	}

	function closeForm(): void {
		formOpen = false;
		editingId = null;
		form = emptyForm();
		formError = '';
	}

	async function saveWorkCatalog(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving) return;

		const targetHours = form.target_sla_hours.trim() === '' ? null : Number(form.target_sla_hours);
		if (!form.divisi_id || !form.nama_pekerjaan.trim()) {
			formError = 'Pilih divisi dan isi nama pekerjaan.';
			return;
		}
		if (targetHours !== null && (!Number.isFinite(targetHours) || targetHours <= 0)) {
			formError = 'Target SLA harus lebih dari 0 jam, atau dikosongkan jika belum ditetapkan.';
			return;
		}

		const token = $authSession.token;
		if (!token) {
			clearAuthenticatedSession();
			await goto('/');
			return;
		}

		const input: WorkCatalogInput = {
			divisi_id: Number(form.divisi_id),
			nama_pekerjaan: form.nama_pekerjaan.trim(),
			deskripsi: form.deskripsi.trim() || null,
			target_sla_minutes: targetHours === null ? null : Math.round(targetHours * 60),
			is_active: form.is_active
		};

		isSaving = true;
		formError = '';
		statusMessage = '';
		try {
			const result = editingId === null
				? await createWorkCatalog(token, input)
				: await updateWorkCatalog(token, editingId, input);
			statusMessage = result.message;
			closeForm();
			await reloadMasterData();
		} catch (error) {
			formError = error instanceof ApiError
				? error.message
				: 'Perubahan belum tersimpan. Periksa koneksi lalu coba lagi.';
		} finally {
			isSaving = false;
		}
	}

	function formatTarget(minutes: number | null): string {
		if (minutes === null) return 'Belum diatur';
		const hours = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(minutes / 60);
		return `${hours} jam`;
	}

</script>

<svelte:head>
	<title>Master SLA | Sistem SLA Pengajuan</title>
	<meta name="description" content="Kelola katalog pekerjaan dan target SLA untuk setiap divisi pusat." />
</svelte:head>

<main class="admin-page">
	<AppNavbar />

	<section class="admin-content app-page-shell" aria-labelledby="page-title">
		<div class="app-page-heading">
			<div class="app-page-heading-copy">
				<p class="app-page-kicker">Administrasi</p>
				<div class="app-page-title-row">
					<h1 id="page-title" class="app-page-title">Master pekerjaan</h1>
					<p class="app-page-description">Atur jenis pekerjaan per divisi pusat. Target SLA dapat dikosongkan sampai disahkan.</p>
				</div>
			</div>
		</div>

		{#if statusMessage}
			<p class="save-status" role="status" aria-live="polite">{statusMessage}</p>
		{/if}

		<div class="workspace" class:has-editor={formOpen}>
			{#if formOpen}
				<Card.Root class="editor-card" aria-labelledby="editor-title">
					<Card.Header>
						<Card.Title id="editor-title">{editingId === null ? 'Tambah pekerjaan' : 'Ubah pekerjaan'}</Card.Title>
						<Card.Description>Jenis pekerjaan terhubung ke satu divisi. Pekerjaan nonaktif tidak tampil di pilihan Cabang.</Card.Description>
					</Card.Header>
					<Card.Content>
						<form class="catalog-form" onsubmit={saveWorkCatalog}>
							<div class="field-group">
								<Label for="work-division">Divisi tujuan</Label>
								<Select.Root type="single" items={activeDivisionItems} bind:value={form.divisi_id}>
									<Select.Trigger id="work-division" class="min-h-11 w-full border-input" aria-required="true">
										<Select.Value placeholder="Pilih divisi" />
									</Select.Trigger>
									<Select.Content>
										{#each activeDivisionItems as division (division.value)}
											<Select.Item value={division.value} label={division.label}>{division.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="field-group">
								<Label for="work-name">Nama pekerjaan</Label>
								<Input id="work-name" bind:value={form.nama_pekerjaan} maxlength={160} required placeholder="Contoh: Persetujuan lelang" class="min-h-11 border-input" />
							</div>
							<div class="field-group">
								<Label for="work-description">Keterangan <span class="optional-label">Opsional</span></Label>
								<Textarea id="work-description" bind:value={form.deskripsi} maxlength={500} rows={3} class="min-h-24 border-input" placeholder="Jelaskan singkat ruang lingkup pekerjaan" />
							</div>
							<div class="field-group">
								<Label for="work-sla">Target SLA (jam) <span class="optional-label">Opsional</span></Label>
								<Input id="work-sla" type="number" min="0.25" step="0.25" bind:value={form.target_sla_hours} aria-describedby="sla-help" placeholder="Belum ditetapkan" class="min-h-11 border-input" />
								<p id="sla-help" class="field-help">Biarkan kosong jika target belum disepakati. Pecahan 0,25 jam diperbolehkan.</p>
							</div>
							<div class="active-control">
								<Checkbox.Root id="work-active" bind:checked={form.is_active} class="size-5 after:-inset-y-3" aria-describedby="active-help" />
								<div class="active-copy">
									<Label for="work-active" class="active-label">Pekerjaan aktif</Label>
									<p id="active-help">Tersedia pada daftar pilihan pengajuan.</p>
								</div>
							</div>

							{#if formError}
								<Alert.Root variant="destructive">
									<Alert.Title>Perubahan belum tersimpan</Alert.Title>
									<Alert.Description>{formError}</Alert.Description>
								</Alert.Root>
							{/if}

							<div class="form-actions">
								<Button type="button" variant="outline" size="lg" class="min-h-11 border-input" onclick={closeForm}>Batal</Button>
								<Button type="submit" size="lg" class="min-h-11" disabled={isSaving}>
									{isSaving ? 'Menyimpan...' : editingId === null ? 'Simpan pekerjaan' : 'Simpan perubahan'}
								</Button>
							</div>
						</form>
					</Card.Content>
				</Card.Root>
			{/if}

			<Card.Root size="sm" class="catalog-card" aria-labelledby="catalog-title">
				<Card.Header class="catalog-header">
					<div class="catalog-heading">
						<BriefcaseBusiness class="list-heading-icon" aria-hidden="true" />
						<div class="list-heading-copy">
							<Card.Title id="catalog-title">Daftar pekerjaan</Card.Title>
							<Card.Description>
								{#if isLoading}
									Sedang memuat master dari database.
								{:else}
									{filteredCatalogs.length} pekerjaan sesuai filter.
								{/if}
							</Card.Description>
						</div>
					</div>
					{#if !isLoading && !loadError}
						<Badge variant="secondary">{workCatalogs.filter((item) => item.is_active).length} aktif</Badge>
					{/if}
				</Card.Header>
				<Card.Content class="catalog-content">
					<div class="catalog-toolbar">
						<div class="filters">
							<div class="filter-field">
								<Label for="division-filter">Divisi</Label>
								<Select.Root type="single" items={divisionFilterItems} bind:value={divisionFilter}>
									<Select.Trigger id="division-filter" class="min-h-11 w-full border-input">
										<Select.Value placeholder="Semua divisi" />
									</Select.Trigger>
									<Select.Content>
										{#each divisionFilterItems as division (division.value)}
											<Select.Item value={division.value} label={division.label}>{division.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="filter-field search-field">
								<Label for="catalog-search" class="sr-only">Cari pekerjaan</Label>
								<div class="search-control">
									<Search class="search-icon" aria-hidden="true" />
									<Input id="catalog-search" bind:value={searchQuery} placeholder="Cari pekerjaan atau divisi" class="min-h-11 border-input" />
								</div>
							</div>
						</div>
						<Button size="lg" class="min-h-11 create-button" onclick={startNewWorkCatalog}><Plus class="size-4" aria-hidden="true" />Tambah pekerjaan</Button>
					</div>
					<Separator class="list-separator" />
					{#if isLoading}
						<div class="state-panel" role="status" aria-live="polite">
							<strong>Memuat katalog pekerjaan</strong>
							<p>Daftar divisi dan pekerjaan sedang diambil dari database.</p>
						</div>
					{:else if loadError}
						<Alert.Root variant="destructive" class="load-error">
							<Alert.Title>Master belum dapat dimuat</Alert.Title>
							<Alert.Description>{loadError}</Alert.Description>
							<Button variant="outline" size="lg" class="min-h-11 border-input" onclick={() => void reloadMasterData()}>Coba lagi</Button>
						</Alert.Root>
					{:else if filteredCatalogs.length === 0}
						<div class="state-panel empty-panel">
							<strong>Belum ada pekerjaan pada hasil ini</strong>
							<p>Tambahkan jenis pekerjaan untuk divisi terkait. Pekerjaan yang sudah ada bisa dinonaktifkan tanpa dihapus.</p>
							<Button size="lg" class="min-h-11" onclick={startNewWorkCatalog}>Tambah pekerjaan</Button>
						</div>
					{:else}
						<div class="desktop-catalog">
							<table>
								<caption class="sr-only">Master pekerjaan dan target SLA per divisi</caption>
								<thead>
									<tr>
										<th scope="col">Pekerjaan</th>
										<th scope="col">Divisi</th>
										<th scope="col">Target SLA</th>
										<th scope="col">Status</th>
										<th scope="col"><span class="sr-only">Tindakan</span></th>
									</tr>
								</thead>
								<tbody>
									{#each filteredCatalogs as item (item.id)}
										<tr>
											<th scope="row">
												<strong>{item.nama_pekerjaan}</strong>
												{#if item.deskripsi}<small>{item.deskripsi}</small>{/if}
											</th>
											<td>{item.nama_divisi}</td>
											<td>{formatTarget(item.target_sla_minutes)}</td>
											<td><Badge variant={item.is_active ? 'secondary' : 'outline'}>{item.is_active ? 'Aktif' : 'Nonaktif'}</Badge></td>
											<td class="action-cell">
												<Button variant="outline" size="sm" class="min-h-11 border-input" onclick={() => editWorkCatalog(item)}>Ubah</Button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<div class="mobile-catalog">
							{#each filteredCatalogs as item (item.id)}
								<Card.Root size="sm" class="mobile-record" role="article" aria-labelledby={`work-record-${item.id}`}>
									<Card.Content class="mobile-record-content">
									<div class="record-heading">
										<div>
											<h3 id={`work-record-${item.id}`}>{item.nama_pekerjaan}</h3>
											<p>{item.nama_divisi}</p>
										</div>
										<Badge variant={item.is_active ? 'secondary' : 'outline'}>{item.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
									</div>
									{#if item.deskripsi}<p class="record-description">{item.deskripsi}</p>{/if}
									<div class="record-meta"><span>Target SLA</span><strong>{formatTarget(item.target_sla_minutes)}</strong></div>
									<Button variant="outline" size="lg" class="min-h-11 border-input record-edit" onclick={() => editWorkCatalog(item)}>Ubah pekerjaan</Button>
									</Card.Content>
								</Card.Root>
							{/each}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	</section>
</main>

<style>
	.admin-content {
		display: grid;
		align-content: start;
		grid-auto-rows: max-content;
		gap: 1rem;
		height: auto;
		min-height: 0;
	}

	.admin-content > .app-page-heading {
		margin-bottom: 0;
	}

	.admin-page {
		min-height: 100svh;
		background: var(--muted);
		color: var(--foreground);
	}

	.catalog-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 0;
	}

	.filters {
		display: grid;
		min-width: 0;
		flex: 1 1 28rem;
		grid-template-columns: minmax(10rem, 0.78fr) minmax(14rem, 1.1fr);
		align-items: end;
		gap: 0.75rem;
	}

	.filter-field,
	.field-group {
		display: grid;
		min-width: 0;
		gap: 0.45rem;
	}

	.filter-field {
		width: 100%;
	}

	.search-field {
		width: 100%;
	}

	.search-control {
		position: relative;
		min-width: 0;
	}

	.search-control :global(input) {
		padding-left: 2.5rem;
	}

	:global(.search-icon) {
		position: absolute;
		z-index: 1;
		top: 50%;
		left: 0.8rem;
		width: 1rem;
		height: 1rem;
		color: var(--muted-foreground);
		transform: translateY(-50%);
		pointer-events: none;
	}

	.workspace {
		display: grid;
		min-width: 0;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		gap: 1rem;
	}

	.workspace.has-editor {
		grid-template-columns: minmax(0, 1fr);
	}

	:global(.editor-card) {
		min-width: 0;
	}

	:global(.catalog-card) {
		min-width: 0;
		container-type: inline-size;
	}

	:global(.catalog-header[data-slot='card-header']) {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		padding-bottom: 0;
	}

	.catalog-heading {
		display: flex;
		min-width: 0;
		flex: 1 1 auto;
		align-items: flex-start;
		gap: 0.65rem;
	}

	:global(.list-heading-icon) {
		width: 1rem;
		height: 1rem;
		flex: 0 0 auto;
		margin-top: 0.15rem;
		color: var(--muted-foreground);
	}

	.list-heading-copy {
		display: grid;
		min-width: 0;
		gap: 0.1rem;
	}

	.list-heading-copy :global([data-slot='card-description']) {
		font-size: var(--type-xs);
		line-height: 1.45;
	}

	:global(.catalog-content[data-slot='card-content']) {
		gap: 0.75rem;
	}

	:global(.list-separator[data-slot='separator']) {
		margin: 0;
	}

	.catalog-form {
		display: grid;
		gap: 1rem;
	}

	.optional-label,
	.field-help {
		color: var(--muted-foreground);
		font-size: var(--type-xs);
		font-weight: 400;
	}

	.field-help {
		margin: 0;
		line-height: 1.5;
	}

	.active-control {
		display: flex;
		min-height: 3.25rem;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.active-copy {
		display: grid;
		gap: 0.2rem;
	}

	:global(.active-label) {
		font-size: var(--type-sm);
		font-weight: 600;
	}

	.active-copy p {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--type-xs);
	}

	.form-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.55rem;
		padding-top: 0.25rem;
	}

	.save-status {
		margin: 0 0 0.75rem;
		color: var(--foreground);
		font-size: var(--type-sm);
		font-weight: 550;
	}

	.state-panel {
		display: grid;
		min-height: 10rem;
		align-content: center;
		justify-items: start;
		gap: 0.6rem;
		padding: 1.5rem 0.25rem;
	}

	.state-panel strong {
		font-size: var(--type-base);
	}

	.state-panel p {
		max-width: 38rem;
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--type-sm);
		line-height: 1.6;
	}

	:global(.load-error) {
		display: grid;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.desktop-catalog {
		margin-top: 0.15rem;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: var(--type-sm);
	}

	thead {
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: var(--type-xs);
	}

	thead th {
		font-weight: 600;
	}

	th,
	td {
		padding: 0.72rem 0.75rem;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}

	tbody tr {
		transition: background-color 140ms ease;
	}

	tbody tr:hover {
		background: var(--muted);
	}

	tbody tr:last-child > * {
		border-bottom: 0;
	}

	tbody th {
		min-width: 11rem;
		font-weight: 500;
	}

	tbody th strong,
	tbody th small {
		display: block;
	}

	tbody th strong {
		color: var(--foreground);
		font-weight: 600;
	}

	tbody th small {
		max-width: 22rem;
		margin-top: 0.25rem;
		color: var(--muted-foreground);
		font-size: var(--type-xs);
		font-weight: 400;
		line-height: 1.45;
	}

	.action-cell {
		text-align: right;
	}

	.mobile-catalog {
		display: none;
	}

	@media (max-width: 58rem) {
		.desktop-catalog { display: none; }
		.mobile-catalog { display: grid; gap: 0.7rem; margin-top: 0.15rem; }
		:global(.mobile-record) { display: grid; min-width: 0; gap: 0; padding: 0; border: 0; background: var(--card); }
		:global(.mobile-record-content[data-slot='card-content']) { display: grid; gap: 0.75rem; padding: 0.9rem; }
		.record-heading { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
		.record-heading > div { min-width: 0; }
		.record-heading h3 { margin: 0; font-size: var(--type-base); font-weight: 620; line-height: 1.4; overflow-wrap: anywhere; }
		.record-heading p, .record-description { margin: 0.25rem 0 0; color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.5; overflow-wrap: anywhere; }
		.record-description { margin-top: 0; }
		.record-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; padding-top: 0.65rem; border-top: 1px solid var(--border); font-size: var(--type-sm); }
		.record-meta span { color: var(--muted-foreground); }
		:global(.record-edit) { width: 100%; }
	}

	@media (min-width: 72rem) {
		.workspace.has-editor {
			grid-template-columns: minmax(18rem, 0.78fr) minmax(0, 1.42fr);
		}
	}

	@media (max-width: 42rem) {
		.catalog-toolbar {
			align-items: stretch;
			flex-direction: column;
			width: 100%;
		}

		.filters {
			grid-template-columns: minmax(0, 1fr);
			flex: 0 1 auto;
			align-content: start;
			align-items: stretch;
			grid-auto-rows: max-content;
			min-height: 0;
		}

		:global(.create-button) {
			width: 100%;
		}
	}

	@media (max-width: 42rem) {
		.filter-field,
		.search-field {
			width: 100%;
		}

		:global(.create-button) {
			width: 100%;
		}

		:global(.catalog-header) {
			align-items: flex-start;
		}

	}
</style>
