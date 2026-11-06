<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import { fetchRequests, formatDate, formatElapsed, statusLabels, type RequestSummary } from '#lib/features/requests/requests.api.js';
	import { ArrowRight, Clock3, FilePlus2, Inbox } from '@lucide/svelte';

	let requests = $state<RequestSummary[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state('');
	let token = $state<string | null>(null);

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; });
		void load();
		return unsubscribe;
	});

	async function load(): Promise<void> {
		if (!token) { await goto('/'); return; }
		isLoading = true; errorMessage = '';
		try { requests = (await fetchRequests(token)).data.requests; }
		catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Daftar belum dapat dimuat. Periksa koneksi lalu coba lagi.';
		}
		finally { isLoading = false; }
	}
</script>

<svelte:head><title>Pengajuan Cabang | Sistem SLA</title></svelte:head>

<section class="app-page-stack" aria-labelledby="page-title">
	<AppPageHeading eyebrow="Cabang" title="Pengajuan" description="Umur tiket berjalan sejak dikirim; waktu proses Korwil dimulai setelah tiket diambil." flush>
		{#snippet actions()}
			<Button href="/requests/new" class="min-h-11"><FilePlus2 class="size-4" aria-hidden="true" />Buat pengajuan</Button>
		{/snippet}
	</AppPageHeading>

	{#if isLoading}
		<Card.Root role="status" aria-live="polite"><Card.Content class="flex min-h-28 items-center gap-3"><Clock3 class="size-5 text-muted-foreground" aria-hidden="true" /><p class="m-0 text-muted-foreground">Memuat daftar pengajuan…</p></Card.Content></Card.Root>
	{:else if errorMessage}
		<Alert.Root variant="destructive"><Alert.Title>Daftar belum dapat dimuat</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void load()}>Coba lagi</Button></Alert.Action></Alert.Root>
	{:else if requests.length === 0}
		<Card.Root><Card.Content class="empty-state"><Inbox class="size-5 text-muted-foreground" aria-hidden="true" /><h2>Belum ada pengajuan</h2><p>Pengajuan yang kamu kirim akan muncul di sini beserta nomor dan status prosesnya.</p><Button href="/requests/new" variant="outline" class="min-h-11">Buat pengajuan pertama <ArrowRight class="size-4" aria-hidden="true" /></Button></Card.Content></Card.Root>
	{:else}
		<div class="request-list" aria-label="Daftar pengajuan">
			{#each requests as item (item.id)}
				<Card.Root class="request-card">
					<Card.Header class="request-header">
						<div class="request-copy"><p class="request-number">{item.request_number} <span>·</span> {formatDate(item.submitted_at)}</p><Card.Title class="break-words text-base">{item.subject}</Card.Title><Card.Description class="break-words">{item.nama_kantor} · Korwil {item.korwil}</Card.Description></div>
						<Badge variant={item.status.startsWith('in_progress') ? 'default' : 'secondary'}>{statusLabels[item.status] ?? item.status}</Badge>
					</Card.Header>
						<Card.Content class="request-footer"><div class="metadata"><span>{item.authority_type === 'central' ? `${item.nama_divisi ?? 'Pusat'} · ${item.nama_pekerjaan ?? 'Jenis pekerjaan'}` : 'Kewenangan Korwil'}</span><span><Clock3 class="size-3.5" aria-hidden="true" />{item.status === 'waiting_korwil' && item.active_elapsed_seconds === null ? 'Korwil · menunggu diambil' : `${item.current_unit_type === 'korwil' ? `Korwil ${item.current_unit_code}` : item.current_unit_type === 'central' ? `Divisi ${item.nama_divisi ?? item.current_unit_code}` : `Cabang ${item.current_unit_code}`} · ${formatElapsed(item.active_elapsed_seconds)}`}</span><span>Total umur tiket · {formatElapsed(Number(item.overall_elapsed_seconds))}</span></div><Button variant="outline" class="min-h-11 w-full sm:w-auto" href={`/requests/${item.id}`}>Lihat detail <ArrowRight class="size-4" aria-hidden="true" /></Button></Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</section>

<style>
	.request-list { display:grid; gap:.85rem; }
	:global(.request-card) { min-width:0; }
	:global(.request-header) { grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:1rem; }
	.request-copy { min-width:0; display:grid; gap:.4rem; }
	.request-number { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); }
	.request-number span { padding:0 .2rem; }
	:global(.request-footer) { flex-direction:row; align-items:center; justify-content:space-between; gap:1rem; }
	.metadata { display:grid; gap:.45rem; color:var(--muted-foreground); font-size:var(--type-sm); }
	.metadata span { display:flex; align-items:center; gap:.4rem; }
	:global(.empty-state) { min-height:clamp(12rem, 25vw, 18rem); align-items:center; justify-content:center; text-align:center; }
	:global(.empty-state h2) { margin:0; font-size:var(--type-lg); }
	:global(.empty-state p) { max-width:27rem; margin:0 0 .5rem; color:var(--muted-foreground); line-height:1.6; }
	@media(max-width:640px) { :global(.app-page-heading-action a) { width:100%; } :global(.request-header) { grid-template-columns:minmax(0,1fr); } :global(.request-footer) { flex-direction:column; align-items:stretch; } }
</style>
