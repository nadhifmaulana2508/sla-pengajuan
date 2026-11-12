import { apiRequest } from '#lib/api/client.js';
import type { AuthenticatedProfile } from '#lib/features/auth/auth.types.js';

export type AdminDivision = {
	id: number;
	kode: string;
	nama_divisi: string;
	is_active: boolean;
	sso_unit_kerja_aliases: string[];
};

export type WorkCatalog = {
	id: number;
	divisi_id: number;
	kode_divisi: string;
	nama_divisi: string;
	nama_pekerjaan: string;
	deskripsi: string | null;
	target_sla_minutes: number | null;
	routing_flow: 'branch_korwil_central' | 'branch_central';
	is_active: boolean;
	updated_at: string;
	system_key?: string | null;
	form_version_id?: number | null;
	version_number?: number | null;
	form_fields?: WorkFormField[];
	form_repeatable?: RepeatableFormConfig | null;
	form_credit_routing?: CreditRoutingConfig | null;
};

export type RepeatableFormConfig = { label: string; max_entries: number };
export type CreditRoutingConfig = { marketing_threshold_amount: number };

export type WorkFormField = {
	key: string;
	label: string;
	type: 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'select';
	required: boolean;
	options?: string[];
	min_value?: number;
	max_value?: number;
	system?: boolean;
	requires_korwil_review?: boolean;
};

export type WorkFormFieldInput = Omit<WorkFormField, 'key' | 'system'>;

export type WorkCatalogInput = {
	divisi_id: number;
	nama_pekerjaan: string;
	deskripsi: string | null;
	target_sla_minutes: number | null;
	routing_flow: 'branch_korwil_central' | 'branch_central';
	is_active: boolean;
};

export type AdminScopeType = 'global' | 'office' | 'korwil' | 'division';

export type AdminUserAssignment = {
	id: number;
	role_id: number;
	role_code: string;
	role_name: string;
	scope_type: AdminScopeType;
	kode_kantor: string | null;
	nama_kantor: string | null;
	korwil: string | null;
	divisi_id: number | null;
	nama_divisi: string | null;
	can_manage_forms: boolean;
};

export type AdminUser = {
	id: number;
	employee_id: string;
	full_name: string | null;
	branch_name: string | null;
	unit_kerja: string | null;
	job_position: string | null;
	kode_kantor: string | null;
	nama_kantor: string | null;
	sso_korwil: string | null;
	divisi_id: number | null;
	nama_divisi: string | null;
	is_active: boolean;
	assignments: AdminUserAssignment[];
};

export type AdminAccessRole = { id: number; kode: string; nama_role: string };
export type AdminAccessOffice = { kode_kantor: string; nama_kantor: string; korwil: string };
export type AdminAccessDivision = { id: number; kode: string; nama_divisi: string };

export type AdminUserAssignmentInput = {
	role_id: number;
	scope_type: AdminScopeType;
	kode_kantor: string | null;
	korwil: string | null;
	divisi_id: number | null;
	can_manage_forms: boolean;
};

export type AdminUserAccessInput = {
	is_active: boolean;
	assignments: AdminUserAssignmentInput[];
};

type AdminMasterResponse = {
	status: number;
	message: string;
	data: {
		divisions: AdminDivision[];
		work_catalogs: WorkCatalog[];
	};
};

type MutationResponse = { status: number; message: string; data: { id: number } | null };

type FormManagementResponse = {
	status: number;
	message: string;
	data: {
		can_manage_all: boolean;
		division_id: number | null;
		work_catalogs: WorkCatalog[];
	};
};

type PublishFormResponse = {
	status: number;
	message: string;
	data: { id: number; version_number: number };
};
export type ManagedRejectionReason = {
	id: number; scope_type: 'system' | 'division' | 'catalog'; division_id: number | null; work_catalog_id: number | null;
	code: string; label: string; is_active: boolean; sort_order: number;
};

type AdminUsersResponse = {
	status: number;
	message: string;
	data: { users: AdminUser[] };
};

type AdminAccessOptionsResponse = {
	status: number;
	message: string;
	data: {
		roles: AdminAccessRole[];
		offices: AdminAccessOffice[];
		korwils: string[];
		divisions: AdminAccessDivision[];
	};
};

type AdminUsersWorkspaceResponse = {
	status: number;
	message: string;
	data: {
		profile: AuthenticatedProfile;
		users: AdminUser[];
		roles: AdminAccessRole[];
		offices: AdminAccessOffice[];
		korwils: string[];
		divisions: AdminAccessDivision[];
	};
};

export async function fetchAdminMasterData(token: string) {
	const response = await apiRequest<AdminMasterResponse>('admin/master-data', { token });
	return response.data;
}

export async function updateAdminDivision(token: string, id: number, input: {
	nama_divisi: string;
	sso_unit_kerja_aliases: string[];
}) {
	return apiRequest<MutationResponse>(`admin/divisions/${id}`, {
		method: 'PUT',
		token,
		body: input
	});
}

export async function createWorkCatalog(token: string, input: WorkCatalogInput) {
	return apiRequest<MutationResponse>('admin/work-catalogs', {
		method: 'POST',
		token,
		body: input
	});
}

export async function updateWorkCatalog(token: string, id: number, input: WorkCatalogInput) {
	return apiRequest<MutationResponse>(`admin/work-catalogs/${id}`, {
		method: 'PUT',
		token,
		body: input
	});
}

export async function fetchFormManagementWorkspace(token: string) {
	return apiRequest<FormManagementResponse>('forms/manage', { token });
}

export async function publishWorkForm(
	token: string,
	catalogId: number,
	fields: WorkFormFieldInput[],
	repeatable: RepeatableFormConfig | null,
	creditRouting: CreditRoutingConfig | null
) {
	return apiRequest<PublishFormResponse>(`forms/manage/${catalogId}/publish`, {
		method: 'POST',
		token,
		body: { fields, repeatable, credit_routing: creditRouting }
	});
}

export async function fetchManagedRejectionReasons(token: string, catalogId: number) {
	return apiRequest<{ status: number; message: string; data: { can_manage_system: boolean; reasons: ManagedRejectionReason[] } }>(
		`forms/manage/rejection-reasons?catalog_id=${catalogId}`, { token }
	);
}

export async function createManagedRejectionReason(token: string, catalogId: number, scopeType: 'system' | 'division' | 'catalog', label: string) {
	return apiRequest<MutationResponse>('forms/manage/rejection-reasons', {
		method: 'POST', token, body: { catalog_id: catalogId, scope_type: scopeType, label }
	});
}

export async function setManagedRejectionReasonActive(token: string, reasonId: number, isActive: boolean) {
	return apiRequest<MutationResponse>(`forms/manage/rejection-reasons/${reasonId}`, {
		method: 'PATCH', token, body: { is_active: isActive }
	});
}

export async function fetchAdminUsers(token: string) {
	const response = await apiRequest<AdminUsersResponse>('admin/users', { token });
	return response.data.users;
}

export async function fetchAdminAccessOptions(token: string) {
	const response = await apiRequest<AdminAccessOptionsResponse>('admin/access-options', { token });
	return response.data;
}

export async function fetchAdminUsersWorkspace(token: string) {
	const response = await apiRequest<AdminUsersWorkspaceResponse>('admin/users/workspace', { token });
	return response.data;
}

export async function updateAdminUserAccess(token: string, userId: number, input: AdminUserAccessInput) {
	return apiRequest<MutationResponse>(`admin/users/${userId}/access`, {
		method: 'PUT',
		token,
		body: input
	});
}
