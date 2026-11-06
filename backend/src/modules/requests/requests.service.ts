import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { notifyUnitMembers, notifyUser, type NotificationUnit } from '../notifications/notifications.service.js';
import { inferKorwilFromSsoText } from '../organization/sso-scope.js';
import { resolveSlaAccessDetails } from '../auth/access.service.js';
import { DEFAULT_SLA_MINUTES, getSlaStatus, type SlaStatus } from '../../shared/sla.js';
import { parseFormDefinition, validateFormAnswers, type FormDefinition } from '../forms/form-schema.js';

const CREDIT_MINIMUM_AMOUNT = 250_000_000;
const CREDIT_CENTRAL_AMOUNT = 500_000_000;

export class RequestWorkflowError extends Error {
	constructor(public readonly statusCode: number, message: string) {
		super(message);
		this.name = 'RequestWorkflowError';
	}
}

type UserRow = RowDataPacket & {
	id: number; is_active: number; kode_kantor: string | null; korwil: string | null;
	divisi_id?: number | null; role_code?: string | null;
};
type KorwilAccessRow = RowDataPacket & {
	id: number;
	is_active: number;
	kode_kantor: string | null;
	unit_kerja: string | null;
	branch_name: string | null;
	job_position: string | null;
	profile_korwil: string | null;
	assigned_korwil: string | null;
	scope_type: string | null;
	role_code: string | null;
};
type RequestRow = RowDataPacket & {
	id: number; request_number: string; kode_kantor: string; nama_kantor: string;
	korwil: string; authority_type: string; central_division_id: number | null;
	nama_divisi: string | null; work_catalog_id: number | null; nama_pekerjaan: string | null;
	subject: string; description: string; status: string; current_unit_type: string;
	current_unit_code: string; current_owner_user_id: number | null; submitted_at: Date;
	created_by_user_id: number; created_by_name: string | null;
	active_elapsed_seconds: number | null; active_target_sla_minutes: number | null;
	overall_elapsed_seconds: number; closed_at: Date | null;
	sla_target_minutes: number | null; credit_amount?: number | string | null; sla_status?: SlaStatus;
};

async function getActiveBranch(employeeId: string, connection?: PoolConnection): Promise<UserRow> {
	const db = connection ?? mysqlPool;
	const [rows] = await db.execute<UserRow[]>(
		`SELECT u.id, u.is_active, u.kode_kantor, office.korwil
		FROM users u
		INNER JOIN master_kantor office ON office.kode_kantor = u.kode_kantor AND office.is_active = 1
		INNER JOIN user_role_scopes scope ON scope.user_id = u.id AND scope.is_active = 1
		INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1 AND role.kode = 'branch_user'
		WHERE u.employee_id = ? AND u.is_active = 1 AND u.kode_kantor <> '000'
			AND scope.scope_type = 'office' AND scope.kode_kantor = u.kode_kantor
		LIMIT 1 ${connection ? 'FOR UPDATE' : ''}`,
		[employeeId]
	);
	if (!rows[0] || Number(rows[0].is_active) !== 1 || !rows[0].kode_kantor || !rows[0].korwil || rows[0].korwil === 'pusat') {
		throw new RequestWorkflowError(403, 'Akun aktif dengan akses Cabang belum ditetapkan. Hubungi Admin Sistem SLA.');
	}
	return rows[0];
}

async function getActiveKorwilUser(employeeId: string, connection?: PoolConnection): Promise<UserRow> {
	const db = connection ?? mysqlPool;
	const [rows] = await db.execute<KorwilAccessRow[]>(
		`SELECT u.id, u.is_active, u.kode_kantor, u.unit_kerja, u.branch_name, u.job_position,
			profile_office.korwil AS profile_korwil, scope.korwil AS assigned_korwil,
			scope.scope_type, role.kode AS role_code
		FROM users u
		LEFT JOIN master_kantor profile_office ON profile_office.kode_kantor = u.kode_kantor AND profile_office.is_active = 1
		LEFT JOIN user_role_scopes scope ON scope.user_id = u.id AND scope.is_active = 1
		LEFT JOIN roles role ON role.id = scope.role_id AND role.is_active = 1
		WHERE u.employee_id = ? AND u.is_active = 1
		ORDER BY scope.id ${connection ? 'FOR UPDATE' : ''}`,
		[employeeId]
	);
	const profile = rows[0];
	if (!profile || Number(profile.is_active) !== 1) {
		throw new RequestWorkflowError(403, 'Akun aktif dengan cakupan Korwil dari SSO belum ditetapkan.');
	}
	let currentKorwil = profile.profile_korwil;
	if (!currentKorwil || currentKorwil === 'pusat') {
		const [knownRows] = await db.execute<Array<RowDataPacket & { korwil: string }>>(
			`SELECT DISTINCT korwil FROM master_kantor
			WHERE is_active = 1 AND korwil <> 'pusat' ORDER BY korwil`
		);
		currentKorwil = inferKorwilFromSsoText(profile, knownRows.map((row) => row.korwil));
	}
	const assignment = rows.find((row) =>
		row.scope_type === 'korwil' &&
		['korwil_staff', 'korwil_approver'].includes(row.role_code ?? '') &&
		row.assigned_korwil === currentKorwil
	);
	if (!currentKorwil || currentKorwil === 'pusat' || !assignment) {
		throw new RequestWorkflowError(403, 'Cakupan Korwil pada profil SSO belum terpetakan atau belum diberi role.');
	}
	return { ...assignment, korwil: currentKorwil } as UserRow;
}

async function getActiveDivisionUser(employeeId: string, divisionId?: number, connection?: PoolConnection): Promise<UserRow> {
	const db = connection ?? mysqlPool;
	const [rows] = await db.execute<Array<RowDataPacket & UserRow>>(
		`SELECT u.id, u.is_active, u.divisi_id, role.kode AS role_code
		FROM users u
		INNER JOIN user_role_scopes scope ON scope.user_id = u.id AND scope.is_active = 1
		INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1 AND role.kode = 'division_staff'
		INNER JOIN master_divisi division ON division.id = u.divisi_id AND division.is_active = 1
		WHERE u.employee_id = ? AND u.is_active = 1 AND scope.scope_type = 'division'
			AND scope.divisi_id = u.divisi_id AND (? IS NULL OR scope.divisi_id = ?)
		ORDER BY scope.id LIMIT 1 ${connection ? 'FOR UPDATE' : ''}`,
		[employeeId, divisionId ?? null, divisionId ?? null]
	);
	if (!rows[0] || !rows[0].divisi_id) {
		throw new RequestWorkflowError(403, 'Akun aktif dengan cakupan Divisi Pusat belum ditetapkan.');
	}
	return rows[0];
}

async function getKorwilUser(employeeId: string, korwil: string, connection?: PoolConnection): Promise<UserRow> {
	const user = await getActiveKorwilUser(employeeId, connection);
	if (user.korwil !== korwil) {
		throw new RequestWorkflowError(403, 'Akun tidak memiliki akses ke Korwil pengajuan ini.');
	}
	return user;
}

export async function getRequestOptions(employeeId: string) {
	const branch = await getActiveBranch(employeeId);
	const [divisions] = await mysqlPool.execute<Array<RowDataPacket & { id: number; nama_divisi: string }>>(
		`SELECT id, nama_divisi FROM master_divisi WHERE is_active = 1 ORDER BY nama_divisi`
	);
	const [workCatalogs] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; divisi_id: number; nama_pekerjaan: string; deskripsi: string | null; target_sla_minutes: number | null;
		system_key: string | null; form_version_id: number | null; version_number: number | null; definition_json: unknown;
	}>>(
		`SELECT catalog.id, catalog.divisi_id, catalog.nama_pekerjaan, catalog.deskripsi,
			catalog.system_key, current_form.id AS form_version_id, current_form.version_number,
			current_form.definition_json,
			COALESCE(catalog.target_sla_minutes, ${DEFAULT_SLA_MINUTES}) AS target_sla_minutes
		FROM work_catalogs catalog INNER JOIN master_divisi division ON division.id = catalog.divisi_id
		LEFT JOIN work_catalog_form_versions current_form ON current_form.id = (
			SELECT form_version.id FROM work_catalog_form_versions form_version
			WHERE form_version.work_catalog_id = catalog.id
			ORDER BY form_version.version_number DESC LIMIT 1
		)
		WHERE catalog.is_active = 1 AND division.is_active = 1
		ORDER BY division.nama_divisi, catalog.nama_pekerjaan`
	);
	return {
		office: { kode_kantor: branch.kode_kantor, korwil: branch.korwil },
		divisions,
		work_catalogs: workCatalogs.map((item) => ({
			id: Number(item.id),
			divisi_id: Number(item.divisi_id),
			nama_pekerjaan: item.nama_pekerjaan,
			deskripsi: item.deskripsi,
			target_sla_minutes: Number(item.target_sla_minutes),
			system_key: item.system_key,
			form_version_id: item.form_version_id === null ? null : Number(item.form_version_id),
			version_number: item.version_number === null ? null : Number(item.version_number),
			form_fields: parseFormDefinition(item.definition_json).fields
		}))
	};
}

export async function submitRequest(employeeId: string, input: {
	authority_type: 'korwil' | 'central'; central_division_id: number | null;
	work_catalog_id: number | null; form_version_id?: number | null;
	form_answers?: Record<string, unknown>; subject: string; description: string;
}) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const branch = await getActiveBranch(employeeId, connection);
		let resolvedAuthority = input.authority_type;
		let resolvedDivisionId = input.central_division_id;
		let workCatalogId = input.work_catalog_id;
		let formVersionId: number | null = null;
		let formAnswers: Record<string, string | number> = {};
		let creditAmount: number | null = null;
		let targetSlaMinutes = DEFAULT_SLA_MINUTES;
		let catalog: (RowDataPacket & {
			id: number; divisi_id: number; target_sla_minutes: number | null; system_key: string | null;
			form_version_id: number | null; definition_json: unknown;
		}) | null = null;

		if (input.work_catalog_id !== null) {
			const [catalogRows] = await connection.execute<Array<RowDataPacket & {
				id: number; divisi_id: number; target_sla_minutes: number | null; system_key: string | null;
				form_version_id: number | null; definition_json: unknown;
			}>>(
				`SELECT catalog.id, catalog.divisi_id, catalog.target_sla_minutes, catalog.system_key,
					current_form.id AS form_version_id, current_form.definition_json
				FROM work_catalogs catalog
				INNER JOIN master_divisi division ON division.id = catalog.divisi_id AND division.is_active = 1
				LEFT JOIN work_catalog_form_versions current_form ON current_form.id = (
					SELECT form_version.id FROM work_catalog_form_versions form_version
					WHERE form_version.work_catalog_id = catalog.id
					ORDER BY form_version.version_number DESC LIMIT 1
				)
				WHERE catalog.id = ? AND catalog.is_active = 1 LIMIT 1 FOR UPDATE`,
				[input.work_catalog_id]
			);
			catalog = catalogRows[0] ?? null;
			if (!catalog) throw new RequestWorkflowError(400, 'Jenis pekerjaan aktif tidak ditemukan. Muat ulang katalog pekerjaan.');
			targetSlaMinutes = Number(catalog.target_sla_minutes ?? DEFAULT_SLA_MINUTES);
		}

		const isCreditApplication = catalog?.system_key === 'credit_application';
		if (catalog && isCreditApplication) {
			if (catalog.form_version_id === null) throw new RequestWorkflowError(409, 'Form pengajuan kredit belum diterbitkan. Hubungi Admin atau Divisi Pemasaran.');
			if (input.form_version_id !== Number(catalog.form_version_id)) throw new RequestWorkflowError(409, 'Form kredit sudah diperbarui. Muat ulang halaman lalu isi kembali.');
			const definition = parseFormDefinition(catalog.definition_json);
			try {
				formAnswers = validateFormAnswers(definition, input.form_answers ?? {});
			} catch (error) {
				throw new RequestWorkflowError(400, error instanceof Error ? error.message : 'Periksa kembali isian form kredit.');
			}
			const amount = formAnswers.credit_amount;
			if (typeof amount !== 'number' || amount < CREDIT_MINIMUM_AMOUNT) {
				throw new RequestWorkflowError(400, 'Pengajuan kredit harus bernilai minimal Rp250.000.000.');
			}
			creditAmount = amount;
			resolvedAuthority = amount >= CREDIT_CENTRAL_AMOUNT ? 'central' : 'korwil';
			resolvedDivisionId = resolvedAuthority === 'central' ? Number(catalog.divisi_id) : null;
			workCatalogId = Number(catalog.id);
			formVersionId = Number(catalog.form_version_id);
		} else if (input.authority_type === 'korwil') {
			if (input.central_division_id !== null || input.work_catalog_id !== null) {
				throw new RequestWorkflowError(400, 'Divisi dan jenis pekerjaan hanya diisi untuk pengajuan ke Pusat.');
			}
			if ((input.form_version_id ?? null) !== null || Object.keys(input.form_answers ?? {}).length > 0) {
				throw new RequestWorkflowError(400, 'Isian form khusus harus terhubung dengan jenis pekerjaan aktif.');
			}
		} else {
			if (!catalog || input.central_division_id === null || Number(catalog.divisi_id) !== input.central_division_id) {
				throw new RequestWorkflowError(400, 'Jenis pekerjaan aktif harus sesuai dengan divisi tujuan.');
			}
			if (catalog.form_version_id !== null) {
				const definition = parseFormDefinition(catalog.definition_json);
				const answerInput = input.form_answers ?? {};
				const legacyEmptyForm = definition.fields.length === 0 && input.form_version_id == null && Object.keys(answerInput).length === 0;
				if (!legacyEmptyForm && input.form_version_id !== Number(catalog.form_version_id)) throw new RequestWorkflowError(409, 'Form pekerjaan sudah diperbarui. Muat ulang halaman lalu isi kembali.');
				try {
					formAnswers = validateFormAnswers(definition, answerInput);
				} catch (error) {
					throw new RequestWorkflowError(400, error instanceof Error ? error.message : 'Periksa kembali isian form pekerjaan.');
				}
				formVersionId = Number(catalog.form_version_id);
			} else if ((input.form_version_id ?? null) !== null || Object.keys(input.form_answers ?? {}).length > 0) {
				throw new RequestWorkflowError(409, 'Form pekerjaan belum aktif atau sudah berubah. Muat ulang halaman.');
			}
		}

		const [insert] = await connection.execute<ResultSetHeader>(
			`INSERT INTO service_requests
			(created_by_user_id, kode_kantor, korwil, authority_type, central_division_id, work_catalog_id,
			 form_version_id, form_answers_json, credit_amount, subject, description, status, current_unit_type, current_unit_code)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting_korwil', 'korwil', ?)`,
			[branch.id, branch.kode_kantor, branch.korwil, resolvedAuthority,
				resolvedDivisionId, workCatalogId, formVersionId, formVersionId === null ? null : JSON.stringify(formAnswers),
				creditAmount, input.subject, input.description, branch.korwil]
		);
		const requestId = insert.insertId;
		const requestNumber = `SLA-${String(requestId).padStart(8, '0')}`;
		await connection.execute('UPDATE service_requests SET request_number = ? WHERE id = ?', [requestNumber, requestId]);
		await connection.execute(
			`INSERT INTO request_assignments (request_id, unit_type, unit_code) VALUES (?, 'korwil', ?)`,
			[requestId, branch.korwil]
		);
		await connection.execute(
			`INSERT INTO request_sla_sessions (request_id, unit_type, unit_code, started_at, start_reason, target_sla_minutes)
			VALUES (?, 'korwil', ?, NULL, NULL, ?)`,
			[requestId, branch.korwil, targetSlaMinutes]
		);
		const [history] = await connection.execute<ResultSetHeader>(
			`INSERT INTO request_status_histories
			(request_id, actor_user_id, action_name, status_from, status_to, unit_to_type, unit_to_code)
			VALUES (?, ?, 'submitted', NULL, 'waiting_korwil', 'korwil', ?)`,
			[requestId, branch.id, branch.korwil]
		);
		await notifyUnitMembers(connection, {
			requestId,
			historyId: history.insertId,
			unitType: 'korwil',
			unitCode: branch.korwil!,
			eventType: 'request_received',
			title: 'Pengajuan baru masuk ke Korwil',
			body: `${requestNumber} · ${input.subject}`
		});
		await connection.commit();
		return { id: requestId, request_number: requestNumber };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

const requestSelect = `SELECT request.id, request.request_number, request.kode_kantor, office.nama_kantor,
	request.korwil, request.authority_type, request.central_division_id, division.nama_divisi,
	request.work_catalog_id, catalog.nama_pekerjaan, request.subject, request.description,
	request.status, request.current_unit_type, request.current_unit_code, request.current_owner_user_id,
	request.submitted_at, request.created_by_user_id, creator.full_name AS created_by_name, request.closed_at,
	COALESCE(catalog.target_sla_minutes, ${DEFAULT_SLA_MINUTES}) AS sla_target_minutes,
	TIMESTAMPDIFF(SECOND, request.submitted_at, COALESCE(request.closed_at, CURRENT_TIMESTAMP(3))) AS overall_elapsed_seconds,
	(SELECT TIMESTAMPDIFF(SECOND, timer.started_at, COALESCE(timer.ended_at, CURRENT_TIMESTAMP(3)))
		FROM request_sla_sessions timer WHERE timer.request_id = request.id AND timer.ended_at IS NULL AND timer.started_at IS NOT NULL
		ORDER BY timer.id DESC LIMIT 1) AS active_elapsed_seconds,
	(SELECT timer.target_sla_minutes FROM request_sla_sessions timer
		WHERE timer.request_id = request.id AND timer.ended_at IS NULL AND timer.started_at IS NOT NULL ORDER BY timer.id DESC LIMIT 1)
		AS active_target_sla_minutes
	FROM service_requests request INNER JOIN master_kantor office ON office.kode_kantor = request.kode_kantor
	LEFT JOIN master_divisi division ON division.id = request.central_division_id
	LEFT JOIN work_catalogs catalog ON catalog.id = request.work_catalog_id
	INNER JOIN users creator ON creator.id = request.created_by_user_id`;

export async function listBranchRequests(employeeId: string) {
	const branch = await getActiveBranch(employeeId);
	const [rows] = await mysqlPool.execute<RequestRow[]>(
		`${requestSelect} WHERE request.kode_kantor = ? ORDER BY request.submitted_at DESC LIMIT 100`, [branch.kode_kantor]
	);
	return rows.map(decorateRequest);
}

export async function listKorwilInbox(employeeId: string) {
	const user = await getActiveKorwilUser(employeeId);
	const [rows] = await mysqlPool.execute<RequestRow[]>(
		`${requestSelect}
		WHERE request.current_unit_type = 'korwil'
			AND request.status IN ('waiting_korwil', 'in_progress_korwil')
			AND request.korwil = ?
		ORDER BY CASE WHEN request.status = 'waiting_korwil' THEN 0 ELSE 1 END, request.submitted_at ASC LIMIT 100`,
		[user.korwil]
	);
	return rows.map(decorateRequest);
}

export async function listKorwilHistory(employeeId: string) {
	const user = await getActiveKorwilUser(employeeId);
	const [rows] = await mysqlPool.execute<RequestRow[]>(
		`${requestSelect}
		WHERE request.korwil = ?
			AND (request.current_unit_type <> 'korwil'
				OR request.status IN ('completed', 'rejected'))
			AND EXISTS (
				SELECT 1 FROM request_status_histories history
				WHERE history.request_id = request.id
					AND history.unit_to_type = 'korwil'
					AND history.unit_to_code = request.korwil
			)
		ORDER BY request.updated_at DESC, request.id DESC LIMIT 100`,
		[user.korwil]
	);
	return rows.map(decorateRequest);
}

async function canViewRequest(employeeId: string, row: RequestRow): Promise<boolean> {
	const resolution = await resolveSlaAccessDetails(employeeId);
	if (resolution.access.enabled && resolution.access.scope === 'all' &&
		['admin', 'supervisor', 'management'].includes(resolution.access.role ?? '')) return true;
	const [branches] = await mysqlPool.execute<UserRow[]>(
		`SELECT u.id, u.is_active, u.kode_kantor, office.korwil FROM users u
		INNER JOIN master_kantor office ON office.kode_kantor = u.kode_kantor AND office.is_active = 1
		INNER JOIN user_role_scopes scope ON scope.user_id = u.id AND scope.is_active = 1
		INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1 AND role.kode = 'branch_user'
		WHERE u.employee_id = ? AND u.is_active = 1 AND u.kode_kantor = ? AND scope.scope_type = 'office' AND scope.kode_kantor = u.kode_kantor LIMIT 1`,
		[employeeId, row.kode_kantor]
	);
	if (branches[0]) return true;
	try {
		const korwilUser = await getActiveKorwilUser(employeeId);
		if (korwilUser.korwil === row.korwil) return true;
	} catch (error) {
		if (!(error instanceof RequestWorkflowError && error.statusCode === 403)) throw error;
	}
	if (row.central_division_id !== null) {
		try {
			const divisionUser = await getActiveDivisionUser(employeeId, row.central_division_id);
			if (divisionUser.divisi_id !== row.central_division_id) return false;
			const [historyRows] = await mysqlPool.execute<RowDataPacket[]>(
				`SELECT 1 FROM request_status_histories history
				INNER JOIN master_divisi division ON division.id = ?
				WHERE history.request_id = ? AND history.unit_to_type = 'central'
					AND history.unit_to_code = division.kode LIMIT 1`,
				[row.central_division_id, row.id]
			);
			return historyRows.length > 0;
		} catch (error) {
			if (error instanceof RequestWorkflowError && error.statusCode === 403) return false;
			throw error;
		}
	}
	return false;
}

function decorateRequest(row: RequestRow): RequestRow {
	const elapsed = Number(row.overall_elapsed_seconds ?? 0);
	const target = Number(row.sla_target_minutes ?? DEFAULT_SLA_MINUTES) || DEFAULT_SLA_MINUTES;
	return {
		...row,
		overall_elapsed_seconds: Number.isFinite(elapsed) ? elapsed : 0,
		active_elapsed_seconds: row.active_elapsed_seconds === null ? null : Number(row.active_elapsed_seconds),
		active_target_sla_minutes: row.active_target_sla_minutes === null
			? DEFAULT_SLA_MINUTES
			: Number(row.active_target_sla_minutes),
		sla_target_minutes: target,
		sla_status: getSlaStatus(elapsed, target)
	};
}

export async function getRequestDetail(employeeId: string, requestId: number) {
	const [rows] = await mysqlPool.execute<RequestRow[]>(`${requestSelect} WHERE request.id = ? LIMIT 1`, [requestId]);
	const request = rows[0];
	if (!request) throw new RequestWorkflowError(404, 'Pengajuan tidak ditemukan.');
	if (!(await canViewRequest(employeeId, request))) throw new RequestWorkflowError(403, 'Kamu tidak memiliki akses ke pengajuan ini.');
	const [formRows] = await mysqlPool.execute<Array<RowDataPacket & {
		form_answers_json: unknown;
		definition_json: unknown;
	}>>(
		`SELECT request.form_answers_json, form_version.definition_json
		FROM service_requests request
		LEFT JOIN work_catalog_form_versions form_version ON form_version.id = request.form_version_id
		WHERE request.id = ? LIMIT 1`,
		[requestId]
	);
	let storedAnswers: unknown = formRows[0]?.form_answers_json;
	if (typeof storedAnswers === 'string') {
		try { storedAnswers = JSON.parse(storedAnswers) as unknown; } catch { storedAnswers = null; }
	}
	const answerValues = storedAnswers && typeof storedAnswers === 'object' && !Array.isArray(storedAnswers)
		? storedAnswers as Record<string, unknown>
		: {};
	const formAnswers = parseFormDefinition(formRows[0]?.definition_json).fields.flatMap((field) => {
		const value = answerValues[field.key];
		return typeof value === 'string' || typeof value === 'number'
			? [{ key: field.key, label: field.label, type: field.type, value }]
			: [];
	});
	const [sessions] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; unit_type: string; unit_code: string; started_at: Date | null; start_reason: string | null; claimed_at: Date | null;
		ended_at: Date | null; created_at: Date; target_sla_minutes: number | null; outcome: string | null; duration_seconds: number | null;
	}>>(
		`SELECT id, unit_type, unit_code, started_at, start_reason, claimed_at, ended_at, created_at, target_sla_minutes, outcome,
		CASE WHEN started_at IS NULL THEN NULL ELSE TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, CURRENT_TIMESTAMP(3))) END AS duration_seconds
		FROM request_sla_sessions WHERE request_id = ? ORDER BY id`, [requestId]
	);
	const [timeline] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; action_name: string; status_from: string | null; status_to: string;
		unit_from_type: string | null; unit_from_code: string | null; unit_to_type: string; unit_to_code: string;
		reason: string | null; created_at: Date; actor_name: string | null;
	}>>(
		`SELECT history.id, history.action_name, history.status_from, history.status_to,
		history.unit_from_type, history.unit_from_code, history.unit_to_type, history.unit_to_code,
		history.reason, history.created_at, actor.full_name AS actor_name
		FROM request_status_histories history INNER JOIN users actor ON actor.id = history.actor_user_id
		WHERE history.request_id = ? ORDER BY history.created_at, history.id`, [requestId]
	);
	const capabilities = {
		can_submit_revision: false,
		can_request_documents: false,
		can_forward_to_central: false,
		can_complete: false,
		can_reject: false,
		can_claim_central: false
	};
	try {
		const branch = await getActiveBranch(employeeId);
		capabilities.can_submit_revision = request.status === 'waiting_branch_revision' &&
			request.current_unit_type === 'branch' && branch.kode_kantor === request.kode_kantor;
	} catch (error) {
		if (!(error instanceof RequestWorkflowError && error.statusCode === 403)) throw error;
	}
	try {
		const korwil = await getKorwilUser(employeeId, request.korwil);
		const ownsRequest = request.current_owner_user_id === korwil.id;
		if (ownsRequest && request.status === 'in_progress_korwil' && request.current_unit_type === 'korwil') {
			capabilities.can_request_documents = true;
			capabilities.can_forward_to_central = request.authority_type === 'central';
			capabilities.can_complete = request.authority_type === 'korwil';
			capabilities.can_reject = true;
		}
	} catch (error) {
		if (!(error instanceof RequestWorkflowError && error.statusCode === 403)) throw error;
	}
	if (request.central_division_id !== null) {
		try {
			const division = await getActiveDivisionUser(employeeId, request.central_division_id);
			const [divisionRows] = await mysqlPool.execute<Array<RowDataPacket & { kode: string }>>(
				'SELECT kode FROM master_divisi WHERE id = ? LIMIT 1', [request.central_division_id]
			);
			const ownsRequest = request.current_owner_user_id === division.id;
			if (ownsRequest && request.status === 'in_progress_central' && request.current_unit_type === 'central' &&
				request.current_unit_code === divisionRows[0]?.kode) {
				capabilities.can_request_documents = true;
				capabilities.can_complete = true;
				capabilities.can_reject = true;
			}
		} catch (error) {
			if (!(error instanceof RequestWorkflowError && error.statusCode === 403)) throw error;
		}
	}
	return { request: decorateRequest(request), form_answers: formAnswers, sessions, timeline, capabilities };
}

export async function claimKorwilRequest(employeeId: string, requestId: number) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const [requests] = await connection.execute<Array<RowDataPacket & {
			id: number; korwil: string; status: string; current_owner_user_id: number | null;
			current_unit_type: string; current_unit_code: string; request_number: string; subject: string; kode_kantor: string;
		}>>(
			`SELECT id, request_number, subject, kode_kantor, korwil, status,
				current_owner_user_id, current_unit_type, current_unit_code
			FROM service_requests WHERE id = ? FOR UPDATE`, [requestId]
		);
		const request = requests[0];
		if (!request) throw new RequestWorkflowError(404, 'Pengajuan tidak ditemukan.');
		const actor = await getKorwilUser(employeeId, request.korwil, connection);
		if (request.status !== 'waiting_korwil' || request.current_unit_type !== 'korwil' || request.current_unit_code !== request.korwil || request.current_owner_user_id !== null) {
			throw new RequestWorkflowError(409, 'Pengajuan ini sudah diambil atau tidak lagi berada di antrean Korwil.');
		}
		await connection.execute(
			`UPDATE service_requests SET status = 'in_progress_korwil', current_owner_user_id = ? WHERE id = ?`,
			[actor.id, requestId]
		);
		const [assignmentUpdate] = await connection.execute<ResultSetHeader>(
			`UPDATE request_assignments SET assigned_user_id = ?, claimed_at = CURRENT_TIMESTAMP(3)
			WHERE request_id = ? AND unit_type = 'korwil' AND unit_code = ? AND released_at IS NULL`,
			[actor.id, requestId, request.korwil]
		);
		if (assignmentUpdate.affectedRows !== 1) {
			throw new RequestWorkflowError(409, 'Penugasan aktif tidak ditemukan. Muat ulang antrean sebelum mencoba lagi.');
		}
		const [sessionUpdate] = await connection.execute<ResultSetHeader>(
			`UPDATE request_sla_sessions
			SET started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3)),
				start_reason = COALESCE(start_reason, 'claim'),
				claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP(3))
			WHERE request_id = ? AND unit_type = 'korwil' AND unit_code = ? AND ended_at IS NULL`,
			[requestId, request.korwil]
		);
		if (sessionUpdate.affectedRows !== 1) {
			throw new RequestWorkflowError(409, 'Sesi timer aktif tidak ditemukan. Muat ulang antrean sebelum mencoba lagi.');
		}
		const [history] = await connection.execute<ResultSetHeader>(
			`INSERT INTO request_status_histories
			(request_id, actor_user_id, action_name, status_from, status_to, unit_from_type, unit_from_code, unit_to_type, unit_to_code)
			VALUES (?, ?, 'claimed', 'waiting_korwil', 'in_progress_korwil', 'korwil', ?, 'korwil', ?)`,
			[requestId, actor.id, request.korwil, request.korwil]
		);
		await notifyRequestUnit(connection, request, history.insertId, 'branch', request.kode_kantor,
			'request_claimed', 'Pengajuan mulai diproses');
		await connection.commit();
		return { id: requestId, status: 'in_progress_korwil' };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

type LockedRequest = RowDataPacket & {
	id: number; request_number: string; subject: string; kode_kantor: string; korwil: string; authority_type: string;
	central_division_id: number | null; status: string; current_unit_type: string; current_unit_code: string;
	current_owner_user_id: number | null; sla_target_minutes: number | null;
};

async function lockRequest(connection: PoolConnection, requestId: number): Promise<LockedRequest> {
	const [rows] = await connection.execute<LockedRequest[]>(
		`SELECT request.id, request.request_number, request.subject, request.kode_kantor, request.korwil,
			request.authority_type, request.central_division_id, request.status, request.current_unit_type,
			request.current_unit_code, request.current_owner_user_id,
			COALESCE(catalog.target_sla_minutes, ${DEFAULT_SLA_MINUTES}) AS sla_target_minutes
		FROM service_requests request
		LEFT JOIN work_catalogs catalog ON catalog.id = request.work_catalog_id
		WHERE request.id = ? FOR UPDATE`, [requestId]
	);
	if (!rows[0]) throw new RequestWorkflowError(404, 'Pengajuan tidak ditemukan.');
	return rows[0];
}

async function findResumableHandler(
	connection: PoolConnection,
	requestId: number,
	unitType: 'korwil' | 'central',
	unitCode: string,
	requesterId: number,
	divisionId: number | null
): Promise<number | null> {
	const [assignments] = await connection.execute<Array<RowDataPacket & { employee_id: string }>>(
		`SELECT handler_user.employee_id
		FROM request_assignments assignment
		INNER JOIN users handler_user ON handler_user.id = assignment.assigned_user_id
		WHERE assignment.request_id = ? AND assignment.unit_type = ? AND assignment.unit_code = ?
			AND assignment.assigned_user_id = ? AND assignment.released_at IS NOT NULL
		ORDER BY assignment.id DESC LIMIT 1`,
		[requestId, unitType, unitCode, requesterId]
	);
	const employeeId = assignments[0]?.employee_id;
	if (!employeeId) return null;

	try {
		if (unitType === 'korwil') return (await getKorwilUser(employeeId, unitCode, connection)).id;
		if (divisionId === null) return null;
		return (await getActiveDivisionUser(employeeId, divisionId, connection)).id;
	} catch (error) {
		if (error instanceof RequestWorkflowError && error.statusCode === 403) return null;
		throw error;
	}
}

async function closeActiveSession(connection: PoolConnection, requestId: number, outcome: string): Promise<void> {
	const [result] = await connection.execute<ResultSetHeader>(
		`UPDATE request_sla_sessions
		SET ended_at = CURRENT_TIMESTAMP(3),
			duration_seconds = TIMESTAMPDIFF(SECOND, started_at, CURRENT_TIMESTAMP(3)), outcome = ?
		WHERE request_id = ? AND ended_at IS NULL AND started_at IS NOT NULL`, [outcome, requestId]
	);
	if (result.affectedRows !== 1) throw new RequestWorkflowError(409, 'Sesi SLA aktif tidak ditemukan. Muat ulang pengajuan.');
}

async function releaseActiveAssignment(connection: PoolConnection, requestId: number): Promise<void> {
	const [result] = await connection.execute<ResultSetHeader>(
		'UPDATE request_assignments SET released_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND released_at IS NULL',
		[requestId]
	);
	if (result.affectedRows !== 1) throw new RequestWorkflowError(409, 'Penugasan aktif tidak ditemukan. Muat ulang pengajuan.');
}

async function addHistory(connection: PoolConnection, input: {
	requestId: number; actorId: number; action: string; statusFrom: string; statusTo: string;
	fromType: 'branch' | 'korwil' | 'central'; fromCode: string;
	toType: 'branch' | 'korwil' | 'central'; toCode: string; reason: string;
}): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO request_status_histories
		(request_id, actor_user_id, action_name, status_from, status_to, unit_from_type, unit_from_code, unit_to_type, unit_to_code, reason)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[input.requestId, input.actorId, input.action, input.statusFrom, input.statusTo,
			input.fromType, input.fromCode, input.toType, input.toCode, input.reason]
	);
	return result.insertId;
}

async function notifyRequestUnit(connection: PoolConnection, request: {
	id: number; request_number: string; subject: string;
}, historyId: number, unitType: NotificationUnit, unitCode: string, eventType: string, title: string): Promise<void> {
	await notifyUnitMembers(connection, {
		requestId: request.id,
		historyId,
		unitType,
		unitCode,
		eventType,
		title,
		body: `${request.request_number} · ${request.subject}`
	});
}

export async function returnKorwilRequestForDocuments(employeeId: string, requestId: number, reason: string) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		const actor = await getKorwilUser(employeeId, request.korwil, connection);
		if (request.status !== 'in_progress_korwil' || request.current_unit_type !== 'korwil' || request.current_owner_user_id !== actor.id) {
			throw new RequestWorkflowError(409, 'Ambil dan miliki pengajuan ini sebelum meminta kelengkapan.');
		}
		await closeActiveSession(connection, requestId, 'requested_documents');
		await releaseActiveAssignment(connection, requestId);
		await connection.execute(
			`UPDATE service_requests SET status = 'waiting_branch_revision', current_unit_type = 'branch',
				current_unit_code = ?, current_owner_user_id = NULL, closed_at = NULL WHERE id = ?`,
			[request.kode_kantor, requestId]
		);
		await connection.execute(
			`INSERT INTO request_assignments (request_id, unit_type, unit_code) VALUES (?, 'branch', ?)`,
			[requestId, request.kode_kantor]
		);
		await connection.execute(
			`INSERT INTO request_sla_sessions (request_id, unit_type, unit_code, started_at, start_reason, target_sla_minutes)
			VALUES (?, 'branch', ?, CURRENT_TIMESTAMP(3), 'sent', ?)`, [requestId, request.kode_kantor, DEFAULT_SLA_MINUTES]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: 'request_documents', statusFrom: 'in_progress_korwil',
			statusTo: 'waiting_branch_revision', fromType: 'korwil', fromCode: request.korwil,
			toType: 'branch', toCode: request.kode_kantor, reason
		});
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			'documents_requested', 'Kelengkapan diminta');
		await connection.commit();
		return { id: requestId, status: 'waiting_branch_revision' };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function forwardKorwilRequestToCentral(employeeId: string, requestId: number, reason: string) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		const actor = await getKorwilUser(employeeId, request.korwil, connection);
		if (request.authority_type !== 'central' || request.central_division_id === null) {
			throw new RequestWorkflowError(409, 'Pengajuan ini tidak memiliki tujuan Divisi Pusat.');
		}
		if (request.status !== 'in_progress_korwil' || request.current_unit_type !== 'korwil' || request.current_owner_user_id !== actor.id) {
			throw new RequestWorkflowError(409, 'Ambil dan miliki pengajuan ini sebelum meneruskannya.');
		}
		const [divisions] = await connection.execute<Array<RowDataPacket & { kode: string }>>(
			'SELECT kode FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1', [request.central_division_id]
		);
		const divisionCode = divisions[0]?.kode;
		if (!divisionCode) throw new RequestWorkflowError(409, 'Divisi tujuan tidak aktif. Hubungi Admin Sistem SLA.');
		await closeActiveSession(connection, requestId, 'forwarded');
		await releaseActiveAssignment(connection, requestId);
		await connection.execute(
			`UPDATE service_requests SET status = 'waiting_central', current_unit_type = 'central',
				current_unit_code = ?, current_owner_user_id = NULL, closed_at = NULL WHERE id = ?`, [divisionCode, requestId]
		);
		await connection.execute(
			`INSERT INTO request_assignments (request_id, unit_type, unit_code) VALUES (?, 'central', ?)`, [requestId, divisionCode]
		);
		await connection.execute(
			`INSERT INTO request_sla_sessions (request_id, unit_type, unit_code, started_at, start_reason, target_sla_minutes)
			VALUES (?, 'central', ?, NULL, NULL, ?)`, [requestId, divisionCode, request.sla_target_minutes ?? DEFAULT_SLA_MINUTES]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: 'forwarded_to_central', statusFrom: 'in_progress_korwil',
			statusTo: 'waiting_central', fromType: 'korwil', fromCode: request.korwil,
			toType: 'central', toCode: divisionCode, reason
		});
		await notifyRequestUnit(connection, request, historyId, 'central', divisionCode,
			'request_forwarded', 'Pengajuan masuk ke Divisi Pusat');
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			'request_forwarded', 'Pengajuan diteruskan ke Divisi Pusat');
		await connection.commit();
		return { id: requestId, status: 'waiting_central' };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function finishKorwilRequest(employeeId: string, requestId: number, outcome: 'completed' | 'rejected', reason: string) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		const actor = await getKorwilUser(employeeId, request.korwil, connection);
		if (request.status !== 'in_progress_korwil' || request.current_unit_type !== 'korwil' || request.current_owner_user_id !== actor.id) {
			throw new RequestWorkflowError(409, 'Ambil dan miliki pengajuan ini sebelum menutupnya.');
		}
		if (outcome === 'completed' && request.authority_type === 'central') {
			throw new RequestWorkflowError(409, 'Pengajuan dengan tujuan Pusat harus diteruskan ke Divisi yang dipilih.');
		}
		await closeActiveSession(connection, requestId, outcome);
		await releaseActiveAssignment(connection, requestId);
		await connection.execute(
			`UPDATE service_requests SET status = ?, current_owner_user_id = NULL, closed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
			[outcome, requestId]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: outcome, statusFrom: 'in_progress_korwil', statusTo: outcome,
			fromType: 'korwil', fromCode: request.korwil, toType: 'korwil', toCode: request.korwil, reason
		});
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			outcome === 'completed' ? 'request_completed' : 'request_rejected',
			outcome === 'completed' ? 'Pengajuan selesai' : 'Pengajuan ditolak');
		await connection.commit();
		return { id: requestId, status: outcome };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function claimCentralRequest(employeeId: string, requestId: number) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		if (request.central_division_id === null) throw new RequestWorkflowError(409, 'Divisi tujuan pengajuan tidak ditemukan.');
		const actor = await getActiveDivisionUser(employeeId, request.central_division_id, connection);
		const [divisionRows] = await connection.execute<Array<RowDataPacket & { kode: string }>>(
			'SELECT kode FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1', [request.central_division_id]
		);
		const divisionCode = divisionRows[0]?.kode;
		if (request.status !== 'waiting_central' || request.current_unit_type !== 'central' ||
			request.current_unit_code !== divisionCode || request.current_owner_user_id !== null) {
			throw new RequestWorkflowError(409, 'Pengajuan ini sudah diambil atau tidak lagi berada di antrean Divisi Pusat.');
		}
		await connection.execute(
			`UPDATE service_requests SET status = 'in_progress_central', current_owner_user_id = ? WHERE id = ?`, [actor.id, requestId]
		);
		const [assignment] = await connection.execute<ResultSetHeader>(
			`UPDATE request_assignments SET assigned_user_id = ?, claimed_at = CURRENT_TIMESTAMP(3)
			WHERE request_id = ? AND unit_type = 'central' AND unit_code = ? AND released_at IS NULL`,
			[actor.id, requestId, divisionCode]
		);
		const [session] = await connection.execute<ResultSetHeader>(
			`UPDATE request_sla_sessions
			SET started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3)),
				start_reason = COALESCE(start_reason, 'claim'),
				claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP(3))
			WHERE request_id = ? AND unit_type = 'central' AND unit_code = ? AND ended_at IS NULL`,
			[requestId, divisionCode]
		);
		if (assignment.affectedRows !== 1 || session.affectedRows !== 1) {
			throw new RequestWorkflowError(409, 'Penugasan atau sesi Divisi tidak ditemukan. Muat ulang antrean.');
		}
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: 'claimed', statusFrom: 'waiting_central', statusTo: 'in_progress_central',
			fromType: 'central', fromCode: divisionCode!, toType: 'central', toCode: divisionCode!, reason: ''
		});
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			'request_claimed', 'Pengajuan mulai diproses');
		await connection.commit();
		return { id: requestId, status: 'in_progress_central' };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function returnCentralRequestForDocuments(employeeId: string, requestId: number, reason: string) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		if (request.central_division_id === null) throw new RequestWorkflowError(409, 'Divisi tujuan pengajuan tidak ditemukan.');
		const actor = await getActiveDivisionUser(employeeId, request.central_division_id, connection);
		const [divisionRows] = await connection.execute<Array<RowDataPacket & { kode: string }>>(
			'SELECT kode FROM master_divisi WHERE id = ? LIMIT 1', [request.central_division_id]
		);
		const divisionCode = divisionRows[0]?.kode;
		if (request.status !== 'in_progress_central' || request.current_unit_type !== 'central' ||
			request.current_unit_code !== divisionCode || request.current_owner_user_id !== actor.id) {
			throw new RequestWorkflowError(409, 'Ambil dan miliki pengajuan ini sebelum meminta kelengkapan.');
		}
		await closeActiveSession(connection, requestId, 'requested_documents');
		await releaseActiveAssignment(connection, requestId);
		await connection.execute(
			`UPDATE service_requests SET status = 'waiting_branch_revision', current_unit_type = 'branch',
				current_unit_code = ?, current_owner_user_id = NULL, closed_at = NULL WHERE id = ?`,
			[request.kode_kantor, requestId]
		);
		await connection.execute(
			`INSERT INTO request_assignments (request_id, unit_type, unit_code) VALUES (?, 'branch', ?)`, [requestId, request.kode_kantor]
		);
		await connection.execute(
			`INSERT INTO request_sla_sessions (request_id, unit_type, unit_code, started_at, start_reason, target_sla_minutes)
			VALUES (?, 'branch', ?, CURRENT_TIMESTAMP(3), 'sent', ?)`, [requestId, request.kode_kantor, DEFAULT_SLA_MINUTES]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: 'request_documents', statusFrom: 'in_progress_central',
			statusTo: 'waiting_branch_revision', fromType: 'central', fromCode: divisionCode!,
			toType: 'branch', toCode: request.kode_kantor, reason
		});
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			'documents_requested', 'Kelengkapan diminta');
		await connection.commit();
		return { id: requestId, status: 'waiting_branch_revision' };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function finishCentralRequest(employeeId: string, requestId: number, outcome: 'completed' | 'rejected', reason: string) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		if (request.central_division_id === null) throw new RequestWorkflowError(409, 'Divisi tujuan pengajuan tidak ditemukan.');
		const actor = await getActiveDivisionUser(employeeId, request.central_division_id, connection);
		const [divisionRows] = await connection.execute<Array<RowDataPacket & { kode: string }>>(
			'SELECT kode FROM master_divisi WHERE id = ? LIMIT 1', [request.central_division_id]
		);
		const divisionCode = divisionRows[0]?.kode;
		if (request.status !== 'in_progress_central' || request.current_unit_type !== 'central' ||
			request.current_unit_code !== divisionCode || request.current_owner_user_id !== actor.id) {
			throw new RequestWorkflowError(409, 'Ambil dan miliki pengajuan ini sebelum menutupnya.');
		}
		await closeActiveSession(connection, requestId, outcome);
		await releaseActiveAssignment(connection, requestId);
		await connection.execute(
			`UPDATE service_requests SET status = ?, current_owner_user_id = NULL, closed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
			[outcome, requestId]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: outcome, statusFrom: 'in_progress_central', statusTo: outcome,
			fromType: 'central', fromCode: divisionCode!, toType: 'central', toCode: divisionCode!, reason
		});
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			outcome === 'completed' ? 'request_completed' : 'request_rejected',
			outcome === 'completed' ? 'Pengajuan selesai' : 'Pengajuan ditolak');
		await connection.commit();
		return { id: requestId, status: outcome };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function submitBranchRevision(employeeId: string, requestId: number, responseText: string) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		const branch = await getActiveBranch(employeeId, connection);
		if (request.status !== 'waiting_branch_revision' || request.current_unit_type !== 'branch' ||
			request.kode_kantor !== branch.kode_kantor || request.current_unit_code !== branch.kode_kantor) {
			throw new RequestWorkflowError(409, 'Pengajuan ini tidak sedang menunggu kelengkapan dari kantor Cabang kamu.');
		}
		const [histories] = await connection.execute<Array<RowDataPacket & {
			actor_user_id: number; unit_from_type: string; unit_from_code: string;
		}>>(
			`SELECT actor_user_id, unit_from_type, unit_from_code FROM request_status_histories
			WHERE request_id = ? AND action_name = 'request_documents' ORDER BY id DESC LIMIT 1`, [requestId]
		);
		const target = histories[0];
		if (!target || !['korwil', 'central'].includes(target.unit_from_type)) {
			throw new RequestWorkflowError(409, 'Tujuan pengembalian pelengkapan tidak ditemukan. Hubungi petugas yang meminta.');
		}
		let targetCode = target.unit_from_code;
		if (target.unit_from_type === 'korwil' && targetCode !== request.korwil) {
			throw new RequestWorkflowError(409, 'Cakupan Korwil pada histori tidak cocok dengan pengajuan.');
		}
		if (target.unit_from_type === 'central') {
			const [divisionRows] = await connection.execute<Array<RowDataPacket & { kode: string }>>(
				'SELECT kode FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1', [request.central_division_id]
			);
			if (!divisionRows[0] || divisionRows[0].kode !== targetCode) {
				throw new RequestWorkflowError(409, 'Divisi yang meminta kelengkapan tidak lagi cocok dengan tujuan pengajuan.');
			}
			targetCode = divisionRows[0].kode;
		}
		const resumedHandlerId = await findResumableHandler(
			connection, requestId, target.unit_from_type as 'korwil' | 'central', targetCode,
			target.actor_user_id, request.central_division_id
		);
		await closeActiveSession(connection, requestId, 'documents_submitted');
		await releaseActiveAssignment(connection, requestId);
		const nextStatus = target.unit_from_type === 'korwil'
			? resumedHandlerId === null ? 'waiting_korwil' : 'in_progress_korwil'
			: resumedHandlerId === null ? 'waiting_central' : 'in_progress_central';
		await connection.execute(
			`UPDATE service_requests SET status = ?, current_unit_type = ?, current_unit_code = ?,
				current_owner_user_id = ?, closed_at = NULL WHERE id = ?`,
			[nextStatus, target.unit_from_type, targetCode, resumedHandlerId, requestId]
		);
		await connection.execute(
			`INSERT INTO request_assignments (request_id, unit_type, unit_code, assigned_user_id) VALUES (?, ?, ?, ?)`,
			[requestId, target.unit_from_type, targetCode, resumedHandlerId]
		);
		await connection.execute(
			`INSERT INTO request_sla_sessions (request_id, unit_type, unit_code, started_at, start_reason, target_sla_minutes)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP(3), 'sent', ?)`, [requestId, target.unit_from_type, targetCode,
				target.unit_from_type === 'central' ? request.sla_target_minutes ?? DEFAULT_SLA_MINUTES : DEFAULT_SLA_MINUTES]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: branch.id, action: 'branch_revision_submitted', statusFrom: 'waiting_branch_revision',
			statusTo: nextStatus, fromType: 'branch', fromCode: branch.kode_kantor,
			toType: target.unit_from_type as 'korwil' | 'central', toCode: targetCode, reason: responseText
		});
		if (resumedHandlerId !== null) {
			await notifyUser(connection, {
				recipientUserId: resumedHandlerId,
				requestId: request.id,
				historyId,
				eventType: 'revision_submitted',
				title: 'Kelengkapan dikirim kembali',
				body: `${request.request_number} · ${request.subject}`
			});
		} else {
			await notifyRequestUnit(connection, request, historyId, target.unit_from_type as NotificationUnit, targetCode,
				'revision_submitted', 'Kelengkapan masuk ke antrean unit');
		}
		await connection.commit();
		return { id: requestId, status: nextStatus, resumed_to_previous_handler: resumedHandlerId !== null };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function listCentralInbox(employeeId: string) {
	const actor = await getActiveDivisionUser(employeeId);
	const divisionId = actor.divisi_id;
	if (!divisionId) throw new RequestWorkflowError(403, 'Cakupan Divisi Pusat belum ditetapkan.');
	const [rows] = await mysqlPool.execute<RequestRow[]>(
		`${requestSelect}
		INNER JOIN master_divisi scope_division ON scope_division.id = request.central_division_id
		WHERE request.current_unit_type = 'central' AND request.current_unit_code = scope_division.kode
			AND scope_division.id = ? AND request.status IN ('waiting_central', 'in_progress_central')
		ORDER BY CASE WHEN request.status = 'waiting_central' THEN 0 ELSE 1 END, request.submitted_at ASC LIMIT 100`,
		[divisionId]
	);
	return rows.map(decorateRequest);
}

export async function listCentralHistory(employeeId: string) {
	const actor = await getActiveDivisionUser(employeeId);
	const divisionId = actor.divisi_id;
	if (!divisionId) throw new RequestWorkflowError(403, 'Cakupan Divisi Pusat belum ditetapkan.');
	const [rows] = await mysqlPool.execute<RequestRow[]>(
		`${requestSelect}
		INNER JOIN master_divisi scope_division ON scope_division.id = request.central_division_id
		WHERE scope_division.id = ?
			AND (request.current_unit_type <> 'central'
				OR request.status IN ('completed', 'rejected'))
			AND EXISTS (
				SELECT 1 FROM request_status_histories history
				WHERE history.request_id = request.id
					AND history.unit_to_type = 'central'
					AND history.unit_to_code = scope_division.kode
			)
		ORDER BY request.updated_at DESC, request.id DESC LIMIT 100`,
		[divisionId]
	);
	return rows.map(decorateRequest);
}
