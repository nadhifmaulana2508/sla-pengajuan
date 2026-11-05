<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import { claimCentral, fetchCentralHistory, fetchCentralInbox, formatDate, formatElapsed, statusLabels, type RequestSummary } from '#lib/features/requests/requests.api.js';
	import { ArrowRight, Clock3, History, Inbox, Landmark, LoaderCircle } from '@lucide/svelte';

	let token = $state<string | null>(null);
	let requests = $state<RequestSummary[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state('');
	let notice = $state('');
	let claimingId = $state<number | null>(null);
	let view = $state<'active' | 'history'>('active');

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; });
		void load();
		return unsubscribe;
	});

	async function load(): Promise<void> {
		if (!token) { await goto('/'); return; }
		isLoading = true;
		errorMessage = '';
		try { requests = (await (view === 'active' ? fetchCentralInbox(token) : fetchCentralHistory(token))).data.requests; }
		catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Antrean belum dapat dimuat. Periksa koneksi lalu coba lagi.';
		}
		finally { isLoading = false; }
	}

	async function changeView(next: 'active' | 'history'): Promise<void> {
		if (view === next) return;
		view = next;
		requests = [];
		notice = '';
		await load();
	}

	async function claim(item: RequestSummary): Promise<void> {
		if (!token) { await goto('/'); return; }
		claimingId = item.id;
		errorMessage = '';
		notice = '';
		try {
			await claimCentral(token, item.id);
			notice = `${item.request_number} berhasil diambil.`;
			await load();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Pengajuan belum dapat diambil. Muat ulang antrean.';
		} finally { claimingId = null; }
	}
</script>

<svelte:head><title>Antrean Divisi Pusat | Sistem SLA</title></svelte:head>

<section class="app-page-stack" aria-labelledby="page-title">
	<div class="app-page-heading app-page-heading--flush">
		<div class="app-page-heading-copy"><p class="app-page-kicker">Divisi Pusat</p><div class="app-page-title-row"><h1 id="page-title" class="app-page-title">Antrean pengajuan</h1><p class="app-page-description">Pengajuan yang diteruskan Korwil ke divisi sesuai profil SSO kamu.</p></div></div>
		<div class="app-page-heading-action"><Badge variant="outline"><Clock3 class="mr-1 size-3.5" aria-hidden="true" />SLA sejak diambil</Badge></div>
	</div>
	<div class="view-switch" role="group" aria-label="Tampilan pengajuan Divisi Pusat">
		<Button variant={view === 'active' ? 'secondary' : 'ghost'} class="min-h-11" aria-pressed={view === 'active'} onclick={() => void changeView('active')}><Inbox class="size-4" aria-hidden="true" />Aktif</Button>
		<Button variant={view === 'history' ? 'secondary' : 'ghost'} class="min-h-11" aria-pressed={view === 'history'} onclick={() => void changeView('history')}><History class="size-4" aria-hidden="true" />Riwayat</Button>
	</div>
	<p class="view-description">{view === 'active' ? 'Pengajuan yang saat ini menunggu atau sedang ditangani divisi kamu.' : 'Pengajuan yang sudah berpindah dari antrean divisi. Status dan lokasi terkininya tetap ditampilkan.'}</p>
	{#if notice}<Alert.Root><Alert.Title>Pengajuan diambil</Alert.Title><Alert.Description>{notice}</Alert.Description></Alert.Root>{/if}
	{#if errorMessage}<Alert.Root variant="destructive"><Alert.Title>{requests.length ? 'Tindakan belum berhasil' : 'Antrean belum dapat dimuat'}</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void load()}>Muat ulang</Button></Alert.Action></Alert.Root>{/if}
	{#if isLoading}
		<Card.Root role="status" aria-live="polite"><Card.Content class="flex min-h-28 items-center gap-3"><LoaderCircle class="size-4 animate-spin text-muted-foreground" aria-hidden="true" /><p class="m-0 text-muted-foreground">Memuat antrean…</p></Card.Content></Card.Root>
	{:else if !errorMessage && requests.length === 0 && view === 'history'}
		<Card.Root><Card.Content class="empty-state"><History class="size-5 text-muted-foreground" aria-hidden="true" /><h2>Belum ada riwayat divisi</h2><p>Tiket yang pernah masuk ke Divisi Pusat akan tampil setelah berpindah ke unit lain atau ditutup.</p></Card.Content></Card.Root>
	{:else if !errorMessage && requests.length === 0}
		<Card.Root><Card.Content class="empty-state"><Landmark class="size-5 text-muted-foreground" aria-hidden="true" /><h2>Antrean sedang kosong</h2><p>Pengajuan untuk divisi kamu akan muncul setelah diteruskan oleh Korwil.</p></Card.Content></Card.Root>
	{:else if requests.length > 0 && view === 'history'}
		<div class="request-list">
			{#each requests as item (item.id)}
				<Card.Root class="request-card">
					<Card.Header class="request-header"><div class="request-copy"><p class="request-number">{item.request_number} · {formatDate(item.submitted_at)}</p><Card.Title class="break-words text-base">{item.subject}</Card.Title><Card.Description>{item.nama_kantor} · Korwil {item.korwil}</Card.Description></div><Badge variant="outline">{statusLabels[item.status] ?? item.status}</Badge></Card.Header>
					<Card.Content class="request-footer"><div class="metadata"><span>{item.nama_divisi ?? 'Divisi Pusat'} · {item.nama_pekerjaan ?? 'Jenis pekerjaan'}</span><span><Clock3 class="size-3.5" aria-hidden="true" />Umur total · {formatElapsed(Number(item.overall_elapsed_seconds))}</span><span>Lokasi sekarang · {item.current_unit_type === 'central' ? item.nama_divisi ?? 'Divisi Pusat' : item.current_unit_type === 'korwil' ? `Korwil ${item.current_unit_code}` : `Cabang ${item.nama_kantor}`}</span></div><div class="actions"><Button variant="outline" class="min-h-11" href={`/requests/${item.id}`}>Detail <ArrowRight class="size-4" aria-hidden="true" /></Button></div></Card.Content>
				</Card.Root>
			{/each}
		</div>
	{:else if requests.length > 0}
		<div class="request-list">
			{#each requests as item (item.id)}
				<Card.Root class="request-card">
					<Card.Header class="request-header"><div class="request-copy"><p class="request-number">{item.request_number} · {formatDate(item.submitted_at)}</p><Card.Title class="break-words text-base">{item.subject}</Card.Title><Card.Description>{item.nama_kantor} · Korwil {item.korwil}</Card.Description></div><Badge variant={item.status === 'waiting_central' ? 'secondary' : 'default'}>{statusLabels[item.status] ?? item.status}</Badge></Card.Header>
					<Card.Content class="request-footer"><div class="metadata"><span>{item.nama_divisi ?? 'Divisi Pusat'} · {item.nama_pekerjaan ?? 'Jenis pekerjaan'}</span><span><Clock3 class="size-3.5" aria-hidden="true" />{item.status === 'waiting_central' && item.active_elapsed_seconds === null ? 'Menunggu diambil · timer belum mulai' : `Sejak diambil · ${formatElapsed(item.active_elapsed_seconds)}`}</span></div><div class="actions"><Button variant="outline" class="min-h-11" href={`/requests/${item.id}`}>Detail <ArrowRight class="size-4" aria-hidden="true" /></Button>{#if item.status === 'waiting_central'}<Button class="min-h-11" disabled={claimingId !== null} onclick={() => void claim(item)}>{#if claimingId === item.id}<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Mengambil…{:else}<Inbox class="size-4" aria-hidden="true" />Ambil pengajuan{/if}</Button>{/if}</div></Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</section>

<style>
	.request-list { display:grid; gap:.85rem; }
	.view-switch { display: flex; width: max-content; max-width: 100%; gap: .2rem; border-bottom: 1px solid var(--border); }
	.view-description { margin: -.35rem 0 0; color: var(--muted-foreground); font-size: var(--type-sm); line-height: 1.5; }
	:global(.request-card) { min-width:0; }
	:global(.request-header) { grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:1rem; }
	.request-copy { min-width:0; display:grid; gap:.4rem; }
	.request-number { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); }
	:global(.request-footer) { flex-direction:row; align-items:center; justify-content:space-between; gap:1rem; }
	.metadata { display:grid; gap:.45rem; color:var(--muted-foreground); font-size:var(--type-sm); }
	.metadata span { display:flex; align-items:center; gap:.4rem; }
	.actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.5rem; }
	:global(.empty-state) { min-height:clamp(12rem, 25vw, 18rem); align-items:center; justify-content:center; text-align:center; }
	:global(.empty-state h2) { margin:0; font-size:var(--type-lg); }
	:global(.empty-state p) { max-width:27rem; margin:0; color:var(--muted-foreground); line-height:1.6; }
	@media(max-width:640px) { .view-switch { display: grid; width: 100%; grid-template-columns: 1fr 1fr; } :global(.request-header) { grid-template-columns:minmax(0,1fr); } :global(.request-footer) { flex-direction:column; align-items:stretch; } .actions { display:grid; grid-template-columns:1fr; } }
</style>
