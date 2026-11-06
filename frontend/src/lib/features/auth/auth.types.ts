export type SsoProfile = {
	kode?: string | null;
	employee_id: string;
	full_name: string;
	email?: string | null;
	telp?: string | null;
	branch_name?: string | null;
	unit_kerja?: string | null;
	job_position?: string | null;
	level?: string | null;
	group_jabatan?: string | null;
};

export type AuthenticatedProfile = SsoProfile & {
	sla_access: {
		enabled: boolean;
		can_manage_forms: boolean;
		role:
			| 'admin'
			| 'branch_user'
			| 'korwil_staff'
			| 'korwil_approver'
			| 'division_staff'
			| 'supervisor'
			| 'management'
			| null;
		scope: 'all' | 'office' | 'korwil' | 'division' | null;
		source: 'database' | null;
	};
};

export type AuthSession = {
	token: string | null;
	profile: AuthenticatedProfile | null;
};
