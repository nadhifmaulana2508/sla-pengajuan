import { apiRequest } from '#lib/api/client.js';
import type { SlaStatus } from '../dashboard/dashboard.api.js';

export type ApiEnvelope<T> = { status: number; message: string; data: T };
export type RequestSummary = {
	id: number; request_number: string; kode_kantor: string; nama_kantor: string; korwil: string;
	authority_type: 'korwil' | 'central'; nama_divisi: string | null; nama_pekerjaan: string | null;
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
	system_key: string | null;
	form_version_id: number | null;
	version_number: number | null;
	form_fields: WorkFormField[];
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
		form_answers: Array<{ key: string; label: string; type: WorkFormField['type']; value: string | number }>;
		sessions: Array<{ id: number; unit_type: string; unit_code: string; created_at: string; started_at: string | null; start_reason: 'claim' | 'sent' | null; claimed_at: string | null; ended_at: string | null; target_sla_minutes: number | null; outcome: string | null; duration_seconds: number | string | null }>;
		timeline: Array<{ id: number; action_name: string; status_from: string | null; status_to: string; unit_from_type: string | null; unit_from_code: string | null; unit_to_type: string; unit_to_code: string; reason: string | null; created_at: string; actor_name: string | null }>;
		capabilities: {
			can_submit_revision: boolean; can_request_documents: boolean; can_forward_to_central: boolean;
			can_complete: boolean; can_reject: boolean; can_claim_central: boolean;
		};
	}>>(`requests/${encodeURIComponent(id)}`, { token });
}
export async function submitRevision(token: string, id: number, response: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string; resumed_to_previous_handler: boolean }>>(`requests/${id}/revision`, { method: 'POST', token, body: { response } });
}
export async function createRequest(token: string, input: {
	authority_type: 'korwil' | 'central'; central_division_id: number | null;
	work_catalog_id: number | null; form_version_id: number | null;
	form_answers: Record<string, string | number>; subject: string; description: string;
}) {
	return apiRequest<ApiEnvelope<{ id: number; request_number: string }>>('requests', { method: 'POST', token, body: input });
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
export async function requestKorwilDocuments(token: string, id: number, reason: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/korwil/${id}/request-documents`, { method: 'POST', token, body: { reason } });
}
export async function forwardKorwilRequest(token: string, id: number, reason: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/korwil/${id}/forward`, { method: 'POST', token, body: { reason } });
}
export async function finishKorwil(token: string, id: number, outcome: 'completed' | 'rejected', reason: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/korwil/${id}/${outcome === 'completed' ? 'complete' : 'reject'}`, { method: 'POST', token, body: { reason } });
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
export async function requestCentralDocuments(token: string, id: number, reason: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/central/${id}/request-documents`, { method: 'POST', token, body: { reason } });
}
export async function finishCentral(token: string, id: number, outcome: 'completed' | 'rejected', reason: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`inbox/central/${id}/${outcome === 'completed' ? 'complete' : 'reject'}`, { method: 'POST', token, body: { reason } });
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
	return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
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
