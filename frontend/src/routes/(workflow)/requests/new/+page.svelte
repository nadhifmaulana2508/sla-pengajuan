<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { Input } from '#lib/components/ui/input/index.js';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import { createRequest, fetchRequestOptions, type RequestOptions, type WorkFormField } from '#lib/features/requests/requests.api.js';
	import { ArrowLeft, Building2, CircleAlert, Plus, Send, Trash2 } from '@lucide/svelte';

	let token = $state<string | null>(null);
	let options = $state<RequestOptions | null>(null);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let errorMessage = $state('');
	let authorityType = $state<'korwil' | 'central'>('korwil');
	let divisionId = $state('');
	let catalogId = $state('');
	let subject = $state('');
	let description = $state('');
	let inofficeLetterNumber = $state('');
	let inofficeLetterDate = $state('');
	let inofficeLetterFile = $state<File | null>(null);
	let formAnswers = $state<Record<string, string | number>>({});
	let formAnswerEntries = $state<Array<Record<string, string | number>>>([]);
	let currencyInputValues = $state<Record<string, string>>({});
	let selectedCatalog = $derived(options?.work_catalogs.find((item) => String(item.id) === catalogId) ?? null);
	let selectedDivision = $derived(options?.divisions.find((item) => String(item.id) === divisionId) ?? null);
	let workCatalogs = $derived(options?.work_catalogs.filter((item) => String(item.divisi_id) === divisionId) ?? []);
	let korwilCreditCatalogs = $derived(options?.work_catalogs.filter((item) => item.system_key === 'credit_application') ?? []);
	let isCreditApplication = $derived(selectedCatalog?.system_key === 'credit_application');
	let korwilFormValue = $derived(isCreditApplication && authorityType === 'korwil' ? catalogId : 'none');
	let creditAmount = $derived(Number(formAnswers.credit_amount ?? 0));
	let marketingThreshold = $derived(selectedCatalog?.form_credit_routing?.marketing_threshold_amount ?? 500_000_000);
	let routeSummary = $derived.by(() => {
		if (isCreditApplication) {
			if (creditAmount < 250_000_000) return {
				title: 'Minimal Rp250.000.000',
				description: 'Nominal di bawah batas minimum tidak dapat dikirim.'
			};
			if (authorityType === 'korwil') return {
				title: 'Cabang → Korwil',
				description: `Form Pengajuan Kredit dari Pemasaran dipakai; tiket ditangani Korwil saja. Nilai pengajuan ${formatCurrency(creditAmount)}.`
			};
			const direct = selectedCatalog?.routing_flow === 'branch_central';
			return {
				title: direct ? 'Cabang → Pemasaran' : 'Cabang → Korwil → Pemasaran',
				description: direct
					? `Form Pengajuan Kredit digunakan untuk meminta penanganan Pemasaran. Nilai ${formatCurrency(creditAmount)} langsung masuk ke antreannya.`
					: `Form Pengajuan Kredit digunakan untuk meminta penanganan Pemasaran. Korwil memeriksa lebih dulu; nilai pengajuan ${formatCurrency(creditAmount)}.`
			};
		}
		if (authorityType === 'korwil') return {
			title: 'Cabang → Korwil',
			description: 'Korwil menangani pengajuan ini.'
		};
		if (!selectedCatalog) return null;
		const direct = selectedCatalog.routing_flow === 'branch_central';
		const divisionName = selectedDivision?.nama_divisi ?? 'Divisi Pusat';
		return {
			title: direct
				? `Cabang → ${divisionName}`
				: `Cabang → Korwil → ${divisionName}`,
			description: direct
				? 'Pengajuan masuk langsung ke antrean divisi; timer dimulai saat petugas mengambilnya.'
				: 'Korwil memeriksa lebih dulu, lalu meneruskan pengajuan ke antrean divisi.'
		};
	});
	let submitTarget = $derived.by(() => {
		if (authorityType === 'korwil') return 'Korwil';
		if (isCreditApplication) return selectedCatalog?.routing_flow === 'branch_central'
			? options?.divisions.find((division) => division.id === selectedCatalog.divisi_id)?.nama_divisi ?? 'Pemasaran'
			: 'Korwil';
		return selectedCatalog?.routing_flow === 'branch_central' ? selectedDivision?.nama_divisi ?? 'Pusat' : 'Korwil';
	});
	let visibleFields = $derived(authorityType === 'central' || isCreditApplication ? selectedCatalog?.form_fields ?? [] : []);
	let repeatableForm = $derived(authorityType === 'central' || isCreditApplication ? selectedCatalog?.form_repeatable ?? null : null);
	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; });
		void loadOptions();
		return unsubscribe;
	});

	async function loadOptions(): Promise<void> {
		if (!token) { await goto('/'); return; }
		isLoading = true; errorMessage = '';
		try { options = (await fetchRequestOptions(token)).data; }
		catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Form belum dapat dimuat. Periksa koneksi lalu coba lagi.';
		}
		finally { isLoading = false; }
	}

	function chooseAuthority(value: 'korwil' | 'central'): void {
		const creditCatalog = isCreditApplication ? selectedCatalog : null;
		authorityType = value;
		if (!creditCatalog) {
			formAnswers = {};
			formAnswerEntries = [];
			currencyInputValues = {};
		}
		divisionId = value === 'central' && creditCatalog ? String(creditCatalog.divisi_id) : '';
		catalogId = creditCatalog ? String(creditCatalog.id) : '';
	}
	function chooseCatalog(value: string): void {
		catalogId = value;
		formAnswers = {};
		formAnswerEntries = options?.work_catalogs.find((item) => String(item.id) === value)?.form_repeatable ? [{}] : [];
		currencyInputValues = {};
	}
	function chooseKorwilForm(value: string): void {
		chooseCatalog(value === 'none' ? '' : value);
	}
	function divisionNameFor(id: number): string {
		return options?.divisions.find((division) => division.id === id)?.nama_divisi ?? 'Pusat';
	}

	function answerInputKey(field: WorkFormField, entryIndex: number | null): string {
		return entryIndex === null ? field.key : `${entryIndex}.${field.key}`;
	}

	function getFormAnswer(field: WorkFormField, entryIndex: number | null): string | number {
		return entryIndex === null ? formAnswers[field.key] ?? '' : formAnswerEntries[entryIndex]?.[field.key] ?? '';
	}

	function setAnswer(field: WorkFormField, value: string | number, entryIndex: number | null = null): void {
		const parsedValue = field.type === 'currency' || field.type === 'number'
			? value === '' || (typeof value === 'string' && value.trim() === '') ? '' : Number(value)
			: String(value);
		if (entryIndex === null) {
			formAnswers = { ...formAnswers, [field.key]: parsedValue };
			return;
		}
		formAnswerEntries = formAnswerEntries.map((entry, index) => index === entryIndex
			? { ...entry, [field.key]: parsedValue }
			: entry);
	}

	function formatGroupedNumber(value: string | number | undefined): string {
		if (value === undefined || value === '') return '';
		const numericValue = typeof value === 'number' ? value : Number(value);
		return Number.isFinite(numericValue)
			? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(numericValue)
			: '';
	}

	function caretPositionAfterDigits(value: string, digitCount: number): number {
		if (digitCount === 0) return 0;
		let seenDigits = 0;
		for (let index = 0; index < value.length; index += 1) {
			if (/\d/.test(value[index])) {
				seenDigits += 1;
				if (seenDigits === digitCount) return index + 1;
			}
		}
		return value.length;
	}

	function updateCurrencyAnswer(field: WorkFormField, input: HTMLInputElement, entryIndex: number | null = null): void {
		const selectionStart = input.selectionStart ?? input.value.length;
		const digitsBeforeCaret = input.value.slice(0, selectionStart).replace(/\D/g, '').length;
		const digits = input.value.replace(/\D/g, '');
		const amount = digits === '' ? '' : Number(digits);
		const formatted = formatGroupedNumber(amount);
		const displayKey = answerInputKey(field, entryIndex);

		currencyInputValues[displayKey] = formatted;
		setAnswer(field, amount, entryIndex);
		input.value = formatted;

		if (typeof amount === 'number' && field.min_value !== undefined && amount < field.min_value) {
			input.setCustomValidity(`Nilai minimal ${formatGroupedNumber(field.min_value)}.`);
		} else if (typeof amount === 'number' && field.max_value !== undefined && amount > field.max_value) {
			input.setCustomValidity(`Nilai maksimal ${formatGroupedNumber(field.max_value)}.`);
		} else {
			input.setCustomValidity('');
		}

		requestAnimationFrame(() => {
			const caretPosition = caretPositionAfterDigits(formatted, digitsBeforeCaret);
			input.setSelectionRange(caretPosition, caretPosition);
		});
	}

	function addFormAnswerEntry(): void {
		if (repeatableForm && formAnswerEntries.length < repeatableForm.max_entries) {
			formAnswerEntries = [...formAnswerEntries, {}];
		}
	}

	function removeFormAnswerEntry(entryIndex: number): void {
		if (entryIndex < 1) return;
		formAnswerEntries = formAnswerEntries.filter((_, index) => index !== entryIndex);
		currencyInputValues = {};
	}

	function formatCurrency(value: number): string {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!token) { await goto('/'); return; }
		isSaving = true; errorMessage = '';
		try {
			if (isCreditApplication && (!Number.isSafeInteger(creditAmount) || creditAmount < 250_000_000)) {
				errorMessage = 'Pengajuan kredit minimal Rp250.000.000.';
				isSaving = false;
				return;
			}
			if (inofficeLetterFile) {
				const isPdf = inofficeLetterFile.type === 'application/pdf' && inofficeLetterFile.name.toLocaleLowerCase('id-ID').endsWith('.pdf');
				if (!isPdf || inofficeLetterFile.size === 0 || inofficeLetterFile.size > 10 * 1024 * 1024) {
					errorMessage = 'Lampiran surat harus berupa PDF dengan ukuran maksimal 10 MB.';
					isSaving = false;
					return;
				}
			}
			const catalog = authorityType === 'central' || isCreditApplication ? selectedCatalog : null;
			const result = await createRequest(token, {
				authority_type: authorityType,
				central_division_id: authorityType === 'central' ? Number(divisionId) : null,
				work_catalog_id: catalog?.id ?? null,
				form_version_id: typeof catalog?.form_version_id === 'number' ? catalog.form_version_id : null,
				form_answers: typeof catalog?.form_version_id === 'number'
					? repeatableForm ? { __entries: formAnswerEntries } : formAnswers
					: {},
				subject: subject.trim(), description: description.trim(),
				inoffice_letter_number: inofficeLetterNumber.trim() || null,
				inoffice_letter_date: inofficeLetterDate || null,
				inoffice_letter: inofficeLetterFile
			});
			await goto(`/requests/${result.data.id}`);
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Pengajuan belum berhasil dikirim. Coba lagi.';
		} finally { isSaving = false; }
	}
</script>

{#snippet requestFormField(field: WorkFormField, entryIndex: number | null)}
	{@const fieldId = `request-field-${entryIndex === null ? 'single' : entryIndex}-${field.key}`}
	{@const answer = getFormAnswer(field, entryIndex)}
	<div class="field">
		<Label for={fieldId}>{field.label}{#if field.required}<span class="required-mark" aria-hidden="true"> *</span>{/if}</Label>
		{#if field.type === 'textarea'}
			<Textarea id={fieldId} value={String(answer)} oninput={(event) => setAnswer(field, event.currentTarget.value, entryIndex)} required={field.required} maxlength={5000} rows={4} class="min-h-24" />
		{:else if field.type === 'select'}
			<SearchableSelect id={fieldId} label={field.label} options={(field.options ?? []).map((option) => ({ value: option, label: option }))} value={String(answer)} onValueChange={(value) => setAnswer(field, value, entryIndex)} placeholder="Pilih jawaban" searchPlaceholder={`Cari ${field.label.toLocaleLowerCase('id-ID')}...`} />
		{:else if field.type === 'currency'}
			<Input id={fieldId} type="text" inputmode="numeric" value={currencyInputValues[answerInputKey(field, entryIndex)] ?? formatGroupedNumber(answer)} oninput={(event) => updateCurrencyAnswer(field, event.currentTarget, entryIndex)} required={field.required} class="min-h-11" />
			<p class="field-hint">Pemisah ribuan ditampilkan otomatis, contoh 2.500.000.</p>
		{:else}
			<Input id={fieldId} type={field.type} min={field.min_value} max={field.max_value} step="any" value={String(answer)} oninput={(event) => setAnswer(field, event.currentTarget.value, entryIndex)} required={field.required} class="min-h-11" />
		{/if}
	</div>
{/snippet}

<svelte:head><title>Buat Pengajuan | Sistem SLA</title></svelte:head>

<section class="form-page app-page-stack" aria-labelledby="page-title">
	<a class="back-link" href="/requests"><ArrowLeft class="size-4" aria-hidden="true" />Kembali ke pengajuan</a>
	<AppPageHeading eyebrow="Pengajuan Cabang" title="Buat pengajuan" description="Alur pengajuan mengikuti pengaturan pada jenis pekerjaan yang dipilih." flush />

	{#if isLoading}
		<Card.Root role="status" aria-live="polite"><Card.Content class="min-h-28 justify-center text-sm text-muted-foreground">Memuat data kantor dan katalog pekerjaan…</Card.Content></Card.Root>
	{:else if errorMessage && !options}
		<Alert.Root variant="destructive"><Alert.Title>Form belum dapat dibuka</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void loadOptions()}>Coba lagi</Button></Alert.Action></Alert.Root>
	{:else if options}
		<div class="form-layout">
			<form onsubmit={submit}>
				<Card.Root>
					<Card.Header><Card.Title>Informasi pengajuan</Card.Title><Card.Description>Kolom bertanda wajib diisi.</Card.Description></Card.Header>
					<Card.Content class="form-fields">
						<div class="destination"><Building2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>Cabang <strong>{options.office.kode_kantor}</strong> · Korwil pemetaan <strong>{options.office.korwil}</strong></span></div>
						<div class="field"><label for="subject">Perihal <span aria-hidden="true">*</span></label><Input id="subject" bind:value={subject} required minlength={3} maxlength={200} class="min-h-11" placeholder="Contoh: Permohonan persetujuan lelang" /></div>
						<fieldset class="field-set"><legend>Kewenangan tujuan <span aria-hidden="true">*</span></legend><div class="authority-options">
							<label class:chosen={authorityType === 'korwil'} class="authority-option"><input type="radio" name="authority" value="korwil" checked={authorityType === 'korwil'} onchange={() => chooseAuthority('korwil')} /><span><strong>Korwil</strong><small>Ditangani di tingkat Korwil</small></span></label>
							<label class:chosen={authorityType === 'central'} class="authority-option"><input type="radio" name="authority" value="central" checked={authorityType === 'central'} onchange={() => chooseAuthority('central')} /><span><strong>Pusat</strong><small>Pilih divisi dan jenis pekerjaan</small></span></label>
						</div></fieldset>
						{#if authorityType === 'central'}
							<div class="field"><span id="division-label" class="field-label">Divisi Pusat <span aria-hidden="true">*</span></span><SearchableSelect id="division-select" label="Divisi Pusat" options={options.divisions.map((division) => ({ value: String(division.id), label: division.nama_divisi }))} value={divisionId} onValueChange={(value) => { divisionId = value; chooseCatalog(''); }} placeholder="Pilih divisi tujuan" searchPlaceholder="Cari divisi..." /></div>
							<div class="field"><span id="catalog-label" class="field-label">Jenis pekerjaan <span aria-hidden="true">*</span></span><SearchableSelect id="catalog-select" label="Jenis pekerjaan" options={workCatalogs.map((item) => ({ value: String(item.id), label: item.nama_pekerjaan }))} value={catalogId} onValueChange={chooseCatalog} disabled={!divisionId} placeholder={divisionId ? 'Pilih jenis pekerjaan' : 'Pilih divisi lebih dulu'} searchPlaceholder="Cari pekerjaan..." />{#if divisionId && workCatalogs.length === 0}<p class="field-hint">Belum ada jenis pekerjaan aktif untuk divisi ini. Minta Admin menambahkannya.</p>{/if}</div>
						{:else}
							<div class="field"><Label for="korwil-form-select">Form pengajuan <span class="optional-label">Opsional</span></Label><SearchableSelect id="korwil-form-select" label="Form pengajuan" options={[{ value: 'none', label: 'Tanpa form khusus' }, ...korwilCreditCatalogs.map((item) => ({ value: String(item.id), label: `${item.nama_pekerjaan} · ${divisionNameFor(item.divisi_id)}` }))]} value={korwilFormValue} onValueChange={chooseKorwilForm} placeholder="Pilih form pengajuan" searchPlaceholder="Cari form pekerjaan..." />{#if korwilCreditCatalogs.length > 0}<p class="field-hint">Pilih Pengajuan Kredit jika ingin memakai field dari Pemasaran. Kewenangan Korwil tetap membuat tiket berhenti di Korwil.</p>{:else}<p class="field-hint">Belum ada form Pengajuan Kredit Pemasaran yang aktif.</p>{/if}</div>
						{/if}
						{#if selectedCatalog && (authorityType === 'central' || isCreditApplication)}
							<div class="route-summary" aria-live="polite"><strong>{routeSummary?.title}</strong><span>{routeSummary?.description}</span></div>
							{#if isCreditApplication}
								<div class="credit-guidance"><strong>Batas dan panduan nilai kredit</strong><span>Nilai minimal Rp250.000.000. Ambang panduan Pemasaran saat ini {formatCurrency(marketingThreshold)}; tujuan akhir mengikuti pilihan kewenangan di atas.</span></div>
							{/if}
							{#if selectedCatalog.form_version_id === null}<Alert.Root variant="destructive"><Alert.Title>Form pekerjaan belum tersedia</Alert.Title><Alert.Description>Hubungi Admin atau pengelola Divisi untuk menerbitkan form sebelum pengajuan dikirim.</Alert.Description></Alert.Root>{/if}
							{#if repeatableForm}
								<div class="repeatable-entries">
									{#each formAnswerEntries as entry, entryIndex (entryIndex)}
									<fieldset class="repeatable-entry" aria-label={`${repeatableForm.label} ${entryIndex + 1}`}>
										<legend>{repeatableForm.label} {entryIndex + 1} dari {repeatableForm.max_entries}</legend>
										{#if entryIndex > 0}<Button type="button" variant="outline" class="min-h-10 remove-entry" aria-label={`Hapus ${repeatableForm.label} ${entryIndex + 1}`} onclick={() => removeFormAnswerEntry(entryIndex)}><Trash2 class="size-4" aria-hidden="true" />Hapus kelompok</Button>{/if}
										<div class="repeatable-entry-fields">{#each visibleFields as field (field.key)}{@render requestFormField(field, entryIndex)}{/each}</div>
									</fieldset>
								{/each}
								</div>
								<Button type="button" variant="outline" class="min-h-11 add-entry" disabled={formAnswerEntries.length >= repeatableForm.max_entries} onclick={addFormAnswerEntry}><Plus class="size-4" aria-hidden="true" />Tambah {repeatableForm.label.toLocaleLowerCase('id-ID')}</Button>
							{:else}
								{#each visibleFields as field (field.key)}{@render requestFormField(field, null)}{/each}
							{/if}
							{#if selectedCatalog.form_version_id !== null && visibleFields.length === 0}<p class="field-hint">Belum ada kolom tambahan pada versi form ini. Pengelola Divisi dapat menambahkannya.</p>{/if}
						{/if}
						<div class="field"><label for="description">Uraian <span aria-hidden="true">*</span></label><Textarea id="description" bind:value={description} required minlength={3} maxlength={5000} rows={6} placeholder="Jelaskan latar belakang dan hal yang diminta." /><p class="field-hint">Maksimal 5.000 karakter.</p></div>
						<fieldset class="letter-fields"><legend>Surat InOffice <span>(opsional)</span></legend><div class="letter-grid">
							<div class="field"><Label for="inoffice-letter-number">Nomor surat</Label><Input id="inoffice-letter-number" bind:value={inofficeLetterNumber} maxlength={100} class="min-h-11" placeholder="Nomor surat InOffice" /></div>
							<div class="field"><Label for="inoffice-letter-date">Tanggal surat</Label><Input id="inoffice-letter-date" type="date" bind:value={inofficeLetterDate} class="min-h-11" /></div>
							<div class="field letter-upload"><Label for="inoffice-letter-file">File surat (PDF)</Label><Input id="inoffice-letter-file" type="file" accept="application/pdf,.pdf" class="min-h-11 file-input" onchange={(event) => { inofficeLetterFile = event.currentTarget.files?.[0] ?? null; errorMessage = ''; }} /><p class="field-hint">Opsional · PDF maksimal 10 MB. File hanya dapat diakses oleh pengguna yang berhak melihat tiket.</p>{#if inofficeLetterFile}<p class="selected-file">Dipilih: {inofficeLetterFile.name}<Button type="button" variant="ghost" class="clear-file" onclick={() => { inofficeLetterFile = null; const input = document.getElementById('inoffice-letter-file'); if (input instanceof HTMLInputElement) input.value = ''; }}>Hapus file</Button></p>{/if}</div>
						</div></fieldset>
						{#if errorMessage}<Alert.Root variant="destructive"><Alert.Title>Pengajuan belum terkirim</Alert.Title><Alert.Description>{errorMessage}</Alert.Description></Alert.Root>{/if}
					</Card.Content>
					<Card.Footer class="form-actions"><Button variant="outline" class="min-h-11" href="/requests">Batal</Button><Button type="submit" class="min-h-11" disabled={isSaving || (authorityType === 'central' && (!divisionId || !catalogId)) || (isCreditApplication && selectedCatalog?.form_version_id === null)}>{#if isSaving}Mengirim…{:else}<Send class="size-4" aria-hidden="true" />Kirim ke {submitTarget}{/if}</Button></Card.Footer>
				</Card.Root>
			</form>
			<aside class="aside-stack" aria-label="Informasi alur dan batasan form">
				{#if isCreditApplication}
					<Card.Root><Card.Header><Card.Title class="text-base">Jalur pengajuan kredit</Card.Title><Card.Description>Nilai minimum Rp250.000.000. Kewenangan yang dipilih menentukan tujuan; ambang Pemasaran menjadi panduan nilai.</Card.Description></Card.Header><Card.Content class="flow-copy"><p><span>1</span> Di bawah Rp250 juta tidak dapat dikirim.</p><p><span>2</span> Pilih Korwil untuk memakai form Kredit dan menangani tiket hanya di Korwil.</p><p><span>3</span> Pilih Pusat untuk mengirim ke Pemasaran melalui jalur katalog; ambang panduan saat ini {formatCurrency(marketingThreshold)}.</p></Card.Content></Card.Root>
				{/if}
				<Card.Root><Card.Header><Card.Title class="text-base">Alur setelah dikirim</Card.Title></Card.Header><Card.Content class="flow-copy"><p><span>1</span> {routeSummary?.title ?? 'Pilih kewenangan tujuan'}</p><p><span>2</span> {routeSummary?.description ?? 'Untuk tujuan Pusat, pilih divisi dan jenis pekerjaan.'}</p><p><span>3</span> Antrean unit tujuan dicatat; timer proses dimulai saat petugas mengambil tiket.</p></Card.Content></Card.Root>
			</aside>
		</div>
	{/if}
</section>

<style>
	.form-page { display:grid; gap:1rem; }
	.back-link { display:inline-flex; width:fit-content; min-height:2.75rem; align-items:center; gap:.45rem; color:var(--muted-foreground); font-size:var(--type-sm); text-decoration:none; }
	.back-link:hover { color:var(--foreground); }
	.back-link:focus-visible { outline:3px solid var(--ring); outline-offset:2px; }
	.form-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(16rem,.62fr); align-items:start; gap:1rem; }
	:global(.form-fields) { gap:1.1rem; }
	.destination { display:flex; align-items:flex-start; gap:.6rem; padding:.8rem .9rem; border:1px solid var(--border); border-radius:.5rem; background:var(--muted); font-size:var(--type-sm); line-height:1.5; }
	.destination :global(svg) { margin-top:.08rem; }
	.route-summary { display:grid; min-width:0; gap:.35rem; padding:.85rem .95rem; border-left:3px solid var(--primary); border-radius:var(--radius); background:var(--muted); }
	.route-summary strong { font-size:var(--type-sm); }
	.route-summary span { color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.55; overflow-wrap:anywhere; }
	.credit-guidance { display:grid; gap:.3rem; padding:.8rem .9rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--muted); }
	.credit-guidance strong { font-size:var(--type-sm); }
	.credit-guidance span { color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.letter-fields { display:grid; min-width:0; gap:.8rem; margin:0; padding:.9rem; border:1px solid var(--border); border-radius:var(--radius); }
	.letter-fields legend { padding:0 .35rem; color:var(--foreground); font-size:var(--type-sm); font-weight:600; }
	.letter-fields legend span { color:var(--muted-foreground); font-weight:400; }
	.letter-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.9rem; }
	.letter-upload { grid-column:1 / -1; }
	:global(.file-input) { height:auto; padding:.45rem .6rem; }
	.selected-file { display:flex; flex-wrap:wrap; align-items:center; gap:.25rem .5rem; margin:0; color:var(--muted-foreground); font-size:var(--type-xs); overflow-wrap:anywhere; }
	:global(.clear-file) { min-height:2rem; padding:.25rem .4rem; }
	.field { display:grid; gap:.45rem; min-width:0; }
	.field label, .field-label, .field-set legend { color:var(--foreground); font-size:var(--type-sm); font-weight:550; }
	.field label span, .field-label > span, .field-set legend span { color:var(--destructive); }
	.field-set { min-width:0; margin:0; padding:0; border:0; }
	.field-set legend { margin-bottom:.45rem; }
	.authority-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.6rem; }
	.authority-option { display:flex; min-height:4.25rem; align-items:center; gap:.65rem; padding:.65rem .75rem; border:1px solid var(--border); border-radius:.5rem; cursor:pointer; }
	.authority-option.chosen { border-color:#009b55; background:#00c972; color:#062b18; box-shadow:inset 0 0 0 1px #009b55; }
	.authority-option.chosen strong, .authority-option.chosen small { color:#062b18; }
	.authority-option input { width:1rem; height:1rem; accent-color:var(--ring); }
	.authority-option span { display:grid; gap:.2rem; }
	.authority-option strong { font-size:var(--type-sm); }
	.authority-option small, .field-hint { color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.field-hint { margin:0; }
	.repeatable-entries { display:grid; gap:.8rem; }
	.repeatable-entry { display:grid; min-width:0; gap:.75rem; margin:0; padding:.9rem; border:1px solid var(--border); border-radius:var(--radius); }
	.repeatable-entry legend { padding:0 .35rem; color:var(--foreground); font-size:var(--type-sm); font-weight:600; }
	.repeatable-entry-fields { display:grid; gap:1rem; }
	:global(.remove-entry) { justify-self:end; }
	:global(.add-entry) { justify-self:start; }
	:global(.form-actions) { display:flex; justify-content:flex-end; gap:.6rem; border-top:1px solid var(--border); padding-top:1rem; }
	.aside-stack { display:grid; gap:.8rem; }
	:global(.flow-copy) { gap:.7rem; }
	:global(.flow-copy p) { display:flex; align-items:flex-start; gap:.55rem; margin:0; color:var(--muted-foreground); font-size:var(--type-sm); line-height:1.55; }
	:global(.flow-copy span) { display:grid; width:1.4rem; height:1.4rem; flex:0 0 auto; place-items:center; border:1px solid var(--border); border-radius:50%; color:var(--foreground); font-size:var(--type-xs); }
	@media(max-width:800px) { .form-layout { grid-template-columns:minmax(0,1fr); } }
	@media(max-width:520px) { .authority-options, .letter-grid { grid-template-columns:minmax(0,1fr); } .letter-upload { grid-column:auto; } :global(.remove-entry),:global(.add-entry) { width:100%; } :global(.form-actions) { flex-direction:column-reverse; } :global(.form-actions button), :global(.form-actions a) { width:100%; } }
</style>
