<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { ArrowRight, Building2, Clock3, Inbox, LoaderCircle, RefreshCcw } from '@lucide/svelte';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import { fetchBranchFollowUp, type BranchFollowUpData, type SlaStatus } from '#lib/features/dashboard/dashboard.api.js';
	import { formatDate, formatElapsed, slaStatusLabels, statusLabels } from '#lib/features/requests/requests.api.js';

	let data = $state<BranchFollowUpData | null>(null);
	let selectedOffice = $state('all');
	let token = $state<string | null>(null);
	let isLoading = $state(true);
	let errorMessage = $state('');
	let officeFilterItems = $derived([
		{ value: 'all', label: 'Semua Cabang' },
		...(data?.options.offices ?? []).map((office) => ({
			value: office.kode_kantor,
			label: `${office.kode_kantor} · ${office.nama_kantor}`
		}))
	]);

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; });
		void load();
		return unsubscribe;
	});

	async function load(): Promise<void> {
		if (!token) { await goto('/'); return; }
		isLoading = true;
		errorMessage = '';
		try {
			const profile = await fetchCurrentProfile(token);
			updateProfile(profile);
			if (!['management', 'supervisor', 'admin'].includes(profile.sla_access.role ?? '') || profile.sla_access.scope !== 'all') {
				await goto('/dashboard');
				return;
			}
			data = (await fetchBranchFollowUp(token, selectedOffice === 'all' ? undefined : selectedOffice)).data;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Daftar tindak lanjut Cabang belum dapat dimuat.';
		} finally { isLoading = false; }
	}

	function applyFilter(event: SubmitEvent): void {
		event.preventDefault();
		void load();
	}

	function clearFilter(): void {
		selectedOffice = 'all';
		void load();
	}

	function slaClass(status: SlaStatus): string { return `sla-badge sla-badge--${status}`; }
</script>

<svelte:head><title>Tindak Lanjut Cabang | Sistem SLA Pengajuan</title></svelte:head>

<main id="main-content" class="follow-up-page">
	<AppNavbar />
	<section class="app-page-shell follow-up-content" aria-labelledby="page-title">
		<AppPageHeading eyebrow="Pemantauan Manajemen" title="Tiket menunggu Cabang" description="Pantau kelengkapan yang diminta Korwil atau Divisi Pusat dan kondisi SLA setiap Cabang.">
			{#snippet actions()}{#if data}<Badge variant="outline"><Inbox class="size-3.5" aria-hidden="true" />{data.summary.total} tiket</Badge>{/if}{/snippet}
		</AppPageHeading>

		<Card.Root class="filter-card"><Card.Header><Card.Title class="text-base">Filter Cabang</Card.Title><Card.Description>Daftar hanya berisi tiket yang sedang menunggu jawaban atau pelengkapan dari Cabang.</Card.Description></Card.Header><Card.Content><form class="filter-form" onsubmit={applyFilter}><div class="filter-field"><Label for="office-filter">Cabang</Label><Select.Root type="single" items={officeFilterItems} bind:value={selectedOffice}><Select.Trigger id="office-filter" class="min-h-11 w-full border-input"><Select.Value placeholder="Semua Cabang" /></Select.Trigger><Select.Content>{#each officeFilterItems as item (item.value)}<Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>{/each}</Select.Content></Select.Root></div><div class="filter-actions"><Button type="submit" class="min-h-11" disabled={isLoading}><RefreshCcw class="size-4" aria-hidden="true" />Terapkan</Button><Button type="button" variant="outline" class="min-h-11" onclick={clearFilter} disabled={isLoading || selectedOffice === 'all'}>Reset</Button></div></form></Card.Content></Card.Root>

		{#if isLoading}
			<Card.Root role="status" aria-live="polite"><Card.Content class="loading-state"><LoaderCircle class="size-5 animate-spin" aria-hidden="true" /><p>Memuat tiket Cabang...</p></Card.Content></Card.Root>
		{:else if errorMessage}
			<Alert.Root variant="destructive"><Alert.Title>Daftar belum dapat dimuat</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void load()}>Coba lagi</Button></Alert.Action></Alert.Root>
		{:else if data}
			<div class="sla-context" role="status"><div><span>Target SLA</span><strong>7 hari kalender</strong></div><div><span>Hijau</span><strong>{data.sla.counts.safe} tiket</strong></div><div><span>Kuning</span><strong>{data.sla.counts.warning} tiket</strong></div><div><span>Merah</span><strong>{data.sla.counts.overdue} tiket</strong></div></div>
			<Card.Root><Card.Header class="list-header"><div><Card.Title class="text-base">Perlu ditindaklanjuti</Card.Title><Card.Description>Tiket kembali ke unit yang meminta setelah Cabang mengirim jawaban.</Card.Description></div><Badge variant="outline">{data.requests.length} ditampilkan</Badge></Card.Header><Card.Content>
				{#if data.requests.length === 0}<div class="empty-state"><Inbox class="size-5" aria-hidden="true" /><h2>Tidak ada tiket menunggu Cabang</h2><p>Semua tiket pada filter ini sudah berada di unit tindak lanjut atau belum menerima permintaan kelengkapan.</p></div>
				{:else}<div class="request-list">{#each data.requests as item (item.id)}<article class="request-row"><div class="request-main"><p class="request-number">{item.request_number} · {formatDate(item.submitted_at)}</p><h2>{item.subject}</h2><p>{item.nama_kantor} · {item.korwil}{#if item.nama_divisi} · {item.nama_divisi}{/if}</p></div><div class="request-status"><Badge variant="outline">{statusLabels[item.status] ?? item.status}</Badge><Badge variant="outline" class={slaClass(item.sla_status)}>{slaStatusLabels[item.sla_status]}</Badge><span>Umur {formatElapsed(item.overall_elapsed_seconds)}</span></div><Button variant="outline" class="min-h-11" href={`/requests/${item.id}`}>Detail <ArrowRight class="size-4" aria-hidden="true" /></Button></article>{/each}</div>{/if}
			</Card.Content></Card.Root>
		{/if}
	</section>
</main>

<style>
	.follow-up-page { min-height:100svh; background:var(--muted); color:var(--foreground); }
	.follow-up-content { display:grid; align-content:start; gap:1rem; }
	:global(.filter-card) { box-shadow:none; }
	.filter-form { display:grid; grid-template-columns:minmax(0,22rem) auto; align-items:end; gap:.75rem; }
	.filter-field { display:grid; gap:.45rem; }
	.filter-actions { display:flex; flex-wrap:wrap; gap:.5rem; }
	.sla-context { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.75rem; padding:.85rem 1rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--background); }
	.sla-context div { display:grid; gap:.2rem; }
	.sla-context span { color:var(--muted-foreground); font-size:var(--type-xs); }
	.sla-context strong { font-size:var(--type-sm); }
	:global(.list-header) { display:flex; flex-direction:row; align-items:flex-start; justify-content:space-between; gap:1rem; }
	.request-list { display:grid; gap:.65rem; }
	.request-row { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(12rem,.8fr) auto; align-items:center; gap:1rem; padding:.85rem 0; border-bottom:1px solid var(--border); }
	.request-row:last-child { border-bottom:0; }
	.request-main { min-width:0; display:grid; gap:.25rem; }
	.request-main h2 { margin:0; font-size:var(--type-base); line-height:1.35; overflow-wrap:anywhere; }
	.request-main p, .request-number, .request-status span { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.45; }
	.request-main > p:last-child { font-size:var(--type-sm); }
	.request-status { display:grid; justify-items:start; gap:.35rem; }
	.empty-state, :global(.loading-state) { display:grid; min-height:10rem; place-items:center; align-content:center; gap:.55rem; color:var(--muted-foreground); text-align:center; }
	.empty-state h2, .empty-state p, :global(.loading-state p) { margin:0; }
	.empty-state h2 { color:var(--foreground); font-size:var(--type-lg); }
	.empty-state p { max-width:32rem; line-height:1.55; }
	@media(max-width:52rem) { .request-row { grid-template-columns:minmax(0,1fr) auto; } .request-status { grid-column:1; } .request-row > :global(a) { grid-column:2; grid-row:1 / span 2; } }
	@media(max-width:38rem) { .filter-form, .sla-context { grid-template-columns:1fr; } .filter-actions { display:grid; grid-template-columns:1fr 1fr; } .filter-actions :global(button) { width:100%; } .request-row { grid-template-columns:1fr; } .request-status, .request-row > :global(a) { grid-column:auto; grid-row:auto; } .request-row > :global(a) { width:100%; } :global(.list-header) { flex-direction:column; } }
	@media(max-width:24rem) { .filter-actions { grid-template-columns:1fr; } }
</style>
