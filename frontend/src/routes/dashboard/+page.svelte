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
	import { ArrowRight, BarChart3, Building2, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileClock, History, Inbox, ListFilter, LoaderCircle, RefreshCcw, UsersRound, XCircle } from '@lucide/svelte';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import type { AuthenticatedProfile } from '#lib/features/auth/auth.types.js';
	import { fetchDashboard, type DashboardData, type DashboardRequest, type DashboardView, type SlaStatus } from '#lib/features/dashboard/dashboard.api.js';
	import { getDefaultDateRange } from '#lib/features/dashboard/date-range.js';
	import { formatDate, formatElapsed, slaStatusLabels, statusLabels } from '#lib/features/requests/requests.api.js';

	let profile = $state<AuthenticatedProfile | null>(null);
	let dashboard = $state<DashboardData | null>(null);
	let token = $state<string | null>(null);
	let defaultDateRange = $state(getDefaultDateRange());
	let fromDate = $state('');
	let toDate = $state('');
	let selectedKorwil = $state('all');
	let selectedDivisionId = $state('all');
	let isFilterOpen = $state(false);
	let ticketPage = $state(1);
	let isLoading = $state(true);
	let errorMessage = $state('');
	const ticketPageSize = 5;
	let korwilFilterItems = $derived([
		{ value: 'all', label: 'Semua Korwil' },
		...(dashboard?.filter_options?.korwils ?? []).map((item) => ({ value: item, label: item }))
	]);
	let divisionFilterItems = $derived([
		{ value: 'all', label: 'Semua Divisi' },
		...(dashboard?.filter_options?.divisions ?? []).map((item) => ({ value: String(item.id), label: item.nama_divisi }))
	]);
	let currentPeriod = $derived.by(() => {
		if (!dashboard?.filters.from && !dashboard?.filters.to) return 'Semua tanggal';
		return `${dashboard?.filters.from ?? 'Awal'} sampai ${dashboard?.filters.to ?? 'Sekarang'}`;
	});
	let divisionBreakdown = $derived((dashboard?.filter_options?.divisions ?? [])
		.map((division) => ({
			...division,
			count: dashboard?.division_counts?.find((item) => item.id === division.id)?.count ?? 0
		}))
		.filter((division) => division.count > 0));
	let prioritizedRequests = $derived.by(() => {
		const slaPriority: Record<SlaStatus, number> = { overdue: 0, warning: 1, safe: 2 };
		return [...(dashboard?.requests ?? [])].sort((a, b) => {
			const group = (status: string) => status === 'completed' ? 1 : status === 'rejected' ? 2 : 0;
			const groupDifference = group(a.status) - group(b.status);
			if (groupDifference) return groupDifference;
			if (group(a.status) === 0) {
				const slaDifference = slaPriority[a.sla_status] - slaPriority[b.sla_status];
				if (slaDifference) return slaDifference;
				return b.overall_elapsed_seconds - a.overall_elapsed_seconds;
			}
			return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
		});
	});
	let ticketPageCount = $derived(Math.max(1, Math.ceil(prioritizedRequests.length / ticketPageSize)));
	let visibleRequests = $derived(prioritizedRequests.slice((ticketPage - 1) * ticketPageSize, ticketPage * ticketPageSize));

	onMount(() => {
		defaultDateRange = getDefaultDateRange();
		fromDate = defaultDateRange.from;
		toDate = defaultDateRange.to;
		const unsubscribe = authSession.subscribe((session) => {
			token = session.token;
			profile = session.profile;
		});
		void verifySession();
		return unsubscribe;
	});

	async function verifySession(): Promise<void> {
		if (!token) {
			await goto('/');
			return;
		}
		isLoading = true;
		errorMessage = '';
		try {
			const currentProfile = await fetchCurrentProfile(token);
			updateProfile(currentProfile);
			profile = currentProfile;
			await loadDashboard(token);
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			errorMessage = error instanceof ApiError
				? error.message
				: 'Dashboard belum dapat dimuat. Coba lagi setelah koneksi pulih.';
		} finally {
			isLoading = false;
		}
	}

	async function loadDashboard(activeToken = token): Promise<void> {
		if (!activeToken) {
			await goto('/');
			return;
		}
		isLoading = true;
		errorMessage = '';
		try {
			dashboard = (await fetchDashboard(activeToken, {
				from: fromDate || undefined,
				to: toDate || undefined,
				korwil: selectedKorwil === 'all' ? undefined : selectedKorwil,
				division_id: selectedDivisionId === 'all' ? undefined : Number(selectedDivisionId)
			})).data;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			errorMessage = error instanceof ApiError
				? error.message
				: 'Dashboard belum dapat dimuat. Coba lagi setelah koneksi pulih.';
		} finally {
			isLoading = false;
		}
	}

	function applyFilters(event: SubmitEvent): void {
		event.preventDefault();
		ticketPage = 1;
		isFilterOpen = false;
		void loadDashboard();
	}

	function clearFilters(): void {
		fromDate = defaultDateRange.from;
		toDate = defaultDateRange.to;
		selectedKorwil = 'all';
		selectedDivisionId = 'all';
		ticketPage = 1;
		isFilterOpen = false;
		void loadDashboard();
	}

	type ManagementDrilldown = { status?: string; sla_status?: SlaStatus; korwil?: string; division_id?: number };
	function managementHref(filters: ManagementDrilldown = {}): string {
		const params = new URLSearchParams();
		if (dashboard?.filters.from) params.set('from', dashboard.filters.from);
		if (dashboard?.filters.to) params.set('to', dashboard.filters.to);
		const korwil = filters.korwil ?? dashboard?.filters.korwil;
		const divisionId = filters.division_id ?? dashboard?.filters.divisionId;
		if (korwil) params.set('korwil', korwil);
		if (divisionId) params.set('division_id', String(divisionId));
		if (filters.status) params.set('status', filters.status);
		if (filters.sla_status) params.set('sla_status', filters.sla_status);
		const query = params.toString();
		return `/management/branch-follow-up${query ? `?${query}` : ''}`;
	}

	function viewTitle(view: DashboardView | undefined): string {
		if (view === 'branch') return 'Dashboard Cabang';
		if (view === 'korwil') return 'Dashboard Korwil';
		if (view === 'division') return 'Dashboard Divisi';
		if (view === 'admin') return 'Dashboard';
		return 'Dashboard';
	}

	function viewDescription(view: DashboardView | undefined): string {
		if (view === 'branch') return 'Pantau seluruh pengajuan dari kantor ini, termasuk status, revisi, dan umur tiket.';
		if (view === 'korwil') return 'Lihat antrean, pekerjaan berjalan, permintaan kelengkapan, dan akumulasi waktu Korwil.';
		if (view === 'division') return 'Lihat tiket yang benar-benar pernah masuk ke divisi ini dan waktu prosesnya.';
		if (view === 'admin') return 'Pantau pengajuan, tindak lanjut, dan SLA seluruh unit.';
		return 'Ringkasan operasional Sistem SLA Pengajuan.';
	}

	function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'rejected') return 'destructive';
		if (status === 'completed') return 'secondary';
		if (status.startsWith('in_progress')) return 'default';
		return 'outline';
	}

	function currentLocation(item: DashboardRequest): string {
		if (item.current_unit_type === 'central') return item.nama_divisi ?? 'Divisi Pusat';
		if (item.current_unit_type === 'korwil') return `Korwil ${item.current_unit_code}`;
		return `Cabang ${item.nama_kantor}`;
	}

	function slaLabel(status: SlaStatus): string {
		return slaStatusLabels[status];
	}

	function slaClass(status: SlaStatus): string {
		return `sla-badge sla-badge--${status}`;
	}
</script>

<svelte:head>
	<title>{viewTitle(dashboard?.view)} | Sistem SLA Pengajuan</title>
	<meta name="description" content="Pantau pengajuan, tindak lanjut, dan SLA seluruh unit." />
</svelte:head>

<main id="main-content" class="dashboard-page">
	<AppNavbar />

	<section class="dashboard-content app-page-shell" aria-labelledby="dashboard-title">
		<AppPageHeading id="dashboard-title" title={viewTitle(dashboard?.view)} description={viewDescription(dashboard?.view)}>
			{#snippet actions()}
				{#if dashboard}
					<div class="dashboard-header-actions">
						<div class="dashboard-header-badges">
							<Badge variant="outline" class="scope-badge"><Building2 class="size-3.5" aria-hidden="true" />{dashboard.scope.label}</Badge>
							<Badge variant="outline" class="period-badge">{currentPeriod}</Badge>
						</div>
						{#if dashboard.view === 'admin'}
							<Popover.Root bind:open={isFilterOpen}>
								<Popover.Trigger>
									{#snippet child({ props })}
										<Button {...props} type="button" variant="outline" class="filter-toggle min-h-11" aria-haspopup="dialog" aria-expanded={isFilterOpen}>
											<ListFilter class="size-4" aria-hidden="true" />Filter
										</Button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content align="end" side="top" sideOffset={8} collisionPadding={12} class="dashboard-filter-popover" aria-label="Filter dashboard">
									<div class="dashboard-filter-header"><h2>Filter dashboard</h2><p>Atur rentang tanggal dan cakupan tiket yang ingin dilihat.</p></div>
									<form class="dashboard-filter-form" onsubmit={applyFilters}>
										<div class="filter-field"><Label for="from-date">Dari tanggal</Label><Input id="from-date" type="date" class="h-11 w-full" bind:value={fromDate} /></div>
										<div class="filter-field"><Label for="to-date">Sampai tanggal</Label><Input id="to-date" type="date" class="h-11 w-full" bind:value={toDate} /></div>
										<div class="filter-field"><Label for="korwil-filter">Korwil</Label><SearchableSelect id="korwil-filter" label="Korwil" options={korwilFilterItems} value={selectedKorwil} onValueChange={(value) => (selectedKorwil = value)} placeholder="Semua Korwil" searchPlaceholder="Cari Korwil..." /></div>
										<div class="filter-field"><Label for="division-filter">Divisi</Label><SearchableSelect id="division-filter" label="Divisi" options={divisionFilterItems} value={selectedDivisionId} onValueChange={(value) => (selectedDivisionId = value)} placeholder="Semua Divisi" searchPlaceholder="Cari divisi..." /></div>
										<div class="dashboard-filter-actions">
											<Button type="button" variant="outline" class="min-h-11" onclick={clearFilters} disabled={isLoading || (fromDate === defaultDateRange.from && toDate === defaultDateRange.to && selectedKorwil === 'all' && selectedDivisionId === 'all')}>Reset</Button>
											<Button type="submit" class="min-h-11" disabled={isLoading}><RefreshCcw class="size-4" aria-hidden="true" />Terapkan</Button>
										</div>
									</form>
								</Popover.Content>
							</Popover.Root>
						{/if}
					</div>
				{/if}
			{/snippet}
		</AppPageHeading>

		{#if dashboard}
			<div class="sla-legend" aria-label="Ambang SLA">
				<Badge variant="outline" class="target-badge">Target SLA 7 hari</Badge>
				<Badge variant="outline" class="sla-badge sla-badge--safe">Hijau &lt; 3 hari</Badge>
				<Badge variant="outline" class="sla-badge sla-badge--warning">Kuning 3–7 hari</Badge>
				<Badge variant="outline" class="sla-badge sla-badge--overdue">Merah &gt; 7 hari</Badge>
			</div>
		{/if}

		{#if isLoading}
			<Card.Root role="status" aria-live="polite"><Card.Content class="loading-state"><LoaderCircle class="size-5 animate-spin" aria-hidden="true" /><p>Memuat ringkasan dashboard...</p></Card.Content></Card.Root>
		{:else if errorMessage}
			<Alert.Root variant="destructive"><Alert.Title>Dashboard belum dapat dimuat</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void verifySession()}>Coba lagi</Button></Alert.Action></Alert.Root>
		{:else if dashboard}
			{#if dashboard.view === 'branch'}
				<div class="metric-grid metric-grid--branch">
					<Card.Root><Card.Content class="metric-card">{@render metric(FileClock, 'Total pengajuan', dashboard.summary.total, 'Semua tiket kantor')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(History, 'Pernah direvisi', dashboard.summary.revision_count, 'Menerima permintaan pelengkapan')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(CheckCircle2, 'Selesai', dashboard.summary.completed, 'Status akhir tiket')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(XCircle, 'Ditolak', dashboard.summary.rejected, 'Status akhir tiket')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(Clock3, 'Umur tiket', formatElapsed(dashboard.summary.total_age_seconds), `Rata-rata ${formatElapsed(dashboard.summary.average_age_seconds)} per tiket`)}</Card.Content></Card.Root>
				</div>
			{:else if dashboard.view === 'korwil'}
				<div class="metric-grid metric-grid--unit">
					<Card.Root><Card.Content class="metric-card">{@render metric(Inbox, 'Menunggu diambil', dashboard.summary.waiting, 'Antrean Korwil')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(FileClock, 'Sedang ditangani', dashboard.summary.in_progress, 'Sudah diambil petugas')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(History, 'Menunggu Cabang', dashboard.summary.waiting_branch, 'Permintaan kelengkapan')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card metric-card--overdue">{@render metric(XCircle, 'Melewati target', dashboard.sla.counts.overdue, 'Umur tiket lebih dari 7 hari')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(Clock3, 'Waktu proses Korwil', formatElapsed(dashboard.summary.total_process_seconds), 'Akumulasi seluruh sesi')}</Card.Content></Card.Root>
				</div>
			{:else if dashboard.view === 'division'}
				<div class="metric-grid metric-grid--unit">
					<Card.Root><Card.Content class="metric-card">{@render metric(Inbox, 'Menunggu diambil', dashboard.summary.waiting, 'Antrean Divisi Pusat')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(FileClock, 'Sedang ditangani', dashboard.summary.in_progress, 'Sudah diambil petugas')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(History, 'Menunggu Cabang', dashboard.summary.waiting_branch, 'Permintaan kelengkapan')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card metric-card--overdue">{@render metric(XCircle, 'Melewati target', dashboard.sla.counts.overdue, 'Umur tiket lebih dari 7 hari')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(Clock3, 'Waktu proses Divisi', formatElapsed(dashboard.summary.total_process_seconds), 'Akumulasi seluruh sesi')}</Card.Content></Card.Root>
				</div>
			{:else}
				<div class="metric-grid metric-grid--admin">
					<a class="metric-card-link" href={managementHref()} aria-label="Lihat seluruh {dashboard.summary.total} tiket di Pemantauan Tiket"><Card.Root><Card.Content class="metric-card">{@render metric(FileClock, 'Total tiket', dashboard.summary.total, 'Sesuai cakupan dan filter')}</Card.Content></Card.Root></a>
					<a class="metric-card-link" href={managementHref({ sla_status: 'safe' })} aria-label="Lihat {dashboard.sla.counts.safe} tiket dengan SLA aman"><Card.Root><Card.Content class="metric-card metric-card--safe">{@render metric(CheckCircle2, 'SLA aman', dashboard.sla.counts.safe, 'Umur tiket di bawah 3 hari')}</Card.Content></Card.Root></a>
					<a class="metric-card-link" href={managementHref({ sla_status: 'warning' })} aria-label="Lihat {dashboard.sla.counts.warning} tiket yang mendekati SLA"><Card.Root><Card.Content class="metric-card metric-card--warning">{@render metric(Clock3, 'Mendekati SLA', dashboard.sla.counts.warning, 'Umur tiket 3 sampai 7 hari')}</Card.Content></Card.Root></a>
					<a class="metric-card-link" href={managementHref({ sla_status: 'overdue' })} aria-label="Lihat {dashboard.sla.counts.overdue} tiket yang melewati SLA"><Card.Root><Card.Content class="metric-card metric-card--overdue">{@render metric(XCircle, 'Melewati SLA', dashboard.sla.counts.overdue, 'Umur tiket lebih dari 7 hari')}</Card.Content></Card.Root></a>
					{#if profile?.sla_access.role !== 'management'}
						<a class="metric-card-link" href={managementHref({ status: 'completed' })} aria-label="Lihat {dashboard.summary.completed} tiket selesai"><Card.Root><Card.Content class="metric-card">{@render metric(CheckCircle2, 'Selesai', dashboard.summary.completed, 'Status akhir tiket')}</Card.Content></Card.Root></a>
						<a class="metric-card-link" href={managementHref({ status: 'rejected' })} aria-label="Lihat {dashboard.summary.rejected} tiket ditolak"><Card.Root><Card.Content class="metric-card">{@render metric(XCircle, 'Ditolak', dashboard.summary.rejected, 'Status akhir tiket')}</Card.Content></Card.Root></a>
					{/if}
				</div>
			{/if}

			{#if dashboard.view === 'admin'}
				<div class="dashboard-panels">
					<Card.Root>
						<Card.Header><div class="panel-title"><UsersRound class="size-4" aria-hidden="true" /><div><Card.Title class="text-base">Jumlah tiket per Korwil</Card.Title><Card.Description>Distribusi berdasarkan Korwil tujuan.</Card.Description></div></div></Card.Header>
						<Card.Content>{#if dashboard.korwil_counts?.length}<div class="status-list">{#each dashboard.korwil_counts as item (item.korwil)}<a class="status-row status-row-link" href={managementHref({ korwil: item.korwil })} aria-label="Lihat {item.count} tiket Korwil {item.korwil}"><span>Korwil {item.korwil}</span><strong>{item.count}</strong></a>{/each}</div>{:else}<p class="muted-copy">Belum ada tiket pada cakupan ini.</p>{/if}</Card.Content>
					</Card.Root>
					<Card.Root class="division-breakdown-card">
						<Card.Header><div class="panel-title"><Building2 class="size-4" aria-hidden="true" /><div><Card.Title class="text-base">Jumlah tiket per Divisi</Card.Title><Card.Description>Tiket dengan tujuan Divisi.</Card.Description></div></div></Card.Header>
						<Card.Content>{#if divisionBreakdown.length}<div class="status-list division-list">{#each divisionBreakdown as item (item.id)}<a class="status-row status-row-link" href={managementHref({ division_id: item.id })} aria-label="Lihat {item.count} tiket Divisi {item.nama_divisi}"><span>{item.nama_divisi}</span><strong>{item.count}</strong></a>{/each}</div>{:else}<p class="muted-copy">Belum ada data Divisi.</p>{/if}</Card.Content>
					</Card.Root>
				</div>
				{@render requestPanel()}
			{:else}
				<div class="role-workspace">
					<Card.Root class="role-status-card">
						<Card.Header><div class="panel-title"><BarChart3 class="size-4" aria-hidden="true" /><div><Card.Title class="text-base">Sebaran status</Card.Title><Card.Description>Status terkini dalam cakupan Anda.</Card.Description></div></div></Card.Header>
						<Card.Content>
							{#if dashboard.status_counts.length}
								<div class="status-list status-list--bars">
									{#each dashboard.status_counts as item (item.status)}
										<div class="status-row status-row--bar">
											<div class="status-row-label"><span>{statusLabels[item.status] ?? item.status}</span><strong>{item.count}</strong></div>
											<div class="status-track" aria-hidden="true"><span style={`width:${dashboard.summary.total > 0 ? Math.min(100, Math.round((item.count / dashboard.summary.total) * 100)) : 0}%`}></span></div>
										</div>
									{/each}
								</div>
							{:else}<p class="muted-copy">Belum ada tiket pada cakupan ini.</p>{/if}
						</Card.Content>
					</Card.Root>
					<div class="role-request-list">{@render requestPanel()}</div>
				</div>
			{/if}
		{/if}
	</section>
</main>

{#snippet metric(icon: any, label: string, value: string | number, note: string)}
	{@const Icon = icon}
	<div class="metric-icon"><Icon class="size-4" aria-hidden="true" /></div>
	<div class="metric-copy"><p>{label}</p><strong>{value}</strong><span>{note}</span></div>
{/snippet}

{#snippet requestPanel()}
	<Card.Root>
		<Card.Header class="request-panel-header"><div><Card.Title class="text-base">Tiket terbaru</Card.Title><Card.Description>{dashboard?.view === 'branch' ? 'Pengajuan dari kantor ini, termasuk tiket yang menunggu pelengkapan.' : dashboard?.view === 'korwil' ? 'Tiket Korwil dengan lokasi dan status terkininya.' : dashboard?.view === 'division' ? 'Tiket yang pernah masuk ke Divisi ini.' : 'Tiket berjalan dan SLA paling mendesak tampil lebih dulu.'}</Card.Description></div><Badge variant="outline">{prioritizedRequests.length} tiket</Badge></Card.Header>
		<Card.Content>
			{#if !prioritizedRequests.length}
				<div class="empty-state"><Inbox class="size-5" aria-hidden="true" /><h2>Belum ada tiket</h2><p>Tiket dalam cakupan ini akan tampil setelah pengajuan dikirim.</p></div>
			{:else}
				<div class="request-list">{#each visibleRequests as item (item.id)}
					<article class="request-row">
						<div class="request-row-main"><p class="request-number">{item.request_number} · {formatDate(item.submitted_at)}</p><h2>{item.subject}</h2><p class="request-office">{item.nama_kantor} · {item.korwil}</p></div>
						<div class="request-row-status"><Badge variant={statusVariant(item.status)} class={item.status === 'rejected' ? 'status-badge status-badge--risk' : ''}>{statusLabels[item.status] ?? item.status}</Badge><Badge variant="outline" class={slaClass(item.sla_status)}>{slaLabel(item.sla_status)}</Badge><p>{currentLocation(item)}</p></div>
						<div class="request-row-time"><span class="time-label">Umur tiket</span><strong>{formatElapsed(item.overall_elapsed_seconds)}</strong>{#if item.revision_count > 0}<span class="time-note">{item.revision_count} revisi</span>{/if}</div>
						<div class="request-row-action"><Button variant="outline" class="min-h-11" href={`/requests/${item.id}`}>Detail <ArrowRight class="size-4" aria-hidden="true" /></Button></div>
					</article>
				{/each}</div>
			{/if}
		</Card.Content>
		{#if ticketPageCount > 1}
			<Card.Footer class="request-pagination">
				<p>Menampilkan {((ticketPage - 1) * ticketPageSize) + 1}–{Math.min(ticketPage * ticketPageSize, prioritizedRequests.length)} dari {prioritizedRequests.length} tiket · Halaman {ticketPage} dari {ticketPageCount}</p>
				<div class="request-pagination-actions">
					<Button variant="outline" class="min-h-11" disabled={ticketPage <= 1} onclick={() => (ticketPage = Math.max(1, ticketPage - 1))}><ChevronLeft class="size-4" aria-hidden="true" />Sebelumnya</Button>
					<Button variant="outline" class="min-h-11" disabled={ticketPage >= ticketPageCount} onclick={() => (ticketPage = Math.min(ticketPageCount, ticketPage + 1))}>Berikutnya<ChevronRight class="size-4" aria-hidden="true" /></Button>
				</div>
			</Card.Footer>
		{/if}
	</Card.Root>
{/snippet}

<style>
	.dashboard-page { min-height: 100svh; background: var(--muted); color: var(--foreground); }
	.dashboard-content { display: grid; align-content: start; gap: 1.15rem; }
	:global(.dashboard-content > .app-page-heading) { margin-bottom: 0; }
	:global(.scope-badge) { max-width: min(100%, 20rem); overflow-wrap: anywhere; }
	:global(.period-badge) { white-space: nowrap; }
	.dashboard-header-actions { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .5rem; }
	.dashboard-header-badges { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: .4rem; }
	:global(.dashboard-content .app-page-title-row) { align-items: flex-start; flex-direction: column; gap: .3rem; }
	:global(.dashboard-content .app-page-description) { flex: 0 1 auto; }
	:global(.filter-toggle) { flex: 0 0 auto; white-space: nowrap; }
	:global(.dashboard-filter-popover) { z-index:60; box-sizing:border-box; display:grid; width:min(24rem,calc(100vw - 1rem)); max-height:min(78dvh,42rem); gap:1rem; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius); background:var(--popover); padding:1rem; color:var(--popover-foreground); box-shadow:0 18px 48px rgb(0 0 0 / .18); }
	.dashboard-filter-header h2 { margin:0; font-size:var(--type-base); font-weight:650; }
	.dashboard-filter-header p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-sm); line-height:1.45; }
	.dashboard-filter-form { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; align-items:stretch; gap:.65rem; }
	.filter-field { display:grid; min-width:0; gap:.4rem; }
	:global(.dashboard-filter-form input) { min-width:0; }
	.dashboard-filter-actions { display:flex; grid-column:1 / -1; width:100%; flex-direction:row; flex-wrap:nowrap; align-items:center; justify-content:space-between; gap:.5rem; }
	.dashboard-filter-actions :global(button) { min-width:0; flex:1 1 0; white-space:nowrap; }
	.sla-legend { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: .45rem; }
	:global(.target-badge) { border-color: var(--border); background: var(--card); color: var(--foreground); }
	.metric-grid { display: grid; gap: .75rem; }
	.metric-grid--branch, .metric-grid--unit { grid-template-columns: repeat(5, minmax(0, 1fr)); }
	.metric-grid--admin { grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.metric-card-link { display: block; min-width: 0; border-radius: var(--radius); color: inherit; text-decoration: none; }
	.metric-card-link > :global([data-slot='card']) { height: 100%; transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease; }
	.metric-card-link:hover > :global([data-slot='card']) { border-color: color-mix(in srgb,var(--ring) 42%,var(--border)); background: color-mix(in srgb,var(--ring) 4%,var(--card)); }
	.metric-card-link:active > :global([data-slot='card']) { transform: translateY(1px); }
	.metric-card-link:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
	:global(.metric-card) { display: flex; min-width: 0; align-items: flex-start; gap: .7rem; min-height: 7rem; }
	.metric-icon { display: grid; width: 2rem; height: 2rem; flex: 0 0 auto; place-items: center; border: 1px solid var(--border); border-radius: .55rem; color: var(--primary); }
	:global(.metric-card-total) { border-inline-start: 3px solid var(--ring); background: color-mix(in srgb, var(--accent) 28%, var(--card)); }
	:global(.metric-card-total) .metric-icon { color: var(--accent-foreground); border-color: color-mix(in srgb, var(--ring) 45%, var(--border)); }
	:global(.metric-card--safe) .metric-icon { color: #16794b; border-color: color-mix(in srgb, #16794b 35%, var(--border)); }
	:global(.metric-card--warning) .metric-icon { color: #9a6700; border-color: color-mix(in srgb, #9a6700 35%, var(--border)); }
	:global(.metric-card--overdue) .metric-icon { color: var(--destructive); border-color: color-mix(in srgb, var(--destructive) 35%, var(--border)); }
	.metric-copy { display: grid; min-width: 0; gap: .28rem; }
	.metric-copy p, .metric-copy span { margin: 0; }
	.metric-copy p { color: var(--muted-foreground); font-size: var(--type-sm); line-height: 1.35; }
	.metric-copy strong { font-size: clamp(1.2rem, 2vw, 1.65rem); font-weight: 620; line-height: 1.15; letter-spacing: -.03em; overflow-wrap: anywhere; }
	.metric-copy span { color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.4; }
	.dashboard-panels { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.35fr); gap: .75rem; }
	.role-workspace { display: grid; grid-template-columns: minmax(15rem, .8fr) minmax(0, 2.2fr); align-items: start; gap: .75rem; }
	.role-request-list { min-width: 0; }
	:global(.panel-title) { display: flex; align-items: flex-start; gap: .6rem; }
	:global(.panel-title > svg) { flex: 0 0 auto; margin-top: .12rem; color: var(--primary); }
	.status-list { display: grid; gap: .15rem; }
	.status-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .55rem 0; border-bottom: 1px solid var(--border); font-size: var(--type-sm); }
	.status-row:last-child { border-bottom: 0; }
	.status-row span { color: var(--muted-foreground); overflow-wrap: anywhere; }
	.status-row strong { font-size: var(--type-base); }
	.status-row-link { border-radius: .35rem; color: inherit; text-decoration: none; transition: background-color 140ms ease, color 140ms ease; }
	.status-row-link:hover { background: color-mix(in srgb,var(--ring) 7%,var(--card)); color: var(--foreground); }
	.status-row-link:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
	.division-list { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 1rem; }
	.division-list .status-row-link { min-width: 0; align-items: flex-start; }
	.division-list .status-row-link span { flex: 1 1 auto; }
	.division-list .status-row-link strong { flex: 0 0 auto; }
	.status-list--bars { gap: .85rem; }
	.status-row--bar { display: grid; gap: .38rem; padding: 0; border: 0; }
	.status-row-label { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; }
	.status-row-label span { color: var(--muted-foreground); font-size: var(--type-sm); }
	.status-row-label strong { font-size: var(--type-sm); }
	.status-track { height: .35rem; overflow: hidden; border-radius: 999px; background: var(--muted); }
	.status-track > span { display: block; height: 100%; border-radius: inherit; background: var(--primary); }
	:global(.loading-state) { display: grid; min-height: 9rem; place-items: center; align-content: center; gap: .55rem; color: var(--muted-foreground); text-align: center; }
	:global(.loading-state p), .empty-state p, .empty-state h2 { margin: 0; }
	.empty-state h2 { color: var(--foreground); font-size: var(--type-lg); }
	.empty-state p { max-width: 28rem; line-height: 1.55; }
	.muted-copy { margin: 0; color: var(--muted-foreground); font-size: var(--type-sm); }
	.request-list { display: grid; gap: .65rem; }
	.request-row { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(11rem, .9fr) minmax(8rem, .7fr) auto; align-items: center; gap: 1rem; padding: .85rem 0; border-bottom: 1px solid var(--border); }
	.request-row:last-child { border-bottom: 0; }
	.request-row-main, .request-row-status, .request-row-time { min-width: 0; }
	.request-row-main { display: grid; gap: .25rem; }
	.request-row-main h2 { margin: 0; font-size: var(--type-base); font-weight: 620; line-height: 1.35; overflow-wrap: anywhere; }
	.request-number, .request-office, .request-row-status p, .time-label, .time-note { margin: 0; color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.45; }
	.request-office { font-size: var(--type-sm); }
	.request-row-status { display: grid; gap: .38rem; justify-items: start; }
	.request-row-time { display: grid; gap: .18rem; }
	.request-row-time strong { font-size: var(--type-sm); font-weight: 620; }
	.request-row-action { justify-self: end; }
	:global(.request-pagination) { display: flex; align-items: center; justify-content: space-between; gap: .75rem; border-top: 1px solid var(--border); }
	:global(.request-pagination p) { margin: 0; color: var(--muted-foreground); font-size: var(--type-sm); }
	.request-pagination-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
	@media (max-width: 68rem) {
		.metric-grid--branch, .metric-grid--unit { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.metric-grid--admin { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.role-workspace { grid-template-columns: 1fr; }
		.request-row { grid-template-columns: minmax(0, 1.5fr) minmax(10rem, 1fr) auto; }
		.request-row-time { grid-column: 2; }
		.request-row-action { grid-column: 3; grid-row: 1 / span 2; }
	}
	@media (max-width: 42rem) {
		.dashboard-panels, .role-workspace, .division-list { grid-template-columns: 1fr; }
		.metric-grid--branch, .metric-grid--unit, .metric-grid--admin { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.metric-grid--branch > :last-child, .metric-grid--unit > :last-child { grid-column: 1 / -1; }
		.dashboard-header-actions { display: grid; width: 100%; grid-template-columns: minmax(0,1fr) auto; align-items: start; gap: .5rem; }
		.dashboard-header-badges { align-items: flex-start; }
		.sla-legend { display: grid; width: 100%; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .4rem; }
		:global(.sla-legend [data-slot='badge']) { min-width: 0; justify-content: center; padding-inline: .4rem; font-size: var(--type-xs); white-space: nowrap; }
		.request-row { grid-template-columns: minmax(0, 1fr) auto; gap: .7rem; }
		.request-row-status { grid-column: 1; }
		.request-row-time { grid-column: 1; }
		.request-row-action { grid-column: 2; grid-row: 1 / span 3; align-self: center; }
		:global(.request-panel-header) { flex-direction: column; }
		:global(.dashboard-content .app-page-heading-action) { justify-content: flex-end; }
		:global(.dashboard-filter-popover) { width:min(24rem,calc(100vw - 1rem)); max-height:min(82dvh,44rem); }
		:global(.request-pagination) { align-items: stretch; flex-direction: column; }
		.request-pagination-actions { display: grid; grid-template-columns: 1fr 1fr; }
		.request-pagination-actions :global(button) { width: 100%; }
	}
	@media (max-width: 24rem) {
		.metric-grid--branch, .metric-grid--unit, .metric-grid--admin { grid-template-columns: 1fr; }
		.dashboard-header-actions { grid-template-columns: minmax(0,1fr) auto; }
		.dashboard-header-badges { flex-direction: column; align-items: flex-start; }
		.dashboard-filter-form { gap:.45rem; }
		.request-row { grid-template-columns: 1fr; }
		.request-row-action { grid-column: auto; grid-row: auto; justify-self: stretch; }
		.request-row-action :global(a) { width: 100%; }
	}
</style>
