import assert from 'node:assert/strict';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { mysqlPool } from '../db/client.js';
import {
	claimCentralRequest,
	claimKorwilRequest,
	finishCentralRequest,
	finishKorwilRequest,
	forwardKorwilRequestToCentral,
	getRequestDetail,
	listCentralHistory,
	listCentralInbox,
	listKorwilHistory,
	listKorwilInbox,
	RequestWorkflowError,
	returnKorwilRequestForDocuments,
	submitBranchRevision,
	submitRequest
} from '../modules/requests/requests.service.js';

const fixturePrefix = 'e2e-workflow-timer-';
const fixtureSubject = '[FIXTURE E2E WORKFLOW TIMER]';

async function defaultRejectionReasonId(): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		`SELECT id FROM rejection_reasons WHERE scope_type = 'system' AND code = 'other' AND is_active = 1 LIMIT 1`
	);
	if (!rows[0]) throw new Error('System rejection reason fixture not found.');
	return Number(rows[0].id);
}

const employees = {
	branch: `${fixturePrefix}branch-001`,
	semarang: `${fixturePrefix}korwil-semarang`,
	solo: `${fixturePrefix}korwil-solo`,
	pemasaran: `${fixturePrefix}division-pemasaran`,
	operasional: `${fixturePrefix}division-operasional`
} as const;

type FixtureUserKey = keyof typeof employees;
type FixtureUser = { id: number; employee_id: string };
type Session = {
	id: number;
	unit_type: string;
	unit_code: string;
	started_at: Date | null;
	start_reason: string | null;
	claimed_at: Date | null;
	ended_at: Date | null;
	outcome: string | null;
	duration_seconds: number | null;
};

function check(condition: unknown, message: string): asserts condition {
	assert.ok(condition, message);
}

function expectWorkflowError(error: unknown, statusCode: number, message: string): void {
	check(error instanceof RequestWorkflowError, `${message}: expected RequestWorkflowError`);
	assert.equal(error.statusCode, statusCode, message);
}

async function expectForbidden(action: () => Promise<unknown>, message: string): Promise<void> {
	try {
		await action();
		assert.fail(`${message}: expected 403`);
	} catch (error) {
		expectWorkflowError(error, 403, message);
	}
}

async function queryFixtureUserIds(): Promise<number[]> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		`SELECT id FROM users WHERE employee_id LIKE ?`, [`${fixturePrefix}%`]
	);
	return rows.map((row) => Number(row.id));
}

async function cleanupFixtures(): Promise<void> {
	const userIds = await queryFixtureUserIds();
	if (userIds.length === 0) return;

	const placeholders = userIds.map(() => '?').join(', ');
	await mysqlPool.execute(
		`DELETE n FROM notifications AS n
		 INNER JOIN service_requests AS r ON r.id = n.request_id
		 WHERE r.created_by_user_id IN (${placeholders})`, userIds
	);
	await mysqlPool.execute(
		`DELETE h FROM request_status_histories AS h
		 INNER JOIN service_requests AS r ON r.id = h.request_id
		 WHERE r.created_by_user_id IN (${placeholders})`, userIds
	);
	await mysqlPool.execute(
		`DELETE s FROM request_sla_sessions AS s
		 INNER JOIN service_requests AS r ON r.id = s.request_id
		 WHERE r.created_by_user_id IN (${placeholders})`, userIds
	);
	await mysqlPool.execute(
		`DELETE a FROM request_assignments AS a
		 INNER JOIN service_requests AS r ON r.id = a.request_id
		 WHERE r.created_by_user_id IN (${placeholders})`, userIds
	);
	await mysqlPool.execute(
		`DELETE FROM service_requests WHERE created_by_user_id IN (${placeholders})`, userIds
	);
	await mysqlPool.execute(`DELETE FROM user_role_scopes WHERE user_id IN (${placeholders})`, userIds);
	await mysqlPool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);
}

async function assertFixturesRemoved(): Promise<void> {
	const remainingUserIds = await queryFixtureUserIds();
	assert.equal(remainingUserIds.length, 0, 'Cleanup harus menghapus seluruh akun fixture E2E.');
	const [remainingRequests] = await mysqlPool.execute<Array<RowDataPacket & { count: number }>>(
		`SELECT COUNT(*) AS count FROM service_requests WHERE subject LIKE ?`, [`${fixtureSubject}%`]
	);
	assert.equal(Number(remainingRequests[0]?.count ?? 0), 0, 'Cleanup harus menghapus seluruh tiket fixture E2E.');
}

async function getRoleId(code: string): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		' SELECT id FROM roles WHERE kode = ? AND is_active = 1 LIMIT 1', [code]
	);
	check(rows[0], `Role ${code} harus tersedia di database lokal.`);
	return Number(rows[0].id);
}

async function getDivisionId(code: string): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		' SELECT id FROM master_divisi WHERE kode = ? AND is_active = 1 LIMIT 1', [code]
	);
	check(rows[0], `Divisi ${code} harus tersedia di database lokal.`);
	return Number(rows[0].id);
}

async function getCatalogId(divisionId: number): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		' SELECT id FROM work_catalogs WHERE divisi_id = ? AND is_active = 1 ORDER BY id LIMIT 1', [divisionId]
	);
	check(rows[0], 'Katalog pekerjaan aktif untuk fixture E2E harus tersedia.');
	return Number(rows[0].id);
}

async function createFixtures(): Promise<{ users: Record<FixtureUserKey, FixtureUser>; divisionId: number; catalogId: number }> {
	await cleanupFixtures();
	const branchRoleId = await getRoleId('branch_user');
	const korwilRoleId = await getRoleId('korwil_staff');
	const divisionRoleId = await getRoleId('division_staff');
	const divisionId = await getDivisionId('pemasaran');
	const otherDivisionId = await getDivisionId('operasional');
	const catalogId = await getCatalogId(divisionId);

	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const userRows: Record<FixtureUserKey, FixtureUser> = {} as Record<FixtureUserKey, FixtureUser>;
		const userInputs: Array<{ key: FixtureUserKey; name: string; office: string | null; userDivisionId: number | null }> = [
			{ key: 'branch', name: 'E2E Branch Fixture', office: '001', userDivisionId: null },
			{ key: 'semarang', name: 'E2E Korwil Semarang Fixture', office: '001', userDivisionId: null },
			{ key: 'solo', name: 'E2E Korwil Solo Fixture', office: '008', userDivisionId: null },
			{ key: 'pemasaran', name: 'E2E Divisi Pemasaran Fixture', office: '000', userDivisionId: divisionId },
			{ key: 'operasional', name: 'E2E Divisi Operasional Fixture', office: '000', userDivisionId: otherDivisionId }
		];

		for (const input of userInputs) {
			const [insert] = await connection.execute<ResultSetHeader>(
				`INSERT INTO users (employee_id, full_name, unit_kerja, kode_kantor, divisi_id, is_active, profile_synced_at)
				 VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3))`,
				[employees[input.key], input.name, input.userDivisionId ? `Divisi ${input.name}` : 'E2E Fixture', input.office, input.userDivisionId]
			);
			userRows[input.key] = { id: insert.insertId, employee_id: employees[input.key] };
		}

		await connection.execute(
			`INSERT INTO user_role_scopes (user_id, role_id, scope_type, kode_kantor)
			 VALUES (?, ?, 'office', '001')`, [userRows.branch.id, branchRoleId]
		);
		for (const key of ['semarang', 'solo'] as const) {
			await connection.execute(
				`INSERT INTO user_role_scopes (user_id, role_id, scope_type, korwil)
				 VALUES (?, ?, 'korwil', ?)`, [userRows[key].id, korwilRoleId, key === 'semarang' ? 'semarang' : 'solo']
			);
		}
		for (const key of ['pemasaran', 'operasional'] as const) {
			await connection.execute(
				`INSERT INTO user_role_scopes (user_id, role_id, scope_type, divisi_id)
				 VALUES (?, ?, 'division', ?)`, [userRows[key].id, divisionRoleId, key === 'pemasaran' ? divisionId : otherDivisionId]
			);
		}
		await connection.commit();
		return { users: userRows, divisionId, catalogId };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

async function getSessions(requestId: number): Promise<Session[]> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & Session>>(
		`SELECT id, unit_type, unit_code, started_at, start_reason, claimed_at, ended_at, outcome,
		 CASE WHEN started_at IS NULL THEN NULL ELSE TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, CURRENT_TIMESTAMP(3))) END AS duration_seconds
		 FROM request_sla_sessions WHERE request_id = ? ORDER BY id`, [requestId]
	);
	return rows;
}

async function run(): Promise<void> {
	const fixture = await createFixtures();
	const branchId = fixture.users.branch.employee_id;
	const semarangId = fixture.users.semarang.employee_id;
	const soloId = fixture.users.solo.employee_id;
	const pemasaranId = fixture.users.pemasaran.employee_id;
	const operasionalId = fixture.users.operasional.employee_id;

	const created = await submitRequest(branchId, {
		authority_type: 'central',
		central_division_id: fixture.divisionId,
		work_catalog_id: fixture.catalogId,
		subject: `${fixtureSubject} central completion`,
		description: 'Pengajuan fixture untuk menguji antrean, klaim, revisi, penerusan, dan timer.'
	});
	const requestId = created.id;
	const requestNumber = created.request_number;
	check(requestNumber.startsWith('SLA-'), 'Pengajuan fixture harus memiliki nomor tiket.');

	let detail = await getRequestDetail(branchId, requestId);
	assert.equal(detail.request.status, 'waiting_korwil');
	assert.equal(detail.request.current_unit_code, 'semarang');
	assert.equal(detail.sessions.length, 1);
	assert.equal(detail.sessions[0]?.unit_type, 'korwil');
	assert.equal(detail.sessions[0]?.started_at, null, 'Timer Korwil belum boleh mulai di antrean.');
	assert.equal(detail.sessions[0]?.start_reason, null);
	check(Number(detail.request.overall_elapsed_seconds) >= 0, 'Umur tiket harus dimulai saat submit.');

	const semarangQueue = await listKorwilInbox(semarangId);
	check(semarangQueue.some((item) => item.id === requestId), 'Korwil yang sesuai harus melihat antrean tiket.');
	const soloQueue = await listKorwilInbox(soloId);
	check(!soloQueue.some((item) => item.id === requestId), 'Korwil lain tidak boleh melihat tiket.');
	await expectForbidden(() => getRequestDetail(soloId, requestId), 'Detail tiket harus terisolasi antar Korwil');
	const divisionHistoryBeforeForward = await listCentralHistory(pemasaranId);
	check(!divisionHistoryBeforeForward.some((item) => item.id === requestId), 'Pemilihan divisi belum menjadi riwayat sebelum penerusan.');
	await expectForbidden(() => getRequestDetail(operasionalId, requestId), 'Detail tiket harus terisolasi antar Divisi');

	await claimKorwilRequest(semarangId, requestId);
	detail = await getRequestDetail(semarangId, requestId);
	assert.equal(detail.request.status, 'in_progress_korwil');
	const firstKorwilSession = detail.sessions[0];
	check(firstKorwilSession?.started_at instanceof Date, 'Timer Korwil harus mulai setelah Ambil.');
	assert.equal(firstKorwilSession?.start_reason, 'claim');
	check(firstKorwilSession?.claimed_at instanceof Date, 'Waktu Ambil Korwil harus tercatat.');

	await returnKorwilRequestForDocuments(semarangId, requestId, {
		note: 'Perbaiki uraian pengajuan pada fixture.',
		fields: [{ kind: 'description' }],
		documents: []
	});
	detail = await getRequestDetail(branchId, requestId);
	assert.equal(detail.request.status, 'waiting_branch_revision');
	assert.equal(detail.sessions.length, 2);
	assert.equal(detail.sessions[0]?.outcome, 'requested_documents');
	check(detail.sessions[0]?.ended_at instanceof Date, 'Sesi Korwil harus berhenti saat revisi diminta.');
	assert.equal(detail.sessions[1]?.unit_type, 'branch');
	assert.equal(detail.sessions[1]?.start_reason, 'sent');
	check(detail.sessions[1]?.started_at instanceof Date, 'Timer Cabang harus mulai saat permintaan revisi dikirim.');

	const revision = await submitBranchRevision(branchId, requestId, {
		response: 'Pelengkapan fixture sudah dikirim kembali.',
		updates: [{ kind: 'description', value: 'Uraian fixture sudah diperbaiki.' }],
		files: {}
	});
	assert.equal(revision.id, requestId, 'Pelengkapan harus memakai tiket yang sama.');
	assert.equal(revision.status, 'in_progress_korwil');
	assert.equal(revision.resumed_to_previous_handler, true, 'Petugas Korwil aktif harus menerima resume otomatis.');
	detail = await getRequestDetail(semarangId, requestId);
	assert.equal(detail.request.request_number, requestNumber);
	assert.equal(detail.request.current_owner_user_id, fixture.users.semarang.id);
	assert.equal(detail.sessions.length, 3);
	assert.equal(detail.sessions[2]?.unit_type, 'korwil');
	assert.equal(detail.sessions[2]?.start_reason, 'sent');
	check(detail.sessions[2]?.started_at instanceof Date, 'Timer Korwil resume harus mulai saat Cabang mengirim.');
	assert.equal(detail.sessions[2]?.claimed_at, null, 'Resume otomatis tidak boleh meminta Ambil ulang.');

	await forwardKorwilRequestToCentral(semarangId, requestId, 'Pemeriksaan Korwil selesai; diteruskan ke Pemasaran.', { approvalConfirmed: true });
	detail = await getRequestDetail(branchId, requestId);
	assert.equal(detail.request.request_number, requestNumber);
	assert.equal(detail.request.status, 'waiting_central');
	assert.equal(detail.sessions.length, 4);
	assert.equal(detail.sessions[2]?.outcome, 'forwarded');
	assert.equal(detail.sessions[3]?.unit_type, 'central');
	assert.equal(detail.sessions[3]?.started_at, null, 'Timer Pusat belum boleh mulai sebelum Ambil.');
	assert.equal(detail.sessions[3]?.start_reason, null);

	const centralQueue = await listCentralInbox(pemasaranId);
	check(centralQueue.some((item) => item.id === requestId), 'Divisi tujuan harus melihat antrean Pusat.');
	const otherCentralQueue = await listCentralInbox(operasionalId);
	check(!otherCentralQueue.some((item) => item.id === requestId), 'Divisi lain tidak boleh melihat antrean tiket.');
	await expectForbidden(() => getRequestDetail(operasionalId, requestId), 'Detail tiket harus ditolak untuk Divisi lain setelah diteruskan');

	await claimCentralRequest(pemasaranId, requestId);
	detail = await getRequestDetail(pemasaranId, requestId);
	assert.equal(detail.request.status, 'in_progress_central');
	const centralSession = detail.sessions[3];
	check(centralSession?.started_at instanceof Date, 'Timer Pusat harus mulai setelah Ambil.');
	assert.equal(centralSession?.start_reason, 'claim');
	check(centralSession?.claimed_at instanceof Date, 'Waktu Ambil Pusat harus tercatat.');

	await finishCentralRequest(pemasaranId, requestId, 'completed', 'Fixture selesai setelah pemeriksaan Pusat.', { approvalConfirmed: true });
	detail = await getRequestDetail(branchId, requestId);
	assert.equal(detail.request.status, 'completed');
	check(detail.request.closed_at instanceof Date, 'Tiket selesai harus memiliki closed_at.');
	assert.equal(detail.sessions[3]?.outcome, 'completed');
	check(detail.sessions.every((session) => session.ended_at instanceof Date), 'Semua sesi tiket selesai harus tertutup.');
	const centralHistory = await listCentralHistory(pemasaranId);
	check(centralHistory.some((item) => item.id === requestId), 'Tiket yang selesai harus masuk riwayat Divisi yang benar.');
	const otherDivisionHistory = await listCentralHistory(operasionalId);
	check(!otherDivisionHistory.some((item) => item.id === requestId), 'Riwayat Divisi lain harus tetap terisolasi.');
	const korwilHistory = await listKorwilHistory(semarangId);
	check(korwilHistory.some((item) => item.id === requestId), 'Tiket yang diteruskan harus masuk riwayat Korwil.');

	const rejected = await submitRequest(branchId, {
		authority_type: 'korwil',
		central_division_id: null,
		work_catalog_id: null,
		subject: `${fixtureSubject} korwil rejection`,
		description: 'Pengajuan fixture untuk memastikan penolakan menyimpan alasan dan menutup timer.'
	});
	await claimKorwilRequest(semarangId, rejected.id);
	await finishKorwilRequest(semarangId, rejected.id, 'rejected', 'Fixture ditolak untuk menguji jalur penolakan.', { rejectionReasonId: await defaultRejectionReasonId() });
	const rejectedDetail = await getRequestDetail(branchId, rejected.id);
	assert.equal(rejectedDetail.request.status, 'rejected');
	check(rejectedDetail.request.closed_at instanceof Date, 'Tiket ditolak harus memiliki closed_at.');
	assert.equal(rejectedDetail.sessions.length, 1);
	assert.equal(rejectedDetail.sessions[0]?.outcome, 'rejected');
	check(rejectedDetail.sessions[0]?.ended_at instanceof Date, 'Timer harus berhenti saat tiket ditolak.');

	const primarySessions = await getSessions(requestId);
	check(primarySessions.length === 4, 'Fixture utama harus menyimpan empat sesi tanpa menimpa histori.');
	console.log(`E2E workflow/timer lulus: ${requestNumber}; ${primarySessions.length} sesi; fixture akan dibersihkan.`);
}

try {
	await run();
	process.exitCode = 0;
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	try {
		await cleanupFixtures();
		await assertFixturesRemoved();
		await mysqlPool.end();
	} catch (cleanupError) {
		console.error('Pembersihan fixture gagal:', cleanupError instanceof Error ? cleanupError.message : cleanupError);
		process.exitCode = 1;
	}
}
