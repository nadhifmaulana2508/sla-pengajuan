import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';
import { mysqlPool } from './client.js';

type ScopeType = 'global' | 'office' | 'korwil' | 'division';
type DummyAccount = {
	employeeId: string;
	label: string;
	fullName: string;
	roleCode: string;
	scopeType: ScopeType;
	kodeKantor: string | null;
	korwil: string | null;
	divisionCode: string | null;
	unitKerja: string | null;
	branchName: string | null;
	canManageForms?: boolean;
};

type IdRow = RowDataPacket & { id: number };
type DivisionRow = RowDataPacket & { id: number; kode: string; nama_divisi: string };

if (env.NODE_ENV !== 'development' || !env.DUMMY_AUTH_ENABLED) {
	throw new Error('Seed akun dummy hanya boleh dijalankan dengan NODE_ENV=development dan DUMMY_AUTH_ENABLED=true.');
}

async function seedDummyUsers(): Promise<void> {
	const connection = await mysqlPool.getConnection();
	try {
		const [roleRows] = await connection.execute<Array<RowDataPacket & { id: number; kode: string }>>(
			'SELECT id, kode FROM roles WHERE is_active = 1'
		);
		const roleIds = new Map(roleRows.map((role) => [role.kode, role.id]));
		const [divisionRows] = await connection.execute<DivisionRow[]>(
			'SELECT id, kode, nama_divisi FROM master_divisi WHERE is_active = 1 ORDER BY id'
		);
		const divisions = new Map(divisionRows.map((division) => [division.kode, division]));
		const [officeRows] = await connection.execute<Array<RowDataPacket & { kode_kantor: string; korwil: string; nama_kantor: string }>>(
			"SELECT kode_kantor, korwil, nama_kantor FROM master_kantor WHERE is_active = 1 AND kode_kantor IN ('000', '001')"
		);
		const offices = new Map(officeRows.map((office) => [office.kode_kantor, office]));
		const office001 = offices.get('001');
		const office000 = offices.get('000');
		if (!office001 || !office000) throw new Error('Master kantor 000 dan 001 harus tersedia sebelum seed akun dummy.');

		const accounts: DummyAccount[] = [
			{
				employeeId: 'DUMMY-ADMIN', label: 'Admin global', fullName: 'Akun Dummy - Admin',
				roleCode: 'admin', scopeType: 'global', kodeKantor: null, korwil: null, divisionCode: null,
				unitKerja: 'Sistem SLA', branchName: null
			},
			{
				employeeId: 'DUMMY-BRANCH-001', label: 'Pengguna Cabang - Kantor 001', fullName: 'Akun Dummy - Cabang 001',
				roleCode: 'branch_user', scopeType: 'office', kodeKantor: '001', korwil: null, divisionCode: null,
				unitKerja: office001.nama_kantor, branchName: office001.nama_kantor
			},
			{
				employeeId: 'DUMMY-KORWIL-STAFF-SEMARANG', label: 'Petugas Korwil - Semarang', fullName: 'Akun Dummy - Petugas Korwil Semarang',
				roleCode: 'korwil_staff', scopeType: 'korwil', kodeKantor: '001', korwil: office001.korwil, divisionCode: null,
				unitKerja: 'Korwil Semarang Raya', branchName: 'Korwil Semarang Raya'
			},
			{
				employeeId: 'DUMMY-KORWIL-APPROVER-SEMARANG', label: 'Penyetuju Korwil - Semarang', fullName: 'Akun Dummy - Penyetuju Korwil Semarang',
				roleCode: 'korwil_approver', scopeType: 'korwil', kodeKantor: '001', korwil: office001.korwil, divisionCode: null,
				unitKerja: 'Korwil Semarang Raya', branchName: 'Korwil Semarang Raya'
			},
			...divisionRows.map((division) => ({
				employeeId: `DUMMY-DIVISION-${division.kode.toUpperCase()}`,
				label: `Petugas Divisi - ${division.nama_divisi}`,
				fullName: `Akun Dummy - Divisi ${division.nama_divisi}`,
				roleCode: 'division_staff' as const,
				scopeType: 'division' as const,
				kodeKantor: '000',
				korwil: null,
				divisionCode: division.kode,
				unitKerja: division.nama_divisi,
				branchName: office000.nama_kantor,
				canManageForms: true
			})),
			{
				employeeId: 'DUMMY-SUPERVISOR', label: 'Supervisor global', fullName: 'Akun Dummy - Supervisor',
				roleCode: 'supervisor', scopeType: 'global', kodeKantor: '000', korwil: null, divisionCode: null,
				unitKerja: 'Pusat', branchName: office000.nama_kantor
			},
			{
				employeeId: 'DUMMY-MANAGEMENT', label: 'Manajemen global', fullName: 'Akun Dummy - Manajemen',
				roleCode: 'management', scopeType: 'global', kodeKantor: '000', korwil: null, divisionCode: null,
				unitKerja: 'Pusat', branchName: office000.nama_kantor
			}
		];

		await connection.beginTransaction();
		for (const account of accounts) {
			const roleId = roleIds.get(account.roleCode);
			if (!roleId) throw new Error(`Role aktif ${account.roleCode} tidak ditemukan.`);
			const divisionId = account.divisionCode ? divisions.get(account.divisionCode)?.id ?? null : null;
			if (account.divisionCode && divisionId === null) throw new Error(`Divisi aktif ${account.divisionCode} tidak ditemukan.`);
			if (account.scopeType === 'office' && account.kodeKantor !== '001') throw new Error(`Scope kantor tidak valid untuk ${account.employeeId}.`);

			const [existingUsers] = await connection.execute<Array<RowDataPacket & { id: number; is_dummy: number }>>(
				`SELECT u.id, (dummy.user_id IS NOT NULL) AS is_dummy
				FROM users u LEFT JOIN dummy_users dummy ON dummy.user_id = u.id
				WHERE u.employee_id = ? LIMIT 1 FOR UPDATE`,
				[account.employeeId]
			);
			if (existingUsers[0] && Number(existingUsers[0].is_dummy) !== 1) {
				throw new Error(`ID ${account.employeeId} sudah dipakai akun non-dummy; tidak ada data yang ditimpa.`);
			}

			await connection.execute(
				`INSERT INTO users (
					employee_id, full_name, branch_name, unit_kerja, kode_kantor, divisi_id, is_active, profile_synced_at
				) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
				ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), branch_name = VALUES(branch_name),
					unit_kerja = VALUES(unit_kerja), kode_kantor = VALUES(kode_kantor),
					divisi_id = VALUES(divisi_id), is_active = 1, profile_synced_at = CURRENT_TIMESTAMP`,
				[account.employeeId, account.fullName, account.branchName, account.unitKerja, account.kodeKantor, divisionId ?? null]
			);
			const [userRows] = await connection.execute<IdRow[]>(
				'SELECT id FROM users WHERE employee_id = ? LIMIT 1 FOR UPDATE',
				[account.employeeId]
			);
			const userId = userRows[0]?.id;
			if (!userId) throw new Error(`Akun ${account.employeeId} gagal disimpan.`);

			await connection.execute(
				`INSERT INTO dummy_users (user_id, label, is_active) VALUES (?, ?, 1)
				ON DUPLICATE KEY UPDATE label = VALUES(label), is_active = 1`,
				[userId, account.label]
			);

			const [matchingScopes] = await connection.execute<IdRow[]>(
				`SELECT id FROM user_role_scopes
				WHERE user_id = ? AND role_id = ? AND scope_type = ?
					AND (kode_kantor <=> ?) AND (korwil <=> ?) AND (divisi_id <=> ?)
				ORDER BY id LIMIT 1 FOR UPDATE`,
				[userId, roleId, account.scopeType, account.scopeType === 'office' ? account.kodeKantor : null,
					account.scopeType === 'korwil' ? account.korwil : null,
					account.scopeType === 'division' ? divisionId : null]
			);
			await connection.execute('UPDATE user_role_scopes SET is_active = 0 WHERE user_id = ? AND is_active = 1', [userId]);
			const scopeId = matchingScopes[0]?.id;
			if (scopeId) {
				await connection.execute(
					'UPDATE user_role_scopes SET can_manage_forms = ?, is_active = 1 WHERE id = ?',
					[account.canManageForms ? 1 : 0, scopeId]
				);
			} else {
				await connection.execute(
					`INSERT INTO user_role_scopes
						(user_id, role_id, scope_type, kode_kantor, korwil, divisi_id, can_manage_forms, is_active)
					VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
					[userId, roleId, account.scopeType,
						account.scopeType === 'office' ? account.kodeKantor : null,
						account.scopeType === 'korwil' ? account.korwil : null,
						account.scopeType === 'division' ? divisionId : null,
						account.canManageForms ? 1 : 0]
				);
			}
		}
		await connection.commit();
		console.log(`Akun dummy lokal siap: ${accounts.length} akun untuk ${new Set(accounts.map(({ roleCode }) => roleCode)).size} role.`);
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
		await mysqlPool.end();
	}
}

seedDummyUsers().catch((error: unknown) => {
	console.error('Seed akun dummy gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
