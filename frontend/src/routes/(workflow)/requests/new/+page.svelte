<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import { createRequest, fetchRequestOptions, type RequestOptions } from '#lib/features/requests/requests.api.js';
	import { ArrowLeft, Building2, CircleAlert, Send } from '@lucide/svelte';

	let token = $state<string | null>(null);
	let options = $state<RequestOptions | null>(null);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let errorMessage = $state('');
	let authorityType = $state('korwil');
	let divisionId = $state('');
	let catalogId = $state('');
	let subject = $state('');
	let description = $state('');
	let workCatalogs = $derived(options?.work_catalogs.filter((item) => String(item.divisi_id) === divisionId) ?? []);

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

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!token) { await goto('/'); return; }
		isSaving = true; errorMessage = '';
		try {
			const result = await createRequest(token, {
				authority_type: authorityType as 'korwil' | 'central',
				central_division_id: authorityType === 'central' ? Number(divisionId) : null,
				work_catalog_id: authorityType === 'central' ? Number(catalogId) : null,
				subject: subject.trim(), description: description.trim()
			});
			await goto(`/requests/${result.data.id}`);
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Pengajuan belum berhasil dikirim. Coba lagi.';
		} finally { isSaving = false; }
	}
</script>

<svelte:head><title>Buat Pengajuan | Sistem SLA</title></svelte:head>

<section class="form-page app-page-stack" aria-labelledby="page-title">
	<a class="back-link" href="/requests"><ArrowLeft class="size-4" aria-hidden="true" />Kembali ke pengajuan</a>
	<div class="app-page-heading app-page-heading--flush"><div class="app-page-heading-copy"><p class="app-page-kicker">Pengajuan Cabang</p><div class="app-page-title-row"><h1 id="page-title" class="app-page-title">Buat pengajuan</h1><p class="app-page-description">Isi informasi utama. Sistem mengirim semua pengajuan lebih dulu ke Korwil sesuai kantor kamu.</p></div></div></div>

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
						<div class="destination"><Building2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>Dikirim ke Korwil <strong>{options.office.korwil}</strong> · Cabang <strong>{options.office.kode_kantor}</strong></span></div>
						<div class="field"><label for="subject">Perihal <span aria-hidden="true">*</span></label><Input id="subject" bind:value={subject} required minlength={3} maxlength={200} class="min-h-11" placeholder="Contoh: Permohonan persetujuan lelang" /></div>
						<fieldset class="field-set"><legend>Kewenangan tujuan <span aria-hidden="true">*</span></legend><div class="authority-options">
							<label class:chosen={authorityType === 'korwil'} class="authority-option"><input type="radio" name="authority" value="korwil" bind:group={authorityType} /><span><strong>Korwil</strong><small>Ditangani di tingkat Korwil</small></span></label>
							<label class:chosen={authorityType === 'central'} class="authority-option"><input type="radio" name="authority" value="central" bind:group={authorityType} /><span><strong>Pusat</strong><small>Diperiksa Korwil, lalu divisi tujuan</small></span></label>
						</div></fieldset>
						{#if authorityType === 'central'}
							<div class="field"><span id="division-label" class="field-label">Divisi Pusat <span aria-hidden="true">*</span></span><Select.Root type="single" bind:value={divisionId} onValueChange={(value) => { divisionId = value; catalogId = ''; }}><Select.Trigger id="division-select" class="min-h-11 w-full" aria-labelledby="division-label"><Select.Value placeholder="Pilih divisi tujuan" /></Select.Trigger><Select.Content>{#each options.divisions as division (division.id)}<Select.Item value={String(division.id)} label={division.nama_divisi}>{division.nama_divisi}</Select.Item>{/each}</Select.Content></Select.Root></div>
							<div class="field"><span id="catalog-label" class="field-label">Jenis pekerjaan <span aria-hidden="true">*</span></span><Select.Root type="single" bind:value={catalogId} disabled={!divisionId}><Select.Trigger id="catalog-select" class="min-h-11 w-full" aria-labelledby="catalog-label"><Select.Value placeholder={divisionId ? 'Pilih jenis pekerjaan' : 'Pilih divisi lebih dulu'} /></Select.Trigger><Select.Content>{#each workCatalogs as item (item.id)}<Select.Item value={String(item.id)} label={item.nama_pekerjaan}>{item.nama_pekerjaan}</Select.Item>{/each}</Select.Content></Select.Root>{#if divisionId && workCatalogs.length === 0}<p class="field-hint">Belum ada jenis pekerjaan aktif untuk divisi ini. Minta Admin menambahkannya.</p>{/if}</div>
						{/if}
						<div class="field"><label for="description">Uraian <span aria-hidden="true">*</span></label><Textarea id="description" bind:value={description} required minlength={3} maxlength={5000} rows={6} placeholder="Jelaskan latar belakang dan hal yang diminta." /><p class="field-hint">Maksimal 5.000 karakter.</p></div>
						{#if errorMessage}<Alert.Root variant="destructive"><Alert.Title>Pengajuan belum terkirim</Alert.Title><Alert.Description>{errorMessage}</Alert.Description></Alert.Root>{/if}
					</Card.Content>
					<Card.Footer class="form-actions"><Button variant="outline" class="min-h-11" href="/requests">Batal</Button><Button type="submit" class="min-h-11" disabled={isSaving || (authorityType === 'central' && (!divisionId || !catalogId))}>{#if isSaving}Mengirim…{:else}<Send class="size-4" aria-hidden="true" />Kirim ke Korwil{/if}</Button></Card.Footer>
				</Card.Root>
			</form>
			<aside class="aside-stack" aria-label="Informasi alur dan batasan form">
				<Card.Root><Card.Header><Card.Title class="text-base">Alur setelah dikirim</Card.Title></Card.Header><Card.Content class="flow-copy"><p><span>1</span> Waktu antrean dicatat, tetapi timer Korwil dimulai saat pengajuan diambil.</p><p><span>2</span> Korwil mengambil dan memeriksa pengajuan.</p><p><span>3</span> Jika tujuan Pusat, tiket masuk antrean divisi dan timer Pusat dimulai saat diambil.</p></Card.Content></Card.Root>
				<Alert.Root><CircleAlert class="size-4" aria-hidden="true" /><Alert.Title>Form tahap awal</Alert.Title><Alert.Description>Form ini baru mencatat perihal dan uraian umum. Field khusus dan persyaratan lampiran tiap pekerjaan belum dikonfigurasi; jangan gunakan untuk pengajuan resmi yang mensyaratkan data atau dokumen khusus.</Alert.Description></Alert.Root>
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
	.field { display:grid; gap:.45rem; min-width:0; }
	.field label, .field-label, .field-set legend { color:var(--foreground); font-size:var(--type-sm); font-weight:550; }
	.field label span, .field-label > span, .field-set legend span { color:var(--destructive); }
	.field-set { min-width:0; margin:0; padding:0; border:0; }
	.field-set legend { margin-bottom:.45rem; }
	.authority-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.6rem; }
	.authority-option { display:flex; min-height:4.25rem; align-items:center; gap:.65rem; padding:.65rem .75rem; border:1px solid var(--border); border-radius:.5rem; cursor:pointer; }
	.authority-option.chosen { border-color:var(--ring); background:color-mix(in srgb,var(--primary) 6%,var(--card)); }
	.authority-option input { width:1rem; height:1rem; accent-color:var(--primary); }
	.authority-option span { display:grid; gap:.2rem; }
	.authority-option strong { font-size:var(--type-sm); }
	.authority-option small, .field-hint { color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.field-hint { margin:0; }
	:global(.form-actions) { display:flex; justify-content:flex-end; gap:.6rem; border-top:1px solid var(--border); padding-top:1rem; }
	.aside-stack { display:grid; gap:.8rem; }
	:global(.flow-copy) { gap:.7rem; }
	:global(.flow-copy p) { display:flex; align-items:flex-start; gap:.55rem; margin:0; color:var(--muted-foreground); font-size:var(--type-sm); line-height:1.55; }
	:global(.flow-copy span) { display:grid; width:1.4rem; height:1.4rem; flex:0 0 auto; place-items:center; border:1px solid var(--border); border-radius:50%; color:var(--foreground); font-size:var(--type-xs); }
	@media(max-width:800px) { .form-layout { grid-template-columns:minmax(0,1fr); } }
	@media(max-width:520px) { .authority-options { grid-template-columns:minmax(0,1fr); } :global(.form-actions) { flex-direction:column-reverse; } :global(.form-actions button), :global(.form-actions a) { width:100%; } }
</style>
