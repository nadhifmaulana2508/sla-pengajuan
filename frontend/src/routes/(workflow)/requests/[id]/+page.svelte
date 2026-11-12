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
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { authSession, clearAuthenticatedSession } from '#lib/features/auth/auth.store.js';
	import {
		downloadRequestAttachment, fetchRequest, fetchRequestAttachmentBlob, fetchRequestRejectionReasons, finishCentral, finishKorwil, forwardKorwilRequest, formatDate, formatElapsed,
		requestCentralDocuments, requestKorwilDocuments, slaStatusLabels, statusLabels, submitRevision
	} from '#lib/features/requests/requests.api.js';
	import type { RequestRejectionReason, RevisionDocumentCategory, RevisionFieldTarget } from '#lib/features/requests/requests.api.js';
	import { ArrowDownToLine, ArrowLeft, Building2, Check, ChevronDown, Clock3, Eye, FileText, Send, X } from '@lucide/svelte';

	type Detail = Awaited<ReturnType<typeof fetchRequest>>['data'];
	type FormAnswer = Detail['form_answer_groups'][number]['answers'][number];
	type RevisionOption = RevisionFieldTarget & { label: string; type?: FormAnswer['type'] };
	const rupiahFormatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
	let token = $state<string | null>(null);
	let role = $state<string | null>(null);
	let detail = $state<Detail | null>(null);
	let isLoading = $state(true);
	let errorMessage = $state('');
	let actionError = $state('');
	let actionNotice = $state('');
	let downloadError = $state('');
	let downloadBusy = $state<number | null>(null);
	let previewError = $state('');
	let previewBusy = $state<number | null>(null);
	let previewOpen = $state(false);
	let previewUrl = $state('');
	let previewFilename = $state('');
	let previewAttachmentId = $state<number | null>(null);
	let sessionDetailsOpen = $state(false);
	let timelineOpen = $state(false);
	let actionText = $state('');
	let requestedRevisionFields = $state<RevisionFieldTarget[]>([]);
	let requestedRevisionDocuments = $state<RevisionDocumentCategory[]>([]);
	let revisionValues = $state<Record<string, string | number>>({});
	let revisionFiles = $state<Partial<Record<RevisionDocumentCategory, File>>>({});
	let beritaAcaraFile = $state<File | null>(null);
	let rejectionReasons = $state<RequestRejectionReason[]>([]);
	let rejectionReasonId = $state('');
	let rejectionLoading = $state(false);
	let approvalConfirmed = $state(false);
	let actionBusy = $state(false);
	let actionDialogOpen = $state(false);
	let selectedAction = $state<'request-documents' | 'forward' | 'complete' | 'reject' | 'revision' | null>(null);
	let now = $state(Date.now());
	let timerId: ReturnType<typeof setInterval> | undefined;
	let revisionFieldOptions = $derived.by(() => {
		if (!detail) return [] as RevisionOption[];
		const fields: RevisionOption[] = [
			{ kind: 'subject', label: 'Perihal' },
			{ kind: 'description', label: 'Uraian pengajuan' },
			{ kind: 'inoffice_letter_number', label: 'Nomor surat InOffice' },
			{ kind: 'inoffice_letter_date', label: 'Tanggal surat InOffice' }
		];
		if (detail.form_answer_groups.length > 0) {
			for (const [entryIndex, group] of detail.form_answer_groups.entries()) {
				for (const answer of group.answers) fields.push({ kind: 'form_field', key: answer.key, entry_index: entryIndex, label: `${group.label} · ${answer.label}` });
			}
		} else {
			for (const answer of detail.form_answers) fields.push({ kind: 'form_field', key: answer.key, label: answer.label });
		}
		return fields;
	});
	let groupedAnswerRows = $derived.by(() => {
		const rows = new Map<string, Pick<FormAnswer, 'key' | 'label' | 'type'>>();
		for (const group of detail?.form_answer_groups ?? []) {
			for (const answer of group.answers) {
				if (!rows.has(answer.key)) rows.set(answer.key, { key: answer.key, label: answer.label, type: answer.type });
			}
		}
		return [...rows.values()];
	});
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
	let latestTimelineEvent = $derived(detail?.timeline.at(-1) ?? null);
	let backHref = $derived(role === 'branch_user' ? '/requests' : role === 'division_staff' ? '/inbox/central' : role === 'korwil_staff' || role === 'korwil_approver' ? '/inbox/korwil' : '/dashboard');
	let backLabel = $derived(role === 'branch_user' ? 'Daftar pengajuan' : role === 'division_staff' ? 'Antrean Divisi' : role === 'korwil_staff' || role === 'korwil_approver' ? 'Antrean Korwil' : 'Beranda');

	onMount(() => {
		const unsubscribe = authSession.subscribe((session) => { token = session.token; role = session.profile?.sla_access.role ?? null; });
		timerId = setInterval(() => { now = Date.now(); }, 30_000);
		void load();
		return () => {
			unsubscribe();
			if (timerId) clearInterval(timerId);
			if (previewUrl) URL.revokeObjectURL(previewUrl);
		};
	});

	$effect(() => {
		if (!previewOpen && previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = '';
			previewAttachmentId = null;
		}
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

	async function downloadAttachment(attachment: Detail['attachments'][number]): Promise<void> {
		if (!token || !detail) return;
		downloadError = '';
		downloadBusy = attachment.id;
		try {
			await downloadRequestAttachment(token, detail.request.id, attachment.id, attachment.original_filename);
		} catch (error) {
			downloadError = error instanceof Error ? error.message : 'Lampiran belum dapat diunduh.';
		} finally {
			downloadBusy = null;
		}
	}

	async function previewAttachment(attachment: Detail['attachments'][number]): Promise<void> {
		if (!token || !detail) return;
		previewError = '';
		previewBusy = attachment.id;
		try {
			const blob = await fetchRequestAttachmentBlob(token, detail.request.id, attachment.id);
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = URL.createObjectURL(blob);
			previewFilename = attachment.original_filename;
			previewAttachmentId = attachment.id;
			previewOpen = true;
		} catch (error) {
			previewError = error instanceof Error ? error.message : 'Pratinjau PDF belum dapat dibuka.';
		} finally {
			previewBusy = null;
		}
	}

	async function downloadPreviewAttachment(): Promise<void> {
		const attachment = detail?.attachments.find((item) => item.id === previewAttachmentId);
		if (attachment) await downloadAttachment(attachment);
	}

	function formatDateOnly(value: string): string {
		const [year, month, day] = value.split('-').map(Number);
		return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
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

	function revisionTargetId(target: RevisionFieldTarget): string {
		return `${target.kind}:${target.key ?? ''}:${target.entry_index ?? 'single'}`;
	}

	function currentRevisionValue(target: RevisionFieldTarget): string | number {
		if (!detail) return '';
		if (target.kind === 'subject') return detail.request.subject;
		if (target.kind === 'description') return detail.request.description;
		if (target.kind === 'inoffice_letter_number') return detail.request.inoffice_letter_number ?? '';
		if (target.kind === 'inoffice_letter_date') return detail.request.inoffice_letter_date ?? '';
		if (target.entry_index !== undefined && target.entry_index !== null) {
			const answer = detail.form_answer_groups[target.entry_index]?.answers.find((item) => item.key === target.key);
			return answer?.value ?? '';
		}
		return detail.form_answers.find((item) => item.key === target.key)?.value ?? '';
	}

	function answerType(target: RevisionFieldTarget): NonNullable<Detail>['form_fields'][number]['type'] {
		return detail?.form_fields.find((field) => field.key === target.key)?.type ?? 'text';
	}

	function updateRevisionValue(target: RevisionFieldTarget, value: string): void {
		const key = revisionTargetId(target);
		revisionValues = { ...revisionValues, [key]: value };
	}

	function attachmentLabel(category: string): string {
		if (category === 'inoffice_letter') return 'Surat InOffice';
		if (category === 'berita_acara') return 'Berita Acara';
		if (category === 'supporting_document') return 'Dokumen pendukung';
		return 'Lampiran';
	}

	function decisionLabel(type: string): string {
		if (type === 'forwarded') return 'Disetujui untuk diteruskan';
		if (type === 'approved') return 'Disetujui';
		return 'Ditolak';
	}

	function snapshotValue(snapshot: Record<string, unknown>, target: RevisionFieldTarget): unknown {
		if (target.kind !== 'form_field') return snapshot[target.kind === 'subject' ? 'subject' : target.kind === 'description' ? 'description' : target.kind];
		const answers = snapshot.form_answers && typeof snapshot.form_answers === 'object'
			? snapshot.form_answers as Record<string, unknown> : {};
		if (target.entry_index !== undefined && target.entry_index !== null) {
			const entries = answers.__entries;
			const entry = Array.isArray(entries) ? entries[target.entry_index] : null;
			return entry && typeof entry === 'object' ? (entry as Record<string, unknown>)[target.key ?? ''] : undefined;
		}
		return answers[target.key ?? ''];
	}

	function displaySnapshotValue(value: unknown, type?: FormAnswer['type']): string {
		if (value === undefined || value === null || value === '') return 'Kosong';
		if (type === 'currency') return rupiahFormatter.format(Number(value));
		return String(value);
	}

	async function downloadDecisionAttachment(attachmentId: number): Promise<void> {
		const attachment = detail?.attachments.find((item) => item.id === attachmentId);
		if (attachment) await downloadAttachment(attachment);
	}

	function answerFor(group: Detail['form_answer_groups'][number], key: string): FormAnswer | undefined {
		return group.answers.find((answer) => answer.key === key);
	}

	function tableFieldLabel(label: string): string {
		const normalized = label.trim().toLocaleLowerCase('id-ID');
		if (['rekening', 'no rekening', 'nomor rekening'].includes(normalized)) return 'No Rekening';
		if (['nama', 'nama nasabah'].includes(normalized)) return 'Nama';
		return label;
	}

	function formatAnswer(answer: FormAnswer | undefined, fallbackType?: FormAnswer['type']): string {
		if (!answer || answer.value === '') return 'Tidak diisi';
		if ((answer.type ?? fallbackType) === 'currency') {
			return rupiahFormatter.format(Number(answer.value));
		}
		return String(answer.value);
	}

	function timelineLabel(action: string, status: string, unitToType: string): string {
		if (action === 'submitted') return unitToType === 'central' ? 'Dikirim langsung ke Divisi Pusat' : 'Dikirim ke Korwil';
		if (action === 'claimed') return 'Pengajuan diambil';
		if (action === 'request_documents') return 'Kelengkapan diminta';
		if (action === 'forwarded_to_central') return 'Diteruskan ke Divisi Pusat';
		if (action === 'branch_revision_submitted') return 'Cabang mengirim pelengkapan';
		if (action === 'completed') return 'Pengajuan selesai';
		if (action === 'rejected') return 'Pengajuan ditolak';
		return statusLabels[status] ?? action;
	}

	let approvalText = $derived.by(() => {
		if (!detail) return '';
		if (selectedAction === 'forward') return `Saya telah memeriksa dan menyetujui penerusan pengajuan ${detail.request.request_number} ke ${detail.request.nama_divisi ?? 'Divisi Pusat'}.`;
		const letter = detail.request.inoffice_letter_number
			? ` atas surat InOffice nomor ${detail.request.inoffice_letter_number}${detail.request.inoffice_letter_date ? ` tanggal ${formatDateOnly(detail.request.inoffice_letter_date)}` : ''}`
			: '';
		return `Saya menyetujui pengajuan ${detail.request.request_number}${letter}.`;
	});

	async function openAction(action: NonNullable<typeof selectedAction>): Promise<void> {
		selectedAction = action;
		actionText = '';
		actionError = '';
		approvalConfirmed = false;
		beritaAcaraFile = null;
		rejectionReasonId = '';
		rejectionReasons = [];
		revisionFiles = {};
		requestedRevisionFields = [];
		requestedRevisionDocuments = [];
		revisionValues = {};
		if (action === 'revision' && detail?.revision_request) {
			requestedRevisionFields = detail.revision_request.fields;
			requestedRevisionDocuments = detail.revision_request.documents;
			revisionValues = Object.fromEntries(requestedRevisionFields.map((target) => [revisionTargetId(target), currentRevisionValue(target)]));
		}
		actionDialogOpen = true;
		if (action === 'reject' && token && detail) {
			rejectionLoading = true;
			try { rejectionReasons = (await fetchRequestRejectionReasons(token, detail.request.id)).data.reasons; }
			catch (error) { actionError = error instanceof Error ? error.message : 'Pilihan alasan belum dapat dimuat.'; }
			finally { rejectionLoading = false; }
		}
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
		if (selectedAction === 'request-documents' && requestedRevisionFields.length + requestedRevisionDocuments.length === 0) {
			actionError = 'Pilih setidaknya satu kolom atau dokumen yang perlu dilengkapi.'; return;
		}
		if (selectedAction === 'reject' && !rejectionReasonId) { actionError = 'Pilih alasan penolakan.'; return; }
		if (['forward', 'complete'].includes(selectedAction) && !approvalConfirmed) { actionError = 'Centang konfirmasi persetujuan sebelum melanjutkan.'; return; }
		actionBusy = true;
		actionError = '';
		try {
			let revisionResumed = false;
			let returnedToKorwil = false;
			if (selectedAction === 'revision') {
				const fields = detail.revision_request?.fields ?? [];
				const updates = fields.map((target) => {
					const raw = revisionValues[revisionTargetId(target)] ?? '';
					const type = target.kind === 'form_field' ? answerType(target) : 'text';
					const value = type === 'number' || type === 'currency'
						? String(raw).trim() === '' ? '' : Number(raw)
						: String(raw);
					return { ...target, value };
				});
				const result = await submitRevision(token, detail.request.id, { response: text, updates, files: revisionFiles });
				revisionResumed = result.data.resumed_to_previous_handler;
				returnedToKorwil = result.data.returned_to_korwil;
			}
			else if (selectedAction === 'request-documents') {
				const input = { note: text, fields: requestedRevisionFields, documents: requestedRevisionDocuments };
				if (detail.request.current_unit_type === 'korwil') await requestKorwilDocuments(token, detail.request.id, input);
				else await requestCentralDocuments(token, detail.request.id, input);
			}
			else if (selectedAction === 'forward') await forwardKorwilRequest(token, detail.request.id, text, { approval_confirmed: true, berita_acara: beritaAcaraFile });
			else if (selectedAction === 'complete' && detail.request.current_unit_type === 'korwil') await finishKorwil(token, detail.request.id, 'completed', text, { approval_confirmed: true, berita_acara: beritaAcaraFile });
			else if (selectedAction === 'complete') await finishCentral(token, detail.request.id, 'completed', text, { approval_confirmed: true, berita_acara: beritaAcaraFile });
			else if (selectedAction === 'reject' && detail.request.current_unit_type === 'korwil') await finishKorwil(token, detail.request.id, 'rejected', text, { rejection_reason_id: Number(rejectionReasonId) });
			else await finishCentral(token, detail.request.id, 'rejected', text, { rejection_reason_id: Number(rejectionReasonId) });
			actionNotice = selectedAction === 'revision'
				? returnedToKorwil
					? 'Pelengkapan mengubah nilai kredit. Tiket kembali ke Korwil untuk pemeriksaan ulang.'
					: revisionResumed
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

	function toggleRevisionField(target: RevisionFieldTarget): void {
		const id = revisionTargetId(target);
		const selected = requestedRevisionFields.some((item) => revisionTargetId(item) === id);
		requestedRevisionFields = selected
			? requestedRevisionFields.filter((item) => revisionTargetId(item) !== id)
			: [...requestedRevisionFields, target];
	}

	function toggleRevisionDocument(category: RevisionDocumentCategory): void {
		requestedRevisionDocuments = requestedRevisionDocuments.includes(category)
			? requestedRevisionDocuments.filter((item) => item !== category)
			: [...requestedRevisionDocuments, category];
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
		<AppPageHeading id="page-title" meta={`${item.request_number} · ${formatDate(item.submitted_at)}`} title={item.subject} description={`${item.nama_kantor} · Korwil ${item.korwil}`} flush>
			{#snippet actions()}
				<div class="heading-badges">
					<Badge variant={item.status === 'rejected' ? 'destructive' : item.status.startsWith('in_progress') ? 'default' : 'secondary'} class={item.status === 'rejected' ? 'status-badge status-badge--risk' : ''}>{statusLabels[item.status] ?? item.status}</Badge>
					<Badge variant="outline" class={slaClass(item.sla_status)}>{slaLabel(item.sla_status)}</Badge>
				</div>
			{/snippet}
		</AppPageHeading>
		{#if actionNotice}<Alert.Root><Alert.Title>Perubahan tersimpan</Alert.Title><Alert.Description>{actionNotice}</Alert.Description></Alert.Root>{/if}
		{#if detail.capabilities.can_request_documents || detail.capabilities.can_forward_to_central || detail.capabilities.can_complete || detail.capabilities.can_reject || detail.capabilities.can_submit_revision}
			<Card.Root size="sm"><Card.Header><Card.Title>Tindakan pengajuan</Card.Title><Card.Description>{detail.capabilities.can_submit_revision ? 'Perbarui item yang diminta dan kirim pada tiket yang sama.' : 'Keputusan dan perpindahan tiket dicatat pada histori.'}</Card.Description></Card.Header><Card.Content class="action-list">
				{#if detail.capabilities.can_request_documents}<Button variant="outline" class="min-h-11" onclick={() => void openAction('request-documents')}><FileText class="size-4" aria-hidden="true" />Minta kelengkapan</Button>{/if}
				{#if detail.capabilities.can_forward_to_central}<Button class="min-h-11" onclick={() => void openAction('forward')}><Send class="size-4" aria-hidden="true" />Setujui dan teruskan</Button>{/if}
				{#if detail.capabilities.can_complete}<Button class="min-h-11" onclick={() => void openAction('complete')}><Check class="size-4" aria-hidden="true" />Setujui dan selesaikan</Button>{/if}
				{#if detail.capabilities.can_reject}<Button variant="destructive" class="min-h-11" onclick={() => void openAction('reject')}><X class="size-4" aria-hidden="true" />Tolak</Button>{/if}
				{#if detail.capabilities.can_submit_revision}<Button class="min-h-11" onclick={() => void openAction('revision')}><Send class="size-4" aria-hidden="true" />Kirim pelengkapan</Button>{/if}
			</Card.Content></Card.Root>
		{/if}
		{#if detail.revision_request && item.status === 'waiting_branch_revision'}
			<Card.Root size="sm" class="revision-summary"><Card.Header><Card.Title>Yang perlu dilengkapi · Putaran {detail.revision_request.revision_number}</Card.Title><Card.Description>{detail.revision_request.note}</Card.Description></Card.Header><Card.Content><ul>{#each detail.revision_request.fields as field}<li>{field.label}</li>{/each}{#each detail.revision_request.documents as document}<li>{attachmentLabel(document)} (PDF)</li>{/each}</ul></Card.Content></Card.Root>
		{/if}
		<div class="detail-grid">
			<div class="main-column">
				<Card.Root size="sm"><Card.Header><Card.Title><FileText class="mr-2 inline size-4" aria-hidden="true" />Uraian pengajuan</Card.Title><Card.Description>{item.authority_type === 'central' ? `${item.nama_divisi ?? 'Pusat'} · ${item.nama_pekerjaan ?? 'Jenis pekerjaan'}` : item.nama_pekerjaan ? `Kewenangan Korwil · Form ${item.nama_pekerjaan}` : 'Kewenangan Korwil'}</Card.Description></Card.Header><Card.Content><p class="description">{item.description}</p></Card.Content></Card.Root>
				{#if detail.form_answers.length > 0 || detail.form_answer_groups.length > 0}
					<Card.Root size="sm"><Card.Header><Card.Title>Data tambahan</Card.Title><Card.Description>Jawaban disimpan sesuai versi form saat tiket dibuat.</Card.Description></Card.Header><Card.Content>
						{#if detail.form_answer_groups.length > 1}
							<p class="comparison-note">Setiap baris mewakili satu rekening/fasilitas.</p>
							<Table.Root label="Data rekening atau fasilitas" class="answer-table-scroll" tableClass="answer-comparison-table">
								<Table.Caption class="sr-only">Daftar rekening atau fasilitas yang diajukan.</Table.Caption>
								<Table.Header><Table.Row><Table.Head scope="col" class="answer-index-heading">No</Table.Head>{#each groupedAnswerRows as row (row.key)}<Table.Head scope="col" class="answer-value-heading">{tableFieldLabel(row.label)}</Table.Head>{/each}</Table.Row></Table.Header>
								<Table.Body>{#each detail.form_answer_groups as group, index (group.label)}<Table.Row><Table.Cell class="answer-index-cell">{index + 1}</Table.Cell>{#each groupedAnswerRows as row (row.key)}<Table.Cell class="answer-value-cell">{formatAnswer(answerFor(group, row.key), row.type)}</Table.Cell>{/each}</Table.Row>{/each}</Table.Body>
							</Table.Root>
						{:else if detail.form_answer_groups.length === 1}
							{#each detail.form_answer_groups as group (group.label)}<section class="answer-group"><h3>{group.label}</h3><dl class="answer-list">{#each group.answers as answer (answer.key)}<div><dt>{answer.label}</dt><dd>{formatAnswer(answer)}</dd></div>{/each}</dl></section>{/each}
						{:else}
							<dl class="answer-list">{#each detail.form_answers as answer (answer.key)}<div><dt>{answer.label}</dt><dd>{formatAnswer(answer)}</dd></div>{/each}</dl>
						{/if}
					</Card.Content></Card.Root>
				{/if}
				{#if item.inoffice_letter_number || item.inoffice_letter_date || detail.attachments.length > 0}
					<Card.Root size="sm"><Card.Header><Card.Title>Surat dan lampiran</Card.Title><Card.Description>Dokumen privat pengajuan dan pelengkapan.</Card.Description></Card.Header><Card.Content class="letter-detail">
						{#if item.inoffice_letter_number || item.inoffice_letter_date}<dl class="answer-list"><div><dt>Nomor surat InOffice</dt><dd>{item.inoffice_letter_number || 'Tidak diisi'}</dd></div><div><dt>Tanggal surat</dt><dd>{item.inoffice_letter_date ? formatDateOnly(item.inoffice_letter_date) : 'Tidak diisi'}</dd></div></dl>{/if}
						{#each detail.attachments as attachment (attachment.id)}<div class="attachment-row"><div><strong>{attachmentLabel(attachment.category)} · {attachment.original_filename}</strong><p>PDF · {new Intl.NumberFormat('id-ID').format(attachment.size_bytes / 1024)} KB · {formatDate(attachment.created_at)}</p></div><div class="attachment-actions"><Button variant="outline" class="min-h-11" disabled={previewBusy === attachment.id} onclick={() => void previewAttachment(attachment)}>{#if previewBusy === attachment.id}Memuat…{:else}<Eye class="size-4" aria-hidden="true" />Lihat{/if}</Button><Button variant="outline" class="min-h-11" disabled={downloadBusy === attachment.id} onclick={() => void downloadAttachment(attachment)}>{#if downloadBusy === attachment.id}Mengunduh…{:else}<ArrowDownToLine class="size-4" aria-hidden="true" />Unduh PDF{/if}</Button></div></div>{/each}
						{#if downloadError || previewError}<Alert.Root variant="destructive"><Alert.Description>{downloadError || previewError}</Alert.Description></Alert.Root>{/if}
					</Card.Content></Card.Root>
				{/if}
				{#if detail.revision_history.length > 0}
					<Card.Root size="sm"><Card.Header><Card.Title>Riwayat pelengkapan</Card.Title><Card.Description>Setiap putaran menyimpan permintaan dan snapshot data sebelum serta sesudah perubahan.</Card.Description></Card.Header><Card.Content class="revision-history-list">
						{#each detail.revision_history as revision (revision.id)}<article class="revision-history-item"><div class="decision-heading"><strong>Putaran {revision.revision_number}</strong><span>{formatDate(revision.requested_at)}</span></div><p class="muted-copy">Diminta oleh {revision.requested_by_name ?? 'Petugas'}: {revision.request_note}</p>{#if revision.snapshot_after}<div class="revision-diff">{#each revision.fields as field (revisionTargetId(field))}<div><span>{field.label}</span><strong>{displaySnapshotValue(snapshotValue(revision.snapshot_before, field), field.type)} <span aria-hidden="true">→</span> {displaySnapshotValue(snapshotValue(revision.snapshot_after, field), field.type)}</strong></div>{/each}</div>{#if revision.response_note}<p class="muted-copy">Jawaban Cabang: {revision.response_note}</p>{/if}<p class="muted-copy">Dikirim oleh {revision.response_by_name ?? 'Pegawai'} · {revision.submitted_at ? formatDate(revision.submitted_at) : ''}</p>{:else}<Badge variant="outline">Menunggu pelengkapan Cabang</Badge>{/if}{#each detail.attachments.filter((attachment) => attachment.revision_id === revision.id) as attachment (attachment.id)}<div class="attachment-row"><div><strong>{attachmentLabel(attachment.category)} · {attachment.original_filename}</strong></div><Button variant="outline" class="min-h-10" disabled={downloadBusy === attachment.id} onclick={() => void downloadAttachment(attachment)}><ArrowDownToLine class="size-4" aria-hidden="true" />Unduh PDF</Button></div>{/each}</article>{/each}
					</Card.Content></Card.Root>
				{/if}
			</div>
			<aside>
				<Card.Root size="sm"><Card.Header><Card.Title><Clock3 class="mr-2 inline size-4" aria-hidden="true" />Waktu proses</Card.Title><Card.Description>Umur tiket dan akumulasi waktu setiap unit.</Card.Description></Card.Header><Card.Content class="process-overview">
					<div class="overall-row"><div><strong>Total umur tiket</strong><p>Sejak pertama kali dikirim Cabang</p></div><div class="session-time"><strong>{formatElapsed(overallElapsed)}</strong><Badge variant={item.closed_at ? 'secondary' : 'outline'}>{item.closed_at ? 'Ditutup' : 'Berjalan'}</Badge></div></div>
					{#if totals.length > 0}<Separator />{#each totals as total (total.key)}<div class="total-row"><span>Total {total.unit}</span><strong>{formatElapsed(total.seconds)}</strong></div>{/each}{/if}
					{#if detail.sessions.length > 0}<Button type="button" variant="outline" class="min-h-11 disclosure-button" aria-expanded={sessionDetailsOpen} aria-controls="request-session-details" onclick={() => (sessionDetailsOpen = !sessionDetailsOpen)}><span>{sessionDetailsOpen ? 'Tutup rincian sesi' : `Lihat rincian sesi (${detail.sessions.length})`}</span><ChevronDown class={`size-4 transition-transform ${sessionDetailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></Button>{/if}
					{#if sessionDetailsOpen}<div id="request-session-details" class="session-list">
						{#each detail.sessions as session (session.id)}<div class="session-row"><div><strong>{unitLabel(session.unit_type, session.unit_code)}</strong><p>{sessionDescription(session)}</p>{#if queueWait(session) !== null}<p>Waktu tunggu sebelum diambil: {formatElapsed(queueWait(session))}</p>{/if}</div><div class="session-time"><strong>{formatElapsed(elapsedFor(session))}</strong>{#if session.ended_at}<Badge variant="secondary">Selesai</Badge>{:else if session.started_at}<Badge variant="outline">Berjalan</Badge>{:else}<Badge variant="outline">Menunggu</Badge>{/if}</div></div>{/each}
					</div>{/if}
				</Card.Content></Card.Root>
				<Card.Root size="sm"><Card.Header class="timeline-header"><div class="timeline-heading"><Card.Title><Building2 class="mr-2 inline size-4" aria-hidden="true" />Alur pengajuan</Card.Title><Card.Description>Riwayat perpindahan tercatat dengan nomor yang sama.</Card.Description>{#if latestTimelineEvent}<p class="timeline-latest">Terakhir: {timelineLabel(latestTimelineEvent.action_name, latestTimelineEvent.status_to, latestTimelineEvent.unit_to_type)} · {formatDate(latestTimelineEvent.created_at)}</p>{/if}</div><Button type="button" variant="outline" class="min-h-11 timeline-toggle" aria-expanded={timelineOpen} aria-controls="request-timeline" onclick={() => (timelineOpen = !timelineOpen)}><span>{timelineOpen ? 'Tutup alur' : `Lihat alur (${detail.timeline.length})`}</span><ChevronDown class={`size-4 transition-transform ${timelineOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></Button></Card.Header>{#if timelineOpen}<Card.Content id="request-timeline" class="timeline">
					{#each detail.timeline as event, index (event.id)}<div class="timeline-item"><span class="timeline-marker">{#if index === detail.timeline.length - 1}<Send class="size-3" aria-hidden="true" />{:else}<Check class="size-3" aria-hidden="true" />{/if}</span><div><strong>{timelineLabel(event.action_name, event.status_to, event.unit_to_type)}</strong><p>{event.actor_name ?? 'Pegawai'} · {formatDate(event.created_at)}</p><small>{event.unit_from_code ? `${event.unit_from_type} ${event.unit_from_code} → ` : 'Dari Cabang → '}{event.unit_to_type} {event.unit_to_code}</small>{#if event.reason}<p>{event.reason}</p>{/if}</div></div>{/each}
				</Card.Content>{/if}</Card.Root>
				{#if detail.decisions.length > 0}
					<Card.Root size="sm"><Card.Header><Card.Title>Keputusan</Card.Title><Card.Description>Konfirmasi, alasan, dan dokumen yang dicatat saat keputusan dibuat.</Card.Description></Card.Header><Card.Content class="decision-list">
						{#each detail.decisions as decision (decision.id)}<article class="decision-item"><div class="decision-heading"><strong>{decisionLabel(decision.decision_type)}</strong><span>{formatDate(decision.created_at)}</span></div><p>{decision.actor_name ?? 'Pegawai'} · {unitLabel(decision.unit_type, decision.unit_code)}</p>{#if decision.reason_label_snapshot}<p><strong>Alasan:</strong> {decision.reason_label_snapshot}</p>{/if}<p>{decision.note}</p>{#if decision.confirmation_text}<blockquote>{decision.confirmation_text}</blockquote>{/if}{#if decision.attachment_id && decision.attachment_filename}<Button variant="outline" class="min-h-10" disabled={downloadBusy === decision.attachment_id} onclick={() => void downloadDecisionAttachment(decision.attachment_id!)}><ArrowDownToLine class="size-4" aria-hidden="true" />Berita Acara · {decision.attachment_filename}</Button>{/if}</article>{/each}
					</Card.Content></Card.Root>
				{/if}
			</aside>
		</div>
	{/if}
</section>

<Dialog.Root bind:open={actionDialogOpen}>
	<Dialog.Content class="action-dialog" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>{actionTitle()}</Dialog.Title>
			<Dialog.Description>{actionPrompt()}</Dialog.Description>
		</Dialog.Header>
		{#if selectedAction === 'request-documents'}
			<section class="revision-picker" aria-labelledby="revision-fields-label">
				<div><h3 id="revision-fields-label">Kolom yang perlu diperbaiki</h3><p>Pilih hanya bagian yang harus diubah Cabang.</p></div>
				<div class="revision-checklist">
					{#each revisionFieldOptions as target (revisionTargetId(target))}
						<label class="revision-check"><input type="checkbox" checked={requestedRevisionFields.some((item) => revisionTargetId(item) === revisionTargetId(target))} onchange={() => toggleRevisionField(target)} /><span>{target.label}</span></label>
					{/each}
				</div>
				<div><h3>Dokumen yang perlu diunggah</h3><p>File yang diminta harus PDF.</p></div>
				<div class="revision-checklist">
					{#each [{ value: 'inoffice_letter', label: 'Surat InOffice' }, { value: 'supporting_document', label: 'Dokumen pendukung' }] as document (document.value)}
						<label class="revision-check"><input type="checkbox" checked={requestedRevisionDocuments.includes(document.value as RevisionDocumentCategory)} onchange={() => toggleRevisionDocument(document.value as RevisionDocumentCategory)} /><span>{document.label}</span></label>
					{/each}
				</div>
			</section>
		{:else if selectedAction === 'revision' && detail?.revision_request}
			<section class="revision-editor" aria-label="Kolom revisi yang diminta">
				<div class="revision-request-note"><strong>Catatan petugas</strong><p>{detail.revision_request.note}</p></div>
				{#each detail.revision_request.fields as target (revisionTargetId(target))}
					{@const inputType = target.kind === 'form_field' ? answerType(target) : target.kind === 'inoffice_letter_date' ? 'date' : 'text'}
					<div class="revision-input"><label class="action-label" for={`revision-${revisionTargetId(target)}`}>{target.label}</label>
						{#if target.kind === 'description' || inputType === 'textarea'}
							<Textarea id={`revision-${revisionTargetId(target)}`} value={String(revisionValues[revisionTargetId(target)] ?? '')} oninput={(event) => updateRevisionValue(target, event.currentTarget.value)} class="min-h-24 resize-y" maxlength={5000} />
						{:else if inputType === 'select'}
							{@const field = detail.form_fields.find((item) => item.key === target.key)}
							<SearchableSelect id={`revision-${revisionTargetId(target)}`} label={target.label} options={(field?.options ?? []).map((value) => ({ value, label: value }))} value={String(revisionValues[revisionTargetId(target)] ?? '')} onValueChange={(value) => updateRevisionValue(target, value)} placeholder="Pilih jawaban" searchPlaceholder={`Cari ${target.label.toLocaleLowerCase('id-ID')}...`} />
						{:else}
							<Input id={`revision-${revisionTargetId(target)}`} type={inputType === 'currency' || inputType === 'number' ? 'number' : inputType} min={inputType === 'currency' ? '0' : undefined} value={String(revisionValues[revisionTargetId(target)] ?? '')} oninput={(event) => updateRevisionValue(target, event.currentTarget.value)} />
						{/if}
					</div>
				{/each}
				{#each detail.revision_request.documents as category (category)}
					<label class="action-label file-field">{attachmentLabel(category)} · PDF<input type="file" accept="application/pdf,.pdf" onchange={(event) => { const file = event.currentTarget.files?.[0]; if (file) revisionFiles = { ...revisionFiles, [category]: file }; }} /><span class="muted-copy">{revisionFiles[category]?.name ?? 'Pilih file PDF, maksimal 10 MB.'}</span></label>
				{/each}
			</section>
		{/if}
		{#if selectedAction === 'reject'}
			<div class="action-field"><label class="action-label" for="rejection-reason">Alasan penolakan</label><SearchableSelect id="rejection-reason" label="Alasan penolakan" options={rejectionReasons.map((reason) => ({ value: String(reason.id), label: reason.label, keywords: [reason.scope_type] }))} value={rejectionReasonId} onValueChange={(value) => (rejectionReasonId = value)} placeholder={rejectionLoading ? 'Memuat alasan…' : 'Pilih alasan'} searchPlaceholder="Cari alasan penolakan..." disabled={rejectionLoading || rejectionReasons.length === 0} />{#if !rejectionLoading && rejectionReasons.length === 0}<p class="muted-copy">Belum ada alasan aktif. Minta Admin atau pengelola Divisi menambahkannya.</p>{/if}</div>
		{/if}
		{#if selectedAction === 'forward' || selectedAction === 'complete'}
			<div class="approval-confirmation"><p>{approvalText}</p><label class="revision-check"><input type="checkbox" bind:checked={approvalConfirmed} /><span>Saya sudah memeriksa dan menyetujui {selectedAction === 'forward' ? 'penerusan pengajuan ini' : 'hasil penanganan pengajuan ini'}.</span></label></div>
			<label class="action-label file-field">Berita Acara · PDF (opsional)<input type="file" accept="application/pdf,.pdf" onchange={(event) => (beritaAcaraFile = event.currentTarget.files?.[0] ?? null)} /><span class="muted-copy">{beritaAcaraFile?.name ?? 'Pilih file PDF, maksimal 10 MB.'}</span></label>
		{/if}
		{#if selectedAction === 'revision'}<p class="muted-copy">Isi uraian pelengkapan di bawah. File surat awal tetap dapat diunduh pada detail tiket.</p>{/if}
		<label class="action-label" for="action-note">{selectedAction === 'reject' ? 'Keterangan penolakan' : selectedAction === 'complete' ? 'Ringkasan hasil' : selectedAction === 'revision' ? 'Catatan pelengkapan' : 'Catatan pemeriksaan'}</label>
		<Textarea id="action-note" bind:value={actionText} class="min-h-32 resize-y" minlength={3} maxlength={selectedAction === 'revision' ? 5000 : 1000} placeholder="Tulis keterangan yang jelas dan dapat ditindaklanjuti" required aria-describedby="action-note-help" />
		<p id="action-note-help" class="muted-copy">3–{selectedAction === 'revision' ? '5000' : '1000'} karakter. Catatan akan tersimpan di histori tiket.</p>
		{#if actionError}<Alert.Root variant="destructive"><Alert.Description>{actionError}</Alert.Description></Alert.Root>{/if}
		<div class="dialog-actions"><Button variant="outline" class="min-h-11" disabled={actionBusy} onclick={() => (actionDialogOpen = false)}>Batal</Button><Button class="min-h-11" variant={selectedAction === 'reject' ? 'destructive' : 'default'} disabled={actionBusy} onclick={() => void submitAction()}>{#if actionBusy}Menyimpan…{:else}{actionTitle()}{/if}</Button></div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content class="pdf-preview-dialog">
		<Dialog.Header class="pdf-preview-header">
			<Dialog.Title>{previewFilename || 'Pratinjau PDF'}</Dialog.Title>
			<Dialog.Description>Dokumen privat tiket ini. Akses diperiksa sebelum file ditampilkan.</Dialog.Description>
		</Dialog.Header>
		{#if previewUrl}<iframe class="pdf-preview-frame" src={previewUrl} title={`Pratinjau PDF: ${previewFilename}`}></iframe>{/if}
		{#if downloadError}<Alert.Root variant="destructive"><Alert.Description>{downloadError}</Alert.Description></Alert.Root>{/if}
		<div class="pdf-preview-actions">
			<Button type="button" variant="outline" class="min-h-11" onclick={() => (previewOpen = false)}>Tutup</Button>
			<Button type="button" class="min-h-11" disabled={downloadBusy === previewAttachmentId} onclick={() => void downloadPreviewAttachment()}>{#if downloadBusy === previewAttachmentId}Mengunduh…{:else}<ArrowDownToLine class="size-4" aria-hidden="true" />Unduh PDF{/if}</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.back-link { display:inline-flex; min-height:2.75rem; align-items:center; gap:.45rem; color:var(--muted-foreground); font-size:var(--type-sm); text-decoration:none; }
	.back-link:hover { color:var(--foreground); }
	.back-link:focus-visible { outline:3px solid var(--ring); outline-offset:2px; }
	.detail-grid { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(17rem,.8fr); align-items:start; gap:.8rem; }
	.main-column, aside { display:grid; gap:.75rem; min-width:0; }
	.heading-badges { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:.4rem; }
	:global(.action-list) { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(10rem,100%),max-content)); justify-content:end; align-items:center; gap:.55rem .65rem; }
	:global(.action-list > button) { min-width:10rem; }
	:global(.action-dialog) { width:min(100% - 2rem, 34rem); max-height:calc(100dvh - 2rem); overflow-y:auto; }
	.action-label { margin-top:.2rem; font-size:var(--type-sm); font-weight:600; }
	.action-field, .revision-input { display:grid; min-width:0; gap:.45rem; }
	:global(.revision-summary ul) { display:grid; gap:.4rem; margin:0; padding-left:1.2rem; color:var(--muted-foreground); font-size:var(--type-sm); }
	.revision-picker, .revision-editor { display:grid; gap:.9rem; }
	.revision-picker h3 { margin:0; font-size:var(--type-sm); font-weight:600; }
	.revision-picker p { margin:.2rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); }
	.revision-checklist { display:grid; max-height:14rem; overflow-y:auto; gap:.25rem; padding:.4rem; border:1px solid var(--border); border-radius:var(--radius); }
	.revision-check { display:flex; min-height:2.75rem; align-items:center; gap:.6rem; padding:.45rem .55rem; border-radius:calc(var(--radius) - 2px); font-size:var(--type-sm); cursor:pointer; }
	.revision-check:hover { background:var(--muted); }
	.revision-check input { width:1rem; height:1rem; flex:none; accent-color:var(--primary); }
	.revision-request-note { padding:.75rem; border-left:2px solid var(--primary); background:var(--muted); }
	.revision-request-note p { margin:.3rem 0 0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:var(--type-sm); }
	.file-field { display:grid; gap:.35rem; }
	.file-field input { max-width:100%; padding:.45rem; border:1px solid var(--input); border-radius:var(--radius); font-size:var(--type-sm); }
	.approval-confirmation { display:grid; gap:.55rem; padding:.75rem; border:1px solid var(--border); border-radius:var(--radius); }
	.approval-confirmation p { margin:0; font-size:var(--type-sm); line-height:1.5; }
	:global(.decision-list), :global(.revision-history-list) { gap:.7rem; }
	.revision-history-item { display:grid; min-width:0; gap:.5rem; padding:.75rem 0; border-bottom:1px solid var(--border); }
	.revision-history-item:first-child { padding-top:0; }
	.revision-history-item:last-child { padding-bottom:0; border-bottom:0; }
	.revision-diff { display:grid; gap:.35rem; }
	.revision-diff div { display:grid; grid-template-columns:minmax(8rem,.6fr) minmax(0,1.4fr); gap:.5rem; font-size:var(--type-xs); }
	.revision-diff div > span { color:var(--muted-foreground); }
	.revision-diff strong { min-width:0; overflow-wrap:anywhere; font-weight:500; }
	.decision-item { display:grid; gap:.35rem; padding:.75rem 0; border-bottom:1px solid var(--border); }
	.decision-item:first-child { padding-top:0; }
	.decision-item:last-child { padding-bottom:0; border-bottom:0; }
	.decision-heading { display:flex; flex-wrap:wrap; justify-content:space-between; gap:.35rem .7rem; }
	.decision-heading span, .decision-item p { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.decision-item blockquote { margin:0; padding:.6rem .7rem; border-left:2px solid var(--primary); background:var(--muted); font-size:var(--type-sm); }
	.dialog-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.55rem; }
	.description { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.55; }
	:global(.letter-detail) { gap:.75rem; }
	.attachment-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.7rem; padding:.75rem; border:1px solid var(--border); border-radius:var(--radius); }
	.attachment-row > div { min-width:0; }
	:global(.attachment-actions) { display:flex; flex-wrap:wrap; align-items:center; gap:.45rem; }
	.attachment-row strong { display:block; overflow-wrap:anywhere; font-size:var(--type-sm); }
	.attachment-row p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); }
	.answer-list { display:grid; gap:.55rem; margin:0; }
	.answer-group { display:grid; min-width:0; gap:.65rem; padding:.8rem; border:1px solid var(--border); border-radius:var(--radius); }
	.answer-group h3 { margin:0; font-size:var(--type-sm); font-weight:600; }
	.comparison-note { margin:0 0 .65rem; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	:global(.answer-table-scroll) { max-width:100%; border:1px solid var(--border); border-radius:var(--radius); outline-offset:2px; }
	:global(.answer-table-scroll:focus-visible) { outline:2px solid var(--ring); }
	:global(.answer-comparison-table) { width:max-content; min-width:100%; }
	:global(.answer-index-heading), :global(.answer-index-cell) { position:sticky; left:0; z-index:1; width:3.5rem; min-width:3.5rem; background:var(--card); text-align:center; }
	:global(.answer-value-heading), :global(.answer-value-cell) { width:14rem; min-width:12rem; max-width:22rem; white-space:normal; }
	:global(.answer-value-cell) { overflow-wrap:anywhere; vertical-align:middle; white-space:pre-wrap; }
	.answer-list div { display:grid; grid-template-columns:minmax(8rem,.7fr) minmax(0,1.3fr); gap:.65rem; padding-bottom:.5rem; border-bottom:1px solid var(--border); }
	.answer-list div:last-child { padding-bottom:0; border-bottom:0; }
	.answer-list dt { color:var(--muted-foreground); font-size:var(--type-sm); }
	.answer-list dd { min-width:0; margin:0; overflow-wrap:anywhere; font-size:var(--type-sm); white-space:pre-wrap; }
	:global(.session-list) { gap:.65rem; }
	:global(.process-overview) { display:grid; gap:.65rem; }
	.session-row, .total-row, .overall-row { display:flex; justify-content:space-between; align-items:flex-start; gap:.8rem; }
	.session-row > div:first-child { min-width:0; }
	.session-row p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.session-row strong, .total-row strong, .overall-row strong { font-size:var(--type-sm); }
	.overall-row > div:first-child { min-width:0; }
	.overall-row p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); }
	.session-time { display:grid; justify-items:end; gap:.3rem; white-space:nowrap; }
	.total-row { align-items:center; color:var(--muted-foreground); font-size:var(--type-sm); }
	.total-row strong { color:var(--foreground); }
	:global(.disclosure-button) { width:100%; justify-content:space-between; }
	.muted-copy { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	:global(.timeline) { gap:0; }
	:global(.timeline-header[data-slot='card-header']) { display:flex; align-items:flex-start; justify-content:space-between; gap:.7rem; }
	.timeline-heading { display:grid; min-width:0; gap:.4rem; }
	.timeline-latest { margin:0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.45; }
	:global(.timeline-toggle) { flex:none; }
	.timeline-item { position:relative; display:grid; grid-template-columns:1.6rem minmax(0,1fr); gap:.55rem; padding:0 0 .8rem; }
	.timeline-item:not(:last-child)::after { position:absolute; top:1.55rem; bottom:0; left:.68rem; width:1px; background:var(--border); content:''; }
	.timeline-marker { z-index:1; display:grid; width:1.45rem; height:1.45rem; place-items:center; border:1px solid var(--border); border-radius:50%; background:var(--card); color:var(--muted-foreground); }
	.timeline-item strong { font-size:var(--type-sm); }
	.timeline-item p { margin:.25rem 0 0; color:var(--muted-foreground); font-size:var(--type-xs); line-height:1.5; }
	.timeline-item small { display:block; margin-top:.3rem; color:var(--muted-foreground); font-size:var(--type-xs); overflow-wrap:anywhere; }
	:global(.pdf-preview-dialog) { width:min(92vw,68rem); height:min(90dvh,56rem); max-width:none; max-height:none; grid-template-rows:auto minmax(0,1fr) auto; gap:.75rem; overflow:hidden; padding:1rem; }
	:global(.pdf-preview-header[data-slot='dialog-header']) { padding-right:2.25rem; }
	:global(.pdf-preview-header [data-slot='dialog-title']) { overflow-wrap:anywhere; }
	.pdf-preview-frame { width:100%; height:100%; min-height:0; border:1px solid var(--border); border-radius:calc(var(--radius) - 2px); background:var(--muted); }
	.pdf-preview-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.5rem; }
	@media(max-width:56rem) { .detail-grid { grid-template-columns:minmax(0,1fr); } }
	@media(max-width:32rem) { .answer-list div { grid-template-columns:minmax(0,1fr); gap:.25rem; } }
	@media(max-width:40rem) {
		.heading-badges { justify-content:flex-start; }
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
		:global(.attachment-actions) { width:100%; }
		:global(.attachment-actions button) { flex:1; }
		:global(.timeline-header[data-slot='card-header']) { flex-direction:column; }
		:global(.timeline-toggle) { width:100%; justify-content:space-between; }
		:global(.pdf-preview-dialog) { width:calc(100vw - 1rem); height:calc(100dvh - 1rem); padding:.75rem; }
		.pdf-preview-actions :global(button) { flex:1; }
	}
</style>
