import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { inferKorwilFromSsoText, normalizeSsoUnitName } from '../organization/sso-scope.js';

export type ScopeType = 'global' | 'office' | 'korwil' | 'division';

export type UserAssignmentInput = {
	role_id: number;
	scope_type: ScopeType;
	kode_kantor: string | null;
	korwil: string | null;
	divisi_id: number | null;
};

export type UserAccessInput = {
	is_active: boolean;
	assignments: UserAssignmentInput[];
};

export class AdminUserAccessError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string
	) {
		super(message);
		this.name = 'AdminUserAccessError';
	}
}

type UserListRow = RowDataPacket & {
	user_id: number;
	employee_id: string;
	full_name: string | null;
	branch_name: string | null;
	unit_kerja: string | null;
	job_position: string | null;
	kode_kantor: string | null;
	nama_kantor: string | null;
	profile_korwil: string | null;
	user_is_active: number;
	assignment_id: number | null;
	role_id: number | null;
	role_code: string | null;
	role_name: string | null;
	scope_type: ScopeType | null;
	scope_kode_kantor: string | null;
	scope_nama_kantor: string | null;
	scope_korwil: string | null;
	scope_divisi_id: number | null;
	scope_nama_divisi: string | null;
};

type RoleRow = RowDataPacket & { id: number; kode: string; nama_role: string };
type OfficeRow = RowDataPacket & { kode_kantor: string; nama_kantor: string; korwil: string };
type DivisionRow = RowDataPacket & { id: number; kode: string; nama_divisi: string };
type IdRow = RowDataPacket & { id: number };
type CountRow = RowDataPacket & { total: number };

export async function listAdminUsers() {
	const [korwilRows] = await mysqlPool.execute<Array<RowDataPacket & { korwil: string }>>(
		`SELECT DISTINCT korwil FROM master_kantor
		WHERE is_active = 1 AND korwil <> 'pusat' ORDER BY korwil`
	);
	const knownKorwils = korwilRows.map((row) => row.korwil);
	const [divisionAliases] = await mysqlPool.execute<Array<RowDataPacket & {
		unit_kerja_key: string; division_id: number; nama_divisi: string;
	}>>(
		`SELECT alias.unit_kerja_key, division.id AS division_id, division.nama_divisi
		FROM division_sso_unit_aliases alias
		INNER JOIN master_divisi division ON division.id = alias.division_id AND division.is_active = 1`
	);
	const divisionsBySsoUnit = new Map(divisionAliases.map((alias) => [
		alias.unit_kerja_key,
		{ id: Number(alias.division_id), name: alias.nama_divisi }
	]));
	const [rows] = await mysqlPool.execute<UserListRow[]>(
		`SELECT u.id AS user_id, u.employee_id, u.full_name, u.branch_name,
			u.unit_kerja, u.job_position, u.kode_kantor, office.nama_kantor,
			profile_office.korwil AS profile_korwil,
			u.is_active AS user_is_active,
			s.id AS assignment_id, role.id AS role_id, role.kode AS role_code,
			role.nama_role AS role_name, s.scope_type,
			s.kode_kantor AS scope_kode_kantor, scope_office.nama_kantor AS scope_nama_kantor,
			s.korwil AS scope_korwil, s.divisi_id AS scope_divisi_id,
			scope_division.nama_divisi AS scope_nama_divisi
		FROM users u
		LEFT JOIN master_kantor office ON office.kode_kantor = u.kode_kantor
		LEFT JOIN master_kantor profile_office ON profile_office.kode_kantor = u.kode_kantor AND profile_office.is_active = 1
		LEFT JOIN user_role_scopes s ON s.user_id = u.id AND s.is_active = 1
		LEFT JOIN roles role ON role.id = s.role_id AND role.is_active = 1
		LEFT JOIN master_kantor scope_office ON scope_office.kode_kantor = s.kode_kantor
		LEFT JOIN master_divisi scope_division ON scope_division.id = s.divisi_id
		ORDER BY COALESCE(u.full_name, u.employee_id), u.employee_id, s.id`
	);

	const users = new Map<number, {
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
		assignments: Array<{
			id: number;
			role_id: number;
			role_code: string;
			role_name: string;
			scope_type: ScopeType;
			kode_kantor: string | null;
			nama_kantor: string | null;
			korwil: string | null;
			divisi_id: number | null;
			nama_divisi: string | null;
		}>;
	}>();

	for (const row of rows) {
		let user = users.get(row.user_id);
		if (!user) {
			const divisionFromProfile = divisionsBySsoUnit.get(normalizeSsoUnitName(row.unit_kerja) ?? '');
			user = {
				id: row.user_id,
				employee_id: row.employee_id,
				full_name: row.full_name,
				branch_name: row.branch_name,
				unit_kerja: row.unit_kerja,
				job_position: row.job_position,
				kode_kantor: row.kode_kantor,
				nama_kantor: row.nama_kantor,
				sso_korwil: row.profile_korwil && row.profile_korwil !== 'pusat'
					? row.profile_korwil
					: inferKorwilFromSsoText(row, knownKorwils),
				divisi_id: divisionFromProfile?.id ?? null,
				nama_divisi: divisionFromProfile?.name ?? null,
				is_active: Number(row.user_is_active) === 1,
				assignments: []
			};
			users.set(user.id, user);
		}

		if (
			row.assignment_id !== null && row.role_id !== null && row.role_code !== null &&
			row.role_name !== null && row.scope_type !== null
		) {
			user.assignments.push({
				id: row.assignment_id,
				role_id: row.role_id,
				role_code: row.role_code,
				role_name: row.role_name,
				scope_type: row.scope_type,
				kode_kantor: row.scope_kode_kantor,
				nama_kantor: row.scope_nama_kantor,
				korwil: row.scope_korwil,
				divisi_id: row.scope_divisi_id,
				nama_divisi: row.scope_nama_divisi
			});
		}
	}

	return [...users.values()];
}

export async function getAdminAccessOptions() {
	const [roles] = await mysqlPool.execute<RoleRow[]>(
		'SELECT id, kode, nama_role FROM roles WHERE is_active = 1 ORDER BY nama_role'
	);
	const [offices] = await mysqlPool.execute<OfficeRow[]>(
		`SELECT kode_kantor, nama_kantor, korwil FROM master_kantor
		WHERE is_active = 1 ORDER BY kode_kantor`
	);
	const [korwils] = await mysqlPool.execute<Array<RowDataPacket & { korwil: string }>>(
		`SELECT DISTINCT korwil FROM master_kantor
		WHERE is_active = 1 AND korwil <> 'pusat' ORDER BY korwil`
	);
	const [divisions] = await mysqlPool.execute<DivisionRow[]>(
		'SELECT id, kode, nama_divisi FROM master_divisi WHERE is_active = 1 ORDER BY nama_divisi'
	);

	return {
		roles,
		offices,
		korwils: korwils.map((item) => item.korwil),
		divisions
	};
}

export async function updateAdminUserAccess(
	userId: number,
	actorEmployeeId: string,
	input: UserAccessInput
): Promise<void> {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();

		const [actorRows] = await connection.execute<IdRow[]>(
			'SELECT id FROM users WHERE employee_id = ? AND is_active = 1 LIMIT 1',
			[actorEmployeeId]
		);
		const [targetRows] = await connection.execute<Array<RowDataPacket & {
			id: number;
			employee_id: string;
			is_active: number;
			kode_kantor: string | null;
			divisi_id: number | null;
			unit_kerja: string | null;
			branch_name: string | null;
			job_position: string | null;
			profile_korwil: string | null;
		}>>(
			`SELECT u.id, u.employee_id, u.is_active, u.kode_kantor, u.divisi_id,
				u.unit_kerja, u.branch_name, u.job_position, office.korwil AS profile_korwil
			FROM users u LEFT JOIN master_kantor office
				ON office.kode_kantor = u.kode_kantor AND office.is_active = 1
			WHERE u.id = ? LIMIT 1 FOR UPDATE`,
			[userId]
		);
		if (!targetRows[0]) throw new AdminUserAccessError(404, 'Pegawai tidak ditemukan.');
		if (!actorRows[0]) throw new AdminUserAccessError(403, 'Akun Admin tidak ditemukan pada data lokal.');
		if (targetRows[0].employee_id === actorEmployeeId) {
			throw new AdminUserAccessError(409, 'Akses akun admin yang sedang digunakan tidak dapat diubah dari halaman ini.');
		}
		if (input.is_active && input.assignments.length === 0) {
			throw new AdminUserAccessError(400, 'Akun aktif harus memiliki setidaknya satu peran dan cakupan.');
		}

		await connection.execute('SELECT id FROM roles WHERE kode = ? FOR UPDATE', ['admin']);
		const [actorAdminRows] = await connection.execute<IdRow[]>(
			`SELECT s.id FROM user_role_scopes s
			INNER JOIN roles r ON r.id = s.role_id AND r.is_active = 1
			WHERE s.user_id = ? AND s.is_active = 1 AND r.kode = 'admin'
				AND s.scope_type = 'global' LIMIT 1`,
			[actorRows[0]?.id]
		);
		if (!actorAdminRows[0]) {
			throw new AdminUserAccessError(403, 'Akses Admin sudah tidak aktif. Muat ulang sesi sebelum melanjutkan.');
		}
		const [roleRows] = await connection.execute<RoleRow[]>(
			'SELECT id, kode, nama_role FROM roles WHERE is_active = 1'
		);
		const rolesById = new Map(roleRows.map((role) => [Number(role.id), role]));
		const profileDivisionKey = normalizeSsoUnitName(targetRows[0].unit_kerja);
		let profileDivisionId: number | null = null;
		if (profileDivisionKey) {
			const [profileDivisionRows] = await connection.execute<IdRow[]>(
				`SELECT division.id FROM division_sso_unit_aliases alias
				INNER JOIN master_divisi division ON division.id = alias.division_id AND division.is_active = 1
				WHERE alias.unit_kerja_key = ? LIMIT 2`,
				[profileDivisionKey]
			);
			if (profileDivisionRows.length === 1) profileDivisionId = Number(profileDivisionRows[0]?.id);
		}
		const uniqueAssignments = new Set<string>();
		const resolvedAssignments: Array<{
			assignment: UserAssignmentInput;
			kode_kantor: string | null;
			korwil: string | null;
			divisi_id: number | null;
		}> = [];
		const [knownKorwilRows] = await connection.execute<Array<RowDataPacket & { korwil: string }>>(
			`SELECT DISTINCT korwil FROM master_kantor
			WHERE is_active = 1 AND korwil <> 'pusat' ORDER BY korwil`
		);
		const targetKorwil = targetRows[0].profile_korwil && targetRows[0].profile_korwil !== 'pusat'
			? targetRows[0].profile_korwil
			: inferKorwilFromSsoText(targetRows[0], knownKorwilRows.map((row) => row.korwil));

		for (const assignment of input.assignments) {
			const role = rolesById.get(assignment.role_id);
			if (!role) throw new AdminUserAccessError(400, 'Peran yang dipilih tidak tersedia.');

			const requiredScope: Record<string, ScopeType> = {
				admin: 'global',
				branch_user: 'office',
				korwil_staff: 'korwil',
				korwil_approver: 'korwil',
				division_staff: 'division'
			};
			if (requiredScope[role.kode] && requiredScope[role.kode] !== assignment.scope_type) {
				throw new AdminUserAccessError(400, `Peran ${role.nama_role} harus memakai cakupan ${requiredScope[role.kode]}.`);
			}

			let targetKey = '';
			let resolvedOfficeCode: string | null = null;
			let resolvedKorwil: string | null = null;
			let resolvedDivisionId: number | null = null;
			if (assignment.scope_type === 'global') {
				if (assignment.kode_kantor || assignment.korwil || assignment.divisi_id !== null) {
					throw new AdminUserAccessError(400, 'Cakupan global tidak memakai kantor, Korwil, atau divisi.');
				}
				targetKey = 'global';
			} else if (assignment.scope_type === 'office') {
				if (assignment.korwil || assignment.divisi_id !== null) {
					throw new AdminUserAccessError(400, 'Cakupan kantor tidak memakai Korwil atau divisi.');
				}
				if (role.kode === 'branch_user') {
					if (assignment.kode_kantor !== null) {
						throw new AdminUserAccessError(400, 'Kantor Pengguna Cabang harus mengikuti profil SSO, bukan pilihan manual.');
					}
					resolvedOfficeCode = targetRows[0].kode_kantor;
					if (!resolvedOfficeCode || resolvedOfficeCode === '000') {
						throw new AdminUserAccessError(400, 'Profil SSO pegawai belum menunjukkan kantor Cabang yang aktif.');
					}
				} else {
					resolvedOfficeCode = assignment.kode_kantor;
					if (!resolvedOfficeCode) {
						throw new AdminUserAccessError(400, 'Pilih satu kantor untuk cakupan kantor.');
					}
				}
				const [offices] = await connection.execute<Array<RowDataPacket & { kode_kantor: string }>>(
					`SELECT kode_kantor FROM master_kantor
					WHERE kode_kantor = ? AND is_active = 1
						AND (? <> 'branch_user' OR (kode_kantor <> '000' AND korwil <> 'pusat'))
					LIMIT 1`,
					[resolvedOfficeCode, role.kode]
				);
				if (!offices[0]) {
					throw new AdminUserAccessError(400, 'Kantor pada profil SSO belum terdaftar sebagai Cabang aktif.');
				}
				targetKey = `office:${resolvedOfficeCode}`;
			} else if (assignment.scope_type === 'korwil') {
				const automaticKorwil = ['korwil_staff', 'korwil_approver'].includes(role.kode);
				if (assignment.kode_kantor || assignment.divisi_id !== null || (automaticKorwil && assignment.korwil !== null)) {
					throw new AdminUserAccessError(400, 'Cakupan Petugas Korwil mengikuti profil SSO, bukan pilihan manual.');
				}
				resolvedKorwil = automaticKorwil ? targetKorwil : assignment.korwil;
				if (!resolvedKorwil) {
					throw new AdminUserAccessError(400, 'Profil SSO pegawai belum menunjukkan Korwil yang terdaftar.');
				}
				const [korwils] = await connection.execute<Array<RowDataPacket & { korwil: string }>>(
					`SELECT DISTINCT korwil FROM master_kantor
					WHERE korwil = ? AND is_active = 1 AND korwil <> 'pusat' LIMIT 1`,
					[resolvedKorwil]
				);
				if (!korwils[0]) throw new AdminUserAccessError(400, 'Korwil dari profil SSO tidak ditemukan atau nonaktif.');
				targetKey = `korwil:${resolvedKorwil}`;
			} else {
				const automaticDivision = role.kode === 'division_staff';
				if (assignment.kode_kantor || assignment.korwil || (automaticDivision && assignment.divisi_id !== null)) {
					throw new AdminUserAccessError(400, 'Cakupan Petugas Divisi mengikuti unit kerja SSO, bukan pilihan manual.');
				}
				resolvedDivisionId = automaticDivision ? profileDivisionId : assignment.divisi_id;
				if (resolvedDivisionId === null) {
					throw new AdminUserAccessError(400, 'Unit kerja pada profil SSO belum cocok dengan Divisi Pusat aktif.');
				}
				const [divisions] = await connection.execute<IdRow[]>(
					'SELECT id FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1',
					[resolvedDivisionId]
				);
				if (!divisions[0]) throw new AdminUserAccessError(400, 'Divisi dari profil SSO tidak ditemukan atau nonaktif.');
				targetKey = `division:${resolvedDivisionId}`;
			}

			const fingerprint = `${assignment.role_id}:${assignment.scope_type}:${targetKey}`;
			if (uniqueAssignments.has(fingerprint)) {
				throw new AdminUserAccessError(400, 'Ada peran dengan cakupan yang sama lebih dari satu kali.');
			}
			uniqueAssignments.add(fingerprint);
			resolvedAssignments.push({
				assignment,
				kode_kantor: resolvedOfficeCode,
				korwil: resolvedKorwil,
				divisi_id: resolvedDivisionId
			});
		}

		const before = await getActiveAssignments(connection, userId);
		await connection.execute('UPDATE users SET divisi_id = ? WHERE id = ?', [profileDivisionId, userId]);
		await connection.execute('UPDATE users SET is_active = ? WHERE id = ?', [input.is_active ? 1 : 0, userId]);
		await connection.execute(
			'UPDATE user_role_scopes SET is_active = 0 WHERE user_id = ? AND is_active = 1',
			[userId]
		);
		for (const { assignment, kode_kantor, korwil, divisi_id } of resolvedAssignments) {
			await connection.execute(
				`INSERT INTO user_role_scopes
					(user_id, role_id, scope_type, kode_kantor, korwil, divisi_id, is_active)
				VALUES (?, ?, ?, ?, ?, ?, 1)`,
				[
					userId,
					assignment.role_id,
					assignment.scope_type,
					assignment.scope_type === 'office' ? kode_kantor : null,
					assignment.scope_type === 'korwil' ? korwil : null,
					assignment.scope_type === 'division' ? divisi_id : null
				]
			);
		}

		const [activeAdmins] = await connection.execute<CountRow[]>(
			`SELECT COUNT(*) AS total FROM users u
			INNER JOIN user_role_scopes s ON s.user_id = u.id AND s.is_active = 1
			INNER JOIN roles r ON r.id = s.role_id AND r.is_active = 1
			WHERE u.is_active = 1 AND r.kode = 'admin' AND s.scope_type = 'global'`
		);
		if (Number(activeAdmins[0]?.total ?? 0) === 0) {
			throw new AdminUserAccessError(409, 'Perubahan ditolak karena sistem harus memiliki setidaknya satu Admin global aktif.');
		}

		const after = await getActiveAssignments(connection, userId);
		await connection.execute(
			`INSERT INTO user_access_audit_logs
				(actor_user_id, target_user_id, action, before_data, after_data)
			VALUES (?, ?, 'access_updated', ?, ?)`,
			[
				actorRows[0].id,
				userId,
				JSON.stringify({ is_active: Number(targetRows[0].is_active) === 1, assignments: before }),
				JSON.stringify({ is_active: input.is_active, assignments: after })
			]
		);
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

async function getActiveAssignments(connection: PoolConnection, userId: number) {
	const [rows] = await connection.execute<Array<RowDataPacket & {
		role_id: number;
		role_code: string;
		nama_role: string;
		scope_type: ScopeType;
		kode_kantor: string | null;
		korwil: string | null;
		divisi_id: number | null;
	}>>(
		`SELECT r.id AS role_id, r.kode AS role_code, r.nama_role,
			s.scope_type, s.kode_kantor, s.korwil, s.divisi_id
		FROM user_role_scopes s INNER JOIN roles r ON r.id = s.role_id
		WHERE s.user_id = ? AND s.is_active = 1 ORDER BY s.id`,
		[userId]
	);
	return rows;
}
