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
	is_active: boolean;
	updated_at: string;
	system_key?: string | null;
	form_version_id?: number | null;
	version_number?: number | null;
	form_fields?: WorkFormField[];
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

export type WorkFormFieldInput = Omit<WorkFormField, 'key' | 'system'>;

export type WorkCatalogInput = {
	divisi_id: number;
	nama_pekerjaan: string;
	deskripsi: string | null;
	target_sla_minutes: number | null;
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

export async function publishWorkForm(token: string, catalogId: number, fields: WorkFormFieldInput[]) {
	return apiRequest<PublishFormResponse>(`forms/manage/${catalogId}/publish`, {
		method: 'POST',
		token,
		body: { fields }
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
