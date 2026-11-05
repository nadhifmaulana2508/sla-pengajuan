import assert from 'node:assert/strict';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../db/client.js';
import {
	claimCentralRequest,
	claimKorwilRequest,
	finishCentralRequest,
	finishKorwilRequest,
	forwardKorwilRequestToCentral,
	getRequestDetail,
	RequestWorkflowError,
	returnCentralRequestForDocuments,
	submitBranchRevision,
	submitRequest
} from '../modules/requests/requests.service.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../modules/notifications/notifications.service.js';

const fixturePrefix = 'e2e-notification-';
const employees = {
	branch: `${fixturePrefix}branch-001`,
	korwil: `${fixturePrefix}korwil-semarang`,
	division: `${fixturePrefix}division-pemasaran`,
	outsideDivision: `${fixturePrefix}division-operasional`
} as const;

type FixtureKey = keyof typeof employees;
type FixtureUser = { id: number; employee_id: string };

function check(condition: unknown, message: string): asserts condition {
	assert.ok(condition, message);
}

async function expectForbidden(action: () => Promise<unknown>, message: string): Promise<void> {
	try {
		await action();
		assert.fail(`${message}: expected 403`);
	} catch (error) {
		check(error instanceof RequestWorkflowError && error.statusCode === 403, message);
	}
}

async function getRoleId(code: string): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM roles WHERE kode = ? AND is_active = 1 LIMIT 1', [code]
	);
	check(rows[0], `Role ${code} harus tersedia.`);
	return Number(rows[0].id);
}

async function getDivisionId(code: string): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM master_divisi WHERE kode = ? AND is_active = 1 LIMIT 1', [code]
	);
	check(rows[0], `Divisi ${code} harus tersedia.`);
	return Number(rows[0].id);
}

async function getCatalogId(divisionId: number): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM work_catalogs WHERE divisi_id = ? AND is_active = 1 ORDER BY id LIMIT 1', [divisionId]
	);
	check(rows[0], 'Katalog aktif untuk fixture harus tersedia.');
	return Number(rows[0].id);
}

async function fixtureUserIds(): Promise<number[]> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		' SELECT id FROM users WHERE employee_id LIKE ?', [`${fixturePrefix}%`]
	);
	return rows.map((row) => Number(row.id));
}

async function cleanupFixtures(): Promise<void> {
	const userIds = await fixtureUserIds();
	if (userIds.length === 0) return;
	const placeholders = userIds.map(() => '?').join(', ');
	await mysqlPool.execute(
		`DELETE notification FROM notifications notification
		INNER JOIN service_requests request ON request.id = notification.request_id
		WHERE request.created_by_user_id IN (${placeholders})`, userIds
	);
	for (const table of ['request_status_histories', 'request_sla_sessions', 'request_assignments'] as const) {
		await mysqlPool.execute(
			`DELETE item FROM ${table} item
			INNER JOIN service_requests request ON request.id = item.request_id
			WHERE request.created_by_user_id IN (${placeholders})`, userIds
		);
	}
	await mysqlPool.execute(`DELETE FROM service_requests WHERE created_by_user_id IN (${placeholders})`, userIds);
	await mysqlPool.execute(`DELETE FROM user_role_scopes WHERE user_id IN (${placeholders})`, userIds);
	await mysqlPool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);
}

async function assertFixturesRemoved(): Promise<void> {
	assert.equal((await fixtureUserIds()).length, 0, 'Cleanup harus menghapus seluruh akun fixture notifikasi.');
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { count: number }>>(
		`SELECT COUNT(*) AS count FROM service_requests WHERE subject LIKE ?`, ['[FIXTURE NOTIFICATION]%']
	);
	assert.equal(Number(rows[0]?.count ?? 0), 0, 'Cleanup harus menghapus seluruh tiket fixture notifikasi.');
}

async function createFixtures(): Promise<{ users: Record<FixtureKey, FixtureUser>; divisionId: number; catalogId: number }> {
	await cleanupFixtures();
	const branchRoleId = await getRoleId('branch_user');
	const korwilRoleId = await getRoleId('korwil_staff');
	const divisionRoleId = await getRoleId('division_staff');
	const divisionId = await getDivisionId('pemasaran');
	const outsideDivisionId = await getDivisionId('operasional');
	const catalogId = await getCatalogId(divisionId);
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const inputs: Array<{ key: FixtureKey; office: string; division: number | null }> = [
			{ key: 'branch', office: '001', division: null },
			{ key: 'korwil', office: '001', division: null },
			{ key: 'division', office: '000', division: divisionId },
			{ key: 'outsideDivision', office: '000', division: outsideDivisionId }
		];
		const users = {} as Record<FixtureKey, FixtureUser>;
		for (const input of inputs) {
			const [insert] = await connection.execute<ResultSetHeader>(
				`INSERT INTO users (employee_id, full_name, unit_kerja, kode_kantor, divisi_id, is_active, profile_synced_at)
				VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3))`,
				[employees[input.key], `Notification Fixture ${input.key}`, 'E2E Fixture', input.office, input.division]
			);
			users[input.key] = { id: insert.insertId, employee_id: employees[input.key] };
		}
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, kode_kantor)
			VALUES (?, ?, 'office', '001')`, [users.branch.id, branchRoleId]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, korwil)
			VALUES (?, ?, 'korwil', 'semarang')`, [users.korwil.id, korwilRoleId]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, divisi_id)
			VALUES (?, ?, 'division', ?)`, [users.division.id, divisionRoleId, divisionId]
		);
		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, divisi_id)
			VALUES (?, ?, 'division', ?)`, [users.outsideDivision.id, divisionRoleId, outsideDivisionId]
		);
		await connection.commit();
		return { users, divisionId, catalogId };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

async function eventTypes(employeeId: string): Promise<string[]> {
	return (await listNotifications(employeeId)).notifications.map((item) => item.event_type);
}

async function run(): Promise<void> {
	const fixture = await createFixtures();
	const branch = fixture.users.branch.employee_id;
	const korwil = fixture.users.korwil.employee_id;
	const division = fixture.users.division.employee_id;
	const outsideDivision = fixture.users.outsideDivision.employee_id;
	const requestIds: number[] = [];
	try {
		const central = await submitRequest(branch, {
			authority_type: 'central', central_division_id: fixture.divisionId, work_catalog_id: fixture.catalogId,
			subject: '[FIXTURE NOTIFICATION] central', description: 'Fixture untuk verifikasi notifikasi.'
		});
		requestIds.push(central.id);
		check((await eventTypes(korwil)).includes('request_received'), 'Unit tujuan harus menerima pengajuan baru.');
		check(!(await eventTypes(outsideDivision)).includes('request_received'), 'Divisi di luar scope tidak boleh menerima pengajuan baru.');

		await claimKorwilRequest(korwil, central.id);
		check((await eventTypes(branch)).includes('request_claimed'), 'Cabang harus menerima notifikasi Ambil Korwil.');
		await forwardKorwilRequestToCentral(korwil, central.id, 'Fixture diteruskan.');
		check((await eventTypes(division)).includes('request_forwarded'), 'Divisi tujuan harus menerima notifikasi penerusan.');
		check((await eventTypes(branch)).includes('request_forwarded'), 'Cabang harus menerima perubahan penerusan.');
		check(!(await eventTypes(outsideDivision)).includes('request_forwarded'), 'Divisi di luar scope tidak boleh menerima penerusan.');

		await claimCentralRequest(division, central.id);
		check((await eventTypes(branch)).filter((event) => event === 'request_claimed').length >= 2, 'Cabang harus menerima Ambil Divisi.');
		await returnCentralRequestForDocuments(division, central.id, 'Fixture minta kelengkapan.');
		check((await eventTypes(branch)).includes('documents_requested'), 'Cabang harus menerima permintaan kelengkapan.');
		const revision = await submitBranchRevision(branch, central.id, 'Fixture mengirim jawaban kelengkapan.');
		assert.equal(revision.resumed_to_previous_handler, true);
		check((await eventTypes(division)).includes('revision_submitted'), 'Jawaban revisi harus kembali ke petugas peminta.');
		check(!(await eventTypes(outsideDivision)).includes('revision_submitted'), 'Jawaban revisi tidak boleh keluar scope.');
		await finishCentralRequest(division, central.id, 'rejected', 'Fixture ditolak.');
		check((await eventTypes(branch)).includes('request_rejected'), 'Cabang harus menerima penolakan.');
		assert.equal((await getRequestDetail(branch, central.id)).request.id, central.id);
		await expectForbidden(() => getRequestDetail(outsideDivision, central.id), 'Detail harus menolak pengguna di luar scope.');

		const korwilRequest = await submitRequest(branch, {
			authority_type: 'korwil', central_division_id: null, work_catalog_id: null,
			subject: '[FIXTURE NOTIFICATION] completed', description: 'Fixture untuk verifikasi selesai.'
		});
		requestIds.push(korwilRequest.id);
		await claimKorwilRequest(korwil, korwilRequest.id);
		await finishKorwilRequest(korwil, korwilRequest.id, 'completed', 'Fixture selesai.');
		check((await eventTypes(branch)).includes('request_completed'), 'Cabang harus menerima penyelesaian.');

		const before = await listNotifications(branch);
		check(before.unread_count > 0, 'Unread count harus bertambah saat event masuk.');
		const unread = before.notifications.find((item) => item.read_at === null);
		check(unread, 'Fixture harus memiliki notifikasi belum dibaca.');
		await markNotificationRead(branch, unread.id);
		const afterOne = await listNotifications(branch);
		assert.equal(afterOne.unread_count, before.unread_count - 1);
		check(afterOne.notifications.find((item) => item.id === unread.id)?.read_at !== null, 'Tandai satu dibaca harus tersimpan.');
		await markAllNotificationsRead(branch);
		const afterAll = await listNotifications(branch);
		assert.equal(afterAll.unread_count, 0);
		check(afterAll.notifications.every((item) => item.read_at !== null), 'Tandai semua dibaca harus tersimpan.');
		console.log('E2E notifikasi lulus: penerima, event workflow, scope, detail, unread, tandai satu, tandai semua.');
	} finally {
		await cleanupFixtures();
		await assertFixturesRemoved();
	}
}

try {
	await run();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await mysqlPool.end();
}
