import { apiRequest } from '#lib/api/client.js';
import { formatDateTimeWib } from '#lib/utils/datetime.js';
import type { SlaStatus } from '../dashboard/dashboard.api.js';

export type ApiEnvelope<T> = { status: number; message: string; data: T };
export type RequestSummary = {
	id: number; request_number: string; kode_kantor: string; nama_kantor: string; korwil: string;
	authority_type: 'korwil' | 'central'; nama_divisi: string | null; nama_pekerjaan: string | null;
	inoffice_letter_number: string | null; inoffice_letter_date: string | null;
	subject: string; description: string; status: string; current_unit_type: string;
	current_unit_code: string; current_owner_user_id: number | null; submitted_at: string; created_by_name: string | null;
	active_elapsed_seconds: number | null; active_target_sla_minutes: number | null;
	overall_elapsed_seconds: number | string; closed_at: string | null;
	sla_target_minutes?: number; sla_status?: SlaStatus;
};
export type WorkFormField = {
	key: string;
	label: string;
	type: 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'select';
	required: boolean;
	options?: string[];
	min_value?: number;
	max_value?: number;
	system?: boolean;
};
export type WorkCatalog = {
	id: number;
	divisi_id: number;
	nama_pekerjaan: string;
	deskripsi: string | null;
	target_sla_minutes: number | null;
	routing_flow: 'branch_korwil_central' | 'branch_central';
	system_key: string | null;
	form_version_id: number | null;
	version_number: number | null;
	form_fields: WorkFormField[];
	form_repeatable: { label: string; max_entries: number } | null;
	form_credit_routing: { marketing_threshold_amount: number } | null;
};
export type RequestAttachment = {
	id: number;
	category: string;
	revision_id: number | null;
	original_filename: string;
	mime_type: 'application/pdf';
	size_bytes: number;
	created_at: string;
};
export type RequestOptions = {
	office: { kode_kantor: string; korwil: string };
	divisions: Array<{ id: number; nama_divisi: string }>;
	work_catalogs: WorkCatalog[];
};

export async function fetchRequestOptions(token: string) {
	return apiRequest<ApiEnvelope<RequestOptions>>('requests/options', { token });
}
export async function fetchRequests(token: string) {
	return apiRequest<ApiEnvelope<{ requests: RequestSummary[] }>>('requests', { token });
}
export async function fetchRequest(token: string, id: string) {
	return apiRequest<ApiEnvelope<{
		request: RequestSummary;
		form_fields: WorkFormField[];
		form_repeatable: { label: string; max_entries: number } | null;
		attachments: RequestAttachment[];
		form_answers: Array<{ key: string; label: string; type: WorkFormField['type']; value: string | number }>;
		form_answer_groups: Array<{ label: string; answers: Array<{ key: string; label: string; type: WorkFormField['type']; value: string | number }> }>;
		revision_request: null | {
			id: number; revision_number: number; note: string;
			fields: Array<{ kind: 'subject' | 'description' | 'inoffice_letter_number' | 'inoffice_letter_date' | 'form_field'; key?: string; entry_index?: number | null; label: string; type?: WorkFormField['type'] }>;
			documents: Array<'inoffice_letter' | 'supporting_document'>; requested_at: string;
		};
		revision_history: Array<{
			id: number; revision_number: number; request_note: string; requested_by_name: string | null; response_by_name: string | null;
			fields: Array<{ kind: 'subject' | 'description' | 'inoffice_letter_number' | 'inoffice_letter_date' | 'form_field'; key?: string; entry_index?: number | null; label: string; type?: WorkFormField['type'] }>;
			documents: Array<'inoffice_letter' | 'supporting_document'>; snapshot_before: Record<string, unknown>;
			snapshot_after: Record<string, unknown> | null; response_note: string | null; status: 'requested' | 'submitted'; requested_at: string; submitted_at: string | null;
		}>;
		decisions: Array<{ id: number; unit_type: string; unit_code: string; decision_type: 'forwarded' | 'approved' | 'rejected'; reason_label_snapshot: string | null; note: string; confirmation_text: string | null; attachment_id: number | null; created_at: string; actor_name: string | null; attachment_filename: string | null }>;
		sessions: Array<{ id: number; unit_type: string; unit_code: string; created_at: string; started_at: string | null; start_reason: 'claim' | 'sent' | null; claimed_at: string | null; ended_at: string | null; target_sla_minutes: number | null; outcome: string | null; duration_seconds: number | string | null }>;
		timeline: Array<{ id: number; action_name: string; status_from: string | null; status_to: string; unit_from_type: string | null; unit_from_code: string | null; unit_to_type: string; unit_to_code: string; reason: string | null; created_at: string; actor_name: string | null }>;
		capabilities: {
			can_submit_revision: boolean; can_request_documents: boolean; can_forward_to_central: boolean;
			can_complete: boolean; can_reject: boolean; can_claim_central: boolean;
		};
	}>>(`requests/${encodeURIComponent(id)}`, { token });
}
export type RevisionUpdate = { kind: 'subject' | 'description' | 'inoffice_letter_number' | 'inoffice_letter_date' | 'form_field'; key?: string; entry_index?: number | null; value: string | number };
export type RevisionDocumentCategory = 'inoffice_letter' | 'supporting_document';
export async function submitRevision(token: string, id: number, input: {
	response: string; updates: RevisionUpdate[]; files: Partial<Record<RevisionDocumentCategory, File>>;
}) {
	const body = new FormData();
	body.append('payload', JSON.stringify({ response: input.response, updates: input.updates.map(({ kind, key, entry_index, value }) => ({ kind, key, entry_index, value })) }));
	for (const category of ['inoffice_letter', 'supporting_document'] as const) {
		const file = input.files[category];
		if (file) body.append(category, file, file.name);
	}
	return apiRequest<ApiEnvelope<{ id: number; status: string; resumed_to_previous_handler: boolean; returned_to_korwil: boolean }>>(`requests/${id}/revision`, { method: 'POST', token, body });
}
export type RequestRejectionReason = { id: number; code: string; label: string; scope_type: 'system' | 'division' | 'catalog' };
export async function fetchRequestRejectionReasons(token: string, id: number) {
	return apiRequest<ApiEnvelope<{ reasons: RequestRejectionReason[] }>>(`requests/${id}/rejection-reasons`, { token });
}
export async function createRequest(token: string, input: {
	authority_type: 'korwil' | 'central'; central_division_id: number | null;
	work_catalog_id: number | null; form_version_id: number | null;
	form_answers: Record<string, string | number> | { __entries: Array<Record<string, string | number>> };
	subject: string; description: string;
	inoffice_letter_number: string | null; inoffice_letter_date: string | null; inoffice_letter: File | null;
}) {
	const { inoffice_letter, ...payload } = input;
	const body = new FormData();
	body.append('payload', JSON.stringify(payload));
	if (inoffice_letter) body.append('inoffice_letter', inoffice_letter, inoffice_letter.name);
	return apiRequest<ApiEnvelope<{
		id: number; request_number: string; routed_to: 'korwil' | 'central'; unit_code: string;
	}>>('requests', { method: 'POST', token, body });
}
export async function fetchRequestAttachmentBlob(token: string, requestId: number, attachmentId: number): Promise<Blob> {
	const baseUrl = import.meta.env.VITE_API_BASE_URL;
	if (!baseUrl) throw new Error('Alamat backend belum diatur di file .env frontend.');
	const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/requests/${requestId}/attachments/${attachmentId}`, {
		headers: { accept: 'application/pdf', authorization: `Bearer ${token}` }
	});
	if (!response.ok) {
		const payload: unknown = await response.json().catch(() => null);
		const message = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
			? payload.message
			: 'Lampiran belum dapat diunduh.';
		throw new Error(message);
	}
	return response.blob();
}

export async function downloadRequestAttachment(token: string, requestId: number, attachmentId: number, filename: string): Promise<void> {
	const objectUrl = URL.createObjectURL(await fetchRequestAttachmentBlob(token, requestId, attachmentId));
	const link = document.createElement('a');
	link.href = objectUrl;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
export async function fetchKorwilInbox(token: string) {
	return apiRequest<ApiEnvelope<{ requests: RequestSummary[] }>>('inbox/korwil', { token });
}
export async function fetchKorwilHistory(token: string) {
	return apiRequest<ApiEnvelope<{ requests: RequestSummary[] }>>('inbox/korwil/history', { token });
}
export async function claimRequest(token: string, id: number) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/korwil/${id}/claim`, { method: 'POST', token });
}
export type RevisionFieldTarget = { kind: RevisionUpdate['kind']; key?: string; entry_index?: number | null };
export async function requestKorwilDocuments(token: string, id: number, input: { note: string; fields: RevisionFieldTarget[]; documents: RevisionDocumentCategory[] }) {
	const body = { ...input, fields: input.fields.map(({ kind, key, entry_index }) => ({ kind, key, entry_index })) };
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/korwil/${id}/request-documents`, { method: 'POST', token, body });
}
export async function requestCentralDocuments(token: string, id: number, input: { note: string; fields: RevisionFieldTarget[]; documents: RevisionDocumentCategory[] }) {
	const body = { ...input, fields: input.fields.map(({ kind, key, entry_index }) => ({ kind, key, entry_index })) };
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/central/${id}/request-documents`, { method: 'POST', token, body });
}
function actionForm(note: string, input: { approval_confirmed?: boolean; rejection_reason_id?: number; berita_acara?: File | null }) {
	const body = new FormData();
	body.append('payload', JSON.stringify({ note, approval_confirmed: input.approval_confirmed ?? false, rejection_reason_id: input.rejection_reason_id }));
	if (input.berita_acara) body.append('berita_acara', input.berita_acara, input.berita_acara.name);
	return body;
}
export async function forwardKorwilRequest(token: string, id: number, note: string, input: { approval_confirmed: boolean; berita_acara?: File | null }) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/korwil/${id}/forward`, { method: 'POST', token, body: actionForm(note, input) });
}
export async function finishKorwil(token: string, id: number, outcome: 'completed' | 'rejected', note: string, input: { approval_confirmed?: boolean; rejection_reason_id?: number; berita_acara?: File | null }) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/korwil/${id}/${outcome === 'completed' ? 'complete' : 'reject'}`, { method: 'POST', token, body: actionForm(note, input) });
}
export async function fetchCentralInbox(token: string) {
	return apiRequest<ApiEnvelope<{ requests: RequestSummary[] }>>('inbox/central', { token });
}
export async function fetchCentralHistory(token: string) {
	return apiRequest<ApiEnvelope<{ requests: RequestSummary[] }>>('inbox/central/history', { token });
}
export async function claimCentral(token: string, id: number) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/central/${id}/claim`, { method: 'POST', token });
}
export async function finishCentral(token: string, id: number, outcome: 'completed' | 'rejected', note: string, input: { approval_confirmed?: boolean; rejection_reason_id?: number; berita_acara?: File | null }) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/central/${id}/${outcome === 'completed' ? 'complete' : 'reject'}`, { method: 'POST', token, body: actionForm(note, input) });
}

export const statusLabels: Record<string, string> = {
	waiting_korwil: 'Menunggu Korwil',
	in_progress_korwil: 'Diproses Korwil',
	waiting_central: 'Menunggu Divisi Pusat',
	in_progress_central: 'Diproses Divisi Pusat',
	waiting_branch_revision: 'Menunggu kelengkapan Cabang',
	waiting_korwil_revision: 'Menunggu pemeriksaan Korwil',
	completed: 'Selesai',
	rejected: 'Ditolak'
};

export const DEFAULT_SLA_MINUTES = 7 * 24 * 60;

export function formatDate(value: string | Date): string {
	return formatDateTimeWib(value);
}

export function formatElapsed(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return '—';
	const totalMinutes = Math.max(0, Math.floor(seconds / 60));
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	return days > 0 ? `${days} hari ${hours} jam` : `${hours} jam ${minutes} menit`;
}

export const slaStatusLabels: Record<SlaStatus, string> = {
	safe: 'SLA aman',
	warning: 'Mendekati SLA',
	overdue: 'Melewati SLA'
};
