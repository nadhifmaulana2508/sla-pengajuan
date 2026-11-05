import type { RowDataPacket } from 'mysql2';
import type { SsoProfile } from './auth.service.js';
import { mysqlPool } from '../../db/client.js';
import { inferKorwilFromSsoText, normalizeSsoUnitName } from '../organization/sso-scope.js';

export type SlaAccess = {
	enabled: boolean;
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

export type SlaAccessResolution = {
	access: SlaAccess;
	assignment: {
		scopeType: 'global' | 'office' | 'korwil' | 'division';
		kodeKantor: string | null;
		korwil: string | null;
		divisiId: number | null;
	} | null;
};

type IdRow = RowDataPacket & { id: number };
type AccessRow = RowDataPacket & {
	is_active: number;
	role_code: string | null;
	scope_type: string | null;
	user_kode_kantor: string | null;
	user_divisi_id: number | null;
	user_unit_kerja: string | null;
	user_branch_name: string | null;
	user_job_position: string | null;
	profile_korwil: string | null;
	scope_kode_kantor: string | null;
	scope_korwil: string | null;
	scope_divisi_id: number | null;
	scope_office_active: number | null;
	scope_division_active: number | null;
};

export async function syncSsoProfile(profile: SsoProfile): Promise<void> {
	const officeCode = profile.kode?.trim() ?? '';
	let kodeKantor: string | null = null;
	let profileKorwil: string | null = null;
	if (/^\d{3}$/.test(officeCode)) {
		const [offices] = await mysqlPool.execute<Array<RowDataPacket & { kode_kantor: string; korwil: string }>>(
			'SELECT kode_kantor, korwil FROM master_kantor WHERE kode_kantor = ? AND is_active = 1 LIMIT 1',
			[officeCode]
		);
		if (offices[0]) {
			kodeKantor = offices[0].kode_kantor;
			if (offices[0].korwil !== 'pusat') profileKorwil = offices[0].korwil;
		}
	}
	if (!profileKorwil) {
		const [korwils] = await mysqlPool.execute<Array<RowDataPacket & { korwil: string }>>(
			`SELECT DISTINCT korwil FROM master_kantor
			WHERE is_active = 1 AND korwil <> 'pusat' ORDER BY korwil`
		);
		profileKorwil = inferKorwilFromSsoText(profile, korwils.map((row) => row.korwil));
	}

	const divisionName = normalizeSsoUnitName(profile.unit_kerja);
	let divisiId: number | null = null;
	if (divisionName) {
		const [divisions] = await mysqlPool.execute<IdRow[]>(
			`SELECT division.id FROM division_sso_unit_aliases alias
			INNER JOIN master_divisi division ON division.id = alias.division_id AND division.is_active = 1
			WHERE alias.unit_kerja_key = ?
			LIMIT 2`,
			[divisionName]
		);
		if (divisions.length === 1) divisiId = divisions[0]?.id ?? null;
	}

	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		await connection.execute(
			`INSERT INTO users (
				employee_id, full_name, email, telp, branch_name, unit_kerja,
				job_position, level, group_jabatan, kode_kantor, divisi_id, profile_synced_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE
				full_name = VALUES(full_name),
				email = VALUES(email),
				telp = VALUES(telp),
				branch_name = VALUES(branch_name),
				unit_kerja = VALUES(unit_kerja),
				job_position = VALUES(job_position),
				level = VALUES(level),
				group_jabatan = VALUES(group_jabatan),
				kode_kantor = VALUES(kode_kantor),
				divisi_id = VALUES(divisi_id),
				profile_synced_at = CURRENT_TIMESTAMP`,
			[
				profile.employee_id,
				profile.full_name,
				profile.email ?? null,
				profile.telp ?? null,
				profile.branch_name ?? null,
				profile.unit_kerja ?? null,
				profile.job_position ?? null,
				profile.level ?? null,
				profile.group_jabatan ?? null,
				kodeKantor,
				divisiId
			]
		);

		const [userRows] = await connection.execute<IdRow[]>(
			'SELECT id FROM users WHERE employee_id = ? FOR UPDATE',
			[profile.employee_id]
		);
		const userId = userRows[0]?.id;
		if (!userId) throw new Error('Profil SSO tidak tersimpan.');

		const [automaticAssignments] = await connection.execute<Array<RowDataPacket & {
				id: number;
				role_code: string;
				scope_type: string;
				kode_kantor: string | null;
				korwil: string | null;
				divisi_id: number | null;
			}>>(
				`SELECT scope.id, role.kode AS role_code, scope.scope_type,
					scope.kode_kantor, scope.korwil, scope.divisi_id
				FROM user_role_scopes scope
				INNER JOIN roles role ON role.id = scope.role_id
					AND role.kode IN ('branch_user', 'korwil_staff', 'korwil_approver', 'division_staff')
				WHERE scope.user_id = ? AND scope.is_active = 1
				FOR UPDATE`,
				[userId]
			);
		const changedAssignments: Array<{
			id: number;
			role_code: string;
			column: 'kode_kantor' | 'korwil' | 'divisi_id';
			before: string | number | null;
			after: string | number;
		}> = [];
		for (const assignment of automaticAssignments) {
			let column: 'kode_kantor' | 'korwil' | 'divisi_id' | null = null;
			let before: string | number | null = null;
			let after: string | number | null = null;
			if (assignment.role_code === 'branch_user' && assignment.scope_type === 'office' && kodeKantor) {
				column = 'kode_kantor';
				before = assignment.kode_kantor;
				after = kodeKantor;
			} else if (
				['korwil_staff', 'korwil_approver'].includes(assignment.role_code) &&
				assignment.scope_type === 'korwil' && profileKorwil
			) {
				column = 'korwil';
				before = assignment.korwil;
				after = profileKorwil;
			} else if (
				assignment.role_code === 'division_staff' &&
				assignment.scope_type === 'division' &&
				divisiId !== null
			) {
				column = 'divisi_id';
				before = assignment.divisi_id;
				after = divisiId;
			}
			if (column && before !== after && after !== null) {
				changedAssignments.push({
					id: assignment.id,
					role_code: assignment.role_code,
					column,
					before,
					after
				});
			}
		}

		for (const assignment of changedAssignments) {
			await connection.execute(
				`UPDATE user_role_scopes SET ${assignment.column} = ? WHERE id = ?`,
				[assignment.after, assignment.id]
			);
		}
		if (changedAssignments.length > 0) {
			await connection.execute(
				`INSERT INTO user_access_audit_logs
					(actor_user_id, target_user_id, action, before_data, after_data)
				VALUES (?, ?, 'sso_scope_synced', ?, ?)`,
				[
					userId,
					userId,
					JSON.stringify({
						source: 'sso_profile_sync',
						assignments: changedAssignments.map(({ id, role_code, column, before }) => ({
							assignment_id: id,
							role: role_code,
							field: column,
							value: before
						}))
					}),
					JSON.stringify({
						source: 'sso_profile_sync',
						assignments: changedAssignments.map(({ id, role_code, column, after }) => ({
							assignment_id: id,
							role: role_code,
							field: column,
							value: after
						}))
					})
				]
			);
		}
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

export async function resolveSlaAccessDetails(employeeId: string): Promise<SlaAccessResolution> {
	const [rows] = await mysqlPool.execute<AccessRow[]>(
		`SELECT u.is_active, r.kode AS role_code, s.scope_type,
			u.kode_kantor AS user_kode_kantor, u.divisi_id AS user_divisi_id,
			u.unit_kerja AS user_unit_kerja, u.branch_name AS user_branch_name,
			u.job_position AS user_job_position,
			user_office.korwil AS profile_korwil,
			s.kode_kantor AS scope_kode_kantor, s.korwil AS scope_korwil,
			s.divisi_id AS scope_divisi_id, scope_office.is_active AS scope_office_active,
			scope_division.is_active AS scope_division_active
		FROM users u
		LEFT JOIN user_role_scopes s ON s.user_id = u.id AND s.is_active = 1
		LEFT JOIN roles r ON r.id = s.role_id AND r.is_active = 1
		LEFT JOIN master_kantor user_office ON user_office.kode_kantor = u.kode_kantor AND user_office.is_active = 1
		LEFT JOIN master_kantor scope_office ON scope_office.kode_kantor = s.kode_kantor
		LEFT JOIN master_divisi scope_division ON scope_division.id = s.divisi_id
		WHERE u.employee_id = ?
		ORDER BY CASE WHEN r.kode = 'admin' AND s.scope_type = 'global' THEN 0
			WHEN r.kode = 'admin' THEN 1 ELSE 2 END, s.id`,
		[employeeId]
	);
	let profileKorwil = rows[0]?.profile_korwil;
	if (!profileKorwil || profileKorwil === 'pusat') {
		const [korwilRows] = await mysqlPool.execute<Array<RowDataPacket & { korwil: string }>>(
			`SELECT DISTINCT korwil FROM master_kantor
			WHERE is_active = 1 AND korwil <> 'pusat' ORDER BY korwil`
		);
		profileKorwil = inferKorwilFromSsoText({
			unit_kerja: rows[0]?.user_unit_kerja,
			branch_name: rows[0]?.user_branch_name,
			job_position: rows[0]?.user_job_position
		}, korwilRows.map((row) => row.korwil));
	}

	const assignment = rows.find((row) => {
		if (Number(row.is_active) !== 1 || row.role_code === null || row.scope_type === null) return false;
		if (row.role_code === 'branch_user') {
			return row.scope_type === 'office' &&
				row.user_kode_kantor !== null &&
				row.user_kode_kantor !== '000' &&
				row.user_kode_kantor === row.scope_kode_kantor &&
				Number(row.scope_office_active) === 1;
		}
		if (['korwil_staff', 'korwil_approver'].includes(row.role_code)) {
			return row.scope_type === 'korwil' && profileKorwil !== null && profileKorwil !== 'pusat' && row.scope_korwil === profileKorwil;
		}
		if (row.role_code === 'division_staff') {
			return row.scope_type === 'division' && row.user_divisi_id !== null &&
				row.scope_divisi_id === row.user_divisi_id && Number(row.scope_division_active) === 1;
		}
		return true;
	});
	if (!assignment) {
		return {
			access: { enabled: false, role: null, scope: null, source: null },
			assignment: null
		};
	}

	const roles = new Set<SlaAccess['role']>([
		'admin',
		'branch_user',
		'korwil_staff',
		'korwil_approver',
		'division_staff',
		'supervisor',
		'management'
	]);
	const role = roles.has(assignment.role_code as SlaAccess['role'])
		? (assignment.role_code as NonNullable<SlaAccess['role']>)
		: null;
	const scope = {
		global: 'all',
		office: 'office',
		korwil: 'korwil',
		division: 'division'
	} as const;
	const scopeType = assignment.scope_type;
	const accessScope = scopeType !== null && scopeType in scope
		? scope[scopeType as keyof typeof scope]
		: null;
	const enabled = role !== null && accessScope !== null;
	const access: SlaAccess = {
		enabled,
		role,
		scope: accessScope,
		source: enabled ? 'database' : null
	};
	return {
		access,
		assignment: enabled && scopeType !== null && scopeType in scope ? {
			scopeType: scopeType as 'global' | 'office' | 'korwil' | 'division',
			kodeKantor: assignment.scope_kode_kantor,
			korwil: assignment.scope_korwil,
			divisiId: assignment.scope_divisi_id
		} : null
	};
}

export async function resolveSlaAccess(employeeId: string): Promise<SlaAccess> {
	return (await resolveSlaAccessDetails(employeeId)).access;
}
