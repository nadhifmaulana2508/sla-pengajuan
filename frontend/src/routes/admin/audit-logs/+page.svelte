<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { Popover } from 'bits-ui';
	import { ChevronLeft, ChevronRight, History, ListFilter, LoaderCircle, Search } from '@lucide/svelte';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import { authSession, clearAuthenticatedSession, updateProfile } from '#lib/features/auth/auth.store.js';
	import { fetchAdminActivityLogs, type AdminActivityLog } from '#lib/features/admin/admin.api.js';
	import { formatDateTimeWib } from '#lib/utils/datetime.js';

	const pageSize = 50;
	let token = $state<string | null>(null);
	let logs = $state<AdminActivityLog[]>([]);
	let searchQuery = $state('');
	let method = $state('all');
	let fromDate = $state('');
	let toDate = $state('');
	let currentPage = $state(1);
	let total = $state(0);
	let totalPages = $state(0);
	let isLoading = $state(true);
	let errorMessage = $state('');
	let filterError = $state('');
	let filtersOpen = $state(false);
	let appliedFilters = $state({ q: '', method: 'all', from: '', to: '' });
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let loadSequence = 0;

	onDestroy(() => {
		if (searchTimer) clearTimeout(searchTimer);
	});

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => {
			token = session.token;
		});
		void verifyAdminAndLoad();
		return unsubscribe;
	});

	async function verifyAdminAndLoad(): Promise<void> {
		if (!token) {
			await goto('/');
			return;
		}
		try {
			const profile = await fetchCurrentProfile(token);
			updateProfile(profile);
			if (profile.sla_access.role !== 'admin' || profile.sla_access.scope !== 'all') {
				await goto('/dashboard');
				return;
			}
			await loadLogs(1);
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			if (error instanceof ApiError && error.status === 403) {
				await goto('/dashboard');
				return;
			}
			errorMessage = error instanceof ApiError
				? error.message
				: 'Audit aktivitas belum dapat dimuat. Coba lagi setelah koneksi pulih.';
			isLoading = false;
		}
	}

	async function loadLogs(page: number): Promise<void> {
		if (!token) return;
		const sequence = ++loadSequence;
		isLoading = true;
		errorMessage = '';
		try {
			const response = await fetchAdminActivityLogs(token, {
				q: appliedFilters.q || undefined,
				method: appliedFilters.method,
				from: appliedFilters.from || undefined,
				to: appliedFilters.to || undefined,
				page,
				page_size: pageSize
			});
			if (sequence !== loadSequence) return;
			logs = response.data.logs;
			total = response.data.pagination.total;
			totalPages = response.data.pagination.total_pages;
			currentPage = response.data.pagination.page;
		} catch (error) {
			if (sequence !== loadSequence) return;
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			if (error instanceof ApiError && error.status === 403) {
				await goto('/dashboard');
				return;
			}
			errorMessage = error instanceof ApiError
				? error.message
				: 'Audit aktivitas belum dapat dimuat. Coba lagi setelah koneksi pulih.';
		} finally {
			if (sequence === loadSequence) isLoading = false;
		}
	}

	function scheduleAuditSearch(value: string): void {
		searchQuery = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = null;
			const q = searchQuery.trim();
			if (q === appliedFilters.q) return;
			appliedFilters = { ...appliedFilters, q };
			void loadLogs(1);
		}, 300);
	}

	function applyFilters(): boolean {
		filterError = '';
		if (fromDate && toDate && fromDate > toDate) {
			filterError = 'Tanggal mulai tidak boleh setelah tanggal akhir.';
			return false;
		}
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = null;
		appliedFilters = { q: searchQuery.trim(), method, from: fromDate, to: toDate };
		void loadLogs(1);
		return true;
	}

	function submitAuditFilters(event: SubmitEvent): void {
		event.preventDefault();
		if (applyFilters()) filtersOpen = false;
	}

	function resetFilters(): void {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = null;
		searchQuery = '';
		method = 'all';
		fromDate = '';
		toDate = '';
		filterError = '';
		appliedFilters = { q: '', method: 'all', from: '', to: '' };
		void loadLogs(1);
	}

	function actorLabel(log: AdminActivityLog): string {
		return log.actor.full_name || log.actor.employee_id;
	}
</script>

<main id="main-content" class="audit-page">
	<AppNavbar />

	<section class="audit-content app-page-shell" aria-labelledby="audit-title">
		<AppPageHeading id="audit-title" eyebrow="Administrasi" title="Audit aktivitas" description="Riwayat login dan aktivitas API pengguna Sistem SLA." />

		<Card.Root>
			<Card.Header class="audit-header">
				<div class="audit-card-title">
					<div class="audit-icon"><History class="size-4" aria-hidden="true" /></div>
					<div>
						<Card.Title class="text-base">Aktivitas pengguna</Card.Title>
						<Card.Description>{#if isLoading}Memuat aktivitas...{:else}{total.toLocaleString('id-ID')} aktivitas sesuai filter.{/if} Isi request, password, serta token tidak dicatat.</Card.Description>
					</div>
				</div>
				<div class="audit-header-actions">
					<div class="audit-search-control">
						<Search class="size-4" aria-hidden="true" />
						<Input aria-label="Cari pengguna atau aktivitas" placeholder="Nama, ID pegawai, atau path API" class="min-h-11 pl-9" bind:value={searchQuery} oninput={(event) => scheduleAuditSearch((event.currentTarget as HTMLInputElement).value)} />
					</div>
				<Popover.Root bind:open={filtersOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button {...props} type="button" variant="outline" class="filter-trigger min-h-11" aria-haspopup="dialog" aria-expanded={filtersOpen}><ListFilter class="size-4" aria-hidden="true" />Filter</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Portal>
						<Popover.Content class="app-filter-popover" side="top" align="end" sideOffset={8} trapFocus={false} aria-labelledby="audit-filter-title" aria-describedby="audit-filter-description">
							<div class="app-filter-popover-header">
								<h2 id="audit-filter-title" class="app-filter-popover-title">Filter aktivitas</h2>
								<p id="audit-filter-description" class="app-filter-popover-description">Atur metode dan rentang tanggal aktivitas.</p>
							</div>
							<form class="app-filter-popover-form" onsubmit={submitAuditFilters}>
								<div class="app-filter-popover-fields">
									<div class="audit-filter-fields">
										<div class="audit-filter-field">
											<Label for="audit-method">Metode</Label>
											<select id="audit-method" class="audit-select" bind:value={method}>
												<option value="all">Semua metode</option>
												<option value="GET">GET</option>
												<option value="POST">POST</option>
												<option value="PUT">PUT</option>
												<option value="PATCH">PATCH</option>
												<option value="DELETE">DELETE</option>
												<option value="SSO">Sinkronisasi SSO</option>
											</select>
										</div>
										<div class="audit-filter-field"><Label for="audit-from">Dari tanggal</Label><Input id="audit-from" type="date" class="min-h-11" bind:value={fromDate} /></div>
										<div class="audit-filter-field"><Label for="audit-to">Sampai tanggal</Label><Input id="audit-to" type="date" class="min-h-11" bind:value={toDate} /></div>
									</div>
							</div>
							<div class="app-filter-popover-actions">
								<Button type="button" variant="outline" class="min-h-11" disabled={isLoading && logs.length === 0} onclick={() => { resetFilters(); filtersOpen = false; }}>Reset</Button>
								<Button type="submit" class="min-h-11" disabled={isLoading}>Terapkan</Button>
							</div>
						</form>
						</Popover.Content>
					</Popover.Portal>
				</Popover.Root>
				</div>
			</Card.Header>
			<Card.Content class="space-y-5">
				{#if filterError}<Alert.Root variant="destructive"><Alert.Description>{filterError}</Alert.Description></Alert.Root>{/if}
				{#if errorMessage}<Alert.Root variant="destructive"><Alert.Description>{errorMessage}</Alert.Description></Alert.Root>{/if}

				{#if isLoading}<div class="audit-loading" role="status"><LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Memuat aktivitas</div>{/if}

				{#if logs.length}
					<Table.Root label="Daftar audit aktivitas" tableClass="audit-table">
						<Table.Header>
							<Table.Row><Table.Head>Waktu</Table.Head><Table.Head>Pengguna</Table.Head><Table.Head>Aktivitas</Table.Head><Table.Head>Hasil</Table.Head></Table.Row>
						</Table.Header>
						<Table.Body>
							{#each logs as log (`${log.source}-${log.id}`)}
								<Table.Row>
									<Table.Cell class="audit-time">{formatDateTimeWib(log.created_at)}</Table.Cell>
									<Table.Cell><strong class="audit-actor">{actorLabel(log)}</strong><span class="audit-secondary">{log.actor.employee_id}</span>{#if log.target}<span class="audit-secondary">Target: {log.target.full_name || log.target.employee_id}</span>{/if}</Table.Cell>
									<Table.Cell><div class="audit-action"><Badge variant="outline">{log.method}</Badge><span class="audit-source">{log.action === 'sso_scope_synced' ? 'Sinkronisasi cakupan SSO' : log.source === 'access' ? 'Perubahan akses' : 'Aktivitas API'}</span></div><code class="audit-path">{log.path}</code></Table.Cell>
									<Table.Cell><Badge variant={log.status_code >= 400 ? 'destructive' : 'secondary'}>{log.status_code}</Badge></Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{:else if !isLoading}
					<div class="audit-empty"><History class="size-5" aria-hidden="true" /><h2>Belum ada aktivitas</h2><p>Aktivitas yang cocok dengan filter akan tampil di sini.</p></div>
				{/if}

				{#if totalPages > 1}
					<nav class="audit-pagination" aria-label="Halaman audit aktivitas">
						<span>Halaman {currentPage} dari {totalPages}</span>
						<div><Button type="button" variant="outline" class="min-h-11" onclick={() => void loadLogs(currentPage - 1)} disabled={isLoading || currentPage <= 1}><ChevronLeft class="size-4" aria-hidden="true" />Sebelumnya</Button><Button type="button" variant="outline" class="min-h-11" onclick={() => void loadLogs(currentPage + 1)} disabled={isLoading || currentPage >= totalPages}>Berikutnya<ChevronRight class="size-4" aria-hidden="true" /></Button></div>
					</nav>
				{/if}
			</Card.Content>
		</Card.Root>
	</section>
</main>

<style>
	.audit-content { display: grid; gap: 1.25rem; }
	.audit-card-title { display: flex; align-items: flex-start; gap: .75rem; }
	.audit-icon { display: grid; width: 1.25rem; height: 1.25rem; flex: 0 0 auto; place-items: center; color: var(--muted-foreground); }
	:global(.audit-header[data-slot='card-header']) { display: flex; width: 100%; flex-direction: row; align-items: center; justify-content: space-between; gap: 1rem; }
	.audit-header-actions { display: flex; min-width: 0; flex: 0 1 auto; align-items: center; justify-content: flex-end; gap: .5rem; margin-left: auto; }
	.audit-filter-fields { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: .75rem; }
	.audit-filter-field { display: grid; min-width: 0; gap: .4rem; }
	.audit-search-control { position: relative; width: min(19rem, 30vw); min-width: 12rem; }
	.audit-search-control :global(svg) { position: absolute; z-index: 1; top: 50%; left: .75rem; transform: translateY(-50%); color: var(--muted-foreground); }
	.audit-select { min-height: 2.75rem; width: 100%; border: 1px solid var(--input); border-radius: var(--radius); background: var(--background); padding: 0 .75rem; color: var(--foreground); font: inherit; }
	.audit-loading { display: flex; align-items: center; gap: .5rem; color: var(--muted-foreground); font-size: var(--type-sm); }
	:global(.audit-table) { min-width: 48rem; }
	.audit-actor,.audit-secondary { display: block; }
	.audit-secondary { margin-top: .2rem; color: var(--muted-foreground); font-size: var(--type-xs); }
	:global(.audit-time) { white-space: nowrap; }
	.audit-action { display: flex; align-items: center; gap: .5rem; margin-bottom: .35rem; }
	.audit-source { color: var(--muted-foreground); font-size: var(--type-xs); }
	.audit-path { display: block; max-width: 33rem; overflow-wrap: anywhere; white-space: normal; color: var(--muted-foreground); font-size: var(--type-xs); }
	.audit-empty { display: grid; justify-items: center; gap: .5rem; border: 1px dashed var(--border); border-radius: var(--radius); padding: 2.5rem 1rem; text-align: center; color: var(--muted-foreground); }
	.audit-empty h2,.audit-empty p { margin: 0; }
	.audit-empty h2 { color: var(--foreground); font-size: var(--type-base); }
	.audit-pagination { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: var(--muted-foreground); font-size: var(--type-sm); }
	.audit-pagination > div { display: flex; min-width: 0; flex-wrap: wrap; gap: .5rem; }
	@media (max-width: 42rem) {
		.audit-filter-fields { grid-template-columns: 1fr; }
		:global(.audit-header[data-slot='card-header']) { align-items: stretch; flex-direction: column; }
		.audit-header-actions { display: grid; width: 100%; grid-template-columns: minmax(0, 1fr) auto; margin-left: 0; }
		.audit-search-control { width: auto; min-width: 0; }
		.audit-pagination { align-items: flex-start; flex-direction: column; }
		.audit-pagination > div { width: 100%; }
		.audit-pagination > div :global(button) { flex: 1; }
	}
</style>
