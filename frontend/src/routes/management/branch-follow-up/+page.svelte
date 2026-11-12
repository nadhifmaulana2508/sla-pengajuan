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
	import { Popover } from 'bits-ui';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Inbox, ListFilter, LoaderCircle, RefreshCcw } from '@lucide/svelte';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import { fetchManagementRequests, type ManagementRequestsData, type SlaStatus } from '#lib/features/dashboard/dashboard.api.js';
	import { getDefaultDateRange } from '#lib/features/dashboard/date-range.js';
	import { formatDate, formatElapsed, slaStatusLabels, statusLabels } from '#lib/features/requests/requests.api.js';

	const pageSize = 5;
	const statusFilterItems = [
		{ value: 'all', label: 'Semua status' },
		...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))
	];
	const slaFilterItems = [
		{ value: 'all', label: 'Semua kondisi SLA' },
		{ value: 'safe', label: 'SLA aman' },
		{ value: 'warning', label: 'Mendekati SLA' },
		{ value: 'overdue', label: 'Melewati SLA' }
	];
	let data = $state<ManagementRequestsData | null>(null);
	let selectedOffice = $state('all');
	let selectedKorwil = $state('all');
	let selectedDivision = $state('all');
	let selectedStatus = $state('all');
	let selectedSlaStatus = $state('all');
	let defaultDateRange = $state(getDefaultDateRange());
	let fromDate = $state('');
	let toDate = $state('');
	let isFilterOpen = $state(false);
	let mobileView = $state<'tickets' | 'summary'>('tickets');
	let pageNumber = $state(1);
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
	let korwilFilterItems = $derived([
		{ value: 'all', label: 'Semua Korwil' },
		...(data?.options.korwils ?? []).map((korwil) => ({ value: korwil, label: `Korwil ${korwil}` }))
	]);
	let divisionFilterItems = $derived([
		{ value: 'all', label: 'Semua Divisi' },
		...(data?.options.divisions ?? []).map((division) => ({ value: String(division.id), label: division.nama_divisi }))
	]);
	let statusSummary = $derived(Object.entries(statusLabels).map(([status, label]) => ({
		status,
		label,
		count: data?.status_counts.find((item) => item.status === status)?.count ?? 0
	})));

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; });
		defaultDateRange = getDefaultDateRange();
		const params = new URLSearchParams(window.location.search);
		selectedOffice = params.get('kode_kantor') || 'all';
		selectedKorwil = params.get('korwil') || 'all';
		const divisionId = params.get('division_id');
		selectedDivision = divisionId && /^\d+$/.test(divisionId) ? divisionId : 'all';
		const status = params.get('status');
		if (status && statusFilterItems.some((item) => item.value === status)) selectedStatus = status;
		const slaStatus = params.get('sla_status');
		if (slaStatus && slaFilterItems.some((item) => item.value === slaStatus)) selectedSlaStatus = slaStatus;
		const from = params.get('from');
		const to = params.get('to');
		const validFrom = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
		const validTo = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
		if (validFrom) fromDate = validFrom;
		if (validTo) toDate = validTo;
		if (!validFrom && !validTo) {
			fromDate = defaultDateRange.from;
			toDate = defaultDateRange.to;
		}
		void load();
		return unsubscribe;
	});

	async function load(nextPage = pageNumber): Promise<void> {
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
			data = (await fetchManagementRequests(token, {
				kode_kantor: selectedOffice === 'all' ? undefined : selectedOffice,
				korwil: selectedKorwil === 'all' ? undefined : selectedKorwil,
				division_id: selectedDivision === 'all' ? undefined : Number(selectedDivision),
				status: selectedStatus,
				sla_status: selectedSlaStatus === 'all' ? undefined : selectedSlaStatus as SlaStatus,
				from: fromDate || undefined,
				to: toDate || undefined,
				page: nextPage,
				page_size: pageSize
			})).data;
			pageNumber = nextPage;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Pemantauan tiket belum dapat dimuat.';
		} finally { isLoading = false; }
	}

	function applyFilter(event: SubmitEvent): void {
		event.preventDefault();
		pageNumber = 1;
		isFilterOpen = false;
		mobileView = 'tickets';
		updateFilterUrl();
		void load(1);
	}

	function updateFilterUrl(): void {
		const params = new URLSearchParams();
		if (selectedOffice !== 'all') params.set('kode_kantor', selectedOffice);
		if (selectedKorwil !== 'all') params.set('korwil', selectedKorwil);
		if (selectedDivision !== 'all') params.set('division_id', selectedDivision);
		if (selectedStatus !== 'all') params.set('status', selectedStatus);
		if (selectedSlaStatus !== 'all') params.set('sla_status', selectedSlaStatus);
		if (fromDate) params.set('from', fromDate);
		if (toDate) params.set('to', toDate);
		const query = params.toString();
		void goto(`${window.location.pathname}${query ? `?${query}` : ''}`, { replaceState: true });
	}

	function clearFilter(): void {
		selectedOffice = 'all';
		selectedKorwil = 'all';
		selectedDivision = 'all';
		selectedStatus = 'all';
		selectedSlaStatus = 'all';
		fromDate = defaultDateRange.from;
		toDate = defaultDateRange.to;
		pageNumber = 1;
		isFilterOpen = false;
		mobileView = 'tickets';
		updateFilterUrl();
		void load(1);
	}

	function slaClass(status: SlaStatus): string { return `sla-badge sla-badge--${status}`; }

	function currentLocation(item: ManagementRequestsData['requests'][number]): string {
		if (item.current_unit_type === 'central') return item.nama_divisi ?? 'Divisi Pusat';
		if (item.current_unit_type === 'korwil') return `Korwil ${item.current_unit_code}`;
		return `${item.nama_kantor} (${item.kode_kantor})`;
	}

	function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'completed') return 'secondary';
		if (status === 'rejected') return 'destructive';
		return status.startsWith('waiting_') ? 'outline' : 'default';
	}
</script>

<svelte:head><title>Pemantauan Tiket | Sistem SLA Pengajuan</title></svelte:head>

<main id="main-content" class="monitoring-page">
	<AppNavbar />
	<section class="monitoring-content" aria-labelledby="page-title">
		<AppPageHeading eyebrow="Pemantauan Manajemen" title="Pemantauan tiket" description="Pantau tiket dari seluruh Cabang, status terkini, lokasi penanganan, dan SLA." descriptionBelow>
			{#snippet actions()}
				<div class="monitoring-header-actions">
					{#if data}<Badge variant="outline"><Inbox class="size-3.5" aria-hidden="true" />{data.summary.total} tiket</Badge>{/if}
					<Popover.Root bind:open={isFilterOpen}>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button {...props} type="button" variant="outline" class="filter-toggle min-h-11" aria-haspopup="dialog" aria-expanded={isFilterOpen} disabled={isLoading || !data}>
									<ListFilter class="size-4" aria-hidden="true" />Filter
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content align="end" side="top" sideOffset={8} collisionPadding={12} class="monitoring-filter-popover" aria-label="Filter tiket">
							<div class="filter-popover-header"><h2>Filter tiket</h2><p>Status, kondisi SLA, tanggal pengajuan, dan cakupan organisasi.</p></div>
							<form class="filter-form" onsubmit={applyFilter}>
								<div class="filter-field"><Label for="status-filter">Status</Label><SearchableSelect id="status-filter" label="Status" options={statusFilterItems} value={selectedStatus} onValueChange={(value) => (selectedStatus = value)} placeholder="Semua status" searchPlaceholder="Cari status..." /></div>
								<div class="filter-field"><Label for="sla-filter">Kondisi SLA</Label><SearchableSelect id="sla-filter" label="Kondisi SLA" options={slaFilterItems} value={selectedSlaStatus} onValueChange={(value) => (selectedSlaStatus = value)} placeholder="Semua kondisi SLA" searchPlaceholder="Cari kondisi SLA..." /></div>
								<div class="filter-field"><Label for="from-date-filter">Dari tanggal</Label><Input id="from-date-filter" type="date" class="h-11 w-full" bind:value={fromDate} /></div>
								<div class="filter-field"><Label for="to-date-filter">Sampai tanggal</Label><Input id="to-date-filter" type="date" class="h-11 w-full" bind:value={toDate} /></div>
								<div class="filter-field"><Label for="office-filter">Cabang</Label><SearchableSelect id="office-filter" label="Cabang" options={officeFilterItems} value={selectedOffice} onValueChange={(value) => (selectedOffice = value)} placeholder="Semua Cabang" searchPlaceholder="Cari kode atau nama Cabang..." /></div>
								<div class="filter-field"><Label for="korwil-filter">Korwil</Label><SearchableSelect id="korwil-filter" label="Korwil" options={korwilFilterItems} value={selectedKorwil} onValueChange={(value) => (selectedKorwil = value)} placeholder="Semua Korwil" searchPlaceholder="Cari Korwil..." /></div>
								<div class="filter-field"><Label for="division-filter">Divisi</Label><SearchableSelect id="division-filter" label="Divisi" options={divisionFilterItems} value={selectedDivision} onValueChange={(value) => (selectedDivision = value)} placeholder="Semua Divisi" searchPlaceholder="Cari divisi..." /></div>
								<div class="monitoring-filter-actions">
									<Button type="button" variant="outline" class="filter-action-reset min-h-11" onclick={clearFilter} disabled={isLoading}>Reset</Button>
									<Button type="submit" class="filter-action-apply min-h-11" disabled={isLoading}><RefreshCcw class="size-4" aria-hidden="true" />Terapkan</Button>
								</div>
							</form>
						</Popover.Content>
					</Popover.Root>
				</div>
			{/snippet}
		</AppPageHeading>

		{#if isLoading}
			<Card.Root size="sm" role="status" aria-live="polite"><Card.Content class="loading-state"><LoaderCircle class="size-5 animate-spin" aria-hidden="true" /><p>Memuat tiket...</p></Card.Content></Card.Root>
		{:else if errorMessage}
			<Alert.Root variant="destructive"><Alert.Title>Pemantauan belum dapat dimuat</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void load()}>Coba lagi</Button></Alert.Action></Alert.Root>
		{:else if data}
			<div class="mobile-view-switch" role="group" aria-label="Pilih tampilan pemantauan">
				<Button type="button" variant={mobileView === 'tickets' ? 'secondary' : 'ghost'} class="mobile-view-option" aria-pressed={mobileView === 'tickets'} onclick={() => (mobileView = 'tickets')}>Daftar tiket</Button>
				<Button type="button" variant={mobileView === 'summary' ? 'secondary' : 'ghost'} class="mobile-view-option" aria-pressed={mobileView === 'summary'} onclick={() => (mobileView = 'summary')}>Ringkasan</Button>
			</div>

			<section class={mobileView === 'summary' ? 'status-overview' : 'status-overview mobile-view-hidden'} aria-label="Jumlah tiket per status" role="list">
				{#each statusSummary as item (item.status)}
					<div class="status-item" role="listitem"><span>{item.label}</span><strong>{item.count}</strong></div>
				{/each}
			</section>

			<div class={mobileView === 'summary' ? 'sla-context' : 'sla-context mobile-view-hidden'} aria-label="Ringkasan SLA"><div><span>Target SLA</span><strong>7 hari kalender</strong></div><div><span>Hijau</span><strong>{data.sla.counts.safe} tiket</strong></div><div><span>Kuning</span><strong>{data.sla.counts.warning} tiket</strong></div><div><span>Merah</span><strong>{data.sla.counts.overdue} tiket</strong></div></div>

			<Card.Root size="sm" class={mobileView === 'tickets' ? 'ticket-card' : 'ticket-card mobile-view-hidden'}>
				<Card.Header class="list-header"><div><Card.Title class="text-base">Semua tiket</Card.Title><Card.Description>Status dan lokasi menunjukkan posisi terbaru setiap pengajuan.</Card.Description></div><Badge variant="outline">{data.summary.total} tiket</Badge></Card.Header>
				<Card.Content class="ticket-list-content" role="region" aria-label="Daftar tiket, geser mendatar untuk melihat seluruh kolom" tabindex={0}>
					{#if data.requests.length === 0}
						<div class="empty-state"><Inbox class="size-5" aria-hidden="true" /><h2>Tidak ada tiket pada filter ini</h2><p>Ubah filter atau reset untuk melihat seluruh tiket.</p></div>
					{:else}
						<div class="ticket-list">
							{#each data.requests as item (item.id)}
								<article class="ticket-row">
									<div class="ticket-main"><p class="ticket-number">{item.request_number} · {formatDate(item.submitted_at)}</p><h2>{item.subject}</h2><p>{item.nama_kantor} · Korwil {item.korwil}{#if item.nama_divisi} · {item.nama_divisi}{/if}</p></div>
									<div class="ticket-location"><span>Lokasi sekarang</span><strong>{currentLocation(item)}</strong><small>{item.authority_type === 'central' ? item.nama_pekerjaan ?? 'Pekerjaan Pusat' : 'Kewenangan Korwil'}</small></div>
									<div class="ticket-state"><div class="ticket-badges"><Badge variant={statusVariant(item.status)} class={item.status === 'rejected' ? 'status-badge status-badge--risk' : ''}>{statusLabels[item.status] ?? item.status}</Badge><Badge variant="outline" class={slaClass(item.sla_status)}>{slaStatusLabels[item.sla_status]}</Badge></div><span><Clock3 class="size-3.5" aria-hidden="true" />Umur {formatElapsed(item.overall_elapsed_seconds)}</span></div>
									<Button variant="outline" class="detail-button min-h-11" href={`/requests/${item.id}`}>Detail <ArrowRight class="size-4" aria-hidden="true" /></Button>
								</article>
							{/each}
						</div>
					{/if}
				</Card.Content>
				{#if data.pagination.total_pages > 1}
					<Card.Footer class="pagination"><p>Menampilkan {Math.min((pageNumber - 1) * pageSize + 1, data.summary.total)}–{Math.min(pageNumber * pageSize, data.summary.total)} dari {data.summary.total} tiket · Halaman {pageNumber} dari {data.pagination.total_pages}</p><div class="pagination-actions"><Button variant="outline" class="min-h-11" disabled={pageNumber <= 1 || isLoading} onclick={() => void load(pageNumber - 1)}><ChevronLeft class="size-4" aria-hidden="true" />Sebelumnya</Button><Button variant="outline" class="min-h-11" disabled={pageNumber >= data.pagination.total_pages || isLoading} onclick={() => void load(pageNumber + 1)}>Berikutnya<ChevronRight class="size-4" aria-hidden="true" /></Button></div></Card.Footer>
				{/if}
			</Card.Root>
		{/if}
	</section>
</main>

<style>
	.monitoring-page { min-height:100svh; background:var(--muted); color:var(--foreground); }
	.monitoring-content { box-sizing:border-box; display:block; width:min(calc(100% - clamp(2rem, 4vw, 3rem)), 82rem); min-width:0; margin-inline:auto; padding-block:clamp(1.25rem, 2.5vw, 2rem) 3.5rem; }
	:global(.monitoring-content > .app-page-heading) { height:auto; min-height:0; margin:0; }
	:global(.monitoring-content > * + *) { margin-top:1rem; }
	:global(.ticket-card) { --card-spacing:.8rem; box-shadow:none; }
	.monitoring-header-actions { display:flex; min-width:0; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:.5rem; }
	:global(.filter-toggle) { flex:0 0 auto; gap:.45rem; }
	:global(.monitoring-filter-popover) { z-index:60; box-sizing:border-box; display:grid; width:min(24rem,calc(100vw - 1rem)); max-height:min(78dvh,42rem); gap:1rem; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius); background:var(--popover); padding:1rem; color:var(--popover-foreground); box-shadow:0 18px 48px rgb(0 0 0 / .18); }
	.filter-popover-header h2 { margin:0; font-size:var(--type-base); font-weight:650; }
	.filter-popover-header p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-sm); line-height:1.45; }
	.filter-form { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; align-items:stretch; gap:.65rem; }
	.filter-field { display:grid; min-width:0; gap:.4rem; }
	:global(.filter-form input) { min-width:0; }
	:global(.monitoring-filter-actions) { display:flex; grid-column:1 / -1; width:100%; flex-direction:row; flex-wrap:nowrap; align-items:center; justify-content:space-between; gap:.5rem; padding:0; }
	:global(.monitoring-filter-actions > button) { min-width:0; flex:1 1 0; white-space:nowrap; }
	.status-overview { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; overflow:hidden; border:1px solid var(--border); border-radius:var(--radius); background:var(--card); }
	.status-item { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:.6rem; padding:.65rem .8rem; border-right:1px solid var(--border); border-bottom:1px solid var(--border); }
	.status-item:nth-child(4n) { border-right:0; }
	.status-item:nth-last-child(-n+4) { border-bottom:0; }
	.status-item span { min-width:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.35; }
	.status-item strong { flex:0 0 auto; font-size:var(--type-sm); font-variant-numeric:tabular-nums; }
	.sla-context { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:.75rem; padding:.7rem .9rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--card); }
	.sla-context > div { display:grid; min-width:0; gap:.15rem; }
	.sla-context span { color:var(--muted-foreground); font-size:var(--type-xs); }
	.sla-context strong { font-size:var(--type-sm); }
	.mobile-view-switch { display:none; }
	.mobile-view-hidden { display:block; }
	:global(.list-header) { display:flex; flex-direction:row; align-items:flex-start; justify-content:space-between; gap:.8rem; padding:.9rem 1rem .7rem; }
	:global(.ticket-list-content) { min-width:0; overflow-x:auto; overscroll-behavior-inline:contain; padding:0 1rem .5rem; }
	.ticket-list { display:grid; min-width:56rem; }
	.ticket-row { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(9rem,.8fr) minmax(11rem,.9fr) auto; align-items:center; gap:.85rem; padding:.8rem 0; border-bottom:1px solid var(--border); }
	.ticket-row:last-child { border-bottom:0; }
	.ticket-main, .ticket-location, .ticket-state { min-width:0; }
	.ticket-main { display:grid; gap:.22rem; }
	.ticket-main h2 { margin:0; font-size:var(--type-base); font-weight:600; line-height:1.35; overflow-wrap:anywhere; }
	.ticket-main p, .ticket-number, .ticket-location span, .ticket-location small, .ticket-state > span { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.45; }
	.ticket-main > p:last-child { font-size:var(--type-sm); }
	.ticket-number { font-variant-numeric:tabular-nums; }
	.ticket-location { display:grid; gap:.15rem; }
	.ticket-location strong { font-size:var(--type-sm); font-weight:550; overflow-wrap:anywhere; }
	.ticket-state { display:grid; justify-items:start; gap:.35rem; }
	.ticket-badges { display:flex; min-width:0; flex-wrap:wrap; gap:.35rem; }
	.ticket-state > span { display:flex; align-items:center; gap:.35rem; }
	:global(.detail-button) { white-space:nowrap; }
	.empty-state { display:grid; min-height:9rem; place-items:center; align-content:center; gap:.45rem; color:var(--muted-foreground); text-align:center; }
	.empty-state h2, .empty-state p { margin:0; }
	.empty-state h2 { color:var(--foreground); font-size:var(--type-lg); }
	.empty-state p { max-width:32rem; line-height:1.5; }
	:global(.pagination) { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.7rem 1rem .9rem; border-top:1px solid var(--border); }
	:global(.pagination p) { margin:0; color:var(--muted-foreground); font-size:var(--type-sm); }
	:global(.pagination-actions) { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.45rem; }
	@media(max-width:38rem) {
		:global(.monitoring-filter-popover) { width:min(24rem,calc(100vw - 1rem)); max-height:min(82dvh,44rem); }
		:global(.monitoring-filter-actions) { justify-content:stretch; gap:.4rem; }
		:global(.monitoring-filter-actions > button) { min-width:0; flex:1 1 0; padding-inline:.45rem; font-size:var(--type-sm); }
		:global(.list-header) { flex-direction:column; }
		:global(.pagination) { align-items:stretch; flex-direction:column; }
		:global(.pagination-actions) { display:grid; grid-template-columns:1fr 1fr; }
		:global(.pagination-actions button) { width:100%; }
	}
	@media(max-width:42rem) {
		.monitoring-content { width:min(calc(100% - 2rem), 82rem); padding-block:1rem calc(5.5rem + env(safe-area-inset-bottom)); }
		:global(.monitoring-content > .app-page-heading) { align-items:flex-start; flex-direction:column; gap:.65rem; }
		:global(.monitoring-content .app-page-heading-action) { width:100%; margin-top:0; }
		.monitoring-header-actions { width:100%; justify-content:space-between; }
		.sla-context { gap:.6rem; }
		.sla-context { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
		.status-overview { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
		.status-item:nth-child(4n) { border-right:1px solid var(--border); }
		.status-item:nth-child(2n) { border-right:0; }
		.status-item:nth-last-child(-n+4) { border-bottom:1px solid var(--border); }
		.status-item:nth-last-child(-n+2) { border-bottom:0; }
		.status-item { padding:.65rem .7rem; }
	}
	@media(max-width:48rem) {
		.mobile-view-switch { position:sticky; top:calc(3.8rem + env(safe-area-inset-top) + .35rem); z-index:20; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.25rem; padding:.25rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--card); }
		:global(.mobile-view-option) { min-width:0; min-height:2.75rem; justify-content:center; border-radius:.5rem; font-size:var(--type-sm); }
		:global(.mobile-view-option[aria-pressed='true']) { background:var(--foreground); color:var(--background); font-weight:650; }
		.mobile-view-hidden { display:none !important; }
	}
	@media(max-width:24rem) {
		:global(.pagination-actions) { grid-template-columns:1fr; }
		.filter-form { gap:.45rem; }
		.sla-context { gap:.45rem; padding:.65rem; }
		.sla-context strong { overflow-wrap:anywhere; }
		.status-item { gap:.35rem; padding:.6rem; }
	}
</style>
