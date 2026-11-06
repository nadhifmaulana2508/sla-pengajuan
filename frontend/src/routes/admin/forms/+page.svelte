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
	import * as Select from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import { fetchFormManagementWorkspace, publishWorkForm, type WorkCatalog, type WorkFormField, type WorkFormFieldInput } from '#lib/features/admin/admin.api.js';
	import { Plus, Trash2 } from '@lucide/svelte';

	type FieldEditor = {
		label: string;
		type: WorkFormField['type'];
		required: boolean;
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
		return { label: '', type: 'text', required: false, min_value: '', max_value: '', options_text: '' };
	}

	let token = $state<string | null>(null);
	let catalogs = $state<WorkCatalog[]>([]);
	let catalogId = $state('');
	let fields = $state<FieldEditor[]>([]);
	let isLoading = $state(true);
	let isPublishing = $state(false);
	let loadError = $state('');
	let formError = $state('');
	let statusMessage = $state('');
	let selectedCatalog = $derived(catalogs.find((item) => String(item.id) === catalogId) ?? null);
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
			min_value: field.min_value === undefined ? '' : String(field.min_value),
			max_value: field.max_value === undefined ? '' : String(field.max_value),
			options_text: (field.options ?? []).join('\n')
		}));
		formError = '';
		statusMessage = '';
	}

	function changeCatalog(value: string): void {
		catalogId = value;
		loadFieldsForCatalog(value);
	}

	function addField(): void {
		fields = [...fields, emptyField()];
	}

	function removeField(index: number): void {
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
				...(minimum === undefined ? {} : { min_value: minimum }),
				...(maximum === undefined ? {} : { max_value: maximum }),
				...(field.type === 'select' ? {
					options: field.options_text.split(/\r?\n/).map((option) => option.trim()).filter(Boolean)
				} : {})
			};
		});
	}

	async function publish(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!token || !selectedCatalog || isPublishing) return;
		if (fields.some((field) => !field.label.trim())) {
			formError = 'Isi label untuk setiap field atau hapus field yang belum digunakan.';
			return;
		}
		if (fields.some((field) => field.type === 'select' && !field.options_text.trim())) {
			formError = 'Tambahkan sedikitnya satu pilihan pada setiap field bertipe pilihan.';
			return;
		}
		const parsedFields = parseEditorFields();
		if (parsedFields.some((field) =>
			(field.min_value !== undefined && !Number.isFinite(field.min_value)) ||
			(field.max_value !== undefined && !Number.isFinite(field.max_value))
		)) {
			formError = 'Batas minimum dan maksimum harus berupa angka yang valid.';
			return;
		}

		isPublishing = true;
		formError = '';
		statusMessage = '';
		try {
			const result = await publishWorkForm(token, selectedCatalog.id, parsedFields);
			const workspace = (await fetchFormManagementWorkspace(token)).data;
			catalogs = workspace.work_catalogs;
			loadFieldsForCatalog(catalogId, workspace.work_catalogs);
			statusMessage = result.message;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			formError = error instanceof ApiError ? error.message : 'Form belum dapat diterbitkan. Coba lagi.';
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
		{#if statusMessage}<p class="save-status" role="status" aria-live="polite">{statusMessage}</p>{/if}
		{#if isLoading}
			<Card.Root role="status" aria-live="polite"><Card.Content class="state-panel">Memuat katalog form…</Card.Content></Card.Root>
		{:else if loadError}
			<Alert.Root variant="destructive"><Alert.Title>Form belum dapat dimuat</Alert.Title><Alert.Description>{loadError}</Alert.Description><Button variant="outline" class="min-h-11" onclick={() => void loadWorkspace()}>Coba lagi</Button></Alert.Root>
		{:else if catalogs.length === 0}
			<Card.Root><Card.Content class="state-panel">Belum ada jenis pekerjaan dalam cakupan akses kamu.</Card.Content></Card.Root>
		{:else}
			<div class="builder-layout">
				<Card.Root class="catalog-card">
					<Card.Header><Card.Title>Jenis pekerjaan</Card.Title><Card.Description>Admin dapat mengelola semua divisi. Pengelola Divisi hanya melihat katalog sesuai unit SSO-nya.</Card.Description></Card.Header>
					<Card.Content class="catalog-content">
						<div class="field">
							<Label for="catalog-select">Pilih pekerjaan</Label>
							<Select.Root type="single" items={catalogItems} value={catalogId} onValueChange={(value) => changeCatalog(value)}>
								<Select.Trigger id="catalog-select" class="min-h-11 w-full"><Select.Value placeholder="Pilih jenis pekerjaan" /></Select.Trigger>
								<Select.Content>{#each catalogItems as item (item.value)}<Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>{/each}</Select.Content>
							</Select.Root>
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

				<Card.Root class="editor-card">
					<Card.Header class="editor-header">
						<div><Card.Title>Kolom form</Card.Title><Card.Description>Atur label, jenis jawaban, dan kewajiban pengisian.</Card.Description></div>
						<Badge variant="outline">{fields.length} kolom tambahan</Badge>
					</Card.Header>
					<Card.Content>
						<form class="editor-form" onsubmit={publish}>
							{#if selectedCatalog?.system_key === 'credit_application'}
								<div class="system-field"><div><strong>Nilai pengajuan kredit</strong><p>Nominal Rupiah · wajib · minimal Rp250.000.000</p></div><Badge variant="secondary">Dikelola sistem</Badge></div>
							{/if}
							{#each fields as field, index (index)}
								<fieldset class="field-editor">
									<legend>Kolom {index + 1}</legend>
									<div class="field-editor-grid">
										<div class="field field-label"><Label for={`field-label-${index}`}>Label</Label><Input id={`field-label-${index}`} bind:value={field.label} maxlength={160} required placeholder="Contoh: Nomor rekening pinjaman" class="min-h-11" /></div>
										<div class="field"><Label for={`field-type-${index}`}>Jenis jawaban</Label><Select.Root type="single" items={fieldTypes} bind:value={field.type}><Select.Trigger id={`field-type-${index}`} class="min-h-11 w-full"><Select.Value /></Select.Trigger><Select.Content>{#each fieldTypes as type (type.value)}<Select.Item value={type.value} label={type.label}>{type.label}</Select.Item>{/each}</Select.Content></Select.Root></div>
										{#if field.type === 'number' || field.type === 'currency'}
											<div class="field"><Label for={`field-min-${index}`}>Nilai minimum <span class="optional">Opsional</span></Label><Input id={`field-min-${index}`} type="number" step="any" bind:value={field.min_value} class="min-h-11" /></div>
											<div class="field"><Label for={`field-max-${index}`}>Nilai maksimum <span class="optional">Opsional</span></Label><Input id={`field-max-${index}`} type="number" step="any" bind:value={field.max_value} class="min-h-11" /></div>
										{/if}
										{#if field.type === 'select'}<div class="field field-options"><Label for={`field-options-${index}`}>Pilihan, satu per baris</Label><Textarea id={`field-options-${index}`} bind:value={field.options_text} rows={3} class="min-h-24" placeholder={'Baru\nBerjalan\nSelesai'} /></div>{/if}
										<div class="field-required"><Checkbox id={`field-required-${index}`} bind:checked={field.required} class="size-5" /><Label for={`field-required-${index}`}>Wajib diisi</Label></div>
										<Button type="button" variant="outline" class="min-h-11 remove-field" aria-label={`Hapus kolom ${index + 1}`} onclick={() => removeField(index)}><Trash2 class="size-4" aria-hidden="true" /><span>Hapus kolom</span></Button>
									</div>
								</fieldset>
							{/each}
							<Button type="button" variant="outline" class="min-h-11 add-field" onclick={addField}><Plus class="size-4" aria-hidden="true" />Tambah kolom</Button>
							{#if formError}<Alert.Root variant="destructive"><Alert.Title>Form belum diterbitkan</Alert.Title><Alert.Description>{formError}</Alert.Description></Alert.Root>{/if}
							<div class="publish-note"><strong>Penerbitan membuat versi baru.</strong><span>Tiket yang sudah ada tetap memakai field dan jawaban dari versi sebelumnya.</span></div>
							<div class="form-actions"><Button type="submit" class="min-h-11" disabled={!selectedCatalog || isPublishing}>{isPublishing ? 'Menerbitkan…' : 'Terbitkan versi form'}</Button></div>
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
	:global(.catalog-card),:global(.editor-card) { min-width:0; }
	:global(.catalog-content),.editor-form { display:grid; gap:1rem; }
	.field { display:grid; min-width:0; gap:.45rem; }
	.catalog-meta { display:grid; gap:.65rem; padding:.8rem; border:1px solid var(--border); border-radius:var(--radius); }
	.catalog-meta div { display:flex; flex-wrap:wrap; justify-content:space-between; gap:.25rem .75rem; font-size:var(--type-sm); }
	.catalog-meta span,.scope-note,.optional { color:var(--muted-foreground); }
	.scope-note { margin:0; font-size:var(--type-xs); line-height:1.55; }
	:global(.editor-header[data-slot='card-header']) { display:flex; flex-direction:row; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:.75rem; }
	.field-editor { min-width:0; margin:0; padding:1rem; border:1px solid var(--border); border-radius:var(--radius); }
	.field-editor legend { padding:0 .35rem; color:var(--muted-foreground); font-size:var(--type-xs); font-weight:600; }
	.field-editor-grid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(10rem,.8fr); align-items:end; gap:.85rem; }
	.field-options { grid-column:1 / -1; }
	.field-required { display:flex; min-height:2.75rem; align-items:center; gap:.6rem; }
	:global(.field-required label) { font-size:var(--type-sm); }
	:global(.remove-field) { justify-self:end; }
	.system-field { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:.75rem; padding:.8rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--muted); }
	.system-field p { margin:.2rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	:global(.add-field) { justify-self:start; }
	.publish-note { display:grid; gap:.2rem; padding:.8rem; border-left:2px solid var(--primary); background:var(--muted); font-size:var(--type-sm); line-height:1.5; }
	.publish-note span { color:var(--muted-foreground); }
	.form-actions { display:flex; justify-content:flex-end; padding-top:.2rem; }
	.save-status { margin:0; font-size:var(--type-sm); font-weight:550; }
	:global(.state-panel) { min-height:8rem; align-items:center; justify-content:center; color:var(--muted-foreground); font-size:var(--type-sm); }
	@media(max-width: 60rem) { .builder-layout { grid-template-columns:minmax(0,1fr); } }
	@media(max-width: 42rem) {
		.form-admin-content { padding-inline:.8rem; }
		.field-editor { padding:.8rem; }
		.field-editor-grid { grid-template-columns:minmax(0,1fr); }
		.field-options { grid-column:auto; }
		:global(.remove-field),:global(.add-field),.form-actions :global(button) { width:100%; }
		.form-actions { display:grid; }
		.system-field { align-items:flex-start; flex-direction:column; }
	}
</style>
