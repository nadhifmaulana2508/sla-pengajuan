import assert from 'node:assert/strict';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { mysqlPool } from '../db/client.js';
import {
	claimCentralRequest,
	claimKorwilRequest,
	finishCentralRequest,
	finishKorwilRequest,
	forwardKorwilRequestToCentral,
	getRequestAttachmentForDownload,
	getRequestDetail,
	listCentralHistory,
	listCentralInbox,
	listKorwilHistory,
	listKorwilInbox,
	listRequestRejectionReasons,
	RequestWorkflowError,
	returnCentralRequestForDocuments,
	returnKorwilRequestForDocuments,
	submitBranchRevision,
	submitRequest
} from '../modules/requests/requests.service.js';
import { readPrivatePdf, removePrivatePdf, type PrivatePdfFile } from '../modules/requests/private-attachments.js';

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

async function expectWorkflowFailure(action: () => Promise<unknown>, statusCode: number, message: string): Promise<void> {
	try {
		await action();
		assert.fail(`${message}: expected HTTP ${statusCode}`);
	} catch (error) {
		expectWorkflowError(error, statusCode, message);
	}
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
	const [attachments] = await mysqlPool.execute<Array<RowDataPacket & { storage_key: string }>>(
		`SELECT attachment.storage_key FROM request_attachments AS attachment
		 INNER JOIN service_requests AS request ON request.id = attachment.request_id
		 WHERE request.created_by_user_id IN (${placeholders})`, userIds
	);
	for (const attachment of attachments) await removePrivatePdf(attachment.storage_key);
	await mysqlPool.execute(
		`DELETE d FROM request_decisions AS d
		 INNER JOIN service_requests AS r ON r.id = d.request_id
		 WHERE r.created_by_user_id IN (${placeholders})`, userIds
	);
	await mysqlPool.execute(`DELETE FROM rejection_reasons WHERE created_by_user_id IN (${placeholders})`, userIds);
	await mysqlPool.execute(
		`DELETE a FROM request_attachments AS a
		 INNER JOIN service_requests AS r ON r.id = a.request_id
		 WHERE r.created_by_user_id IN (${placeholders})`, userIds
	);
	await mysqlPool.execute(
		`DELETE revision FROM request_revisions AS revision
		 INNER JOIN service_requests AS r ON r.id = revision.request_id
		 WHERE r.created_by_user_id IN (${placeholders})`, userIds
	);
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
		`SELECT id FROM work_catalogs
		 WHERE divisi_id = ? AND is_active = 1 AND system_key = 'credit_application'
		 ORDER BY id LIMIT 1`, [divisionId]
	);
	check(rows[0], 'Katalog Pengajuan Kredit aktif untuk fixture E2E harus tersedia.');
	return Number(rows[0].id);
}

async function getCurrentFormVersionId(catalogId: number): Promise<number> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		`SELECT id FROM work_catalog_form_versions WHERE work_catalog_id = ? ORDER BY version_number DESC LIMIT 1`,
		[catalogId]
	);
	check(rows[0], 'Versi form Kredit aktif untuk fixture E2E harus tersedia.');
	return Number(rows[0].id);
}

async function createFixtureRejectionReason(input: {
	scope: 'division' | 'catalog'; divisionId: number; catalogId?: number | null; createdBy: number; code: string;
}): Promise<number> {
	const [result] = await mysqlPool.execute<ResultSetHeader>(
		`INSERT INTO rejection_reasons
		 (scope_type, division_id, work_catalog_id, code, label, is_active, created_by_user_id)
		 VALUES (?, ?, ?, ?, ?, 1, ?)`,
		[input.scope, input.divisionId, input.scope === 'catalog' ? input.catalogId ?? null : null,
			input.code, `Alasan fixture ${input.code}`, input.createdBy]
	);
	return Number(result.insertId);
}

async function createFixtures(): Promise<{
	users: Record<FixtureUserKey, FixtureUser>; divisionId: number; catalogId: number; formVersionId: number;
	rejectionReasonIds: { marketingDivision: number; creditCatalog: number; otherDivision: number };
}> {
	await cleanupFixtures();
	const branchRoleId = await getRoleId('branch_user');
	const korwilRoleId = await getRoleId('korwil_staff');
	const divisionRoleId = await getRoleId('division_staff');
	const divisionId = await getDivisionId('pemasaran');
	const otherDivisionId = await getDivisionId('operasional');
	const catalogId = await getCatalogId(divisionId);
	const formVersionId = await getCurrentFormVersionId(catalogId);

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
		const rejectionReasonIds = {
			marketingDivision: await createFixtureRejectionReason({
				scope: 'division', divisionId, createdBy: userRows.branch.id, code: 'e2e_workflow_marketing_division'
			}),
			creditCatalog: await createFixtureRejectionReason({
				scope: 'catalog', divisionId, catalogId, createdBy: userRows.branch.id, code: 'e2e_workflow_credit_catalog'
			}),
			otherDivision: await createFixtureRejectionReason({
				scope: 'division', divisionId: otherDivisionId, createdBy: userRows.branch.id, code: 'e2e_workflow_other_division'
			})
		};
		return { users: userRows, divisionId, catalogId, formVersionId, rejectionReasonIds };
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

async function verifySlaBadgeBoundaries(branchId: string): Promise<void> {
	const cases = [
		{ label: 'tepat-di-bawah-3-hari', elapsedSeconds: 3 * 24 * 60 * 60 - 1, status: 'safe' },
		{ label: 'tepat-3-hari', elapsedSeconds: 3 * 24 * 60 * 60, status: 'warning' },
		{ label: 'tepat-7-hari', elapsedSeconds: 7 * 24 * 60 * 60, status: 'warning' },
		{ label: 'tepat-di-atas-7-hari', elapsedSeconds: 7 * 24 * 60 * 60 + 1, status: 'overdue' }
	] as const;
	const fixedSubmittedAt = '2025-01-01 00:00:00.000';

	for (const boundaryCase of cases) {
		const created = await submitRequest(branchId, {
			authority_type: 'korwil', central_division_id: null, work_catalog_id: null,
			subject: `${fixtureSubject} sla-boundary-${boundaryCase.label}`,
			description: 'Fixture untuk memeriksa batas badge SLA.'
		});
		await mysqlPool.execute(
			`UPDATE service_requests
			 SET submitted_at = ?, closed_at = TIMESTAMPADD(SECOND, ?, ?), status = 'completed'
			 WHERE id = ?`,
			[fixedSubmittedAt, boundaryCase.elapsedSeconds, fixedSubmittedAt, created.id]
		);
		const detail = await getRequestDetail(branchId, created.id);
		assert.equal(Number(detail.request.overall_elapsed_seconds), boundaryCase.elapsedSeconds,
			`Umur fixture ${boundaryCase.label} harus tepat dalam detik.`);
		assert.equal(detail.request.sla_status, boundaryCase.status,
			`Badge SLA ${boundaryCase.label} harus berstatus ${boundaryCase.status}.`);
	}
}

async function run(): Promise<void> {
	const fixture = await createFixtures();
	const branchId = fixture.users.branch.employee_id;
	const semarangId = fixture.users.semarang.employee_id;
	const soloId = fixture.users.solo.employee_id;
	const pemasaranId = fixture.users.pemasaran.employee_id;
	const operasionalId = fixture.users.operasional.employee_id;
	await verifySlaBadgeBoundaries(branchId);
	const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
	const supportingPdf: PrivatePdfFile = {
		buffer: pdfBuffer, originalname: 'fixture-pelengkapan.pdf', mimetype: 'application/pdf', size: pdfBuffer.length
	};
	const beritaAcaraPdf: PrivatePdfFile = {
		buffer: pdfBuffer, originalname: 'fixture-berita-acara.pdf', mimetype: 'application/pdf', size: pdfBuffer.length
	};
	const creditBoundaryCases = [
		{ label: 'minimum', amount: 200_000_000, suppliedAuthority: 'central' as const, authority: 'korwil', divisionId: null },
		{ label: 'below-marketing', amount: 499_999_999, suppliedAuthority: 'central' as const, authority: 'korwil', divisionId: null },
		{ label: 'marketing-threshold', amount: 500_000_000, suppliedAuthority: 'korwil' as const, authority: 'central', divisionId: fixture.divisionId },
		{ label: 'above-marketing', amount: 500_000_001, suppliedAuthority: 'korwil' as const, authority: 'central', divisionId: fixture.divisionId }
	];
	for (const boundaryCase of creditBoundaryCases) {
		const boundary = await submitRequest(branchId, {
			authority_type: boundaryCase.suppliedAuthority,
			central_division_id: fixture.divisionId,
			work_catalog_id: fixture.catalogId,
			form_version_id: fixture.formVersionId,
			form_answers: { credit_amount: boundaryCase.amount, nama_nasabah: 'Fixture Batas Kredit' },
			subject: `${fixtureSubject} credit-boundary-${boundaryCase.label}`,
			description: 'Fixture uji batas nominal dan routing kredit.'
		});
		const boundaryDetail = await getRequestDetail(branchId, boundary.id);
		assert.equal(boundaryDetail.form_answers.find((answer) => answer.key === 'credit_amount')?.value,
			boundaryCase.amount, `Nominal ${boundaryCase.amount} harus tersimpan.`);
		assert.equal(boundaryDetail.request.authority_type, boundaryCase.authority, `Nominal ${boundaryCase.amount} harus mengabaikan kewenangan pilihan yang bertentangan.`);
		assert.equal(boundaryDetail.request.central_division_id, boundaryCase.divisionId, `Nominal ${boundaryCase.amount} harus memilih tujuan yang sesuai.`);
		assert.equal(boundaryDetail.request.status, 'waiting_korwil', 'Semua pengajuan kredit harus diperiksa Korwil terlebih dahulu.');
		assert.equal(boundaryDetail.request.current_unit_type, 'korwil');
	}

	const belowMinimumSubject = `${fixtureSubject} credit-boundary-below-minimum`;
	await expectWorkflowFailure(() => submitRequest(branchId, {
		authority_type: 'central',
		central_division_id: fixture.divisionId,
		work_catalog_id: fixture.catalogId,
		form_version_id: fixture.formVersionId,
		form_answers: { credit_amount: 199_999_999, nama_nasabah: 'Fixture Batas Kredit' },
		subject: belowMinimumSubject,
		description: 'Fixture nominal di bawah minimum; tiket tidak boleh dibuat.'
	}), 400, 'Nominal kredit di bawah Rp200 juta harus ditolak sebelum tiket dibuat');
	const [belowMinimumRows] = await mysqlPool.execute<Array<RowDataPacket & { count: number }>>(
		'SELECT COUNT(*) AS count FROM service_requests WHERE created_by_user_id = ? AND subject = ?',
		[fixture.users.branch.id, belowMinimumSubject]
	);
	assert.equal(Number(belowMinimumRows[0]?.count ?? 0), 0, 'Nominal di bawah minimum tidak boleh membuat tiket.');

	const created = await submitRequest(branchId, {
		authority_type: 'central',
		central_division_id: fixture.divisionId,
		work_catalog_id: fixture.catalogId,
		form_version_id: fixture.formVersionId,
		form_answers: { credit_amount: 500_000_000, nama_nasabah: 'Fixture Nasabah' },
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
	await expectWorkflowFailure(
		() => returnKorwilRequestForDocuments(semarangId, requestId, { note: 'Permintaan kosong.', fields: [], documents: [] }),
		400,
		'Permintaan kelengkapan kosong harus ditolak'
	);

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
	await expectWorkflowFailure(
		() => submitBranchRevision(branchId, requestId, { response: 'Belum ada isian.', updates: [], files: {} }),
		400,
		'Kolom revisi yang diminta wajib dilengkapi'
	);
	await expectWorkflowFailure(
		() => submitBranchRevision(branchId, requestId, {
			response: 'Mencoba mengubah kolom lain.', updates: [{ kind: 'subject', value: 'Tidak diminta' }], files: {}
		}),
		400,
		'Kolom di luar permintaan revisi harus ditolak'
	);

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
	await returnKorwilRequestForDocuments(semarangId, requestId, {
		note: 'Putaran kedua untuk memastikan revisi berulang tersimpan.',
		fields: [{ kind: 'description' }],
		documents: []
	});
	const secondRevision = await submitBranchRevision(branchId, requestId, {
		response: 'Uraian diperbaiki pada putaran kedua.',
		updates: [{ kind: 'description', value: 'Uraian fixture diperbaiki untuk kedua kalinya.' }],
		files: {}
	});
	assert.equal(secondRevision.id, requestId);
	assert.equal(secondRevision.resumed_to_previous_handler, true);
	detail = await getRequestDetail(semarangId, requestId);
	assert.equal(detail.revision_history.length, 2, 'Dua putaran revisi Korwil harus tersimpan pada satu tiket.');
	assert.equal(detail.request.request_number, requestNumber);
	assert.equal(detail.sessions.length, 5, 'Setiap putaran revisi harus menambah sesi tanpa menimpa sesi lama.');

	await expectWorkflowFailure(
		() => forwardKorwilRequestToCentral(semarangId, requestId, 'Teruskan tanpa konfirmasi.', { approvalConfirmed: false }),
		400,
		'Penerusan tanpa konfirmasi harus ditolak'
	);
	await forwardKorwilRequestToCentral(semarangId, requestId, 'Pemeriksaan Korwil selesai; diteruskan ke Pemasaran.', { approvalConfirmed: true });
	detail = await getRequestDetail(branchId, requestId);
	assert.equal(detail.request.request_number, requestNumber);
	assert.equal(detail.request.status, 'waiting_central');
	assert.equal(detail.sessions.length, 6);
	assert.equal(detail.sessions[4]?.outcome, 'forwarded');
	assert.equal(detail.sessions[5]?.unit_type, 'central');
	assert.equal(detail.sessions[5]?.started_at, null, 'Timer Pusat belum boleh mulai sebelum Ambil.');
	assert.equal(detail.sessions[5]?.start_reason, null);

	const centralQueue = await listCentralInbox(pemasaranId);
	check(centralQueue.some((item) => item.id === requestId), 'Divisi tujuan harus melihat antrean Pusat.');
	const otherCentralQueue = await listCentralInbox(operasionalId);
	check(!otherCentralQueue.some((item) => item.id === requestId), 'Divisi lain tidak boleh melihat antrean tiket.');
	await expectForbidden(() => getRequestDetail(operasionalId, requestId), 'Detail tiket harus ditolak untuk Divisi lain setelah diteruskan');

	await claimCentralRequest(pemasaranId, requestId);
	detail = await getRequestDetail(pemasaranId, requestId);
	assert.equal(detail.request.status, 'in_progress_central');
	const centralSession = detail.sessions[5];
	check(centralSession?.started_at instanceof Date, 'Timer Pusat harus mulai setelah Ambil.');
	assert.equal(centralSession?.start_reason, 'claim');
	check(centralSession?.claimed_at instanceof Date, 'Waktu Ambil Pusat harus tercatat.');
	const visibleRejectionReasons = await listRequestRejectionReasons(pemasaranId, requestId);
	check(visibleRejectionReasons.some((reason) => reason.id === fixture.rejectionReasonIds.marketingDivision), 'Alasan Divisi tujuan harus tersedia.');
	check(visibleRejectionReasons.some((reason) => reason.id === fixture.rejectionReasonIds.creditCatalog), 'Alasan katalog tiket harus tersedia.');
	check(!visibleRejectionReasons.some((reason) => reason.id === fixture.rejectionReasonIds.otherDivision), 'Alasan Divisi lain tidak boleh tersedia.');
	await expectWorkflowFailure(
		() => finishCentralRequest(pemasaranId, requestId, 'rejected', 'Mencoba alasan Divisi lain.', {
			rejectionReasonId: fixture.rejectionReasonIds.otherDivision
		}),
		400,
		'Alasan penolakan di luar scope harus ditolak'
	);
	await returnCentralRequestForDocuments(pemasaranId, requestId, {
		note: 'Mohon perbarui nama nasabah dan lampiran pendukung.',
		fields: [{ kind: 'form_field', key: 'nama_nasabah' }],
		documents: ['supporting_document']
	});
	await expectWorkflowFailure(
		() => submitBranchRevision(branchId, requestId, {
			response: 'Mencoba mengganti uraian yang tidak diminta.',
			updates: [{ kind: 'description', value: 'Uraian yang tidak diminta.' }], files: {}
		}),
		400,
		'Field di luar permintaan Divisi harus ditolak'
	);
	const centralRevision = await submitBranchRevision(branchId, requestId, {
		response: 'Nama nasabah dan dokumen pendukung dilengkapi.',
		updates: [{ kind: 'form_field', key: 'nama_nasabah', value: 'Fixture Nasabah Diperbarui' }],
		files: { supporting_document: supportingPdf }
	});
	assert.equal(centralRevision.id, requestId);
	assert.equal(centralRevision.status, 'in_progress_central', 'Perubahan field biasa kembali langsung ke petugas Divisi.');
	assert.equal(centralRevision.resumed_to_previous_handler, true);
	detail = await getRequestDetail(pemasaranId, requestId);
	assert.equal(detail.request.request_number, requestNumber);
	assert.equal(detail.sessions.length, 8);
	assert.equal(detail.sessions[7]?.unit_type, 'central');
	assert.equal(detail.sessions[7]?.start_reason, 'sent');
	assert.equal(detail.sessions[7]?.claimed_at, null);
	assert.equal(detail.revision_history.length, 3);
	const supportingAttachment = detail.attachments.find((attachment) => attachment.category === 'supporting_document');
	check(supportingAttachment, 'PDF pendukung revisi harus tercatat sebagai lampiran privat.');
	const branchDownload = await getRequestAttachmentForDownload(branchId, requestId, supportingAttachment.id);
	assert.deepEqual((await readPrivatePdf(branchDownload.storage_key)).subarray(0, 5), Buffer.from('%PDF-'));
	await expectForbidden(
		() => getRequestAttachmentForDownload(operasionalId, requestId, supportingAttachment.id),
		'Unduhan lampiran harus ditolak di luar scope Divisi'
	);
	await expectForbidden(
		() => getRequestAttachmentForDownload(soloId, requestId, supportingAttachment.id),
		'Unduhan lampiran harus ditolak di luar scope Korwil'
	);
	await returnCentralRequestForDocuments(pemasaranId, requestId, {
		note: 'Perubahan nilai, perihal, dan uraian harus diperiksa Korwil lagi.',
		fields: [
			{ kind: 'form_field', key: 'credit_amount' },
			{ kind: 'subject' },
			{ kind: 'description' }
		],
		documents: []
	});
	const materialRevision = await submitBranchRevision(branchId, requestId, {
		response: 'Nilai dan substansi pengajuan diperbarui.',
		updates: [
			{ kind: 'form_field', key: 'credit_amount', value: 550_000_000 },
			{ kind: 'subject', value: `${fixtureSubject} credit revised` },
			{ kind: 'description', value: 'Uraian kredit diperbarui dan perlu diperiksa Korwil.' }
		],
		files: {}
	});
	assert.equal(materialRevision.id, requestId);
	assert.equal(materialRevision.status, 'in_progress_korwil', 'Perubahan nilai, perihal, dan uraian harus kembali ke Korwil.');
	detail = await getRequestDetail(semarangId, requestId);
	assert.equal(detail.request.request_number, requestNumber);
	assert.equal(detail.request.current_unit_type, 'korwil');
	assert.equal(detail.request.current_owner_user_id, fixture.users.semarang.id);
	assert.equal(detail.sessions.length, 10);
	await forwardKorwilRequestToCentral(semarangId, requestId, 'Pemeriksaan ulang selesai; diteruskan ke Pemasaran.', { approvalConfirmed: true });
	await claimCentralRequest(pemasaranId, requestId);
	await expectWorkflowFailure(
		() => finishCentralRequest(pemasaranId, requestId, 'completed', 'Fixture selesai tanpa konfirmasi.', { approvalConfirmed: false }),
		400,
		'Penyelesaian tanpa konfirmasi harus ditolak'
	);

	await finishCentralRequest(pemasaranId, requestId, 'completed', 'Fixture selesai setelah pemeriksaan Pusat.', {
		approvalConfirmed: true,
		beritaAcara: beritaAcaraPdf
	});
	detail = await getRequestDetail(branchId, requestId);
	assert.equal(detail.request.status, 'completed');
	check(detail.request.closed_at instanceof Date, 'Tiket selesai harus memiliki closed_at.');
	assert.equal(detail.sessions[10]?.outcome, 'completed');
	check(detail.sessions.every((session) => session.ended_at instanceof Date), 'Semua sesi tiket selesai harus tertutup.');
	const centralHistory = await listCentralHistory(pemasaranId);
	check(centralHistory.some((item) => item.id === requestId), 'Tiket yang selesai harus masuk riwayat Divisi yang benar.');
	const otherDivisionHistory = await listCentralHistory(operasionalId);
	check(!otherDivisionHistory.some((item) => item.id === requestId), 'Riwayat Divisi lain harus tetap terisolasi.');
	const korwilHistory = await listKorwilHistory(semarangId);
	check(korwilHistory.some((item) => item.id === requestId), 'Tiket yang diteruskan harus masuk riwayat Korwil.');
	const approvalAttachment = detail.attachments.find((attachment) => attachment.category === 'berita_acara');
	check(approvalAttachment, 'Berita Acara harus tersimpan sebagai lampiran privat keputusan.');
	const approvalDownload = await getRequestAttachmentForDownload(branchId, requestId, approvalAttachment.id);
	assert.deepEqual((await readPrivatePdf(approvalDownload.storage_key)).subarray(0, 5), Buffer.from('%PDF-'));
	await expectForbidden(
		() => getRequestAttachmentForDownload(operasionalId, requestId, approvalAttachment.id),
		'Berita Acara harus ditolak untuk Divisi di luar scope'
	);

	const rejected = await submitRequest(branchId, {
		authority_type: 'korwil',
		central_division_id: null,
		work_catalog_id: null,
		subject: `${fixtureSubject} korwil rejection`,
		description: 'Pengajuan fixture untuk memastikan penolakan menyimpan alasan dan menutup timer.'
	});
	await claimKorwilRequest(semarangId, rejected.id);
	await expectWorkflowFailure(
		() => finishKorwilRequest(semarangId, rejected.id, 'completed', 'Fixture tanpa konfirmasi.', { approvalConfirmed: false }),
		400,
		'Penyelesaian Korwil tanpa konfirmasi harus ditolak'
	);
	await expectWorkflowFailure(
		() => finishKorwilRequest(semarangId, rejected.id, 'rejected', 'Fixture ditolak tanpa alasan.'),
		400,
		'Penolakan tanpa alasan harus ditolak'
	);
	await finishKorwilRequest(semarangId, rejected.id, 'rejected', 'Fixture ditolak untuk menguji jalur penolakan.', { rejectionReasonId: await defaultRejectionReasonId() });
	const rejectedDetail = await getRequestDetail(branchId, rejected.id);
	assert.equal(rejectedDetail.request.status, 'rejected');
	check(rejectedDetail.request.closed_at instanceof Date, 'Tiket ditolak harus memiliki closed_at.');
	assert.equal(rejectedDetail.sessions.length, 1);
	assert.equal(rejectedDetail.sessions[0]?.outcome, 'rejected');
	check(rejectedDetail.sessions[0]?.ended_at instanceof Date, 'Timer harus berhenti saat tiket ditolak.');

	for (const reasonCase of [
		{ id: fixture.rejectionReasonIds.marketingDivision, code: 'e2e_workflow_marketing_division' },
		{ id: fixture.rejectionReasonIds.creditCatalog, code: 'e2e_workflow_credit_catalog' }
	]) {
		const scopedRejection = await submitRequest(branchId, {
			authority_type: 'central', central_division_id: fixture.divisionId, work_catalog_id: fixture.catalogId,
			form_version_id: fixture.formVersionId,
			form_answers: { credit_amount: 500_000_000, nama_nasabah: 'Fixture Nasabah' },
			subject: `${fixtureSubject} ${reasonCase.code}`,
			description: 'Tiket fixture untuk menguji alasan penolakan dengan scope Divisi dan katalog.'
		});
		await claimKorwilRequest(semarangId, scopedRejection.id);
		await forwardKorwilRequestToCentral(semarangId, scopedRejection.id, 'Diteruskan untuk uji alasan penolakan.', { approvalConfirmed: true });
		await claimCentralRequest(pemasaranId, scopedRejection.id);
		await finishCentralRequest(pemasaranId, scopedRejection.id, 'rejected', 'Alasan fixture sesuai scope tiket.', { rejectionReasonId: reasonCase.id });
		const scopedDetail = await getRequestDetail(branchId, scopedRejection.id);
		const rejectionDecision = scopedDetail.decisions.find((decision) => decision.decision_type === 'rejected');
		assert.equal(rejectionDecision?.reason_label_snapshot, `Alasan fixture ${reasonCase.code}`,
			`Alasan ${reasonCase.code} harus tersimpan sebagai snapshot keputusan.`);
	}

	const fallback = await submitRequest(branchId, {
		authority_type: 'korwil', central_division_id: null, work_catalog_id: null,
		subject: `${fixtureSubject} fallback queue`,
		description: 'Tiket fixture untuk memastikan handoff kembali ke antrean saat petugas tidak aktif.'
	});
	await claimKorwilRequest(semarangId, fallback.id);
	await returnKorwilRequestForDocuments(semarangId, fallback.id, {
		note: 'Mohon lengkapi uraian sebelum dikirim kembali.', fields: [{ kind: 'description' }], documents: []
	});
	await mysqlPool.execute('UPDATE users SET is_active = 0 WHERE id = ?', [fixture.users.semarang.id]);
	let fallbackRevision;
	try {
		fallbackRevision = await submitBranchRevision(branchId, fallback.id, {
			response: 'Uraian dilengkapi; petugas peminta sudah tidak aktif.',
			updates: [{ kind: 'description', value: 'Uraian fixture dilengkapi setelah petugas tidak aktif.' }],
			files: {}
		});
	} finally {
		await mysqlPool.execute('UPDATE users SET is_active = 1 WHERE id = ?', [fixture.users.semarang.id]);
	}
	assert.equal(fallbackRevision?.status, 'waiting_korwil');
	assert.equal(fallbackRevision?.resumed_to_previous_handler, false);
	const fallbackDetail = await getRequestDetail(branchId, fallback.id);
	assert.equal(fallbackDetail.request.current_unit_type, 'korwil');
	assert.equal(fallbackDetail.request.current_owner_user_id, null, 'Fallback harus masuk antrean tanpa petugas lama.');
	assert.equal(fallbackDetail.sessions.at(-1)?.start_reason, 'sent');
	assert.equal(fallbackDetail.sessions.at(-1)?.claimed_at, null);

	const primarySessions = await getSessions(requestId);
	check(primarySessions.length === 11, 'Fixture utama harus menyimpan seluruh sesi revisi dan handoff tanpa menimpa histori.');
	console.log(`E2E workflow/timer lulus: ${requestNumber}; ${primarySessions.length} sesi; revisi, konfirmasi, scope lampiran, dan cleanup lulus.`);
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
