<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import {
		fetchRequest, finishCentral, finishKorwil, forwardKorwilRequest, formatDate, formatElapsed,
		requestCentralDocuments, requestKorwilDocuments, slaStatusLabels, statusLabels, submitRevision
	} from '#lib/features/requests/requests.api.js';
	import { ArrowLeft, Building2, Check, Clock3, FileText, Send, X } from '@lucide/svelte';

	type Detail = Awaited<ReturnType<typeof fetchRequest>>['data'];
	let token = $state<string | null>(null);
	let role = $state<string | null>(null);
	let detail = $state<Detail | null>(null);
	let isLoading = $state(true);
	let errorMessage = $state('');
	let actionError = $state('');
	let actionNotice = $state('');
	let actionText = $state('');
	let actionBusy = $state(false);
	let actionDialogOpen = $state(false);
	let selectedAction = $state<'request-documents' | 'forward' | 'complete' | 'reject' | 'revision' | null>(null);
	let now = $state(Date.now());
	let timerId: ReturnType<typeof setInterval> | undefined;
	const requestId = page.params.id ?? '';
	let totals = $derived.by(() => {
		const grouped = new Map<string, number>();
		for (const session of detail?.sessions ?? []) {
			const key = `${session.unit_type}:${session.unit_code}`;
			const elapsed = session.ended_at
				? Number(session.duration_seconds ?? 0)
				: session.started_at ? Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 1000)) : 0;
			grouped.set(key, (grouped.get(key) ?? 0) + elapsed);
		}
		return [...grouped].map(([key, seconds]) => {
			const [type = '', code = ''] = key.split(':');
			return { key, unit: unitLabel(type, code), seconds };
		});
	});
	let overallElapsed = $derived(detail
		? detail.request.closed_at
			? Number(detail.request.overall_elapsed_seconds)
			: Math.max(0, Math.floor((now - new Date(detail.request.submitted_at).getTime()) / 1000))
		: 0);
	let backHref = $derived(role === 'branch_user' ? '/requests' : role === 'division_staff' ? '/inbox/central' : role === 'korwil_staff' || role === 'korwil_approver' ? '/inbox/korwil' : '/dashboard');
	let backLabel = $derived(role === 'branch_user' ? 'Daftar pengajuan' : role === 'division_staff' ? 'Antrean Divisi' : role === 'korwil_staff' || role === 'korwil_approver' ? 'Antrean Korwil' : 'Beranda');

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; role = session.profile?.sla_access.role ?? null; });
		timerId = setInterval(() => { now = Date.now(); }, 30_000);
		void load();
		return () => { unsubscribe(); if (timerId) clearInterval(timerId); };
	});

	async function load(): Promise<void> {
		if (!token) { await goto('/'); return; }
		isLoading = true; errorMessage = '';
		try { detail = (await fetchRequest(token, requestId)).data; now = Date.now(); }
		catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			errorMessage = error instanceof ApiError ? error.message : 'Detail belum dapat dimuat. Coba lagi.';
		}
		finally { isLoading = false; }
	}

	function elapsedFor(session: NonNullable<Detail>['sessions'][number]): number | null {
		if (session.ended_at) return session.duration_seconds === null ? null : Number(session.duration_seconds);
		if (!session.started_at) return null;
		return Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 1000));
	}

	function unitLabel(type: string, code: string): string {
		if (type === 'korwil') return `Korwil ${code}`;
		if (type === 'branch') return `Cabang ${code}`;
		return `Divisi Pusat · ${detail?.request.nama_divisi ?? code}`;
	}

	function sessionDescription(session: NonNullable<Detail>['sessions'][number]): string {
		if (!session.started_at) return `Masuk antrean ${formatDate(session.created_at)} · Menunggu diambil, timer belum mulai`;
		if (session.start_reason === 'claim') return `Timer mulai saat diambil · ${formatDate(session.started_at)}`;
		if (session.unit_type === 'branch') return `Dimulai saat Cabang menerima permintaan · ${formatDate(session.started_at)}`;
		if (session.unit_type === 'korwil') return `Dimulai saat Cabang mengirim pelengkapan · ${formatDate(session.started_at)}`;
		return session.claimed_at
			? `Masuk ${formatDate(session.created_at)} · Diambil ${formatDate(session.claimed_at)}`
			: `Dimulai saat Cabang mengirim pelengkapan ke Divisi · ${formatDate(session.started_at)}`;
	}

	function queueWait(session: NonNullable<Detail>['sessions'][number]): number | null {
		if (session.claimed_at) return Math.max(0, Math.floor((new Date(session.claimed_at).getTime() - new Date(session.created_at).getTime()) / 1000));
		if (!session.started_at) return Math.max(0, Math.floor((now - new Date(session.created_at).getTime()) / 1000));
		return null;
	}

	function slaLabel(status: NonNullable<Detail>['request']['sla_status']): string {
		return slaStatusLabels[status ?? 'safe'];
	}

	function slaClass(status: NonNullable<Detail>['request']['sla_status']): string {
		return `sla-badge sla-badge--${status ?? 'safe'}`;
	}

	function timelineLabel(action: string, status: string): string {
		if (action === 'submitted') return 'Dikirim ke Korwil';
		if (action === 'claimed') return 'Pengajuan diambil';
		if (action === 'request_documents') return 'Kelengkapan diminta';
		if (action === 'forwarded_to_central') return 'Diteruskan ke Divisi Pusat';
		if (action === 'branch_revision_submitted') return 'Cabang mengirim pelengkapan';
		if (action === 'completed') return 'Pengajuan selesai';
		if (action === 'rejected') return 'Pengajuan ditolak';
		return statusLabels[status] ?? action;
	}

	function openAction(action: NonNullable<typeof selectedAction>): void {
		selectedAction = action;
		actionText = '';
		actionError = '';
		actionDialogOpen = true;
	}

	function actionTitle(): string {
		if (selectedAction === 'request-documents') return 'Minta kelengkapan ke Cabang';
		if (selectedAction === 'forward') return 'Teruskan ke Divisi Pusat';
		if (selectedAction === 'complete') return 'Selesaikan pengajuan';
		if (selectedAction === 'reject') return 'Tolak pengajuan';
		return 'Kirim pelengkapan';
	}

	function actionPrompt(): string {
		if (selectedAction === 'request-documents') return 'Tuliskan data atau dokumen yang perlu dilengkapi Cabang.';
		if (selectedAction === 'forward') return 'Tambahkan catatan pemeriksaan. Divisi tujuan mengikuti pilihan pada pengajuan.';
		if (selectedAction === 'complete') return 'Ringkas hasil penanganan sebagai catatan penutupan.';
		if (selectedAction === 'reject') return 'Jelaskan alasan penolakan. Alasan ini tercatat pada histori pengajuan.';
		return 'Jelaskan pelengkapan yang sudah dilakukan Cabang sebelum mengirim kembali.';
	}

	async function submitAction(): Promise<void> {
		if (!token || !detail || !selectedAction) return;
		const text = actionText.trim();
		if (text.length < 3) { actionError = 'Isi keterangan minimal 3 karakter.'; return; }
		actionBusy = true;
		actionError = '';
		try {
			let revisionResumed = false;
			if (selectedAction === 'revision') {
				const result = await submitRevision(token, detail.request.id, text);
				revisionResumed = result.data.resumed_to_previous_handler;
			}
			else if (selectedAction === 'request-documents' && detail.request.current_unit_type === 'korwil') await requestKorwilDocuments(token, detail.request.id, text);
			else if (selectedAction === 'request-documents') await requestCentralDocuments(token, detail.request.id, text);
			else if (selectedAction === 'forward') await forwardKorwilRequest(token, detail.request.id, text);
			else if (selectedAction === 'complete' && detail.request.current_unit_type === 'korwil') await finishKorwil(token, detail.request.id, 'completed', text);
			else if (selectedAction === 'complete') await finishCentral(token, detail.request.id, 'completed', text);
			else if (selectedAction === 'reject' && detail.request.current_unit_type === 'korwil') await finishKorwil(token, detail.request.id, 'rejected', text);
			else await finishCentral(token, detail.request.id, 'rejected', text);
			actionNotice = selectedAction === 'revision'
				? revisionResumed
					? 'Pelengkapan terkirim. Pengajuan otomatis kembali ke petugas yang meminta dan timer unit berjalan lagi.'
					: 'Pelengkapan terkirim ke antrean unit tujuan. Timer unit sudah berjalan dan petugas dapat mengambilnya.'
				: 'Tindakan berhasil dicatat pada histori pengajuan.';
			actionDialogOpen = false;
			selectedAction = null;
			await load();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) { clearAuthenticatedSession(); await goto('/'); return; }
			actionError = error instanceof ApiError ? error.message : 'Tindakan belum berhasil. Periksa koneksi lalu coba lagi.';
		} finally { actionBusy = false; }
	}
</script>

<svelte:head><title>Detail Pengajuan | Sistem SLA</title></svelte:head>

<section class="app-page-stack" aria-labelledby="page-title">
	<a class="back-link" href={backHref}><ArrowLeft class="size-4" aria-hidden="true" />{backLabel}</a>
	{#if isLoading}
		<Card.Root role="status" aria-live="polite"><Card.Content class="min-h-28 justify-center text-sm text-muted-foreground">Memuat detail pengajuan…</Card.Content></Card.Root>
	{:else if errorMessage}
		<Alert.Root variant="destructive"><Alert.Title>Detail belum dapat dimuat</Alert.Title><Alert.Description>{errorMessage}</Alert.Description><Alert.Action><Button variant="outline" class="min-h-11" onclick={() => void load()}>Coba lagi</Button></Alert.Action></Alert.Root>
	{:else if detail}
		{@const item = detail.request}
		<div class="app-page-heading app-page-heading--flush"><div class="app-page-heading-copy"><p class="app-page-meta">{item.request_number} · {formatDate(item.submitted_at)}</p><div class="app-page-title-row"><h1 id="page-title" class="app-page-title">{item.subject}</h1><p class="app-page-description">{item.nama_kantor} · Korwil {item.korwil}</p></div></div><div class="app-page-heading-action"><Badge variant={item.status.startsWith('in_progress') ? 'default' : 'secondary'}>{statusLabels[item.status] ?? item.status}</Badge></div></div>
		<Card.Root class="sla-summary"><Card.Content class="sla-summary-content"><div><p class="sla-summary-label">Status SLA keseluruhan</p><p class="sla-summary-copy">Target 7 hari kalender · hijau &lt; 3 hari · kuning 3–7 hari · merah &gt; 7 hari.</p></div><Badge variant="outline" class={slaClass(item.sla_status)}>{slaLabel(item.sla_status)}</Badge></Card.Content></Card.Root>
		{#if actionNotice}<Alert.Root><Alert.Title>Perubahan tersimpan</Alert.Title><Alert.Description>{actionNotice}</Alert.Description></Alert.Root>{/if}
		{#if detail.capabilities.can_request_documents || detail.capabilities.can_forward_to_central || detail.capabilities.can_complete || detail.capabilities.can_reject || detail.capabilities.can_submit_revision}
			<Card.Root><Card.Header><Card.Title>Tindakan pengajuan</Card.Title><Card.Description>{detail.capabilities.can_submit_revision ? 'Lengkapi permintaan pada tiket yang sama; tidak perlu membuat pengajuan baru.' : 'Setiap keputusan akan menutup sesi unit dan tercatat pada timeline.'}</Card.Description></Card.Header><Card.Content class="action-list">
				{#if detail.capabilities.can_request_documents}<Button variant="outline" class="min-h-11" onclick={() => openAction('request-documents')}><FileText class="size-4" aria-hidden="true" />Minta kelengkapan</Button>{/if}
				{#if detail.capabilities.can_forward_to_central}<Button class="min-h-11" onclick={() => openAction('forward')}><Send class="size-4" aria-hidden="true" />Teruskan ke {item.nama_divisi ?? 'Divisi Pusat'}</Button>{/if}
				{#if detail.capabilities.can_complete}<Button class="min-h-11" onclick={() => openAction('complete')}><Check class="size-4" aria-hidden="true" />Selesaikan</Button>{/if}
				{#if detail.capabilities.can_reject}<Button variant="destructive" class="min-h-11" onclick={() => openAction('reject')}><X class="size-4" aria-hidden="true" />Tolak</Button>{/if}
				{#if detail.capabilities.can_submit_revision}<Button class="min-h-11" onclick={() => openAction('revision')}><Send class="size-4" aria-hidden="true" />Kirim pelengkapan</Button><p class="action-note">Kolom ini mencatat jawaban pelengkapan. Unggah lampiran belum tersedia sampai penyimpanan privat ditetapkan.</p>{/if}
			</Card.Content></Card.Root>
		{/if}
		<div class="detail-grid">
			<div class="main-column">
				<Card.Root><Card.Header><Card.Title><FileText class="mr-2 inline size-4" aria-hidden="true" />Uraian pengajuan</Card.Title><Card.Description>{item.authority_type === 'central' ? `${item.nama_divisi ?? 'Pusat'} · ${item.nama_pekerjaan ?? 'Jenis pekerjaan'}` : 'Kewenangan Korwil'}</Card.Description></Card.Header><Card.Content><p class="description">{item.description}</p></Card.Content></Card.Root>
				<Card.Root><Card.Header><Card.Title><Clock3 class="mr-2 inline size-4" aria-hidden="true" />Waktu proses</Card.Title><Card.Description>Umur tiket dan waktu yang tercatat pada setiap unit, memakai waktu kalender.</Card.Description></Card.Header><Card.Content class="session-list">
					<div class="overall-row"><div><strong>Total umur tiket</strong><p>Sejak pertama kali dikirim Cabang</p></div><div class="session-time"><strong>{formatElapsed(overallElapsed)}</strong><Badge variant={item.closed_at ? 'secondary' : 'outline'}>{item.closed_at ? 'Ditutup' : 'Berjalan'}</Badge></div></div>
					<Separator />
					{#if detail.sessions.length === 0}<p class="muted-copy">Belum ada sesi waktu.</p>{:else}
						{#each detail.sessions as session (session.id)}<div class="session-row"><div><strong>{unitLabel(session.unit_type, session.unit_code)}</strong><p>{sessionDescription(session)}</p>{#if queueWait(session) !== null}<p>Waktu tunggu sebelum diambil: {formatElapsed(queueWait(session))}</p>{/if}</div><div class="session-time"><strong>{formatElapsed(elapsedFor(session))}</strong>{#if session.ended_at}<Badge variant="secondary">Selesai</Badge>{:else if session.started_at}<Badge variant="outline">Berjalan</Badge>{:else}<Badge variant="outline">Menunggu</Badge>{/if}</div></div>{/each}
					{/if}
					<Separator />
					{#each totals as total (total.key)}<div class="total-row"><span>Total {total.unit}</span><strong>{formatElapsed(total.seconds)}</strong></div>{/each}
				</Card.Content></Card.Root>
			</div>
			<aside><Card.Root><Card.Header><Card.Title><Building2 class="mr-2 inline size-4" aria-hidden="true" />Alur pengajuan</Card.Title><Card.Description>Riwayat perpindahan tercatat dengan nomor yang sama.</Card.Description></Card.Header><Card.Content class="timeline">
					{#each detail.timeline as event, index (event.id)}<div class="timeline-item"><span class="timeline-marker">{#if index === detail.timeline.length - 1}<Send class="size-3" aria-hidden="true" />{:else}<Check class="size-3" aria-hidden="true" />{/if}</span><div><strong>{timelineLabel(event.action_name, event.status_to)}</strong><p>{event.actor_name ?? 'Pegawai'} · {formatDate(event.created_at)}</p><small>{event.unit_from_code ? `${event.unit_from_type} ${event.unit_from_code} → ` : 'Dari Cabang → '}{event.unit_to_type} {event.unit_to_code}</small>{#if event.reason}<p>{event.reason}</p>{/if}</div></div>{/each}
				</Card.Content></Card.Root></aside>
		</div>
	{/if}
</section>

<Dialog.Root bind:open={actionDialogOpen}>
	<Dialog.Content class="action-dialog" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>{actionTitle()}</Dialog.Title>
			<Dialog.Description>{actionPrompt()}</Dialog.Description>
		</Dialog.Header>
		{#if selectedAction === 'revision'}<p class="muted-copy">Untuk saat ini, isi uraian pelengkapan di bawah. File lampiran belum dapat diunggah.</p>{/if}
		<label class="action-label" for="action-note">{selectedAction === 'reject' ? 'Alasan penolakan' : selectedAction === 'complete' ? 'Ringkasan hasil' : selectedAction === 'revision' ? 'Jawaban pelengkapan' : 'Catatan'}</label>
		<Textarea id="action-note" bind:value={actionText} class="min-h-32 resize-y" minlength={3} maxlength={selectedAction === 'revision' ? 5000 : 1000} placeholder="Tulis keterangan yang jelas dan dapat ditindaklanjuti" required aria-describedby="action-note-help" />
		<p id="action-note-help" class="muted-copy">3–{selectedAction === 'revision' ? '5000' : '1000'} karakter. Catatan akan tersimpan di histori tiket.</p>
		{#if actionError}<Alert.Root variant="destructive"><Alert.Description>{actionError}</Alert.Description></Alert.Root>{/if}
		<div class="dialog-actions"><Button variant="outline" class="min-h-11" disabled={actionBusy} onclick={() => (actionDialogOpen = false)}>Batal</Button><Button class="min-h-11" variant={selectedAction === 'reject' ? 'destructive' : 'default'} disabled={actionBusy} onclick={() => void submitAction()}>{#if actionBusy}Menyimpan…{:else}{actionTitle()}{/if}</Button></div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.back-link { display:inline-flex; min-height:2.75rem; align-items:center; gap:.45rem; color:var(--muted-foreground); font-size:var(--type-sm); text-decoration:none; }
	.back-link:hover { color:var(--foreground); }
	.back-link:focus-visible { outline:3px solid var(--ring); outline-offset:2px; }
	.detail-grid { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(17rem,.8fr); align-items:start; gap:1rem; }
	.main-column, aside { display:grid; gap:1rem; min-width:0; }
	:global(.action-list) { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(10rem,100%),max-content)); justify-content:end; align-items:center; gap:.55rem .65rem; }
	:global(.action-list > button) { min-width:10rem; }
	.action-note { grid-column:1 / -1; margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	:global(.action-dialog) { width:min(100% - 2rem, 34rem); max-height:calc(100dvh - 2rem); overflow-y:auto; }
	.action-label { margin-top:.2rem; font-size:var(--type-sm); font-weight:600; }
	.dialog-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.55rem; }
	.description { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; }
	:global(.sla-summary-content) { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
	.sla-summary-label, .sla-summary-copy { margin:0; }
	.sla-summary-label { font-size:var(--type-sm); font-weight:650; }
	.sla-summary-copy { margin-top:.25rem; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.45; }
	:global(.sla-badge) { border-color: transparent; }
	:global(.sla-badge--safe) { border-color: #8cc9a9; background: #e9f8ef; color: #166534; }
	:global(.sla-badge--warning) { border-color: #e5c36b; background: #fff7d6; color: #854d0e; }
	:global(.sla-badge--overdue) { border-color: color-mix(in srgb, var(--destructive) 38%, transparent); background: color-mix(in srgb, var(--destructive) 12%, transparent); color: var(--destructive); }
	:global(.dark .sla-badge--safe) { background: color-mix(in srgb, #16794b 25%, var(--card)); color: #8be0b0; }
	:global(.dark .sla-badge--warning) { background: color-mix(in srgb, #9a6700 25%, var(--card)); color: #f5d477; }
	:global(.session-list) { gap:.85rem; }
	.session-row, .total-row, .overall-row { display:flex; justify-content:space-between; align-items:flex-start; gap:.8rem; }
	.session-row > div:first-child { min-width:0; }
	.session-row p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.session-row strong, .total-row strong, .overall-row strong { font-size:var(--type-sm); }
	.overall-row > div:first-child { min-width:0; }
	.overall-row p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); }
	.session-time { display:grid; justify-items:end; gap:.3rem; white-space:nowrap; }
	.total-row { align-items:center; color:var(--muted-foreground); font-size:var(--type-sm); }
	.total-row strong { color:var(--foreground); }
	.muted-copy { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	:global(.timeline) { gap:0; }
	.timeline-item { position:relative; display:grid; grid-template-columns:1.6rem minmax(0,1fr); gap:.65rem; padding:0 0 1.2rem; }
	.timeline-item:not(:last-child)::after { position:absolute; top:1.55rem; bottom:0; left:.68rem; width:1px; background:var(--border); content:''; }
	.timeline-marker { z-index:1; display:grid; width:1.45rem; height:1.45rem; place-items:center; border:1px solid var(--border); border-radius:50%; background:var(--card); color:var(--muted-foreground); }
	.timeline-item strong { font-size:var(--type-sm); }
	.timeline-item p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.timeline-item small { display:block; margin-top:.3rem; color:var(--muted-foreground); font-size:var(--type-xs); overflow-wrap:anywhere; }
	@media(max-width:56rem) { .detail-grid { grid-template-columns:minmax(0,1fr); } }
	@media(max-width:40rem) {
		:global(.action-list) { grid-template-columns:repeat(2,minmax(0,1fr)); justify-content:stretch; }
		:global(.action-list > button) { width:100%; min-width:0; }
	}
	@media(max-width:26rem) {
		:global(.action-list) { grid-template-columns:1fr; }
		.session-row, .overall-row { flex-direction:column; gap:.55rem; }
		.session-time { display:flex; align-items:center; justify-content:space-between; width:100%; white-space:normal; }
		.session-time strong, .total-row strong { white-space:nowrap; }
		.total-row { align-items:flex-start; }
		.total-row span { min-width:0; overflow-wrap:anywhere; }
	}
</style>
