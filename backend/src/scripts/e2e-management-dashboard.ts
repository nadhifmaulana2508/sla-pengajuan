import assert from 'node:assert/strict';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../db/client.js';
import { getDashboard, getBranchFollowUp } from '../modules/dashboard/dashboard.service.js';
import {
	claimKorwilRequest,
	getRequestDetail,
	returnKorwilRequestForDocuments,
	submitRequest
} from '../modules/requests/requests.service.js';

const prefix = 'e2e-management-dashboard-';
const employees = {
	branch: `${prefix}branch`,
	korwil: `${prefix}korwil`,
	management: `${prefix}management`
} as const;

type FixtureKey = keyof typeof employees;

function check(value: unknown, message: string): asserts value {
	assert.ok(value, message);
}

async function roleId(code: string): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM roles WHERE kode = ? AND is_active = 1 LIMIT 1', [code]
	);
	check(rows[0], `Role ${code} harus tersedia.`);
	return Number(rows[0].id);
}

async function divisionId(): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		"SELECT id FROM master_divisi WHERE kode = 'pemasaran' AND is_active = 1 LIMIT 1"
	);
	check(rows[0], 'Divisi Pemasaran harus tersedia.');
	return Number(rows[0].id);
}

async function catalogId(id: number): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM work_catalogs WHERE divisi_id = ? AND is_active = 1 ORDER BY id LIMIT 1', [id]
	);
	check(rows[0], 'Katalog Pemasaran harus tersedia.');
	return Number(rows[0].id);
}

async function fixtureUserIds(): Promise<number[]> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM users WHERE employee_id LIKE ?', [`${prefix}%`]
	);
	return rows.map((row) => Number(row.id));
}

async function cleanup(): Promise<void> {
	const ids = await fixtureUserIds();
	if (ids.length === 0) return;
	const placeholders = ids.map(() => '?').join(', ');
	for (const table of ['notifications', 'request_status_histories', 'request_sla_sessions', 'request_assignments'] as const) {
		await mysqlPool.execute(
			`DELETE item FROM ${table} item INNER JOIN service_requests request ON request.id = item.request_id WHERE request.created_by_user_id IN (${placeholders})`, ids
		);
	}
	await mysqlPool.execute(`DELETE FROM service_requests WHERE created_by_user_id IN (${placeholders})`, ids);
	await mysqlPool.execute(`DELETE FROM user_role_scopes WHERE user_id IN (${placeholders})`, ids);
	await mysqlPool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, ids);
}

async function createFixtures(division: number): Promise<Record<FixtureKey, string>> {
	await cleanup();
	const branchRole = await roleId('branch_user');
	const korwilRole = await roleId('korwil_staff');
	const managementRole = await roleId('management');
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const ids = {} as Record<FixtureKey, number>;
		for (const [key, employee] of Object.entries(employees) as Array<[FixtureKey, string]>) {
			const [result] = await connection.execute<ResultSetHeader>(
				`INSERT INTO users (employee_id, full_name, unit_kerja, kode_kantor, divisi_id, is_active, profile_synced_at)
				 VALUES (?, ?, 'E2E Management Fixture', ?, ?, 1, CURRENT_TIMESTAMP(3))`,
				[employee, `E2E Management ${key}`, key === 'management' ? '000' : '001', key === 'management' ? null : null]
			);
			ids[key] = Number(result.insertId);
		}
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, kode_kantor) VALUES (?, ?, 'office', '001')`,
			[ids.branch, branchRole]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, korwil) VALUES (?, ?, 'korwil', 'semarang')`,
			[ids.korwil, korwilRole]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type) VALUES (?, ?, 'global')`,
			[ids.management, managementRole]
		);
		await connection.commit();
		return employees;
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

async function run(): Promise<void> {
	const division = await divisionId();
	const catalog = await catalogId(division);
	const fixture = await createFixtures(division);
	try {
		const created = await submitRequest(fixture.branch, {
			authority_type: 'central', central_division_id: division, work_catalog_id: catalog,
			subject: '[FIXTURE MANAGEMENT DASHBOARD] Menunggu Cabang', description: 'Fixture untuk validasi pemantauan Manajemen.'
		});
		const detail = await getRequestDetail(fixture.management, created.id);
		assert.equal(detail.request.id, created.id, 'Manajemen global harus dapat membuka detail tiket.');
		assert.equal(Object.values(detail.capabilities).some(Boolean), false, 'Detail Manajemen harus baca-saja.');

		const dashboard = await getDashboard(fixture.management, { from: null, to: null, korwil: null, divisionId: null });
		assert.equal(dashboard.view, 'admin');
		check(dashboard.requests.some((item) => item.id === created.id), 'Dashboard Manajemen harus menampilkan tiket scope global.');
		check(dashboard.filter_options?.korwils.includes('semarang'), 'Dashboard harus mengembalikan opsi Korwil.');
		check(dashboard.filter_options?.divisions.some((item) => item.id === division), 'Dashboard harus mengembalikan opsi Divisi.');

		const filtered = await getDashboard(fixture.management, { from: null, to: null, korwil: 'semarang', divisionId: division });
		check(filtered.requests.some((item) => item.id === created.id), 'Filter Korwil dan Divisi harus mempertahankan tiket yang cocok.');

		await claimKorwilRequest(fixture.korwil, created.id);
		await returnKorwilRequestForDocuments(fixture.korwil, created.id, {
			note: 'Perbaiki uraian fixture sebelum dikirim ulang.',
			fields: [{ kind: 'description' }],
			documents: []
		});
		const followUp = await getBranchFollowUp(fixture.management, { kodeKantor: '001' });
		check(followUp.requests.some((item) => item.id === created.id), 'Halaman tindak lanjut harus menampilkan tiket menunggu Cabang.');
		const otherBranch = await getBranchFollowUp(fixture.management, { kodeKantor: '002' });
		assert.equal(otherBranch.requests.some((item) => item.id === created.id), false, 'Filter Cabang harus mengisolasi tiket.');
		console.log(`E2E management/dashboard lulus: ${created.request_number}; detail baca-saja, filter, dan tiket menunggu Cabang.`);
	} finally {
		await cleanup();
	}
}

run().catch((error: unknown) => {
		console.error('E2E management/dashboard gagal:', error instanceof Error ? error.message : error);
		process.exitCode = 1;
}).finally(async () => {
		await mysqlPool.end();
});
