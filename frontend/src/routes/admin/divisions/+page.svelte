<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { updateAdminDivision, fetchAdminMasterData, type AdminDivision } from '#lib/features/admin/admin.api.js';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import { Building2, LoaderCircle, Pencil, X } from '@lucide/svelte';

	let divisions = $state<AdminDivision[]>([]);
	let selectedDivision = $state<AdminDivision | null>(null);
	let divisionName = $state('');
	let aliasText = $state('');
	let dialogOpen = $state(false);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let loadError = $state('');
	let formError = $state('');
	let statusMessage = $state('');

	onMount(() => {
		void loadDivisions();
	});

	async function loadDivisions(): Promise<void> {
		const token = $authSession.token;
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
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			loadError = error instanceof ApiError
				? error.message
				: 'Daftar divisi belum dapat dimuat. Periksa koneksi lalu coba lagi.';
		} finally {
			isLoading = false;
		}
	}

	function openEditor(division: AdminDivision): void {
		selectedDivision = division;
		divisionName = division.nama_divisi;
		aliasText = division.sso_unit_kerja_aliases.join('\n');
		formError = '';
		dialogOpen = true;
	}

	function closeEditor(): void {
		dialogOpen = false;
		selectedDivision = null;
		formError = '';
	}

	async function saveDivision(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!selectedDivision || isSaving) return;
		const name = divisionName.trim();
		if (!name) {
			formError = 'Nama divisi wajib diisi.';
			return;
		}

		const token = $authSession.token;
		if (!token) {
			clearAuthenticatedSession();
			await goto('/');
			return;
		}

		const aliases = aliasText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
		isSaving = true;
		formError = '';
		statusMessage = '';
		try {
			const result = await updateAdminDivision(token, selectedDivision.id, {
				nama_divisi: name,
				sso_unit_kerja_aliases: aliases
			});
			statusMessage = result.message;
			closeEditor();
			await loadDivisions();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			formError = error instanceof ApiError
				? error.message
				: 'Perubahan divisi belum tersimpan. Periksa koneksi lalu coba lagi.';
		} finally {
			isSaving = false;
		}
	}
</script>

<svelte:head>
	<title>Divisi Pusat | Sistem SLA Pengajuan</title>
	<meta name="description" content="Atur nama unit SSO yang dipetakan ke Divisi Pusat." />
</svelte:head>

<main id="main-content" class="admin-page">
	<AppNavbar />
	<section class="admin-content app-page-shell" aria-labelledby="page-title">
		<AppPageHeading eyebrow="Administrasi" title="Divisi Pusat" description="Cocokkan nama unit kerja dari SSO dengan divisi agar cakupan petugas terdeteksi otomatis." />

		{#if statusMessage}
			<p class="save-status" role="status" aria-live="polite">{statusMessage}</p>
		{/if}

		<Dialog.Root bind:open={dialogOpen}>
			<Card.Root size="sm" class="division-card" aria-labelledby="division-list-title">
				<Card.Header class="division-card-header">
					<div class="list-heading">
						<Building2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<div class="min-w-0">
							<Card.Title id="division-list-title">Daftar divisi</Card.Title>
							<Card.Description>Nama unit SSO menjadi alias pemetaan, bukan penetapan role pegawai.</Card.Description>
						</div>
					</div>
					{#if !isLoading && !loadError}<Badge variant="secondary">{divisions.length} divisi</Badge>{/if}
				</Card.Header>
				<Card.Content>
					{#if isLoading}
						<div class="state-panel" role="status" aria-live="polite">
							<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
							<strong>Memuat daftar divisi</strong>
							<p>Data divisi dan pemetaan unit SSO sedang diambil.</p>
						</div>
					{:else if loadError}
						<Alert.Root variant="destructive">
							<Alert.Title>Daftar divisi belum dapat dimuat</Alert.Title>
							<Alert.Description>{loadError}</Alert.Description>
							<Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void loadDivisions()}>Coba lagi</Button></Alert.Action>
						</Alert.Root>
					{:else if divisions.length === 0}
						<div class="state-panel">
							<strong>Master divisi belum tersedia</strong>
							<p>Periksa seed database atau hubungi pengelola Sistem SLA.</p>
						</div>
					{:else}
						<div class="desktop-table">
							<table>
								<caption class="sr-only">Daftar Divisi Pusat dan nama unit SSO yang dikenali</caption>
								<thead><tr><th scope="col">Divisi</th><th scope="col">Nama unit SSO</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Tindakan</span></th></tr></thead>
								<tbody>
									{#each divisions as division (division.id)}
										<tr>
											<th scope="row"><strong>{division.nama_divisi}</strong><small>{division.kode}</small></th>
											<td><span class="alias-summary">{division.sso_unit_kerja_aliases.join(', ') || 'Belum ada pemetaan'}</span></td>
											<td><Badge variant={division.is_active ? 'secondary' : 'outline'}>{division.is_active ? 'Aktif' : 'Nonaktif'}</Badge></td>
											<td class="action-cell"><Button variant="outline" class="min-h-11" onclick={() => openEditor(division)}><Pencil class="size-4" aria-hidden="true" />Ubah</Button></td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<div class="mobile-list">
							{#each divisions as division (division.id)}
								<Card.Root size="sm" class="division-row">
									<Card.Content class="division-row-content">
										<div class="row-heading"><div><h2>{division.nama_divisi}</h2><p>{division.kode}</p></div><Badge variant={division.is_active ? 'secondary' : 'outline'}>{division.is_active ? 'Aktif' : 'Nonaktif'}</Badge></div>
										<div class="alias-block"><span>Nama unit SSO</span><p>{division.sso_unit_kerja_aliases.join(', ') || 'Belum ada pemetaan'}</p></div>
										<Button variant="outline" class="min-h-11 w-full" onclick={() => openEditor(division)}><Pencil class="size-4" aria-hidden="true" />Ubah divisi</Button>
									</Card.Content>
								</Card.Root>
							{/each}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

			{#if selectedDivision}
				<Dialog.Content class="division-dialog" showCloseButton={false}>
					<Dialog.Header class="dialog-heading">
						<div>
							<Dialog.Title>Ubah pemetaan divisi</Dialog.Title>
							<Dialog.Description>Kode {selectedDivision.kode}. Role dan cakupan pegawai tetap mengikuti data akses dan profil SSO.</Dialog.Description>
						</div>
						<Button type="button" variant="ghost" size="icon-lg" class="min-h-11 min-w-11" aria-label="Tutup pemetaan divisi" title="Tutup" onclick={closeEditor}>
							<X class="size-4" aria-hidden="true" />
						</Button>
					</Dialog.Header>
					<form class="division-form" onsubmit={saveDivision}>
						<div class="field-group">
							<Label for="division-name">Nama divisi</Label>
							<Input id="division-name" bind:value={divisionName} maxlength={120} required class="min-h-11" />
						</div>
						<div class="field-group">
							<Label for="division-aliases">Nama unit kerja dari SSO</Label>
							<Textarea id="division-aliases" bind:value={aliasText} rows={5} maxlength={1500} aria-describedby="division-alias-help" class="min-h-28" />
							<p id="division-alias-help" class="field-help">Satu nama per baris. Tambahkan nama yang tampil pada profil pegawai, misalnya “Satuan Kerja Audit Internal” untuk SKAI. Nama lama tetap dikenali saat nama divisi diubah.</p>
						</div>
						{#if formError}
							<Alert.Root variant="destructive"><Alert.Title>Perubahan belum tersimpan</Alert.Title><Alert.Description>{formError}</Alert.Description></Alert.Root>
						{/if}
						<div class="form-actions">
							<Button type="button" variant="outline" class="min-h-11" onclick={closeEditor}>Batal</Button>
							<Button type="submit" class="min-h-11" disabled={isSaving}>
								{#if isSaving}<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Menyimpan...{:else}Simpan perubahan{/if}
							</Button>
						</div>
					</form>
				</Dialog.Content>
			{/if}
		</Dialog.Root>
	</section>
</main>

<style>
	.admin-page { min-height: 100svh; background: var(--muted); color: var(--foreground); }
	.admin-content { display: grid; align-content: start; grid-auto-rows: max-content; gap: 1rem; height: auto; min-height: 0; }
	:global(.admin-content > .app-page-heading) { margin-bottom: 0; }
	:global(.division-card) { min-width: 0; }
	:global(.division-card-header) { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.list-heading { display: flex; min-width: 0; align-items: flex-start; gap: .7rem; }
	.list-heading :global([data-slot='card-title']) { margin-bottom: .2rem; }
	.desktop-table { width: 100%; overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; text-align: left; }
	th, td { padding: .85rem .7rem; border-top: 1px solid var(--border); vertical-align: middle; }
	thead th { color: var(--muted-foreground); font-size: var(--type-xs); font-weight: 600; }
	tbody th { min-width: 9rem; font-weight: 500; }
	tbody th strong, tbody th small { display: block; }
	tbody th small { margin-top: .25rem; color: var(--muted-foreground); font-weight: 400; }
	td { color: var(--muted-foreground); font-size: var(--type-sm); }
	.alias-summary { display: block; max-width: 36rem; overflow-wrap: anywhere; }
	.action-cell { width: 1%; white-space: nowrap; text-align: right; }
	.mobile-list { display: none; }
	:global(.division-row-content) { display: grid; gap: .8rem; }
	.row-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: .6rem; }
	.row-heading h2 { margin: 0; font-size: var(--type-base); font-weight: 600; overflow-wrap: anywhere; }
	.row-heading p, .alias-block p { margin: .2rem 0 0; color: var(--muted-foreground); font-size: var(--type-sm); overflow-wrap: anywhere; }
	.alias-block span { color: var(--muted-foreground); font-size: var(--type-xs); }
	:global(.division-dialog) { width: min(36rem, calc(100vw - 2rem)); max-height: min(90svh, 48rem); overflow-y: auto; }
	:global(.dialog-heading) { display: flex; flex-direction: row; align-items: flex-start; justify-content: space-between; gap: .75rem; }
	.division-form { display: grid; gap: 1rem; }
	.field-group { display: grid; min-width: 0; gap: .45rem; }
	.field-help { margin: 0; color: var(--muted-foreground); font-size: var(--type-sm); line-height: 1.5; }
	.form-actions { display: flex; justify-content: flex-end; gap: .5rem; }
	.state-panel { display: grid; justify-items: center; gap: .65rem; padding: 2.5rem 1rem; text-align: center; }
	.state-panel p { max-width: 28rem; margin: 0; color: var(--muted-foreground); }
	.save-status { margin: 0; color: var(--primary); font-size: var(--type-base); }
	@media (max-width: 48rem) {
		.desktop-table { display: none; }
		.mobile-list { display: grid; gap: .65rem; }
		:global(.division-card-header) { align-items: flex-start; }
		.form-actions { display: grid; grid-template-columns: 1fr 1fr; }
	}
</style>
