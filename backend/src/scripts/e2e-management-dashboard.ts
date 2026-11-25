import assert from 'node:assert/strict';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../db/client.js';
import { getDashboard, getBranchFollowUp, getManagementRequests } from '../modules/dashboard/dashboard.service.js';
import {
	claimKorwilRequest,
	forwardKorwilRequestToCentral,
	getRequestDetail,
	listKorwilHistory,
	listKorwilInbox,
	returnKorwilRequestForDocuments,
	submitRequest
} from '../modules/requests/requests.service.js';
import { removePrivatePdf } from '../modules/requests/private-attachments.js';

const prefix = 'e2e-management-dashboard-';
const subjectPrefix = '[FIXTURE MANAGEMENT DASHBOARD]';
const catalogPrefix = `${prefix}catalog-`;
const employees = {
	branch: `${prefix}branch-semarang`,
	branchSolo: `${prefix}branch-solo`,
	korwil: `${prefix}korwil-semarang`,
	korwilSolo: `${prefix}korwil-solo`,
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
		"SELECT id FROM master_divisi WHERE kode = 'operasional' AND is_active = 1 LIMIT 1"
	);
	check(rows[0], 'Divisi Operasional harus tersedia.');
	return Number(rows[0].id);
}

async function createCatalogFixtures(id: number): Promise<{ direct: number; viaKorwil: number }> {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const suffix = Date.now();
		const [direct] = await connection.execute<ResultSetHeader>(
			`INSERT INTO work_catalogs (divisi_id, nama_pekerjaan, target_sla_minutes, routing_flow, is_active)
			VALUES (?, ?, 10080, 'branch_central', 1)`, [id, `${catalogPrefix}direct-${suffix}`]
		);
		const [viaKorwil] = await connection.execute<ResultSetHeader>(
			`INSERT INTO work_catalogs (divisi_id, nama_pekerjaan, target_sla_minutes, routing_flow, is_active)
			VALUES (?, ?, 10080, 'branch_korwil_central', 1)`, [id, `${catalogPrefix}via-korwil-${suffix}`]
		);
		await connection.commit();
		return { direct: Number(direct.insertId), viaKorwil: Number(viaKorwil.insertId) };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

async function fixtureUserIds(): Promise<number[]> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM users WHERE employee_id LIKE ?', [`${prefix}%`]
	);
	return rows.map((row) => Number(row.id));
}

async function cleanup(): Promise<void> {
	const ids = await fixtureUserIds();
	const [requestRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		`SELECT id FROM service_requests WHERE subject LIKE ?${ids.length ? ` OR created_by_user_id IN (${ids.map(() => '?').join(', ')})` : ''}`,
		[`${subjectPrefix}%`, ...ids]
	);
	const requestIds = requestRows.map((row) => Number(row.id));
	if (requestIds.length > 0) {
		const placeholders = requestIds.map(() => '?').join(', ');
		const [attachments] = await mysqlPool.execute<Array<RowDataPacket & { storage_key: string }>>(
			`SELECT storage_key FROM request_attachments WHERE request_id IN (${placeholders})`, requestIds
		);
		for (const attachment of attachments) await removePrivatePdf(attachment.storage_key);
		for (const table of ['request_decisions', 'request_attachments', 'request_revisions', 'notifications',
			'request_status_histories', 'request_sla_sessions', 'request_assignments'] as const) {
			await mysqlPool.execute(`DELETE FROM ${table} WHERE request_id IN (${placeholders})`, requestIds);
		}
		await mysqlPool.execute(`DELETE FROM service_requests WHERE id IN (${placeholders})`, requestIds);
	}
	await mysqlPool.execute('DELETE FROM work_catalogs WHERE nama_pekerjaan LIKE ?', [`${catalogPrefix}%`]);
	if (ids.length > 0) {
		const placeholders = ids.map(() => '?').join(', ');
		await mysqlPool.execute(`DELETE FROM user_role_scopes WHERE user_id IN (${placeholders})`, ids);
		await mysqlPool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, ids);
	}
}

async function assertFixturesRemoved(): Promise<void> {
	assert.equal((await fixtureUserIds()).length, 0, 'Cleanup harus menghapus semua akun fixture.');
	const [requests] = await mysqlPool.execute<Array<RowDataPacket & { count: number }>>(
		' SELECT COUNT(*) AS count FROM service_requests WHERE subject LIKE ?', [`${subjectPrefix}%`]
	);
	assert.equal(Number(requests[0]?.count ?? 0), 0, 'Cleanup harus menghapus semua tiket fixture.');
	const [catalogs] = await mysqlPool.execute<Array<RowDataPacket & { count: number }>>(
		' SELECT COUNT(*) AS count FROM work_catalogs WHERE nama_pekerjaan LIKE ?', [`${catalogPrefix}%`]
	);
	assert.equal(Number(catalogs[0]?.count ?? 0), 0, 'Cleanup harus menghapus semua katalog fixture.');
}

async function createFixtures(): Promise<Record<FixtureKey, string>> {
	const branchRole = await roleId('branch_user');
	const korwilRole = await roleId('korwil_staff');
	const managementRole = await roleId('management');
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const ids = {} as Record<FixtureKey, number>;
		for (const [key, employee] of Object.entries(employees) as Array<[FixtureKey, string]>) {
			const officeCode = key === 'management' ? '000' : key === 'branchSolo' || key === 'korwilSolo' ? '008' : '001';
			const [result] = await connection.execute<ResultSetHeader>(
				`INSERT INTO users (employee_id, full_name, unit_kerja, kode_kantor, divisi_id, is_active, profile_synced_at)
				 VALUES (?, ?, 'E2E Management Fixture', ?, ?, 1, CURRENT_TIMESTAMP(3))`,
				[employee, `E2E Management ${key}`, officeCode, null]
			);
			ids[key] = Number(result.insertId);
		}
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, kode_kantor) VALUES (?, ?, 'office', '001')`,
			[ids.branch, branchRole]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, kode_kantor) VALUES (?, ?, 'office', '008')`,
			[ids.branchSolo, branchRole]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, korwil) VALUES (?, ?, 'korwil', 'semarang')`,
			[ids.korwil, korwilRole]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, korwil) VALUES (?, ?, 'korwil', 'solo')`,
			[ids.korwilSolo, korwilRole]
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
	await cleanup();
	await assertFixturesRemoved();
	try {
		const division = await divisionId();
		const fixture = await createFixtures();
		const catalogs = await createCatalogFixtures(division);
		const noFilters = { from: null, to: null, korwil: null, divisionId: null, status: null };
		const semarangBefore = await getDashboard(fixture.korwil, noFilters);

		const direct = await submitRequest(fixture.branch, {
			authority_type: 'central', central_division_id: division, work_catalog_id: catalogs.direct,
			subject: `${subjectPrefix} Rute langsung`, description: 'Fixture untuk validasi cakupan Korwil jalur langsung.'
		});
		assert.equal(direct.routed_to, 'central', 'Katalog langsung harus mengarahkan tiket ke Divisi.');
		const [directHistory] = await mysqlPool.execute<Array<RowDataPacket & {
			action_name: string; unit_to_type: string; unit_to_code: string;
		}>>(
			`SELECT action_name, unit_to_type, unit_to_code FROM request_status_histories
			WHERE request_id = ? ORDER BY id`, [direct.id]
		);
		assert.equal(directHistory[0]?.action_name, 'submitted');
		assert.equal(directHistory[0]?.unit_to_type, 'central');
		assert.equal(directHistory[0]?.unit_to_code, 'operasional');
		await mysqlPool.execute(
			`UPDATE service_requests SET submitted_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 8 DAY) WHERE id = ?`, [direct.id]
		);

		const semarangAfterDirect = await getDashboard(fixture.korwil, noFilters);
		assert.equal(semarangAfterDirect.requests.some((item) => item.id === direct.id), false,
			'Tiket direct ke Divisi tidak boleh muncul di daftar Dashboard Korwil.');
		assert.equal(semarangAfterDirect.summary.total, semarangBefore.summary.total,
			'Tiket direct tidak boleh menambah jumlah total Dashboard Korwil.');
		for (const key of ['waiting', 'in_progress', 'waiting_branch', 'completed', 'rejected', 'revision_count'] as const) {
			assert.equal(semarangAfterDirect.summary[key], semarangBefore.summary[key],
				`Tiket direct tidak boleh mengubah ringkasan Dashboard Korwil: ${key}.`);
		}
		assert.deepEqual(semarangAfterDirect.status_counts, semarangBefore.status_counts,
			'Tiket direct tidak boleh mengubah hitungan status Dashboard Korwil.');
		assert.deepEqual(semarangAfterDirect.sla.counts, semarangBefore.sla.counts,
			'Tiket direct tidak boleh mengubah hitungan SLA Dashboard Korwil.');
		assert.ok(semarangAfterDirect.summary.total_age_seconds - semarangBefore.summary.total_age_seconds < 86400,
			'Tiket direct berumur 8 hari tidak boleh menambah umur agregat Dashboard Korwil.');
		assert.ok(semarangAfterDirect.summary.total_process_seconds - semarangBefore.summary.total_process_seconds < 86400,
			'Tiket direct tidak boleh menambah agregat durasi unit Korwil.');
		assert.equal((await listKorwilInbox(fixture.korwil)).some((item) => item.id === direct.id), false,
			'Tiket direct tetap tidak boleh muncul di Antrean Korwil.');
		assert.equal((await listKorwilHistory(fixture.korwil)).some((item) => item.id === direct.id), false,
			'Tiket direct tetap tidak boleh muncul di Riwayat Korwil.');

		const viaKorwil = await submitRequest(fixture.branch, {
			authority_type: 'central', central_division_id: division, work_catalog_id: catalogs.viaKorwil,
			subject: `${subjectPrefix} Melalui Korwil`, description: 'Fixture untuk validasi histori Korwil.'
		});
		assert.equal(viaKorwil.routed_to, 'korwil');
		let semarangDashboard = await getDashboard(fixture.korwil, noFilters);
		check(semarangDashboard.requests.some((item) => item.id === viaKorwil.id),
			'Tiket yang masuk ke Korwil harus tampil di Dashboard Korwil.');
		assert.equal(semarangDashboard.summary.total, semarangBefore.summary.total + 1,
			'Total Dashboard Korwil harus bertambah untuk tiket yang memang masuk ke scope-nya.');
		assert.equal(semarangDashboard.summary.waiting, semarangBefore.summary.waiting + 1,
			'Ringkasan antrean Korwil harus menghitung tiket yang menunggu Korwil.');
		await claimKorwilRequest(fixture.korwil, viaKorwil.id);
		await forwardKorwilRequestToCentral(fixture.korwil, viaKorwil.id, 'Fixture diteruskan ke Divisi.', { approvalConfirmed: true });
		semarangDashboard = await getDashboard(fixture.korwil, noFilters);
		const forwardedInDashboard = semarangDashboard.requests.find((item) => item.id === viaKorwil.id);
		check(forwardedInDashboard, 'Tiket yang pernah melalui Korwil harus tetap berada di cakupan Dashboard setelah diteruskan.');
		assert.equal(forwardedInDashboard.status, 'waiting_central');
		check((await listKorwilHistory(fixture.korwil)).some((item) => item.id === viaKorwil.id),
			'Tiket yang diteruskan harus tetap ada di Riwayat Korwil.');
		assert.equal((await listKorwilInbox(fixture.korwil)).some((item) => item.id === viaKorwil.id), false,
			'Tiket yang sudah diteruskan tidak boleh tersisa di Antrean Korwil.');

		const soloRequest = await submitRequest(fixture.branchSolo, {
			authority_type: 'central', central_division_id: division, work_catalog_id: catalogs.viaKorwil,
			subject: `${subjectPrefix} Korwil Solo`, description: 'Fixture untuk validasi isolasi Korwil.'
		});
		const soloDashboard = await getDashboard(fixture.korwilSolo, noFilters);
		check(soloDashboard.requests.some((item) => item.id === soloRequest.id), 'Korwil Solo harus melihat tiket scope Solo.');
		semarangDashboard = await getDashboard(fixture.korwil, noFilters);
		assert.equal(semarangDashboard.requests.some((item) => item.id === soloRequest.id), false,
			'Tiket Solo tidak boleh bocor ke Dashboard Korwil Semarang.');
		assert.equal((await listKorwilInbox(fixture.korwil)).some((item) => item.id === soloRequest.id), false,
			'Tiket Solo tidak boleh bocor ke Antrean Korwil Semarang.');

		const followUpRequest = await submitRequest(fixture.branch, {
			authority_type: 'central', central_division_id: division, work_catalog_id: catalogs.viaKorwil,
			subject: `${subjectPrefix} Menunggu Cabang`, description: 'Fixture untuk validasi pemantauan Manajemen.'
		});
		await claimKorwilRequest(fixture.korwil, followUpRequest.id);
		await returnKorwilRequestForDocuments(fixture.korwil, followUpRequest.id, {
			note: 'Perbaiki uraian fixture sebelum dikirim ulang.',
			fields: [{ kind: 'description' }],
			documents: []
		});
		const detail = await getRequestDetail(fixture.management, followUpRequest.id);
		assert.equal(detail.request.id, followUpRequest.id, 'Manajemen global harus dapat membuka detail tiket.');
		assert.equal(Object.values(detail.capabilities).some(Boolean), false, 'Detail Manajemen harus baca-saja.');

		const dashboard = await getDashboard(fixture.management, noFilters);
		assert.equal(dashboard.view, 'admin');
		for (const request of [direct, viaKorwil, soloRequest, followUpRequest]) {
			check(dashboard.requests.some((item) => item.id === request.id), 'Dashboard Manajemen harus mempertahankan cakupan global.');
		}
		check(dashboard.filter_options?.korwils.includes('semarang'), 'Dashboard harus mengembalikan opsi Korwil.');
		check(dashboard.filter_options?.divisions.some((item) => item.id === division), 'Dashboard harus mengembalikan opsi Divisi.');

		const filtered = await getDashboard(fixture.management, { from: null, to: null, korwil: 'semarang', divisionId: division, status: null });
		check(filtered.requests.some((item) => item.id === direct.id), 'Filter Manajemen tetap harus menampilkan tiket direct yang sesuai.');
		check(!filtered.requests.some((item) => item.id === soloRequest.id), 'Filter Manajemen berdasarkan Korwil harus tetap bekerja.');
		const managementRequests = await getManagementRequests(fixture.management, {
			kodeKantor: null, korwil: null, divisionId: null, status: null, slaStatus: null,
			search: null, from: null, to: null, page: 1, pageSize: 100
		});
		for (const request of [direct, viaKorwil, soloRequest, followUpRequest]) {
			check(managementRequests.requests.some((item) => item.id === request.id), 'Endpoint Pemantauan Manajemen harus tetap menampilkan scope global.');
		}

		const followUp = await getBranchFollowUp(fixture.management, { kodeKantor: '001' });
		check(followUp.requests.some((item) => item.id === followUpRequest.id), 'Halaman tindak lanjut harus menampilkan tiket menunggu Cabang.');
		const otherBranch = await getBranchFollowUp(fixture.management, { kodeKantor: '002' });
		assert.equal(otherBranch.requests.some((item) => item.id === followUpRequest.id), false, 'Filter Cabang harus mengisolasi tiket.');
		console.log(`E2E management/dashboard lulus: direct dikecualikan dari scope Korwil; via-Korwil, Korwil Solo, Manajemen global, dan cleanup terverifikasi.`);
	} finally {
		await cleanup();
		await assertFixturesRemoved();
	}
}

run().catch((error: unknown) => {
		console.error('E2E management/dashboard gagal:', error instanceof Error ? error.message : error);
		process.exitCode = 1;
}).finally(async () => {
		await mysqlPool.end();
});
