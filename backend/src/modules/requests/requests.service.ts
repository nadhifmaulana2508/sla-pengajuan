import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { notifyUnitMembers, notifyUser, type NotificationUnit } from '../notifications/notifications.service.js';
import { inferKorwilFromSsoText } from '../organization/sso-scope.js';
import { resolveSlaAccessDetails } from '../auth/access.service.js';
import { DEFAULT_SLA_MINUTES, getSlaStatus, type SlaStatus } from '../../shared/sla.js';
import { parseFormDefinition, REPEATABLE_FORM_ANSWERS_KEY, validateFormAnswers, type FormDefinition, type ValidatedFormAnswers } from '../forms/form-schema.js';
import { DEFAULT_CREDIT_ROUTING_CONFIG } from '../forms/form-schema.js';
import { removePrivatePdf, storePrivatePdf, type PrivatePdfFile, type StoredPrivatePdf } from './private-attachments.js';

const CREDIT_MINIMUM_AMOUNT = 250_000_000;

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
	inoffice_letter_number: string | null; inoffice_letter_date: string | null;
	subject: string; description: string; status: string; current_unit_type: string;
	current_unit_code: string; current_owner_user_id: number | null; submitted_at: Date;
	created_by_user_id: number; created_by_name: string | null;
	active_elapsed_seconds: number | null; active_target_sla_minutes: number | null;
	overall_elapsed_seconds: number; closed_at: Date | null;
	sla_target_minutes: number | null; credit_amount?: number | string | null; sla_status?: SlaStatus;
};
export type RevisionFieldTarget = {
	kind: 'subject' | 'description' | 'inoffice_letter_number' | 'inoffice_letter_date' | 'form_field';
	key?: string;
	entry_index?: number | null;
	label: string;
	type?: FormDefinition['fields'][number]['type'];
};
export type RevisionDocumentCategory = 'inoffice_letter' | 'supporting_document';

function decodeJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string') return (value ?? fallback) as T;
	try { return JSON.parse(value) as T; } catch { return fallback; }
}

const revisionMetaLabels: Record<Exclude<RevisionFieldTarget['kind'], 'form_field'>, string> = {
	subject: 'Perihal',
	description: 'Uraian pengajuan',
	inoffice_letter_number: 'Nomor surat InOffice',
	inoffice_letter_date: 'Tanggal surat InOffice'
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
		routing_flow: 'branch_korwil_central' | 'branch_central';
		system_key: string | null; form_version_id: number | null; version_number: number | null; definition_json: unknown;
	}>>(
		`SELECT catalog.id, catalog.divisi_id, catalog.nama_pekerjaan, catalog.deskripsi,
			catalog.routing_flow, catalog.system_key, current_form.id AS form_version_id, current_form.version_number,
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
		work_catalogs: workCatalogs.map((item) => {
			const definition = parseFormDefinition(item.definition_json);
			return {
				id: Number(item.id),
				divisi_id: Number(item.divisi_id),
				nama_pekerjaan: item.nama_pekerjaan,
				deskripsi: item.deskripsi,
				routing_flow: item.routing_flow,
				target_sla_minutes: Number(item.target_sla_minutes),
				system_key: item.system_key,
				form_version_id: item.form_version_id === null ? null : Number(item.form_version_id),
				version_number: item.version_number === null ? null : Number(item.version_number),
				form_fields: definition.fields,
				form_repeatable: definition.repeatable ?? null,
				form_credit_routing: definition.credit_routing ?? null
			};
		})
	};
}

export async function submitRequest(employeeId: string, input: {
	authority_type: 'korwil' | 'central'; central_division_id: number | null;
	work_catalog_id: number | null; form_version_id?: number | null;
	form_answers?: Record<string, unknown>; subject: string; description: string;
	inoffice_letter_number?: string | null; inoffice_letter_date?: string | null; inoffice_letter?: PrivatePdfFile | null;
}) {
	const connection = await mysqlPool.getConnection();
	let storedAttachment: StoredPrivatePdf | null = null;
	try {
		await connection.beginTransaction();
		const branch = await getActiveBranch(employeeId, connection);
		let resolvedAuthority = input.authority_type;
		let resolvedDivisionId = input.central_division_id;
		let workCatalogId = input.work_catalog_id;
		let formVersionId: number | null = null;
		let formAnswers: ValidatedFormAnswers = {};
		let creditAmount: number | null = null;
		let targetSlaMinutes = DEFAULT_SLA_MINUTES;
		let catalog: (RowDataPacket & {
			id: number; divisi_id: number; target_sla_minutes: number | null; system_key: string | null;
			routing_flow: 'branch_korwil_central' | 'branch_central'; division_code: string;
			form_version_id: number | null; definition_json: unknown;
		}) | null = null;

		if (input.work_catalog_id !== null) {
			const [catalogRows] = await connection.execute<Array<RowDataPacket & {
				id: number; divisi_id: number; target_sla_minutes: number | null; system_key: string | null;
				routing_flow: 'branch_korwil_central' | 'branch_central'; division_code: string;
				form_version_id: number | null; definition_json: unknown;
			}>>(
				`SELECT catalog.id, catalog.divisi_id, division.kode AS division_code,
					catalog.target_sla_minutes, catalog.routing_flow, catalog.system_key,
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
			const validDestination = input.authority_type === 'central'
				? input.central_division_id === Number(catalog.divisi_id)
				: input.central_division_id === null;
			if (catalog.division_code !== 'pemasaran' || !validDestination) {
				throw new RequestWorkflowError(400, 'Pilih form Pengajuan Kredit dari Pemasaran. Divisi tujuan hanya diisi jika kewenangan Pusat dipilih.');
			}
			if (catalog.form_version_id === null) throw new RequestWorkflowError(409, 'Form pengajuan kredit belum diterbitkan. Hubungi Admin atau Divisi Pemasaran.');
			if (input.form_version_id !== Number(catalog.form_version_id)) throw new RequestWorkflowError(409, 'Form kredit sudah diperbarui. Muat ulang halaman lalu isi kembali.');
			const definition = parseFormDefinition(catalog.definition_json);
			let validatedAnswers: ValidatedFormAnswers;
			try {
				validatedAnswers = validateFormAnswers(definition, input.form_answers ?? {});
			} catch (error) {
				throw new RequestWorkflowError(400, error instanceof Error ? error.message : 'Periksa kembali isian form kredit.');
			}
			if (REPEATABLE_FORM_ANSWERS_KEY in validatedAnswers) {
				throw new RequestWorkflowError(409, 'Form Pengajuan Kredit tidak dapat berisi beberapa kelompok data. Muat ulang form.');
			}
			formAnswers = validatedAnswers;
			const amount = validatedAnswers.credit_amount;
			if (typeof amount !== 'number' || amount < CREDIT_MINIMUM_AMOUNT) {
				throw new RequestWorkflowError(400, 'Pengajuan kredit harus bernilai minimal Rp250.000.000.');
			}
			creditAmount = amount;
			resolvedAuthority = input.authority_type;
			resolvedDivisionId = input.authority_type === 'central' ? Number(catalog.divisi_id) : null;
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

		const initialUnitType = resolvedAuthority === 'central' && catalog?.routing_flow === 'branch_central'
			? 'central'
			: 'korwil';
		const initialUnitCode = initialUnitType === 'central' ? catalog?.division_code : branch.korwil;
		if (!initialUnitCode) throw new RequestWorkflowError(409, 'Unit tujuan pekerjaan belum dapat ditentukan. Hubungi Admin Sistem SLA.');
		const initialStatus = initialUnitType === 'central' ? 'waiting_central' : 'waiting_korwil';

		const [insert] = await connection.execute<ResultSetHeader>(
			`INSERT INTO service_requests
			(created_by_user_id, kode_kantor, korwil, authority_type, central_division_id, work_catalog_id,
			 form_version_id, form_answers_json, credit_amount, inoffice_letter_number, inoffice_letter_date,
			 subject, description, status, current_unit_type, current_unit_code)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[branch.id, branch.kode_kantor, branch.korwil, resolvedAuthority,
				resolvedDivisionId, workCatalogId, formVersionId, formVersionId === null ? null : JSON.stringify(formAnswers),
				creditAmount, input.inoffice_letter_number || null, input.inoffice_letter_date || null,
				input.subject, input.description, initialStatus, initialUnitType, initialUnitCode]
		);
		const requestId = insert.insertId;
		const requestNumber = `SLA-${String(requestId).padStart(8, '0')}`;
		await connection.execute('UPDATE service_requests SET request_number = ? WHERE id = ?', [requestNumber, requestId]);
		if (input.inoffice_letter) {
			storedAttachment = await storePrivatePdf(input.inoffice_letter);
			await connection.execute(
				`INSERT INTO request_attachments
				(request_id, category, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
				VALUES (?, 'inoffice_letter', ?, ?, ?, ?, ?, ?)`,
				[requestId, storedAttachment.storageKey, storedAttachment.originalFilename, storedAttachment.mimeType,
					storedAttachment.sizeBytes, storedAttachment.sha256, branch.id]
			);
		}
		await connection.execute(
			`INSERT INTO request_assignments (request_id, unit_type, unit_code) VALUES (?, ?, ?)`,
			[requestId, initialUnitType, initialUnitCode]
		);
		await connection.execute(
			`INSERT INTO request_sla_sessions (request_id, unit_type, unit_code, started_at, start_reason, target_sla_minutes)
			VALUES (?, ?, ?, NULL, NULL, ?)`,
			[requestId, initialUnitType, initialUnitCode, targetSlaMinutes]
		);
		const [history] = await connection.execute<ResultSetHeader>(
			`INSERT INTO request_status_histories
			(request_id, actor_user_id, action_name, status_from, status_to, unit_to_type, unit_to_code)
			VALUES (?, ?, 'submitted', NULL, ?, ?, ?)`,
			[requestId, branch.id, initialStatus, initialUnitType, initialUnitCode]
		);
		await notifyUnitMembers(connection, {
			requestId,
			historyId: history.insertId,
			unitType: initialUnitType,
			unitCode: initialUnitCode,
			eventType: 'request_received',
			title: initialUnitType === 'central' ? 'Pengajuan baru masuk ke Divisi Pusat' : 'Pengajuan baru masuk ke Korwil',
			body: `${requestNumber} · ${input.subject}`
		});
		await connection.commit();
		storedAttachment = null;
		return { id: requestId, request_number: requestNumber, routed_to: initialUnitType, unit_code: initialUnitCode };
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		if (storedAttachment) await removePrivatePdf(storedAttachment.storageKey).catch(() => undefined);
		throw error;
	} finally {
		connection.release();
	}
}

const requestSelect = `SELECT request.id, request.request_number, request.kode_kantor, office.nama_kantor,
	request.korwil, request.authority_type, request.central_division_id, division.nama_divisi,
	request.work_catalog_id, catalog.nama_pekerjaan, request.inoffice_letter_number,
	DATE_FORMAT(request.inoffice_letter_date, '%Y-%m-%d') AS inoffice_letter_date,
	request.subject, request.description,
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
	const formDefinition = parseFormDefinition(formRows[0]?.definition_json);
	const formAnswers = formDefinition.fields.flatMap((field) => {
		const value = answerValues[field.key];
		return typeof value === 'string' || typeof value === 'number'
			? [{ key: field.key, label: field.label, type: field.type, value }]
			: [];
	});
	const storedEntries = answerValues[REPEATABLE_FORM_ANSWERS_KEY];
	const formAnswerGroups = formDefinition.repeatable && Array.isArray(storedEntries)
		? storedEntries.flatMap((entry, index) => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
			const answers = formDefinition.fields.flatMap((field) => {
				const value = (entry as Record<string, unknown>)[field.key];
				return typeof value === 'string' || typeof value === 'number'
					? [{ key: field.key, label: field.label, type: field.type, value }]
					: [];
			});
			return answers.length > 0 ? [{ label: `${formDefinition.repeatable!.label} ${index + 1}`, answers }] : [];
		})
		: [];
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
	const [attachmentRows] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; category: string; revision_id: number | null; original_filename: string; mime_type: string;
		size_bytes: number; created_at: Date;
	}>>(
		`SELECT id, category, revision_id, original_filename, mime_type, size_bytes, created_at
		FROM request_attachments WHERE request_id = ? ORDER BY created_at, id`, [requestId]
	);
	const [revisionRows] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; revision_number: number; request_note: string; requested_fields_json: unknown;
		requested_documents_json: unknown; requested_at: Date;
	}>>(
		`SELECT id, revision_number, request_note, requested_fields_json, requested_documents_json, requested_at
		FROM request_revisions WHERE request_id = ? AND status = 'requested' ORDER BY id DESC LIMIT 1`, [requestId]
	);
	const revisionRequest = revisionRows[0] ? {
		id: Number(revisionRows[0].id),
		revision_number: Number(revisionRows[0].revision_number),
		note: revisionRows[0].request_note,
		fields: decodeJson<RevisionFieldTarget[]>(revisionRows[0].requested_fields_json, []),
		documents: decodeJson<RevisionDocumentCategory[]>(revisionRows[0].requested_documents_json, []),
		requested_at: revisionRows[0].requested_at
	} : null;
	const [revisionHistoryRows] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; revision_number: number; requested_by_name: string | null; response_by_name: string | null;
		request_note: string; requested_fields_json: unknown; requested_documents_json: unknown;
		snapshot_before_json: unknown; snapshot_after_json: unknown; response_note: string | null;
		status: string; requested_at: Date; submitted_at: Date | null;
	}>>(
		`SELECT revision.id, revision.revision_number, revision.request_note, revision.requested_fields_json,
			revision.requested_documents_json, revision.snapshot_before_json, revision.snapshot_after_json,
			revision.response_note, revision.status, revision.requested_at, revision.submitted_at,
			requester.full_name AS requested_by_name, responder.full_name AS response_by_name
		FROM request_revisions revision
		LEFT JOIN users requester ON requester.id = revision.requested_by_user_id
		LEFT JOIN users responder ON responder.id = revision.response_by_user_id
		WHERE revision.request_id = ? ORDER BY revision.revision_number`, [requestId]
	);
	const [decisionRows] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; unit_type: string; unit_code: string; decision_type: string; reason_label_snapshot: string | null;
		note: string; confirmation_text: string | null; attachment_id: number | null;
		created_at: Date; actor_name: string | null; attachment_filename: string | null;
	}>>(
		`SELECT decision.id, decision.unit_type, decision.unit_code, decision.decision_type, decision.reason_label_snapshot,
			decision.note, decision.confirmation_text, decision.attachment_id, decision.created_at,
			actor.full_name AS actor_name, attachment.original_filename AS attachment_filename
		FROM request_decisions decision
		INNER JOIN users actor ON actor.id = decision.actor_user_id
		LEFT JOIN request_attachments attachment ON attachment.id = decision.attachment_id
		WHERE decision.request_id = ? ORDER BY decision.created_at, decision.id`, [requestId]
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
	return {
		request: decorateRequest(request),
		form_fields: formDefinition.fields,
		form_repeatable: formDefinition.repeatable ?? null,
		form_answers: formAnswers,
		form_answer_groups: formAnswerGroups,
		revision_request: revisionRequest,
		revision_history: revisionHistoryRows.map((row) => ({
			id: Number(row.id), revision_number: Number(row.revision_number), request_note: row.request_note,
			requested_by_name: row.requested_by_name, response_by_name: row.response_by_name,
			fields: decodeJson<RevisionFieldTarget[]>(row.requested_fields_json, []),
			documents: decodeJson<RevisionDocumentCategory[]>(row.requested_documents_json, []),
			snapshot_before: decodeJson<Record<string, unknown>>(row.snapshot_before_json, {}),
			snapshot_after: row.snapshot_after_json === null ? null : decodeJson<Record<string, unknown>>(row.snapshot_after_json, {}),
			response_note: row.response_note, status: row.status, requested_at: row.requested_at, submitted_at: row.submitted_at
		})),
		decisions: decisionRows,
		attachments: attachmentRows.map((attachment) => ({
			...attachment,
			id: Number(attachment.id),
			revision_id: attachment.revision_id === null ? null : Number(attachment.revision_id),
			size_bytes: Number(attachment.size_bytes)
		})),
		sessions,
		timeline,
		capabilities
	};
}

export async function getRequestAttachmentForDownload(employeeId: string, requestId: number, attachmentId: number) {
	await getRequestDetail(employeeId, requestId);
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; storage_key: string; original_filename: string;
	}>>(
		`SELECT id, storage_key, original_filename FROM request_attachments
		WHERE request_id = ? AND id = ? LIMIT 1`,
		[requestId, attachmentId]
	);
	const attachment = rows[0];
	if (!attachment) throw new RequestWorkflowError(404, 'Lampiran tidak ditemukan.');
	return { ...attachment, id: Number(attachment.id) };
}

export async function listRequestRejectionReasons(employeeId: string, requestId: number) {
	const detail = await getRequestDetail(employeeId, requestId);
	let reasonDivisionId = detail.request.central_division_id;
	if (reasonDivisionId === null && detail.request.work_catalog_id !== null) {
		const [catalogRows] = await mysqlPool.execute<Array<RowDataPacket & { divisi_id: number }>>(
			'SELECT divisi_id FROM work_catalogs WHERE id = ? LIMIT 1', [detail.request.work_catalog_id]
		);
		reasonDivisionId = catalogRows[0] ? Number(catalogRows[0].divisi_id) : null;
	}
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number; code: string; label: string; scope_type: string }>>(
		`SELECT id, code, label, scope_type FROM rejection_reasons
		WHERE is_active = 1 AND (
			scope_type = 'system'
			OR (scope_type = 'division' AND division_id = ?)
			OR (scope_type = 'catalog' AND division_id = ? AND work_catalog_id = ?)
		)
		ORDER BY sort_order, label`,
		[reasonDivisionId, reasonDivisionId, detail.request.work_catalog_id]
	);
	return rows.map((row) => ({ id: Number(row.id), code: row.code, label: row.label, scope_type: row.scope_type }));
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
	central_division_id: number | null; catalog_division_id: number | null; work_catalog_id: number | null; inoffice_letter_number: string | null; inoffice_letter_date: string | null;
	status: string; current_unit_type: string; current_unit_code: string;
	current_owner_user_id: number | null; sla_target_minutes: number | null;
};

async function lockRequest(connection: PoolConnection, requestId: number): Promise<LockedRequest> {
	const [rows] = await connection.execute<LockedRequest[]>(
		`SELECT request.id, request.request_number, request.subject, request.kode_kantor, request.korwil,
			request.authority_type, request.central_division_id, request.work_catalog_id, request.inoffice_letter_number,
			catalog.divisi_id AS catalog_division_id,
			DATE_FORMAT(request.inoffice_letter_date, '%Y-%m-%d') AS inoffice_letter_date,
			request.status, request.current_unit_type,
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

async function resolveRejectionReason(connection: PoolConnection, request: LockedRequest, reasonId: number) {
	const reasonDivisionId = request.central_division_id ?? request.catalog_division_id;
	const [rows] = await connection.execute<Array<RowDataPacket & { id: number; scope_type: string; code: string; label: string }>>(
		`SELECT id, scope_type, code, label FROM rejection_reasons
		WHERE id = ? AND is_active = 1 AND (
			scope_type = 'system'
			OR (scope_type = 'division' AND division_id = ?)
			OR (scope_type = 'catalog' AND division_id = ? AND work_catalog_id = ?)
		) LIMIT 1`,
		[reasonId, reasonDivisionId, reasonDivisionId, request.work_catalog_id]
	);
	if (!rows[0]) throw new RequestWorkflowError(400, 'Pilih alasan penolakan yang masih aktif untuk Divisi atau jenis pekerjaan ini.');
	return rows[0];
}

async function storeRequestAttachment(connection: PoolConnection, requestId: number, actorId: number,
	category: string, file: PrivatePdfFile): Promise<{ id: number; stored: StoredPrivatePdf }> {
	const stored = await storePrivatePdf(file);
	try {
		const [result] = await connection.execute<ResultSetHeader>(
			`INSERT INTO request_attachments
				(request_id, category, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[requestId, category, stored.storageKey, stored.originalFilename, stored.mimeType, stored.sizeBytes, stored.sha256, actorId]
		);
		return { id: Number(result.insertId), stored };
	} catch (error) {
		await removePrivatePdf(stored.storageKey).catch(() => undefined);
		throw error;
	}
}

async function addDecision(connection: PoolConnection, input: {
	requestId: number; historyId: number; actorId: number; unitType: 'korwil' | 'central'; unitCode: string;
	decisionType: 'forwarded' | 'approved' | 'rejected'; note: string; confirmationText?: string | null;
	reason?: { id: number; code: string; label: string } | null; attachmentId?: number | null;
}): Promise<void> {
	await connection.execute(
		`INSERT INTO request_decisions
			(request_id, history_id, actor_user_id, unit_type, unit_code, decision_type, rejection_reason_id,
			 reason_code_snapshot, reason_label_snapshot, note, confirmation_text, attachment_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[input.requestId, input.historyId, input.actorId, input.unitType, input.unitCode, input.decisionType,
			input.reason?.id ?? null, input.reason?.code ?? null, input.reason?.label ?? null,
			input.note, input.confirmationText ?? null, input.attachmentId ?? null]
	);
}

function approvalConfirmation(request: LockedRequest, decisionType: 'forwarded' | 'approved' = 'approved'): string {
	if (decisionType === 'forwarded') return `Saya telah memeriksa dan menyetujui penerusan pengajuan ${request.request_number} ke Divisi Pusat.`;
	const letter = request.inoffice_letter_number
		? ` atas surat InOffice nomor ${request.inoffice_letter_number}${request.inoffice_letter_date ? ` tanggal ${request.inoffice_letter_date}` : ''}`
		: '';
	return `Saya menyetujui pengajuan ${request.request_number}${letter}.`;
}

async function createRevisionRequest(connection: PoolConnection, requestId: number, actorId: number,
	unitType: 'korwil' | 'central', unitCode: string, note: string,
	inputFields: Array<{ kind: string; key?: string; entry_index?: number | null }>,
	documents: RevisionDocumentCategory[]): Promise<number> {
	if (inputFields.length + documents.length === 0) throw new RequestWorkflowError(400, 'Pilih setidaknya satu kolom atau dokumen yang perlu dilengkapi.');
	if (new Set(documents).size !== documents.length) throw new RequestWorkflowError(400, 'Jenis dokumen pada daftar revisi tidak boleh berulang.');
	const [rows] = await connection.execute<Array<RowDataPacket & {
		form_version_id: number | null; form_answers_json: unknown; subject: string; description: string;
		inoffice_letter_number: string | null; inoffice_letter_date: string | null; definition_json: unknown;
	}>>(
		`SELECT request.form_version_id, request.form_answers_json, request.subject, request.description,
			request.inoffice_letter_number, DATE_FORMAT(request.inoffice_letter_date, '%Y-%m-%d') AS inoffice_letter_date,
			form_version.definition_json
		FROM service_requests request
	LEFT JOIN work_catalog_form_versions form_version ON form_version.id = request.form_version_id
		WHERE request.id = ? LIMIT 1`, [requestId]
	);
	const current = rows[0];
	if (!current) throw new RequestWorkflowError(404, 'Pengajuan tidak ditemukan.');
	const definition = parseFormDefinition(current.definition_json);
	const answers = decodeJson<Record<string, unknown>>(current.form_answers_json, {});
	const entryCount = Array.isArray(answers[REPEATABLE_FORM_ANSWERS_KEY])
		? (answers[REPEATABLE_FORM_ANSWERS_KEY] as unknown[]).length : 0;
	const fields: RevisionFieldTarget[] = [];
	const duplicateSet = new Set<string>();
	for (const item of inputFields) {
		if (item.kind !== 'form_field') {
			if (!(item.kind in revisionMetaLabels)) throw new RequestWorkflowError(400, 'Kolom revisi tidak dikenal.');
			const kind = item.kind as Exclude<RevisionFieldTarget['kind'], 'form_field'>;
			const signature = `${kind}:`;
			if (duplicateSet.has(signature)) throw new RequestWorkflowError(400, 'Kolom revisi tidak boleh dipilih berulang.');
			duplicateSet.add(signature);
			fields.push({ kind, label: revisionMetaLabels[kind] });
			continue;
		}
		const field = definition.fields.find((candidate) => candidate.key === item.key);
		if (!field) throw new RequestWorkflowError(400, 'Kolom form yang dipilih sudah tidak tersedia.');
		const entryIndex = definition.repeatable ? item.entry_index : null;
		if (definition.repeatable && (!Number.isInteger(entryIndex) || entryIndex! < 0 || entryIndex! >= entryCount)) {
			throw new RequestWorkflowError(400, 'Baris data yang dipilih untuk revisi tidak valid.');
		}
		if (!definition.repeatable && item.entry_index !== undefined && item.entry_index !== null) {
			throw new RequestWorkflowError(400, 'Kolom form ini tidak memiliki baris berulang.');
		}
		const signature = `form_field:${field.key}:${entryIndex ?? 'single'}`;
		if (duplicateSet.has(signature)) throw new RequestWorkflowError(400, 'Kolom revisi tidak boleh dipilih berulang.');
		duplicateSet.add(signature);
		fields.push({ kind: 'form_field', key: field.key, entry_index: entryIndex, label: field.label, type: field.type });
	}
	const [numbers] = await connection.execute<Array<RowDataPacket & { next_number: number }>>(
		'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_number FROM request_revisions WHERE request_id = ?', [requestId]
	);
	const snapshotBefore = {
		form_version_id: current.form_version_id === null ? null : Number(current.form_version_id),
		form_answers: answers,
		subject: current.subject,
		description: current.description,
		inoffice_letter_number: current.inoffice_letter_number,
		inoffice_letter_date: current.inoffice_letter_date
	};
	const [insert] = await connection.execute<ResultSetHeader>(
		`INSERT INTO request_revisions
			(request_id, revision_number, requested_by_user_id, requesting_unit_type, requesting_unit_code,
			 request_note, requested_fields_json, requested_documents_json, snapshot_before_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[requestId, Number(numbers[0]?.next_number ?? 1), actorId, unitType, unitCode, note,
			JSON.stringify(fields), JSON.stringify(documents), JSON.stringify(snapshotBefore)]
	);
	return Number(insert.insertId);
}

export async function returnKorwilRequestForDocuments(employeeId: string, requestId: number, input: {
	note: string; fields: Array<{ kind: string; key?: string; entry_index?: number | null }>;
	documents: RevisionDocumentCategory[];
}) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		const actor = await getKorwilUser(employeeId, request.korwil, connection);
		if (request.status !== 'in_progress_korwil' || request.current_unit_type !== 'korwil' || request.current_owner_user_id !== actor.id) {
			throw new RequestWorkflowError(409, 'Ambil dan miliki pengajuan ini sebelum meminta kelengkapan.');
		}
		await createRevisionRequest(connection, requestId, actor.id, 'korwil', request.korwil, input.note, input.fields, input.documents);
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
			toType: 'branch', toCode: request.kode_kantor, reason: input.note
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

export async function forwardKorwilRequestToCentral(employeeId: string, requestId: number, reason: string, options: {
	approvalConfirmed: boolean; beritaAcara?: PrivatePdfFile | null;
} = { approvalConfirmed: false }) {
	const connection = await mysqlPool.getConnection();
	let storedAttachment: StoredPrivatePdf | null = null;
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
		if (!options.approvalConfirmed) throw new RequestWorkflowError(400, 'Konfirmasikan pemeriksaan sebelum meneruskan pengajuan ke Divisi Pusat.');
		const [divisions] = await connection.execute<Array<RowDataPacket & { kode: string }>>(
			'SELECT kode FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1', [request.central_division_id]
		);
		const divisionCode = divisions[0]?.kode;
		if (!divisionCode) throw new RequestWorkflowError(409, 'Divisi tujuan tidak aktif. Hubungi Admin Sistem SLA.');
		let attachmentId: number | null = null;
		if (options.beritaAcara) {
			const attachment = await storeRequestAttachment(connection, requestId, actor.id, 'berita_acara', options.beritaAcara);
			attachmentId = attachment.id;
			storedAttachment = attachment.stored;
		}
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
		await addDecision(connection, {
			requestId, historyId, actorId: actor.id, unitType: 'korwil', unitCode: request.korwil, decisionType: 'forwarded', note: reason,
			confirmationText: approvalConfirmation(request, 'forwarded'), attachmentId
		});
		await notifyRequestUnit(connection, request, historyId, 'central', divisionCode,
			'request_forwarded', 'Pengajuan masuk ke Divisi Pusat');
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			'request_forwarded', 'Pengajuan diteruskan ke Divisi Pusat');
		await connection.commit();
		storedAttachment = null;
		return { id: requestId, status: 'waiting_central' };
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		if (storedAttachment) await removePrivatePdf(storedAttachment.storageKey).catch(() => undefined);
		throw error;
	} finally { connection.release(); }
}

export async function finishKorwilRequest(employeeId: string, requestId: number, outcome: 'completed' | 'rejected', reason: string, options: {
	approvalConfirmed?: boolean; rejectionReasonId?: number; beritaAcara?: PrivatePdfFile | null;
} = {}) {
	const connection = await mysqlPool.getConnection();
	let storedAttachment: StoredPrivatePdf | null = null;
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
		if (outcome === 'completed' && !options.approvalConfirmed) throw new RequestWorkflowError(400, 'Konfirmasikan persetujuan sebelum menyelesaikan pengajuan.');
		const rejectionReason = outcome === 'rejected'
			? options.rejectionReasonId ? await resolveRejectionReason(connection, request, options.rejectionReasonId) : null
			: null;
		if (outcome === 'rejected' && !rejectionReason) throw new RequestWorkflowError(400, 'Pilih alasan penolakan dari daftar.');
		let attachmentId: number | null = null;
		if (outcome === 'completed' && options.beritaAcara) {
			const attachment = await storeRequestAttachment(connection, requestId, actor.id, 'berita_acara', options.beritaAcara);
			attachmentId = attachment.id;
			storedAttachment = attachment.stored;
		}
		await closeActiveSession(connection, requestId, outcome);
		await releaseActiveAssignment(connection, requestId);
		await connection.execute(
			`UPDATE service_requests SET status = ?, current_owner_user_id = NULL, closed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
			[outcome, requestId]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: outcome, statusFrom: 'in_progress_korwil', statusTo: outcome,
			fromType: 'korwil', fromCode: request.korwil, toType: 'korwil', toCode: request.korwil,
			reason
		});
		await addDecision(connection, {
			requestId, historyId, actorId: actor.id, unitType: 'korwil', unitCode: request.korwil,
			decisionType: outcome === 'completed' ? 'approved' : 'rejected', note: reason,
			confirmationText: outcome === 'completed' ? approvalConfirmation(request) : null,
			reason: rejectionReason ? { id: Number(rejectionReason.id), code: rejectionReason.code, label: rejectionReason.label } : null,
			attachmentId
		});
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			outcome === 'completed' ? 'request_completed' : 'request_rejected',
			outcome === 'completed' ? 'Pengajuan selesai' : 'Pengajuan ditolak');
		await connection.commit();
		storedAttachment = null;
		return { id: requestId, status: outcome };
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		if (storedAttachment) await removePrivatePdf(storedAttachment.storageKey).catch(() => undefined);
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

export async function returnCentralRequestForDocuments(employeeId: string, requestId: number, input: {
	note: string; fields: Array<{ kind: string; key?: string; entry_index?: number | null }>;
	documents: RevisionDocumentCategory[];
}) {
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
		await createRevisionRequest(connection, requestId, actor.id, 'central', divisionCode!, input.note, input.fields, input.documents);
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
			toType: 'branch', toCode: request.kode_kantor, reason: input.note
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

export async function finishCentralRequest(employeeId: string, requestId: number, outcome: 'completed' | 'rejected', reason: string, options: {
	approvalConfirmed?: boolean; rejectionReasonId?: number; beritaAcara?: PrivatePdfFile | null;
} = {}) {
	const connection = await mysqlPool.getConnection();
	let storedAttachment: StoredPrivatePdf | null = null;
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
		if (outcome === 'completed' && !options.approvalConfirmed) throw new RequestWorkflowError(400, 'Konfirmasikan persetujuan sebelum menyelesaikan pengajuan.');
		const rejectionReason = outcome === 'rejected'
			? options.rejectionReasonId ? await resolveRejectionReason(connection, request, options.rejectionReasonId) : null
			: null;
		if (outcome === 'rejected' && !rejectionReason) throw new RequestWorkflowError(400, 'Pilih alasan penolakan dari daftar.');
		let attachmentId: number | null = null;
		if (outcome === 'completed' && options.beritaAcara) {
			const attachment = await storeRequestAttachment(connection, requestId, actor.id, 'berita_acara', options.beritaAcara);
			attachmentId = attachment.id;
			storedAttachment = attachment.stored;
		}
		await closeActiveSession(connection, requestId, outcome);
		await releaseActiveAssignment(connection, requestId);
		await connection.execute(
			`UPDATE service_requests SET status = ?, current_owner_user_id = NULL, closed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
			[outcome, requestId]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: actor.id, action: outcome, statusFrom: 'in_progress_central', statusTo: outcome,
			fromType: 'central', fromCode: divisionCode!, toType: 'central', toCode: divisionCode!,
			reason
		});
		await addDecision(connection, {
			requestId, historyId, actorId: actor.id, unitType: 'central', unitCode: divisionCode!,
			decisionType: outcome === 'completed' ? 'approved' : 'rejected', note: reason,
			confirmationText: outcome === 'completed' ? approvalConfirmation(request) : null,
			reason: rejectionReason ? { id: Number(rejectionReason.id), code: rejectionReason.code, label: rejectionReason.label } : null,
			attachmentId
		});
		await notifyRequestUnit(connection, request, historyId, 'branch', request.kode_kantor,
			outcome === 'completed' ? 'request_completed' : 'request_rejected',
			outcome === 'completed' ? 'Pengajuan selesai' : 'Pengajuan ditolak');
		await connection.commit();
		storedAttachment = null;
		return { id: requestId, status: outcome };
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		if (storedAttachment) await removePrivatePdf(storedAttachment.storageKey).catch(() => undefined);
		throw error;
	} finally { connection.release(); }
}

async function submitBranchRevisionTextOnly(employeeId: string, requestId: number, responseText: string) {
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
		return { id: requestId, status: nextStatus, resumed_to_previous_handler: resumedHandlerId !== null, returned_to_korwil: false };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally { connection.release(); }
}

export async function submitBranchRevision(employeeId: string, requestId: number, input: {
	response: string;
	updates: Array<{ kind: string; key?: string; entry_index?: number | null; value: unknown }>;
	files: Partial<Record<RevisionDocumentCategory, PrivatePdfFile>>;
}) {
	const [pendingRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		`SELECT id FROM request_revisions WHERE request_id = ? AND status = 'requested' ORDER BY id DESC LIMIT 1`, [requestId]
	);
	if (!pendingRows[0]) {
		if (input.updates.length || Object.keys(input.files).length) throw new RequestWorkflowError(409, 'Permintaan revisi terstruktur tidak ditemukan.');
		return submitBranchRevisionTextOnly(employeeId, requestId, input.response);
	}
	const connection = await mysqlPool.getConnection();
	const storedAttachments: StoredPrivatePdf[] = [];
	try {
		await connection.beginTransaction();
		const request = await lockRequest(connection, requestId);
		const branch = await getActiveBranch(employeeId, connection);
		if (request.status !== 'waiting_branch_revision' || request.current_unit_type !== 'branch' ||
			request.kode_kantor !== branch.kode_kantor || request.current_unit_code !== branch.kode_kantor) {
			throw new RequestWorkflowError(409, 'Pengajuan ini tidak sedang menunggu kelengkapan dari kantor Cabang kamu.');
		}
		const [revisionRows] = await connection.execute<Array<RowDataPacket & {
			id: number; requested_by_user_id: number; requesting_unit_type: string; requesting_unit_code: string;
			requested_fields_json: unknown; requested_documents_json: unknown;
		}>>(
			`SELECT id, requested_by_user_id, requesting_unit_type, requesting_unit_code,
				requested_fields_json, requested_documents_json
			FROM request_revisions WHERE request_id = ? AND status = 'requested' ORDER BY id DESC LIMIT 1 FOR UPDATE`, [requestId]
		);
		const revision = revisionRows[0];
		if (!revision || !['korwil', 'central'].includes(revision.requesting_unit_type)) throw new RequestWorkflowError(409, 'Permintaan revisi sudah berubah. Muat ulang tiket.');
		const [currentRows] = await connection.execute<Array<RowDataPacket & {
			form_version_id: number | null; form_answers_json: unknown; subject: string; description: string;
			inoffice_letter_number: string | null; inoffice_letter_date: string | null; definition_json: unknown;
		}>>(
			`SELECT request.form_version_id, request.form_answers_json, request.subject, request.description,
				request.inoffice_letter_number, DATE_FORMAT(request.inoffice_letter_date, '%Y-%m-%d') AS inoffice_letter_date,
				form_version.definition_json
			FROM service_requests request
			LEFT JOIN work_catalog_form_versions form_version ON form_version.id = request.form_version_id
			WHERE request.id = ? LIMIT 1`, [requestId]
		);
		const current = currentRows[0];
		if (!current) throw new RequestWorkflowError(404, 'Pengajuan tidak ditemukan.');
		const definition = parseFormDefinition(current.definition_json);
		const previousAnswers = decodeJson<Record<string, unknown>>(current.form_answers_json, {});
		let nextAnswers = JSON.parse(JSON.stringify(previousAnswers)) as Record<string, unknown>;
		let nextSubject = current.subject;
		let nextDescription = current.description;
		let nextLetterNumber = current.inoffice_letter_number;
		let nextLetterDate = current.inoffice_letter_date;
		const requestedFields = decodeJson<RevisionFieldTarget[]>(revision.requested_fields_json, []);
		const requestedDocuments = decodeJson<RevisionDocumentCategory[]>(revision.requested_documents_json, []);
		const allowed = new Map(requestedFields.map((field) => [
			`${field.kind}:${field.key ?? ''}:${field.entry_index ?? 'single'}`, field
		]));
		const received = new Set<string>();
		let substantiveChange = false;
		for (const update of input.updates) {
			const signature = `${update.kind}:${update.key ?? ''}:${update.entry_index ?? 'single'}`;
			const target = allowed.get(signature);
			if (!target || received.has(signature)) throw new RequestWorkflowError(400, 'Isian revisi memuat kolom yang tidak diminta atau berulang.');
			received.add(signature);
			if (target.kind === 'subject') {
				if (typeof update.value !== 'string' || update.value.trim().length < 3 || update.value.trim().length > 200) throw new RequestWorkflowError(400, 'Perihal harus berisi 3 sampai 200 karakter.');
				const normalized = update.value.trim();
				if (normalized !== current.subject) substantiveChange = true;
				nextSubject = normalized;
			} else if (target.kind === 'description') {
				if (typeof update.value !== 'string' || update.value.trim().length < 3 || update.value.trim().length > 5000) throw new RequestWorkflowError(400, 'Uraian harus berisi 3 sampai 5.000 karakter.');
				const normalized = update.value.trim();
				if (normalized !== current.description) substantiveChange = true;
				nextDescription = normalized;
			} else if (target.kind === 'inoffice_letter_number') {
				if (typeof update.value !== 'string' || update.value.trim().length < 1 || update.value.trim().length > 100) throw new RequestWorkflowError(400, 'Nomor surat InOffice harus diisi dan maksimal 100 karakter.');
				nextLetterNumber = update.value.trim();
			} else if (target.kind === 'inoffice_letter_date') {
				if (typeof update.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(update.value)) throw new RequestWorkflowError(400, 'Tanggal surat InOffice belum valid.');
				const [year, month, day] = update.value.split('-').map(Number);
				const parsedDate = new Date(Date.UTC(year!, month! - 1, day!));
				if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month! - 1 || parsedDate.getUTCDate() !== day) throw new RequestWorkflowError(400, 'Tanggal surat InOffice belum valid.');
				nextLetterDate = update.value;
			} else if (target.kind === 'form_field') {
				const field = definition.fields.find((candidate) => candidate.key === target.key);
				if (!field) throw new RequestWorkflowError(409, 'Kolom form pada tiket tidak ditemukan.');
				let previousValue: unknown;
				if (definition.repeatable) {
					const entries = Array.isArray(nextAnswers[REPEATABLE_FORM_ANSWERS_KEY])
						? [...nextAnswers[REPEATABLE_FORM_ANSWERS_KEY] as Record<string, unknown>[]] : [];
					const entryIndex = target.entry_index;
					if (!Number.isInteger(entryIndex) || entryIndex! < 0 || entryIndex! >= entries.length) throw new RequestWorkflowError(409, 'Baris data yang diminta untuk revisi sudah tidak tersedia.');
					previousValue = entries[entryIndex!]?.[field.key];
					entries[entryIndex!] = { ...(entries[entryIndex!] ?? {}), [field.key]: update.value };
					nextAnswers[REPEATABLE_FORM_ANSWERS_KEY] = entries;
				} else {
					previousValue = previousAnswers[field.key];
					nextAnswers[field.key] = update.value;
				}
				const normalizeComparable = (value: unknown): string => value === undefined || value === null ? '' : String(value).trim();
				const nextComparable = normalizeComparable(update.value);
				const previousComparable = normalizeComparable(previousValue);
				const changed = field.type === 'number' || field.type === 'currency'
					? (nextComparable === '' || previousComparable === ''
						? nextComparable !== previousComparable
						: Number(nextComparable) !== Number(previousComparable))
					: nextComparable !== previousComparable;
				if (changed && (field.requires_korwil_review || field.key === 'credit_amount')) substantiveChange = true;
			} else throw new RequestWorkflowError(400, 'Jenis kolom revisi tidak dikenal.');
		}
		if (received.size !== allowed.size) throw new RequestWorkflowError(400, 'Lengkapi semua kolom yang diminta sebelum mengirim revisi.');
		for (const category of requestedDocuments) {
			if (!input.files[category]) throw new RequestWorkflowError(400, `Unggah dokumen ${category === 'inoffice_letter' ? 'surat InOffice' : 'pendukung'} yang diminta.`);
		}
		for (const category of Object.keys(input.files)) {
			if (!requestedDocuments.includes(category as RevisionDocumentCategory)) throw new RequestWorkflowError(400, 'Ada dokumen yang tidak diminta pada putaran revisi ini.');
		}
		try { nextAnswers = validateFormAnswers(definition, nextAnswers) as Record<string, unknown>; }
		catch (error) { throw new RequestWorkflowError(400, error instanceof Error ? error.message : 'Periksa kembali isian form.'); }
		const targetType = substantiveChange ? 'korwil' : revision.requesting_unit_type as 'korwil' | 'central';
		let targetCode = substantiveChange ? request.korwil : revision.requesting_unit_code;
		if (targetType === 'central') {
			const [divisions] = await connection.execute<Array<RowDataPacket & { kode: string }>>(
				'SELECT kode FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1', [request.central_division_id]
			);
			if (!divisions[0] || divisions[0].kode !== targetCode) throw new RequestWorkflowError(409, 'Divisi yang meminta kelengkapan tidak lagi cocok dengan tujuan pengajuan.');
			targetCode = divisions[0].kode;
		}
		let previousHandlerId: number | null = Number(revision.requested_by_user_id);
		if (substantiveChange) {
			const [assignments] = await connection.execute<Array<RowDataPacket & { assigned_user_id: number | null }>>(
				`SELECT assigned_user_id FROM request_assignments WHERE request_id = ? AND unit_type = 'korwil'
					AND released_at IS NOT NULL AND assigned_user_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [requestId]
			);
			previousHandlerId = assignments[0]?.assigned_user_id ?? null;
		}
		const resumedHandlerId = previousHandlerId === null ? null : await findResumableHandler(
			connection, requestId, targetType, targetCode, previousHandlerId, request.central_division_id
		);
		for (const category of Object.keys(input.files) as RevisionDocumentCategory[]) {
			const file = input.files[category];
			if (!file) continue;
			const stored = await storePrivatePdf(file);
			storedAttachments.push(stored);
			await connection.execute(
				`INSERT INTO request_attachments
					(request_id, revision_id, category, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[requestId, revision.id, category, stored.storageKey, stored.originalFilename, stored.mimeType, stored.sizeBytes, stored.sha256, branch.id]
			);
		}
		const snapshotAfter = {
			form_version_id: current.form_version_id === null ? null : Number(current.form_version_id), form_answers: nextAnswers,
			subject: nextSubject, description: nextDescription, inoffice_letter_number: nextLetterNumber,
			inoffice_letter_date: nextLetterDate
		};
		await connection.execute(
			`UPDATE service_requests SET form_answers_json = ?, subject = ?, description = ?,
				inoffice_letter_number = ?, inoffice_letter_date = ?,
				credit_amount = CASE WHEN ? IS NULL THEN credit_amount ELSE ? END WHERE id = ?`,
			[JSON.stringify(nextAnswers), nextSubject, nextDescription, nextLetterNumber, nextLetterDate,
				substantiveChange ? Number(nextAnswers.credit_amount) : null,
				substantiveChange ? Number(nextAnswers.credit_amount) : null, requestId]
		);
		await connection.execute(
			`UPDATE request_revisions SET status = 'submitted', response_note = ?, response_by_user_id = ?,
				snapshot_after_json = ?, submitted_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'requested'`,
			[input.response, branch.id, JSON.stringify(snapshotAfter), revision.id]
		);
		await closeActiveSession(connection, requestId, 'documents_submitted');
		await releaseActiveAssignment(connection, requestId);
		const nextStatus = targetType === 'korwil'
			? resumedHandlerId === null ? 'waiting_korwil' : 'in_progress_korwil'
			: resumedHandlerId === null ? 'waiting_central' : 'in_progress_central';
		await connection.execute(
			`UPDATE service_requests SET status = ?, current_unit_type = ?, current_unit_code = ?, current_owner_user_id = ?, closed_at = NULL WHERE id = ?`,
			[nextStatus, targetType, targetCode, resumedHandlerId, requestId]
		);
		await connection.execute(
			`INSERT INTO request_assignments (request_id, unit_type, unit_code, assigned_user_id) VALUES (?, ?, ?, ?)`,
			[requestId, targetType, targetCode, resumedHandlerId]
		);
		await connection.execute(
			`INSERT INTO request_sla_sessions (request_id, unit_type, unit_code, started_at, start_reason, target_sla_minutes)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP(3), 'sent', ?)`, [requestId, targetType, targetCode,
				targetType === 'central' ? request.sla_target_minutes ?? DEFAULT_SLA_MINUTES : DEFAULT_SLA_MINUTES]
		);
		const historyId = await addHistory(connection, {
			requestId, actorId: branch.id, action: substantiveChange ? 'branch_substantive_revision_submitted' : 'branch_revision_submitted',
			statusFrom: 'waiting_branch_revision', statusTo: nextStatus, fromType: 'branch', fromCode: branch.kode_kantor,
			toType: targetType, toCode: targetCode, reason: input.response
		});
		if (resumedHandlerId !== null) await notifyUser(connection, {
			recipientUserId: resumedHandlerId, requestId: request.id, historyId, eventType: 'revision_submitted',
			title: substantiveChange ? 'Perubahan substansi perlu diperiksa Korwil' : 'Kelengkapan dikirim kembali',
			body: `${request.request_number} Â· ${request.subject}`
		});
		else await notifyRequestUnit(connection, request, historyId, targetType, targetCode, 'revision_submitted',
			substantiveChange ? 'Perubahan substansi masuk ke antrean Korwil' : 'Kelengkapan masuk ke antrean unit');
		await connection.commit();
		return { id: requestId, status: nextStatus, resumed_to_previous_handler: resumedHandlerId !== null, returned_to_korwil: substantiveChange };
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		for (const attachment of storedAttachments) await removePrivatePdf(attachment.storageKey).catch(() => undefined);
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
