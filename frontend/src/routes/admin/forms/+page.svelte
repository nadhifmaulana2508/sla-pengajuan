<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import {
		createManagedRejectionReason, fetchFormManagementWorkspace, fetchManagedRejectionReasons, publishWorkForm,
		setManagedRejectionReasonActive, type CreditRoutingConfig, type ManagedRejectionReason, type WorkCatalog,
		type WorkFormField, type WorkFormFieldInput, type RepeatableFormConfig
	} from '#lib/features/admin/admin.api.js';
	import { Plus, Trash2 } from '@lucide/svelte';

	type FieldEditor = {
		label: string;
		type: WorkFormField['type'];
		required: boolean;
		requires_korwil_review: boolean;
		min_value: string;
		max_value: string;
		options_text: string;
	};

	const fieldTypes: Array<{ value: WorkFormField['type']; label: string }> = [
		{ value: 'text', label: 'Teks singkat' },
		{ value: 'textarea', label: 'Teks panjang' },
		{ value: 'number', label: 'Angka' },
		{ value: 'currency', label: 'Nominal rupiah' },
		{ value: 'date', label: 'Tanggal' },
		{ value: 'select', label: 'Pilihan' }
	];

	function emptyField(): FieldEditor {
		return { label: '', type: 'text', required: false, requires_korwil_review: false, min_value: '', max_value: '', options_text: '' };
	}

	let token = $state<string | null>(null);
	let catalogs = $state<WorkCatalog[]>([]);
	let catalogId = $state('');
	let fields = $state<FieldEditor[]>([]);
	let repeatableEnabled = $state(false);
	let repeatableLabel = $state('Data rekening/fasilitas');
	let repeatableMaxEntries = $state('10');
	let marketingThresholdAmount = $state('500000000');
	let isLoading = $state(true);
	let isPublishing = $state(false);
	let loadError = $state('');
	let formError = $state('');
	let fieldError = $state<{ index: number; message: string } | null>(null);
	let statusMessage = $state('');
	let managedReasons = $state<ManagedRejectionReason[]>([]);
	let canManageSystemReasons = $state(false);
	let reasonLabel = $state('');
	let reasonScope = $state<'division' | 'catalog' | 'system'>('division');
	let reasonBusy = $state(false);
	let reasonError = $state('');
	let reasonStatus = $state('');
	let selectedCatalog = $derived(catalogs.find((item) => String(item.id) === catalogId) ?? null);
	let maxCustomFields = $derived(selectedCatalog?.system_key === 'credit_application' ? 39 : 40);
	let catalogItems = $derived(catalogs.map((item) => ({
		value: String(item.id),
		label: `${item.nama_pekerjaan} · ${item.nama_divisi}`
	})));

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; });
		void loadWorkspace();
		return unsubscribe;
	});

	async function loadWorkspace(): Promise<void> {
		if (!token) { await goto('/'); return; }
		isLoading = true;
		loadError = '';
		try {
			const profile = await fetchCurrentProfile(token);
			updateProfile(profile);
			if (!profile.sla_access.enabled || !(profile.sla_access.role === 'admin' || profile.sla_access.can_manage_forms)) {
				await goto('/dashboard');
				return;
			}
			const workspace = (await fetchFormManagementWorkspace(token)).data;
			catalogs = workspace.work_catalogs;
			catalogId = String(workspace.work_catalogs[0]?.id ?? '');
			loadFieldsForCatalog(catalogId, workspace.work_catalogs);
			canManageSystemReasons = workspace.can_manage_all;
			if (catalogId) void loadReasons(Number(catalogId));
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			loadError = error instanceof ApiError ? error.message : 'Daftar form belum dapat dimuat. Coba lagi.';
		} finally {
			isLoading = false;
		}
	}

	function loadFieldsForCatalog(id: string, source = catalogs): void {
		const catalog = source.find((item) => String(item.id) === id);
		fields = (catalog?.form_fields ?? []).filter((field) => !field.system).map((field) => ({
			label: field.label,
			type: field.type,
			required: field.required,
			requires_korwil_review: field.requires_korwil_review ?? false,
			min_value: field.min_value === undefined ? '' : String(field.min_value),
			max_value: field.max_value === undefined ? '' : String(field.max_value),
			options_text: (field.options ?? []).join('\n')
		}));
		repeatableEnabled = Boolean(catalog?.form_repeatable);
		repeatableLabel = catalog?.form_repeatable?.label ?? 'Data rekening/fasilitas';
		repeatableMaxEntries = String(catalog?.form_repeatable?.max_entries ?? 10);
		marketingThresholdAmount = String(catalog?.form_credit_routing?.marketing_threshold_amount ?? 500_000_000);
		formError = '';
		fieldError = null;
		statusMessage = '';
	}

	function changeCatalog(value: string): void {
		catalogId = value;
		loadFieldsForCatalog(value);
		if (value && token) void loadReasons(Number(value));
	}

	async function loadReasons(id: number): Promise<void> {
		if (!token) return;
		reasonError = '';
		reasonStatus = '';
		try { managedReasons = (await fetchManagedRejectionReasons(token, id)).data.reasons; }
		catch (error) { reasonError = error instanceof ApiError ? error.message : 'Alasan penolakan belum dapat dimuat.'; }
	}

	async function addRejectionReason(): Promise<void> {
		if (!token || !selectedCatalog || reasonBusy) return;
		if (reasonLabel.trim().length < 3) { reasonError = 'Nama alasan minimal 3 karakter.'; return; }
		reasonBusy = true;
		reasonError = '';
		reasonStatus = '';
		try {
			await createManagedRejectionReason(token, selectedCatalog.id, reasonScope, reasonLabel.trim());
			reasonLabel = '';
			reasonStatus = 'Alasan ditambahkan. Pilihan baru berlaku untuk penolakan berikutnya.';
			await loadReasons(selectedCatalog.id);
		} catch (error) { reasonError = error instanceof ApiError ? error.message : 'Alasan belum dapat ditambahkan.'; }
		finally { reasonBusy = false; }
	}

	async function toggleReason(reason: ManagedRejectionReason): Promise<void> {
		if (!token || reasonBusy) return;
		reasonBusy = true;
		reasonError = '';
		try {
			await setManagedRejectionReasonActive(token, reason.id, !reason.is_active);
			if (selectedCatalog) await loadReasons(selectedCatalog.id);
		} catch (error) { reasonError = error instanceof ApiError ? error.message : 'Status alasan belum dapat diubah.'; }
		finally { reasonBusy = false; }
	}

	function addField(): void {
		if (fields.length >= maxCustomFields) return;
		fieldError = null;
		fields = [...fields, emptyField()];
	}

	function removeField(index: number): void {
		fieldError = null;
		fields = fields.filter((_, fieldIndex) => fieldIndex !== index);
	}

	function parseEditorFields(): WorkFormFieldInput[] {
		return fields.map((field) => {
			const minimum = field.min_value.trim() === '' ? undefined : Number(field.min_value);
			const maximum = field.max_value.trim() === '' ? undefined : Number(field.max_value);
			return {
				label: field.label.trim(),
				type: field.type,
				required: field.required,
				requires_korwil_review: field.requires_korwil_review,
				...(minimum === undefined ? {} : { min_value: minimum }),
				...(maximum === undefined ? {} : { max_value: maximum }),
				...(field.type === 'select' ? {
					options: field.options_text.split(/\r?\n/).map((option) => option.trim()).filter(Boolean)
				} : {})
			};
		});
	}

	function focusField(index: number, target: 'label' | 'options' | 'min' = 'label'): void {
		if (typeof document === 'undefined') return;
		requestAnimationFrame(() => {
			const control = document.getElementById(`field-${target}-${index}`);
			control?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			if (control instanceof HTMLElement) control.focus({ preventScroll: true });
		});
	}

	function showFieldError(index: number, message: string, target: 'label' | 'options' | 'min' = 'label'): void {
		fieldError = { index, message };
		formError = '';
		focusField(index, target);
	}

	async function publish(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!token || !selectedCatalog || isPublishing) return;
		fieldError = null;
		if (fields.length > maxCustomFields) {
			formError = `Form ini maksimal memiliki ${maxCustomFields} kolom tambahan.`;
			return;
		}
		const emptyLabelIndex = fields.findIndex((field) => !field.label.trim());
		if (emptyLabelIndex >= 0) {
			showFieldError(emptyLabelIndex, 'label wajib diisi atau kolom ini harus dihapus.');
			return;
		}
		const parsedFields = parseEditorFields();
		for (const [index, field] of parsedFields.entries()) {
			if (field.type === 'select' && !field.options?.length) {
				showFieldError(index, 'tambahkan sedikitnya satu opsi pilihan.', 'options');
				return;
			}
			if (field.type === 'select' && (field.options?.length ?? 0) > 50) {
				showFieldError(index, 'field pilihan maksimal memiliki 50 opsi.', 'options');
				return;
			}
			const options = field.options ?? [];
			if (new Set(options.map((option) => option.toLocaleLowerCase('id-ID'))).size !== options.length) {
				showFieldError(index, 'opsi pilihan tidak boleh berulang.', 'options');
				return;
			}
			if ((field.min_value !== undefined && !Number.isFinite(field.min_value)) ||
				(field.max_value !== undefined && !Number.isFinite(field.max_value))) {
				showFieldError(index, 'batas minimum atau maksimum harus berupa angka yang valid.', 'min');
				return;
			}
			if (field.min_value !== undefined && field.max_value !== undefined && field.min_value > field.max_value) {
				showFieldError(index, 'nilai minimum tidak boleh lebih besar dari nilai maksimum.', 'min');
				return;
			}
		}
		let repeatableConfig: RepeatableFormConfig | null = null;
		if (repeatableEnabled) {
			const maxEntries = Number(repeatableMaxEntries);
			if (selectedCatalog.system_key === 'credit_application') {
				formError = 'Form Pengajuan Kredit tidak dapat diatur sebagai data berulang.';
				return;
			}
			if (fields.length === 0) {
				formError = 'Tambahkan sedikitnya satu kolom sebelum mengaktifkan data berulang.';
				return;
			}
			if (!repeatableLabel.trim() || repeatableLabel.trim().length > 80) {
				formError = 'Nama data berulang wajib diisi dan maksimal 80 karakter.';
				return;
			}
			if (!Number.isInteger(maxEntries) || maxEntries < 2 || maxEntries > 20) {
				formError = 'Batas data berulang harus berupa bilangan bulat antara 2 dan 20.';
				return;
			}
			repeatableConfig = { label: repeatableLabel.trim(), max_entries: maxEntries };
		}
		let creditRouting: CreditRoutingConfig | null = null;
		if (selectedCatalog.system_key === 'credit_application') {
			const threshold = Number(marketingThresholdAmount);
			if (!Number.isSafeInteger(threshold) || threshold < 250_000_000) {
				formError = 'Ambang Pemasaran harus minimal Rp250.000.000.';
				return;
			}
			creditRouting = { marketing_threshold_amount: threshold };
		}
		isPublishing = true;
		formError = '';
		statusMessage = '';
		try {
			const result = await publishWorkForm(token, selectedCatalog.id, parsedFields, repeatableConfig, creditRouting);
			statusMessage = result.message;
			try {
				const workspace = (await fetchFormManagementWorkspace(token)).data;
				catalogs = workspace.work_catalogs;
				loadFieldsForCatalog(catalogId, workspace.work_catalogs);
				statusMessage = result.message;
			} catch (refreshError) {
				if (refreshError instanceof ApiError && refreshError.status === 401) {
					clearAuthenticatedSession();
					await goto('/');
					return;
				}
				statusMessage = `${result.message} Form sudah tersimpan, tetapi versi terbaru belum termuat. Muat ulang halaman untuk menyegarkan daftar.`;
			}
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			formError = error instanceof ApiError ? error.message : 'Form belum dapat diterbitkan. Coba lagi.';
			const columnMatch = formError.match(/^Kolom (\d+):/i);
			if (columnMatch) {
				const message = formError.replace(/^Kolom \d+:\s*/i, '');
				showFieldError(Number(columnMatch[1]) - 1, message);
			}
		} finally {
			isPublishing = false;
		}
	}
</script>

<svelte:head>
	<title>Kelola Form | Sistem SLA Pengajuan</title>
	<meta name="description" content="Susun dan terbitkan form dinamis untuk katalog pekerjaan yang berada dalam cakupan akses." />
</svelte:head>

<main id="main-content" class="form-admin-page">
	<AppNavbar />
	<section class="form-admin-content app-page-shell" aria-labelledby="page-title">
		<AppPageHeading eyebrow="Pengaturan pekerjaan" title="Kelola form" description="Setiap penerbitan membuat versi baru. Tiket yang sudah dikirim tetap memakai versi form saat pengajuan dibuat." />
		{#if isLoading}
			<Card.Root role="status" aria-live="polite"><Card.Content class="state-panel">Memuat katalog form…</Card.Content></Card.Root>
		{:else if loadError}
			<Alert.Root variant="destructive"><Alert.Title>Form belum dapat dimuat</Alert.Title><Alert.Description>{loadError}</Alert.Description><Button variant="outline" class="min-h-11" onclick={() => void loadWorkspace()}>Coba lagi</Button></Alert.Root>
		{:else if catalogs.length === 0}
			<Card.Root><Card.Content class="state-panel">Belum ada jenis pekerjaan dalam cakupan akses kamu.</Card.Content></Card.Root>
		{:else}
			<div class="builder-layout">
				<div class="builder-sidebar">
				<Card.Root class="catalog-card">
					<Card.Header><Card.Title>Jenis pekerjaan</Card.Title><Card.Description>Admin dapat mengelola semua divisi. Pengelola Divisi hanya melihat katalog sesuai unit SSO-nya.</Card.Description></Card.Header>
					<Card.Content class="catalog-content">
						<div class="field">
							<Label for="catalog-select">Pilih pekerjaan</Label>
							<SearchableSelect id="catalog-select" label="Pilih pekerjaan" options={catalogItems} value={catalogId} onValueChange={changeCatalog} placeholder="Pilih jenis pekerjaan" searchPlaceholder="Cari nama pekerjaan atau divisi..." />
						</div>
						{#if selectedCatalog}
							<div class="catalog-meta">
								<div><span>Divisi</span><strong>{selectedCatalog.nama_divisi}</strong></div>
								<div><span>Versi aktif</span><strong>{selectedCatalog.version_number ? `v${selectedCatalog.version_number}` : 'Belum diterbitkan'}</strong></div>
							</div>
							{#if selectedCatalog.system_key === 'credit_application'}
								<Alert.Root><Alert.Title>Field sistem</Alert.Title><Alert.Description>Nilai kredit selalu wajib dan dikunci oleh sistem. Nilai ini menentukan routing dan tidak dapat dihapus dari form.</Alert.Description></Alert.Root>
							{/if}
						{/if}
						<p class="scope-note">Hak edit form mengikuti assignment aktif. Perubahan nama divisi atau unit SSO tidak memberi akses form secara otomatis.</p>
					</Card.Content>
				</Card.Root>
				{#if selectedCatalog}
					<Card.Root class="reason-card"><Card.Header><Card.Title>Alasan penolakan</Card.Title><Card.Description>Alasan sistem selalu tersedia. Tambahkan alasan yang berlaku untuk seluruh Divisi atau khusus pekerjaan ini.</Card.Description></Card.Header><Card.Content class="reason-manager">
						<div class="reason-create">
							<div class="field"><Label for="reason-scope">Berlaku untuk</Label><SearchableSelect id="reason-scope" label="Cakupan alasan" options={[
								...(canManageSystemReasons ? [{ value: 'system', label: 'Semua Divisi' }] : []),
								{ value: 'division', label: `Semua pekerjaan · ${selectedCatalog.nama_divisi}` },
								{ value: 'catalog', label: `Pekerjaan ini · ${selectedCatalog.nama_pekerjaan}` }
							]} value={reasonScope} onValueChange={(value) => (reasonScope = value as typeof reasonScope)} placeholder="Pilih cakupan" searchPlaceholder="Cari cakupan..." /></div>
							<div class="field"><Label for="reason-label">Nama alasan</Label><Input id="reason-label" bind:value={reasonLabel} maxlength={160} placeholder="Contoh: Data tidak sesuai ketentuan" class="min-h-11" /></div>
							<Button type="button" class="min-h-11 reason-add" disabled={reasonBusy || !reasonLabel.trim()} onclick={() => void addRejectionReason()}><Plus class="size-4" aria-hidden="true" />Tambah alasan</Button>
						</div>
						{#if reasonError}<Alert.Root variant="destructive"><Alert.Description>{reasonError}</Alert.Description></Alert.Root>{/if}
						{#if reasonStatus}<p class="save-status" role="status" aria-live="polite">{reasonStatus}</p>{/if}
						<div class="reason-list">
							{#each managedReasons as reason (reason.id)}<div class="reason-row"><div><strong>{reason.label}</strong><div class="reason-meta"><Badge variant="outline">{reason.scope_type === 'system' ? 'Sistem' : reason.scope_type === 'division' ? selectedCatalog.nama_divisi : selectedCatalog.nama_pekerjaan}</Badge><Badge variant={reason.is_active ? 'secondary' : 'outline'} class={reason.is_active ? 'status-badge status-badge--success' : ''}>{reason.is_active ? 'Aktif' : 'Nonaktif'}</Badge></div></div><Button type="button" variant="outline" class="min-h-10" disabled={reasonBusy} onclick={() => void toggleReason(reason)}>{reason.is_active ? 'Nonaktifkan' : 'Aktifkan'}</Button></div>{:else}<p class="scope-note">Belum ada alasan tambahan. Pilihan awal sistem tetap tersedia.</p>{/each}
						</div>
					</Card.Content></Card.Root>
				{/if}
				</div>

				<Card.Root class="editor-card">
					<Card.Header class="editor-header">
						<div><Card.Title>Kolom form</Card.Title><Card.Description>Atur jawaban, kewajiban, dan field yang perlu ditinjau Korwil jika berubah.</Card.Description></div>
						<Badge variant="outline">{fields.length}/{maxCustomFields} kolom tambahan</Badge>
					</Card.Header>
					<Card.Content>
						<form class="editor-form" novalidate onsubmit={publish}>
							{#if selectedCatalog?.system_key === 'credit_application'}
								<div class="system-field"><div><strong>Nilai pengajuan kredit</strong><p>Nominal Rupiah · wajib · minimal Rp250.000.000</p></div><Badge variant="secondary">Dikelola sistem</Badge></div>
								<fieldset class="credit-routing-settings">
									<legend>Panduan nilai Pemasaran</legend>
									<div class="field"><Label for="credit-marketing-threshold">Nilai panduan Pemasaran (Rp)</Label><Input id="credit-marketing-threshold" type="number" min="250000000" step="1" bind:value={marketingThresholdAmount} required class="min-h-11" /></div>
									<p>Nilai ini membantu Cabang menilai pengajuan, tetapi tidak mengubah tujuan tiket. Cabang memilih Korwil atau Pusat saat mengisi pengajuan; batas minimum tetap Rp250.000.000.</p>
				</fieldset>
							{/if}
							{#each fields as field, index (index)}
								<fieldset class="field-editor">
									<legend>Kolom {index + 1}</legend>
									<Button type="button" variant="outline" class="min-h-11 remove-field" aria-label={`Hapus kolom ${index + 1}`} onclick={() => removeField(index)}><Trash2 class="size-4" aria-hidden="true" /><span>Hapus kolom</span></Button>
									<div class="field-editor-grid">
										<div class="field field-label"><Label for={`field-label-${index}`}>Label</Label><Input id={`field-label-${index}`} bind:value={field.label} oninput={() => (fieldError = null)} maxlength={160} required placeholder="Contoh: Nomor rekening pinjaman" class="min-h-11" /></div>
										<div class="field"><Label for={`field-type-${index}`}>Jenis jawaban</Label><SearchableSelect id={`field-type-${index}`} label="Jenis jawaban" options={fieldTypes} value={field.type} onValueChange={(value) => { field.type = value as typeof field.type; fieldError = null; }} placeholder="Pilih jenis jawaban" searchPlaceholder="Cari jenis jawaban..." /></div>
										{#if field.type === 'number' || field.type === 'currency'}
											<div class="field"><Label for={`field-min-${index}`}>Nilai minimum <span class="optional">Opsional</span></Label><Input id={`field-min-${index}`} type="number" step="any" bind:value={field.min_value} oninput={() => (fieldError = null)} class="min-h-11" /></div>
											<div class="field"><Label for={`field-max-${index}`}>Nilai maksimum <span class="optional">Opsional</span></Label><Input id={`field-max-${index}`} type="number" step="any" bind:value={field.max_value} oninput={() => (fieldError = null)} class="min-h-11" /></div>
										{/if}
										{#if field.type === 'select'}<div class="field field-options"><Label for={`field-options-${index}`}>Pilihan, satu per baris</Label><Textarea id={`field-options-${index}`} bind:value={field.options_text} oninput={() => (fieldError = null)} rows={3} class="min-h-24" placeholder={'Baru\nBerjalan\nSelesai'} /></div>{/if}
										<div class="field-required"><Checkbox id={`field-required-${index}`} bind:checked={field.required} class="size-5" /><Label for={`field-required-${index}`}>Wajib diisi</Label></div>
										<div class="field-required"><Checkbox id={`field-korwil-review-${index}`} bind:checked={field.requires_korwil_review} class="size-5" /><Label for={`field-korwil-review-${index}`}>Periksa ulang lewat Korwil jika berubah saat revisi</Label></div>
									</div>
									{#if fieldError?.index === index}<p class="field-error" role="alert">Kolom {index + 1}: {fieldError.message}</p>{/if}
								</fieldset>
							{/each}
							<section class="repeatable-settings" aria-labelledby="repeatable-title">
								<div class="repeatable-toggle">
									<Checkbox id="repeatable-enabled" bind:checked={repeatableEnabled} disabled={selectedCatalog?.system_key === 'credit_application' || fields.length === 0} class="size-5" />
									<div>
										<Label id="repeatable-title" for="repeatable-enabled">Izinkan beberapa data dalam satu pengajuan</Label>
										<p>Semua kolom tambahan akan diulang bersama, misalnya satu set untuk setiap rekening atau fasilitas.</p>
									</div>
								</div>
								{#if selectedCatalog?.system_key === 'credit_application'}
									<p class="repeatable-hint">Pengajuan kredit memakai satu nilai sistem dan tidak mendukung pengulangan data.</p>
								{:else if fields.length === 0}
									<p class="repeatable-hint">Tambahkan kolom tambahan terlebih dahulu untuk mengatur kelompok berulang.</p>
								{:else if repeatableEnabled}
									<div class="repeatable-options">
										<div class="field"><Label for="repeatable-label">Nama kelompok data</Label><Input id="repeatable-label" bind:value={repeatableLabel} maxlength={80} required placeholder="Contoh: Data rekening/fasilitas" class="min-h-11" /></div>
										<div class="field"><Label for="repeatable-max">Maksimal data</Label><Input id="repeatable-max" type="number" min="2" max="20" step="1" bind:value={repeatableMaxEntries} required class="min-h-11" /></div>
									</div>
									<p class="repeatable-hint">Cabang mengisi satu kelompok terlebih dahulu, lalu dapat menambahkan kelompok sampai batas ini (2–20).</p>
								{/if}
							</section>
							<Button type="button" variant="outline" class="min-h-11 add-field" disabled={fields.length >= maxCustomFields} onclick={addField}><Plus class="size-4" aria-hidden="true" />Tambah kolom</Button>
							{#if fields.length >= maxCustomFields}<p class="field-limit-note" role="status">Batas {maxCustomFields} kolom tambahan sudah tercapai{selectedCatalog?.system_key === 'credit_application' ? ' karena nilai kredit dihitung sebagai kolom sistem' : ''}.</p>{/if}
							{#if formError}<Alert.Root variant="destructive"><Alert.Title>Form belum diterbitkan</Alert.Title><Alert.Description>{formError}</Alert.Description></Alert.Root>{/if}
							<div class="publish-note"><strong>Penerbitan membuat versi baru.</strong><span>Tiket yang sudah ada tetap memakai field dan jawaban dari versi sebelumnya.</span></div>
							<div class="form-actions"><Button type="submit" class="min-h-11" disabled={!selectedCatalog || isPublishing}>{isPublishing ? 'Menerbitkan…' : 'Terbitkan versi form'}</Button></div>
							{#if statusMessage}<p class="save-status" role="status" aria-live="polite">{statusMessage}</p>{/if}
						</form>
					</Card.Content>
				</Card.Root>
			</div>
		{/if}
	</section>
</main>

<style>
	.form-admin-page { min-height:100svh; background:var(--muted); color:var(--foreground); }
	.form-admin-content { display:grid; align-content:start; gap:1rem; }
	:global(.form-admin-content > .app-page-heading) { margin-bottom:0; }
	.builder-layout { display:grid; grid-template-columns:minmax(15rem,.72fr) minmax(0,1.6fr); align-items:start; gap:1rem; }
	.builder-sidebar { display:grid; min-width:0; align-content:start; gap:1rem; }
	:global(.catalog-card),:global(.editor-card) { min-width:0; }
	:global(.reason-card) { min-width:0; }
	:global(.reason-manager) { display:grid; gap:.8rem; }
	.builder-sidebar .reason-create { grid-template-columns:minmax(0,1fr); }
	:global(.builder-sidebar .reason-add) { width:100%; }
	.reason-create { display:grid; grid-template-columns:minmax(12rem,.8fr) minmax(14rem,1.2fr) auto; align-items:end; gap:.7rem; }
	:global(.reason-add) { white-space:nowrap; }
	.reason-list { display:grid; gap:.25rem; }
	.reason-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.6rem; padding:.7rem 0; border-bottom:1px solid var(--border); }
	.reason-row:last-child { border-bottom:0; }
	.reason-row > div:first-child { display:grid; gap:.4rem; min-width:0; }
	.reason-row strong { overflow-wrap:anywhere; font-size:var(--type-sm); }
	.reason-meta { display:flex; flex-wrap:wrap; gap:.35rem; }
	:global(.catalog-content),.editor-form { display:grid; gap:1rem; }
	.field { display:grid; min-width:0; gap:.45rem; }
	.catalog-meta { display:grid; gap:.65rem; padding:.8rem; border:1px solid var(--border); border-radius:var(--radius); }
	.catalog-meta div { display:flex; flex-wrap:wrap; justify-content:space-between; gap:.25rem .75rem; font-size:var(--type-sm); }
	.catalog-meta span,.scope-note,.optional { color:var(--muted-foreground); }
	.scope-note { margin:0; font-size:var(--type-xs); line-height:1.55; }
	:global(.editor-header[data-slot='card-header']) { display:flex; flex-direction:row; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:.75rem; }
	.field-editor { position:relative; min-width:0; margin:0; padding:3rem 1rem 1rem; border:1px solid var(--border); border-radius:var(--radius); }
	.field-editor legend { padding:0 .35rem 0 .35rem; color:var(--muted-foreground); font-size:var(--type-xs); font-weight:600; }
	.field-error { margin:.75rem 0 0; padding:.6rem .7rem; border-left:2px solid var(--destructive); background:color-mix(in srgb,var(--destructive) 8%,var(--card)); color:var(--destructive); font-size:var(--type-sm); line-height:1.5; }
	.field-editor-grid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(10rem,.8fr); align-items:end; gap:.85rem; }
	.field-options { grid-column:1 / -1; }
	.field-required { display:flex; min-height:2.75rem; align-items:center; gap:.6rem; }
	.repeatable-settings { display:grid; gap:.75rem; padding:.9rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--muted); }
	.repeatable-toggle { display:flex; align-items:flex-start; gap:.65rem; }
	.repeatable-toggle > div { display:grid; gap:.25rem; }
	.repeatable-toggle p,.repeatable-hint { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.repeatable-options { display:grid; grid-template-columns:minmax(0,1fr) minmax(8rem,.4fr); gap:.75rem; }
	:global(.field-required label) { font-size:var(--type-sm); }
	:global(.remove-field) { position:absolute; top:.5rem; right:.5rem; z-index:1; }
	.system-field { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:.75rem; padding:.8rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--muted); }
	.system-field p { margin:.2rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.credit-routing-settings { display:grid; gap:.65rem; margin:0; padding:.9rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--muted); }
	.credit-routing-settings legend { padding:0 .35rem; color:var(--muted-foreground); font-size:var(--type-xs); font-weight:600; }
	.credit-routing-settings p { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	:global(.add-field) { justify-self:start; }
	.publish-note { display:grid; gap:.2rem; padding:.8rem; border-left:2px solid var(--primary); background:var(--muted); font-size:var(--type-sm); line-height:1.5; }
	.publish-note span { color:var(--muted-foreground); }
	.form-actions { display:flex; justify-content:flex-end; padding-top:.2rem; }
	.save-status { margin:0; padding:.7rem .8rem; border:1px solid var(--border); border-left:2px solid var(--primary); border-radius:calc(var(--radius) - 2px); background:var(--muted); font-size:var(--type-sm); font-weight:550; line-height:1.5; }
	.field-limit-note { margin:-.65rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	:global(.state-panel) { min-height:8rem; align-items:center; justify-content:center; color:var(--muted-foreground); font-size:var(--type-sm); }
	@media(max-width: 60rem) { .builder-layout { grid-template-columns:minmax(0,1fr); } }
	@media(max-width: 42rem) { .reason-create { grid-template-columns:minmax(0,1fr); } :global(.reason-add) { width:100%; } }
	@media(max-width: 42rem) {
		.form-admin-content { padding-inline:.8rem; }
		.field-editor { padding:3rem .8rem .8rem; }
		.field-editor-grid { grid-template-columns:minmax(0,1fr); }
		.field-options { grid-column:auto; }
		:global(.add-field),.form-actions :global(button) { width:100%; }
		.form-actions { display:grid; }
		.system-field { align-items:flex-start; flex-direction:column; }
	}
	@media(max-width:520px) { .repeatable-options { grid-template-columns:minmax(0,1fr); } }
</style>
