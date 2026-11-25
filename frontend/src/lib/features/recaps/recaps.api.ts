import { apiRequest } from '#lib/api/client.js';

export type ApiEnvelope<T> = { status: number; message: string; data: T };
export type RecapListItem = {
	id: number; title: string; status: 'published' | 'archived'; nama_pekerjaan: string; nama_divisi: string;
	created_at: string; published_at: string; row_count: number; pending_count: number; work_catalog_count: number;
};
export type RecapSourceField = { key: string; label: string; type: string };
export type RecapSourceRequest = {
	id: number; request_number: string; subject: string; status: string; work_catalog_id: number; nama_pekerjaan: string; kode_kantor: string;
	nama_kantor: string; submitted_at: string; entry_count: number; field_keys: string[];
};
export type RecapSources = { source_fields: RecapSourceField[]; requests: RecapSourceRequest[] };
export type RecapTrackingField = {
	key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[]; editable_by_branch: boolean;
};
export type RecapProposal = {
	id: number; changes: Record<string, string | number | null>; note: string;
	status: 'pending' | 'approved' | 'rejected'; review_note: string | null;
	created_at: string; reviewed_at: string | null; proposer_name: string | null; reviewer_name: string | null;
};
export type RecapRow = {
	id: number; source_request_id: number; request_number: string; subject: string; status: string; nama_pekerjaan: string;
	kode_kantor: string; nama_kantor: string; form_entry_index: number | null;
	source_values: Record<string, unknown>; tracking_values: Record<string, string | number | null>;
	updated_at: string; proposals: RecapProposal[];
};
export type RecapDetail = {
	recap: {
		id: number; title: string; status: 'published' | 'archived'; work_catalog_id: number;
		nama_pekerjaan: string; nama_divisi: string; created_at: string; published_at: string;
		source_fields: RecapSourceField[]; visible_source_keys: string[]; tracking_fields: RecapTrackingField[];
		is_division: boolean; branch_editable_keys: string[];
	};
	rows: RecapRow[];
};

export async function fetchRecaps(token: string) {
	return apiRequest<ApiEnvelope<{ recaps: RecapListItem[] }>>('recaps', { token });
}
export async function fetchRecapCatalogs(token: string) {
	return apiRequest<ApiEnvelope<{ catalogs: Array<{ id: number; nama_pekerjaan: string; compatible_work_catalogs: string[]; eligible_count: number }> }>>('recaps/catalogs', { token });
}
export async function fetchRecapSources(token: string, catalogId: number) {
	return apiRequest<ApiEnvelope<RecapSources>>(`recaps/catalogs/${catalogId}/sources`, { token });
}
export async function fetchAppendableRecapSources(token: string, recapId: number) {
	return apiRequest<ApiEnvelope<RecapSources>>(`recaps/${recapId}/sources`, { token });
}
export async function appendRecapSources(token: string, recapId: number, request_ids: number[]) {
	return apiRequest<ApiEnvelope<{ source_request_count: number; row_count: number }>>(`recaps/${recapId}/sources`, {
		method: 'POST', token, body: { request_ids }
	});
}
export async function createRecap(token: string, payload: {
	title: string; work_catalog_id: number; request_ids: number[]; visible_source_keys: string[]; tracking_fields: RecapTrackingField[];
}) {
	return apiRequest<ApiEnvelope<{ id: number; title: string; row_count: number; source_request_count: number }>>('recaps', { method: 'POST', token, body: payload });
}
export async function fetchRecap(token: string, recapId: number) {
	return apiRequest<ApiEnvelope<RecapDetail>>(`recaps/${recapId}`, { token });
}
export async function updateRecapSettings(token: string, recapId: number, payload: {
	title: string; visible_source_keys: string[]; tracking_fields: RecapTrackingField[];
}) {
	return apiRequest<ApiEnvelope<{ id: number; title: string; visible_source_keys: string[]; tracking_fields: RecapTrackingField[] }>>(`recaps/${recapId}`, {
		method: 'PATCH', token, body: payload
	});
}
export async function saveRecapRow(token: string, recapId: number, rowId: number, changes: Record<string, string | number | null>) {
	return apiRequest<ApiEnvelope<{ row_id: number; tracking_values: Record<string, string | number | null> }>>(`recaps/${recapId}/rows/${rowId}`, {
		method: 'PATCH', token, body: { changes }
	});
}
export async function proposeRecapChanges(token: string, recapId: number, rowId: number, changes: Record<string, string | number | null>, note: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`recaps/${recapId}/rows/${rowId}/proposals`, {
		method: 'POST', token, body: { changes, note }
	});
}
export async function reviewRecapChanges(token: string, recapId: number, proposalId: number, outcome: 'approved' | 'rejected', review_note: string) {
	return apiRequest<ApiEnvelope<{ id: number; status: string }>>(`recaps/${recapId}/proposals/${proposalId}/review`, {
		method: 'POST', token, body: { outcome, review_note }
	});
}
