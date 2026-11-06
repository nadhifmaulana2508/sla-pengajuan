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
	import * as Select from '#lib/components/ui/select/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { ArrowRight, BarChart3, Building2, CheckCircle2, ChevronDown, Clock3, FileClock, History, Inbox, ListFilter, LoaderCircle, RefreshCcw, UsersRound, XCircle } from '@lucide/svelte';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import type { AuthenticatedProfile } from '#lib/features/auth/auth.types.js';
	import { fetchDashboard, type DashboardData, type DashboardRequest, type DashboardView, type SlaStatus } from '#lib/features/dashboard/dashboard.api.js';
	import { formatDate, formatElapsed, slaStatusLabels, statusLabels } from '#lib/features/requests/requests.api.js';

	let profile = $state<AuthenticatedProfile | null>(null);
	let dashboard = $state<DashboardData | null>(null);
	let token = $state<string | null>(null);
	let fromDate = $state('');
	let toDate = $state('');
	let selectedKorwil = $state('all');
	let selectedDivisionId = $state('all');
	let isFilterOpen = $state(false);
	let isLoading = $state(true);
	let errorMessage = $state('');
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

	onMount(() => {
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
		void loadDashboard();
	}

	function clearFilters(): void {
		fromDate = '';
		toDate = '';
		selectedKorwil = 'all';
		selectedDivisionId = 'all';
		void loadDashboard();
	}

	function viewTitle(view: DashboardView | undefined): string {
		if (view === 'branch') return 'Dashboard Cabang';
		if (view === 'korwil') return 'Dashboard Korwil';
		if (view === 'division') return 'Dashboard Divisi Pusat';
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
	<meta name="description" content="Ringkasan operasional Sistem SLA Pengajuan." />
</svelte:head>

<main id="main-content" class="dashboard-page">
	<AppNavbar />

	<section class="dashboard-content app-page-shell" aria-labelledby="dashboard-title">
		<AppPageHeading id="dashboard-title" eyebrow="Operasional" title={viewTitle(dashboard?.view)} description={viewDescription(dashboard?.view)}>
			{#snippet actions()}{#if dashboard}<Badge variant="outline" class="scope-badge"><Building2 class="size-3.5" aria-hidden="true" />{dashboard.scope.label}</Badge><Badge variant="outline" class="period-badge">{currentPeriod}</Badge>{/if}{/snippet}
		</AppPageHeading>

		{#if dashboard}
			<div class="sla-legend" aria-label="Ambang SLA">
				<Badge variant="outline" class="target-badge">Target SLA 7 hari</Badge>
				<Badge variant="outline" class="sla-badge sla-badge--safe">Hijau &lt; 3 hari</Badge>
				<Badge variant="outline" class="sla-badge sla-badge--warning">Kuning 3–7 hari</Badge>
				<Badge variant="outline" class="sla-badge sla-badge--overdue">Merah &gt; 7 hari</Badge>
			</div>
		{/if}

		{#if dashboard?.view === 'admin'}
			<Card.Root class={isFilterOpen ? 'filter-card' : 'filter-card filter-card--collapsed'}>
				<Card.Header class="filter-header">
					<div class="filter-heading">
						<Card.Title class="text-base">Filter</Card.Title>
						<Card.Description>Tanggal pengajuan, Korwil, dan Divisi Pusat</Card.Description>
					</div>
					<Button type="button" variant={isFilterOpen ? 'secondary' : 'outline'} class="filter-toggle min-h-10" aria-expanded={isFilterOpen} aria-controls="dashboard-filter-fields" onclick={() => (isFilterOpen = !isFilterOpen)}>
						<ListFilter class="size-4" aria-hidden="true" />
						<span>{isFilterOpen ? 'Tutup filter' : 'Buka filter'}</span>
						<ChevronDown class={isFilterOpen ? 'filter-chevron size-4 filter-chevron--open' : 'filter-chevron size-4'} aria-hidden="true" />
					</Button>
				</Card.Header>
				<Card.Content id="dashboard-filter-fields" hidden={!isFilterOpen}>
					<form class="filter-form" onsubmit={applyFilters}>
						<div class="filter-field"><Label for="from-date">Dari tanggal</Label><Input id="from-date" type="date" class="h-11 w-full" bind:value={fromDate} /></div>
						<div class="filter-field"><Label for="to-date">Sampai tanggal</Label><Input id="to-date" type="date" class="h-11 w-full" bind:value={toDate} /></div>
						<div class="filter-field"><Label for="korwil-filter">Korwil</Label><Select.Root type="single" items={korwilFilterItems} bind:value={selectedKorwil}><Select.Trigger id="korwil-filter" class="h-11 w-full border-input"><Select.Value placeholder="Semua Korwil" /></Select.Trigger><Select.Content>{#each korwilFilterItems as item (item.value)}<Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>{/each}</Select.Content></Select.Root></div>
						<div class="filter-field"><Label for="division-filter">Divisi Pusat</Label><Select.Root type="single" items={divisionFilterItems} bind:value={selectedDivisionId}><Select.Trigger id="division-filter" class="h-11 w-full border-input"><Select.Value placeholder="Semua Divisi" /></Select.Trigger><Select.Content>{#each divisionFilterItems as item (item.value)}<Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>{/each}</Select.Content></Select.Root></div>
						<div class="filter-actions"><Button type="submit" class="h-11" disabled={isLoading}><RefreshCcw class="size-4" aria-hidden="true" />Terapkan</Button><Button type="button" variant="outline" class="h-11" onclick={clearFilters} disabled={isLoading || (!fromDate && !toDate && selectedKorwil === 'all' && selectedDivisionId === 'all')}>Reset</Button></div>
					</form>
				</Card.Content>
			</Card.Root>
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
					<Card.Root class="metric-card-total"><Card.Content class="metric-card">{@render metric(FileClock, 'Total tiket', dashboard.summary.total, 'Sesuai cakupan dan filter')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card metric-card--safe">{@render metric(CheckCircle2, 'SLA aman', dashboard.sla.counts.safe, 'Umur tiket di bawah 3 hari')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card metric-card--warning">{@render metric(Clock3, 'Mendekati SLA', dashboard.sla.counts.warning, 'Umur tiket 3 sampai 7 hari')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card metric-card--overdue">{@render metric(XCircle, 'Melewati SLA', dashboard.sla.counts.overdue, 'Umur tiket lebih dari 7 hari')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(CheckCircle2, 'Selesai', dashboard.summary.completed, 'Status akhir tiket')}</Card.Content></Card.Root>
					<Card.Root><Card.Content class="metric-card">{@render metric(XCircle, 'Ditolak', dashboard.summary.rejected, 'Status akhir tiket')}</Card.Content></Card.Root>
				</div>
			{/if}

			{#if dashboard.view === 'admin'}
				<div class="dashboard-panels">
					<Card.Root>
						<Card.Header><div class="panel-title"><BarChart3 class="size-4" aria-hidden="true" /><div><Card.Title class="text-base">Jumlah tiket per status</Card.Title><Card.Description>Status terakhir setiap tiket dalam cakupan.</Card.Description></div></div></Card.Header>
						<Card.Content>{#if dashboard.status_counts.length}<div class="status-list">{#each dashboard.status_counts as item (item.status)}<div class="status-row"><span>{statusLabels[item.status] ?? item.status}</span><strong>{item.count}</strong></div>{/each}</div>{:else}<p class="muted-copy">Belum ada tiket pada cakupan ini.</p>{/if}</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Header><div class="panel-title"><UsersRound class="size-4" aria-hidden="true" /><div><Card.Title class="text-base">Jumlah tiket per Korwil</Card.Title><Card.Description>Distribusi berdasarkan Korwil tujuan.</Card.Description></div></div></Card.Header>
						<Card.Content>{#if dashboard.korwil_counts?.length}<div class="status-list">{#each dashboard.korwil_counts as item (item.korwil)}<div class="status-row"><span>{item.korwil}</span><strong>{item.count}</strong></div>{/each}</div>{:else}<p class="muted-copy">Belum ada tiket pada cakupan ini.</p>{/if}</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Header><div class="panel-title"><Building2 class="size-4" aria-hidden="true" /><div><Card.Title class="text-base">Jumlah tiket per Divisi</Card.Title><Card.Description>Hanya tiket yang memiliki tujuan Divisi Pusat.</Card.Description></div></div></Card.Header>
						<Card.Content>{#if dashboard.division_counts?.length}<div class="status-list">{#each dashboard.division_counts as item (item.id)}<div class="status-row"><span>{item.nama_divisi}</span><strong>{item.count}</strong></div>{/each}</div>{:else}<p class="muted-copy">Belum ada tiket dengan tujuan Divisi Pusat.</p>{/if}</Card.Content>
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
		<Card.Header class="request-panel-header"><div><Card.Title class="text-base">Tiket terbaru</Card.Title><Card.Description>{dashboard?.view === 'branch' ? 'Pengajuan dari kantor ini, termasuk tiket yang menunggu pelengkapan.' : dashboard?.view === 'korwil' ? 'Tiket Korwil dengan lokasi dan status terkininya.' : dashboard?.view === 'division' ? 'Tiket yang pernah masuk ke Divisi Pusat ini.' : 'Umur total dihitung sejak pengajuan pertama dan mencakup antrean serta revisi.'}</Card.Description></div><Badge variant="outline">{dashboard?.requests.length ?? 0} ditampilkan</Badge></Card.Header>
		<Card.Content>
			{#if !dashboard?.requests.length}
				<div class="empty-state"><Inbox class="size-5" aria-hidden="true" /><h2>Belum ada tiket</h2><p>Tiket dalam cakupan ini akan tampil setelah pengajuan dikirim.</p></div>
			{:else}
				<div class="request-list">{#each dashboard.requests as item (item.id)}
					<article class="request-row">
						<div class="request-row-main"><p class="request-number">{item.request_number} · {formatDate(item.submitted_at)}</p><h2>{item.subject}</h2><p class="request-office">{item.nama_kantor} · {item.korwil}</p></div>
						<div class="request-row-status"><Badge variant={statusVariant(item.status)}>{statusLabels[item.status] ?? item.status}</Badge><Badge variant="outline" class={slaClass(item.sla_status)}>{slaLabel(item.sla_status)}</Badge><p>{currentLocation(item)}</p></div>
						<div class="request-row-time"><span class="time-label">Umur tiket</span><strong>{formatElapsed(item.overall_elapsed_seconds)}</strong>{#if item.revision_count > 0}<span class="time-note">{item.revision_count} revisi</span>{/if}</div>
						<div class="request-row-action"><Button variant="outline" class="min-h-11" href={`/requests/${item.id}`}>Detail <ArrowRight class="size-4" aria-hidden="true" /></Button></div>
					</article>
				{/each}</div>
			{/if}
		</Card.Content>
	</Card.Root>
{/snippet}

<style>
	.dashboard-page { min-height: 100svh; background: var(--muted); color: var(--foreground); }
	.dashboard-content { display: grid; align-content: start; gap: 1.15rem; }
	:global(.dashboard-content > .app-page-heading) { margin-bottom: 0; }
	:global(.scope-badge) { max-width: min(100%, 20rem); overflow-wrap: anywhere; }
	:global(.period-badge) { white-space: nowrap; }
	:global(.dashboard-content .app-page-title-row) { align-items: flex-start; flex-direction: column; gap: .3rem; }
	:global(.dashboard-content .app-page-description) { flex: 0 1 auto; }
	:global(.filter-card) { box-shadow: none; }
	:global(.filter-card--collapsed [data-slot='card-header']) { padding-block: .8rem; }
	:global(.filter-header), :global(.request-panel-header) { display: flex; flex-direction: row; align-items: flex-start; justify-content: space-between; gap: 1rem; }
	:global(.filter-header) { align-items: center; }
	.filter-heading { display: grid; min-width: 0; gap: .2rem; }
	:global(.filter-toggle) { flex: 0 0 auto; white-space: nowrap; }
	:global(.filter-chevron) { transition: transform 140ms ease; }
	:global(.filter-chevron--open) { transform: rotate(180deg); }
	:global(#dashboard-filter-fields[hidden]) { display: none; }
	.filter-form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto; align-items: end; gap: .75rem; }
	.filter-field { display: grid; gap: .45rem; }
	.filter-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
	.sla-legend { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: .45rem; }
	:global(.target-badge) { border-color: var(--border); background: var(--card); color: var(--foreground); }
	.metric-grid { display: grid; gap: .75rem; }
	.metric-grid--branch, .metric-grid--unit { grid-template-columns: repeat(5, minmax(0, 1fr)); }
	.metric-grid--admin { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
	.dashboard-panels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
	.role-workspace { display: grid; grid-template-columns: minmax(15rem, .8fr) minmax(0, 2.2fr); align-items: start; gap: .75rem; }
	.role-request-list { min-width: 0; }
	:global(.panel-title) { display: flex; align-items: flex-start; gap: .6rem; }
	:global(.panel-title > svg) { flex: 0 0 auto; margin-top: .12rem; color: var(--primary); }
	.status-list { display: grid; gap: .15rem; }
	.status-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .55rem 0; border-bottom: 1px solid var(--border); font-size: var(--type-sm); }
	.status-row:last-child { border-bottom: 0; }
	.status-row span { color: var(--muted-foreground); overflow-wrap: anywhere; }
	.status-row strong { font-size: var(--type-base); }
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
	@media (max-width: 68rem) {
		.metric-grid--branch, .metric-grid--unit { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.metric-grid--admin { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.dashboard-panels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.role-workspace { grid-template-columns: 1fr; }
		.request-row { grid-template-columns: minmax(0, 1.5fr) minmax(10rem, 1fr) auto; }
		.request-row-time { grid-column: 2; }
		.request-row-action { grid-column: 3; grid-row: 1 / span 2; }
	}
	@media (max-width: 42rem) {
		.filter-form, .dashboard-panels, .role-workspace { grid-template-columns: 1fr; }
		.metric-grid--branch, .metric-grid--unit, .metric-grid--admin { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.filter-actions { display: grid; grid-template-columns: 1fr 1fr; }
		.filter-actions :global(button) { width: 100%; }
		.request-row { grid-template-columns: minmax(0, 1fr) auto; gap: .7rem; }
		.request-row-status { grid-column: 1; }
		.request-row-time { grid-column: 1; }
		.request-row-action { grid-column: 2; grid-row: 1 / span 3; align-self: center; }
		:global(.request-panel-header) { flex-direction: column; }
		:global(.filter-header) { align-items: center; }
	}
	@media (max-width: 24rem) {
		.metric-grid--branch, .metric-grid--unit, .metric-grid--admin { grid-template-columns: 1fr; }
		.filter-actions { grid-template-columns: 1fr; }
		.request-row { grid-template-columns: 1fr; }
		.request-row-action { grid-column: auto; grid-row: auto; justify-self: stretch; }
		.request-row-action :global(a) { width: 100%; }
	}
</style>
