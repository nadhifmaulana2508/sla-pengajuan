import { apiRequest } from '#lib/api/client.js';

export type ApiEnvelope<T> = { status: number; message: string; data: T };
export type DashboardView = 'branch' | 'korwil' | 'division' | 'admin';
export type SlaStatus = 'safe' | 'warning' | 'overdue';
export type DashboardFilters = { from?: string; to?: string; korwil?: string; division_id?: number };
export type DashboardSla = {
	target_minutes: number;
	warning_minutes: number;
	counts: { safe: number; warning: number; overdue: number };
};
export type DashboardSummary = {
	total: number;
	waiting: number;
	in_progress: number;
	waiting_branch: number;
	completed: number;
	rejected: number;
	revision_count: number;
	total_age_seconds: number;
	average_age_seconds: number;
	total_process_seconds: number;
};
export type DashboardRequest = {
	id: number;
	request_number: string;
	kode_kantor: string;
	nama_kantor: string;
	korwil: string;
	authority_type: 'korwil' | 'central';
	nama_divisi: string | null;
	nama_pekerjaan: string | null;
	subject: string;
	status: string;
	current_unit_type: string;
	current_unit_code: string;
	submitted_at: string;
	closed_at: string | null;
	overall_elapsed_seconds: number;
	active_elapsed_seconds: number | null;
	revision_count: number;
	sla_target_minutes: number;
	sla_status: SlaStatus;
};
export type DashboardData = {
	view: DashboardView;
	scope: {
		label: string;
		kode_kantor?: string | null;
		nama_kantor?: string | null;
		korwil?: string | null;
		divisi_id?: number | null;
		nama_divisi?: string | null;
	};
	filters: { from: string | null; to: string | null; korwil: string | null; divisionId: number | null };
	sla: DashboardSla;
	summary: DashboardSummary;
	status_counts: Array<{ status: string; count: number }>;
	korwil_counts?: Array<{ korwil: string; count: number }>;
	division_counts?: Array<{ id: number; nama_divisi: string; count: number }>;
	filter_options?: { korwils: string[]; divisions: Array<{ id: number; nama_divisi: string }> };
	requests: DashboardRequest[];
};

export async function fetchDashboard(token: string, filters: DashboardFilters = {}) {
	const params = new URLSearchParams();
	if (filters.from) params.set('from', filters.from);
	if (filters.to) params.set('to', filters.to);
	if (filters.korwil) params.set('korwil', filters.korwil);
	if (filters.division_id) params.set('division_id', String(filters.division_id));
	const query = params.toString();
	return apiRequest<ApiEnvelope<DashboardData>>(`dashboard${query ? `?${query}` : ''}`, { token });
}

export type BranchFollowUpData = {
	filters: { kodeKantor: string | null };
	options: { offices: Array<{ kode_kantor: string; nama_kantor: string; korwil: string }> };
	sla: DashboardSla;
	summary: { total: number };
	requests: DashboardRequest[];
};

export async function fetchBranchFollowUp(token: string, kodeKantor?: string) {
	const query = kodeKantor ? `?kode_kantor=${encodeURIComponent(kodeKantor)}` : '';
	return apiRequest<ApiEnvelope<BranchFollowUpData>>(`dashboard/branch-follow-up${query}`, { token });
}
