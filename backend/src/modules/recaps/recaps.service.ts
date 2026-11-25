import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { resolveSlaAccessDetails } from '../auth/access.service.js';
import { parseFormDefinition, REPEATABLE_FORM_ANSWERS_KEY, type FormAnswerRow, type FormFieldDefinition } from '../forms/form-schema.js';

export class RecapError extends Error {
	constructor(public readonly statusCode: number, message: string) { super(message); }
}

export type TrackingField = {
	key: string;
	label: string;
	type: 'text' | 'number' | 'date' | 'select';
	options?: string[];
	editable_by_branch: boolean;
};

type SourceField = Pick<FormFieldDefinition, 'key' | 'label' | 'type'>;
type Access = { role: 'branch_user' | 'division_staff'; userId: number; divisionId: number | null; divisionCode: string | null; officeCode: string | null };
type SourceTicket = RowDataPacket & {
	id: number; request_number: string; subject: string; status: string; kode_kantor: string; nama_kantor: string;
	work_catalog_id: number; nama_pekerjaan: string; submitted_at: Date; form_version_id: number; definition_json: unknown; form_answers_json: unknown;
};
type RecapRow = RowDataPacket & {
	id: number; recap_id: number; source_request_id: number; request_number: string; subject: string;
	status: string; nama_pekerjaan: string; kode_kantor: string; nama_kantor: string; form_entry_index: number | null;
	source_values_json: unknown; tracking_values_json: unknown; created_at: Date; updated_at: Date;
};

function decodeJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string') return (value ?? fallback) as T;
	try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function resolveAccess(employeeId: string): Promise<Access> {
	const resolved = await resolveSlaAccessDetails(employeeId);
	if (!resolved.access.enabled || !resolved.assignment || !['branch_user', 'division_staff'].includes(resolved.access.role ?? '')) {
		throw new RecapError(403, 'Fitur Rekap hanya tersedia untuk petugas Divisi dan pengguna Cabang.');
	}
	const [users] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM users WHERE employee_id = ? AND is_active = 1 LIMIT 1', [employeeId]
	);
	if (!users[0]) throw new RecapError(403, 'Akun aktif Sistem SLA belum ditemukan.');
	if (resolved.access.role === 'division_staff') {
		const divisionId = resolved.assignment.divisiId;
		if (resolved.assignment.scopeType !== 'division' || !divisionId) throw new RecapError(403, 'Cakupan Divisi belum ditetapkan.');
		const [divisions] = await mysqlPool.execute<Array<RowDataPacket & { kode: string }>>(
			'SELECT kode FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1', [divisionId]
		);
		if (!divisions[0]) throw new RecapError(403, 'Divisi aktif pada akun tidak ditemukan.');
		return { role: 'division_staff', userId: Number(users[0].id), divisionId, divisionCode: divisions[0].kode, officeCode: null };
	}
	const officeCode = resolved.assignment.kodeKantor;
	if (resolved.assignment.scopeType !== 'office' || !officeCode || officeCode === '000') throw new RecapError(403, 'Cakupan kantor Cabang belum ditetapkan.');
	return { role: 'branch_user', userId: Number(users[0].id), divisionId: null, divisionCode: null, officeCode };
}

async function loadEligibleSources(access: Access, catalogId: number | null, connection: PoolConnection | typeof mysqlPool = mysqlPool, lock = false, requestIds?: number[]): Promise<SourceTicket[]> {
	if (access.role !== 'division_staff' || access.divisionId === null || access.divisionCode === null) {
		throw new RecapError(403, 'Hanya Divisi yang dapat memilih sumber rekap.');
	}
	const requestFilter = requestIds?.length ? `AND request.id IN (${requestIds.map(() => '?').join(',')})` : '';
	const [rows] = await connection.execute<SourceTicket[]>(
		`SELECT request.id, request.request_number, request.subject, request.status, request.kode_kantor,
			catalog.id AS work_catalog_id, catalog.nama_pekerjaan, office.nama_kantor, request.submitted_at,
			request.form_version_id, form_version.definition_json,
			request.form_answers_json
		FROM service_requests request
		INNER JOIN master_kantor office ON office.kode_kantor = request.kode_kantor
		INNER JOIN work_catalogs catalog ON catalog.id = request.work_catalog_id AND catalog.divisi_id = ?
		INNER JOIN work_catalog_form_versions form_version ON form_version.id = request.form_version_id
		WHERE request.central_division_id = ? AND request.status <> 'rejected'
			AND EXISTS (
				SELECT 1 FROM request_status_histories history
				WHERE history.request_id = request.id AND history.unit_to_type = 'central' AND history.unit_to_code = ?
			)
			${catalogId === null ? '' : 'AND request.work_catalog_id = ?'}
			${requestFilter}
		ORDER BY request.submitted_at DESC, request.id DESC${lock ? ' FOR UPDATE' : ''}`,
		[access.divisionId,
			access.divisionId, access.divisionCode, ...(catalogId === null ? [] : [catalogId]), ...(requestIds ?? [])]
	);
	return rows;
}

async function loadAssignedSourceIds(
	connection: PoolConnection | typeof mysqlPool = mysqlPool,
	requestIds?: number[],
	lock = false
): Promise<Set<number>> {
	const requestFilter = requestIds?.length ? `WHERE source_request_id IN (${requestIds.map(() => '?').join(',')})` : '';
	const [rows] = await connection.execute<Array<RowDataPacket & { source_request_id: number }>>(
		`SELECT source_request_id FROM request_recap_rows ${requestFilter}${lock ? ' FOR UPDATE' : ''}`,
		requestIds ?? []
	);
	return new Set(rows.map((row) => Number(row.source_request_id)));
}

function getTicketFields(ticket: SourceTicket): SourceField[] {
	return parseFormDefinition(ticket.definition_json).fields.map(({ key, label, type }) => ({ key, label, type }));
}

function templateSignature(value: unknown): string | null {
	const definition = parseFormDefinition(value);
	return definition.fields.length ? JSON.stringify(definition) : null;
}

async function loadCatalogTemplates(access: Access, connection: PoolConnection | typeof mysqlPool = mysqlPool) {
	if (access.role !== 'division_staff' || access.divisionId === null) throw new RecapError(403, 'Hanya Divisi yang dapat menyusun rekap.');
	const [rows] = await connection.execute<Array<RowDataPacket & { id: number; nama_pekerjaan: string; definition_json: unknown }>>(
		`SELECT catalog.id, catalog.nama_pekerjaan, current_form.definition_json
		FROM work_catalogs catalog
		INNER JOIN work_catalog_form_versions current_form ON current_form.id = (
			SELECT form_version.id FROM work_catalog_form_versions form_version
			WHERE form_version.work_catalog_id = catalog.id ORDER BY form_version.version_number DESC LIMIT 1
		)
		WHERE catalog.divisi_id = ? ORDER BY catalog.nama_pekerjaan`, [access.divisionId]
	);
	return rows.map((row) => ({ ...row, id: Number(row.id), signature: templateSignature(row.definition_json) }))
		.filter((row): row is typeof row & { signature: string } => row.signature !== null);
}

function sourceTicketSummary(ticket: SourceTicket) {
	return {
		id: Number(ticket.id), request_number: ticket.request_number, subject: ticket.subject,
		status: ticket.status, work_catalog_id: Number(ticket.work_catalog_id), nama_pekerjaan: ticket.nama_pekerjaan,
		kode_kantor: ticket.kode_kantor, nama_kantor: ticket.nama_kantor,
		submitted_at: ticket.submitted_at, entry_count: ticketEntryCount(ticket),
		field_keys: getTicketFields(ticket).map((field) => field.key)
	};
}

async function loadRecapTemplate(access: Access, recapId: number, connection: PoolConnection | typeof mysqlPool = mysqlPool, lock = false) {
	if (access.role !== 'division_staff' || access.divisionId === null || access.divisionCode === null) throw new RecapError(403, 'Hanya Divisi yang dapat menambahkan tiket ke rekap.');
	const [recaps] = await connection.execute<Array<RowDataPacket & {
		id: number; division_id: number; status: 'published' | 'archived'; division_code: string;
		source_fields_json: unknown;
	}>>(
		`SELECT recap.id, recap.division_id, recap.status, division.kode AS division_code, recap.source_fields_json
		FROM request_recaps recap INNER JOIN master_divisi division ON division.id = recap.division_id
		WHERE recap.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [recapId]
	);
	const recap = recaps[0];
	if (!recap) throw new RecapError(404, 'Rekap tidak ditemukan.');
	if (Number(recap.division_id) !== access.divisionId || recap.division_code !== access.divisionCode) throw new RecapError(403, 'Rekap berada di luar cakupan Divisi kamu.');
	if (recap.status !== 'published') throw new RecapError(409, 'Rekap yang sudah diarsipkan tidak dapat ditambah tiket.');
	const [anchors] = await connection.execute<Array<RowDataPacket & { definition_json: unknown }>>(
		`SELECT form_version.definition_json FROM request_recap_rows recap_row
		INNER JOIN service_requests request ON request.id = recap_row.source_request_id
		INNER JOIN work_catalog_form_versions form_version ON form_version.id = request.form_version_id
		WHERE recap_row.recap_id = ? ORDER BY recap_row.id ASC LIMIT 1`, [recapId]
	);
	const signature = templateSignature(anchors[0]?.definition_json);
	if (!signature) throw new RecapError(409, 'Form sumber rekap tidak memiliki template yang valid.');
	return { recap, signature, sourceFields: decodeJson<SourceField[]>(recap.source_fields_json, []) };
}

function ticketEntryCount(ticket: SourceTicket): number {
	const definition = parseFormDefinition(ticket.definition_json);
	const answers = decodeJson<Record<string, unknown>>(ticket.form_answers_json, {});
	if (!definition.repeatable) return 1;
	const entries = answers[REPEATABLE_FORM_ANSWERS_KEY];
	return Array.isArray(entries) ? entries.length : 0;
}

export async function listRecaps(employeeId: string) {
	const access = await resolveAccess(employeeId);
	const branchFilter = access.role === 'branch_user';
	const scopeId = branchFilter ? access.officeCode : access.divisionId;
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; title: string; status: string; nama_pekerjaan: string; nama_divisi: string;
		created_at: Date; published_at: Date; row_count: number; pending_count: number; work_catalog_count: number;
	}>>(
		`SELECT recap.id, recap.title, recap.status, catalog.nama_pekerjaan, division.nama_divisi,
			recap.created_at, recap.published_at,
			(SELECT COUNT(*) FROM request_recap_rows recap_row WHERE recap_row.recap_id = recap.id${branchFilter ? ' AND recap_row.kode_kantor = ?' : ''}) AS row_count,
			(SELECT COUNT(DISTINCT source_request.work_catalog_id) FROM request_recap_rows recap_row
				INNER JOIN service_requests source_request ON source_request.id = recap_row.source_request_id
				WHERE recap_row.recap_id = recap.id${branchFilter ? ' AND recap_row.kode_kantor = ?' : ''}) AS work_catalog_count,
			(SELECT COUNT(*) FROM request_recap_proposals proposal
				INNER JOIN request_recap_rows recap_row ON recap_row.id = proposal.recap_row_id
				WHERE recap_row.recap_id = recap.id AND proposal.status = 'pending'${branchFilter ? ' AND recap_row.kode_kantor = ?' : ''}) AS pending_count
		FROM request_recaps recap
		INNER JOIN work_catalogs catalog ON catalog.id = recap.work_catalog_id
		INNER JOIN master_divisi division ON division.id = recap.division_id
		WHERE ${branchFilter ? "recap.status = 'published' AND EXISTS (SELECT 1 FROM request_recap_rows own_row WHERE own_row.recap_id = recap.id AND own_row.kode_kantor = ?)" : 'recap.division_id = ?'}
		ORDER BY recap.created_at DESC, recap.id DESC`,
		branchFilter ? [scopeId, scopeId, scopeId, scopeId] : [scopeId]
	);
	return { recaps: rows.map((row) => ({ ...row, id: Number(row.id), row_count: Number(row.row_count), pending_count: Number(row.pending_count), work_catalog_count: Number(row.work_catalog_count) })) };
}

export async function listRecapCatalogs(employeeId: string) {
	const access = await resolveAccess(employeeId);
	if (access.role !== 'division_staff' || !access.divisionId || !access.divisionCode) throw new RecapError(403, 'Hanya Divisi yang dapat menyusun rekap.');
	const [templates, tickets, assignedIds] = await Promise.all([
		loadCatalogTemplates(access), loadEligibleSources(access, null), loadAssignedSourceIds()
	]);
	const groups = new Map<string, { id: number; nama_pekerjaan: string; compatible_work_catalogs: string[] }>();
	for (const template of templates) {
		const group = groups.get(template.signature) ?? { id: template.id, nama_pekerjaan: template.nama_pekerjaan, compatible_work_catalogs: [] };
		group.compatible_work_catalogs.push(template.nama_pekerjaan);
		groups.set(template.signature, group);
	}
	return { catalogs: [...groups.entries()].map(([signature, group]) => ({
		...group, eligible_count: tickets.filter((ticket) => !assignedIds.has(Number(ticket.id)) && templateSignature(ticket.definition_json) === signature).length
	})).filter((catalog) => catalog.eligible_count > 0) };
}

export async function listRecapSources(employeeId: string, catalogId: number) {
	const access = await resolveAccess(employeeId);
	const templates = await loadCatalogTemplates(access);
	const template = templates.find((item) => item.id === catalogId);
	if (!template) throw new RecapError(404, 'Template form pekerjaan tidak ditemukan.');
	const allTickets = await loadEligibleSources(access, null);
	const assignedIds = await loadAssignedSourceIds();
	const tickets = allTickets.filter((ticket) => !assignedIds.has(Number(ticket.id)) && templateSignature(ticket.definition_json) === template.signature);
	return {
		source_fields: tickets[0] ? getTicketFields(tickets[0]) : [],
		requests: tickets.map(sourceTicketSummary)
	};
}

function validateTrackingFields(rawFields: TrackingField[]): TrackingField[] {
	if (rawFields.length > 40) throw new RecapError(400, 'Rekap maksimal memiliki 40 kolom pemantauan.');
	const seen = new Set<string>();
	return rawFields.map((raw) => {
		if (!/^[a-z][a-z0-9_]{1,63}$/.test(raw.key) || !raw.key.startsWith('tracking_') || seen.has(raw.key)) {
			throw new RecapError(400, 'Kunci kolom pemantauan tidak valid atau berulang.');
		}
		seen.add(raw.key);
		const label = raw.label.trim();
		if (!label || label.length > 100 || !['text', 'number', 'date', 'select'].includes(raw.type)) throw new RecapError(400, 'Periksa nama dan tipe kolom pemantauan.');
		if (raw.type === 'select') {
			const options = raw.options?.map((option) => option.trim()).filter(Boolean) ?? [];
			if (!options.length || options.length > 50 || new Set(options.map((option) => option.toLocaleLowerCase('id-ID'))).size !== options.length || options.some((option) => option.length > 100)) {
				throw new RecapError(400, `Daftar pilihan untuk kolom “${label}” belum valid.`);
			}
			return { key: raw.key, label, type: raw.type, options, editable_by_branch: raw.editable_by_branch === true };
		}
		if (raw.options?.length) throw new RecapError(400, 'Pilihan hanya boleh diatur untuk kolom dropdown.');
		return { key: raw.key, label, type: raw.type, editable_by_branch: raw.editable_by_branch === true };
	});
}

function validateEditedTrackingFields(rawFields: TrackingField[], currentFields: TrackingField[]): TrackingField[] {
	const nextFields = validateTrackingFields(rawFields);
	const nextByKey = new Map(nextFields.map((field) => [field.key, field]));
	if (currentFields.some((field) => !nextByKey.has(field.key))) {
		throw new RecapError(400, 'Kolom lama tidak dapat dihapus dari rekap agar nilai dan riwayatnya tetap utuh.');
	}
	for (const current of currentFields) {
		if (nextByKey.get(current.key)?.type !== current.type) {
			throw new RecapError(400, `Tipe kolom ${current.label} tidak dapat diubah setelah rekap diterbitkan.`);
		}
	}
	return nextFields;
}

function isValidDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	if ((year ?? 0) < 1000) return false;
	const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
	return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === (month ?? 1) - 1 && parsed.getUTCDate() === day;
}

function validateTrackingChanges(raw: Record<string, unknown>, fields: TrackingField[], branchOnly: boolean): Record<string, string | number | null> {
	const changed: Record<string, string | number | null> = {};
	const byKey = new Map(fields.map((field) => [field.key, field]));
	for (const [key, rawValue] of Object.entries(raw)) {
		const field = byKey.get(key);
		if (!field || (branchOnly && !field.editable_by_branch)) throw new RecapError(400, 'Kolom yang diubah tidak tersedia untuk peran kamu.');
		if (rawValue === null || rawValue === '') { changed[key] = null; continue; }
		if (field.type === 'text') {
			if (typeof rawValue !== 'string' || rawValue.length > 1000) throw new RecapError(400, `Isi “${field.label}” maksimal 1.000 karakter.`);
			changed[key] = rawValue.trim() || null;
		} else if (field.type === 'number') {
			const numeric = typeof rawValue === 'number' ? rawValue : typeof rawValue === 'string' && rawValue.trim() ? Number(rawValue) : Number.NaN;
			if (!Number.isFinite(numeric)) throw new RecapError(400, `Isi “${field.label}” harus berupa angka.`);
			changed[key] = numeric;
		} else if (field.type === 'date') {
			if (typeof rawValue !== 'string' || !isValidDate(rawValue)) throw new RecapError(400, `Tanggal “${field.label}” belum valid.`);
			changed[key] = rawValue;
		} else {
			if (typeof rawValue !== 'string' || !field.options?.includes(rawValue)) throw new RecapError(400, `Pilih opsi yang tersedia untuk “${field.label}”.`);
			changed[key] = rawValue;
		}
	}
	if (!Object.keys(changed).length) throw new RecapError(400, 'Ubah sedikitnya satu kolom sebelum menyimpan.');
	return changed;
}

function formRows(ticket: SourceTicket): Array<{ index: number | null; values: FormAnswerRow }> {
	const definition = parseFormDefinition(ticket.definition_json);
	const answers = decodeJson<Record<string, unknown>>(ticket.form_answers_json, {});
	if (!definition.repeatable) return [{ index: null, values: answers as FormAnswerRow }];
	const entries = answers[REPEATABLE_FORM_ANSWERS_KEY];
	if (!Array.isArray(entries) || entries.length === 0) throw new RecapError(409, `Data form ${ticket.request_number} belum memiliki baris rekening.`);
	return entries.map((entry, index) => ({ index, values: entry && typeof entry === 'object' ? entry as FormAnswerRow : {} }));
}

async function insertRecapTicketRows(connection: PoolConnection, recapId: number, ticket: SourceTicket): Promise<number> {
	const rows = formRows(ticket);
	for (const row of rows) {
		const sourceEntryKey = row.index === null ? 0 : row.index + 1;
		await connection.execute(
			`INSERT INTO request_recap_rows
				(recap_id, source_request_id, kode_kantor, form_entry_index, source_entry_key, source_values_json, tracking_values_json)
			VALUES (?, ?, ?, ?, ?, ?, '{}')`,
			[recapId, ticket.id, ticket.kode_kantor, row.index, sourceEntryKey, JSON.stringify(row.values)]
		);
	}
	return rows.length;
}

export async function createRecap(employeeId: string, input: {
	title: string; work_catalog_id: number; request_ids: number[]; visible_source_keys: string[]; tracking_fields: TrackingField[];
}) {
	const access = await resolveAccess(employeeId);
	if (access.role !== 'division_staff' || !access.divisionId) throw new RecapError(403, 'Hanya Divisi yang dapat menerbitkan rekap.');
	const requestIds = [...new Set(input.request_ids)];
	if (requestIds.length !== input.request_ids.length || requestIds.length === 0 || requestIds.length > 500) throw new RecapError(400, 'Pilih antara 1 sampai 500 tiket sumber.');
	const trackingFields = validateTrackingFields(input.tracking_fields);
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const templates = await loadCatalogTemplates(access, connection);
		const template = templates.find((item) => item.id === input.work_catalog_id);
		if (!template) throw new RecapError(404, 'Template form pekerjaan tidak ditemukan.');
		const eligible = await loadEligibleSources(access, null, connection, true, requestIds);
		const selectedTickets = eligible.filter((ticket) => requestIds.includes(Number(ticket.id)));
		if (selectedTickets.length !== requestIds.length) throw new RecapError(409, 'Sebagian tiket sudah tidak memenuhi syarat rekap atau berada di luar cakupan Divisi. Muat ulang sumber.');
		const assignedIds = await loadAssignedSourceIds(connection, requestIds, true);
		if (selectedTickets.some((ticket) => assignedIds.has(Number(ticket.id)))) throw new RecapError(409, 'Tiket sumber sudah masuk ke rekap dan tidak dapat ditambahkan lagi.');
		if (selectedTickets.some((ticket) => templateSignature(ticket.definition_json) !== template.signature)) {
			throw new RecapError(409, 'Semua tiket dalam rekap harus memakai template form yang sama. Muat ulang sumber.');
		}
		const fields = selectedTickets[0] ? getTicketFields(selectedTickets[0]) : [];
		const fieldKeys = new Set(fields.map((field) => field.key));
		if (!fields.length) throw new RecapError(409, 'Tiket sumber belum memiliki definisi field form.');
		if (input.visible_source_keys.some((key) => !fieldKeys.has(key)) || new Set(input.visible_source_keys).size !== input.visible_source_keys.length) {
			throw new RecapError(400, 'Kolom sumber yang dipilih tidak cocok dengan versi form tiket.');
		}
		const visibleFields = fields.filter((field) => input.visible_source_keys.includes(field.key));
		const [insertRecap] = await connection.execute<ResultSetHeader>(
			`INSERT INTO request_recaps (division_id, work_catalog_id, title, source_fields_json, visible_source_keys_json,
				tracking_fields_json, created_by_user_id, published_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
			[access.divisionId, input.work_catalog_id, input.title.trim(), JSON.stringify(fields),
				JSON.stringify(visibleFields.map((field) => field.key)), JSON.stringify(trackingFields), access.userId]
		);
		const recapId = Number(insertRecap.insertId);
		let rowCount = 0;
		for (const ticket of selectedTickets) rowCount += await insertRecapTicketRows(connection, recapId, ticket);
		await connection.commit();
		return { id: recapId, title: input.title.trim(), row_count: rowCount, source_request_count: selectedTickets.length };
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		throw error;
	} finally { connection.release(); }
}

export async function listAppendableRecapSources(employeeId: string, recapId: number) {
	const access = await resolveAccess(employeeId);
	const { signature, sourceFields } = await loadRecapTemplate(access, recapId);
	const tickets = await loadEligibleSources(access, null);
	const assignedIds = await loadAssignedSourceIds();
	return {
		source_fields: sourceFields,
		requests: tickets.filter((ticket) => !assignedIds.has(Number(ticket.id)) && templateSignature(ticket.definition_json) === signature).map(sourceTicketSummary)
	};
}

export async function appendRecapSources(employeeId: string, recapId: number, requestIdsInput: number[]) {
	const access = await resolveAccess(employeeId);
	if (access.role !== 'division_staff') throw new RecapError(403, 'Hanya Divisi yang dapat menambahkan tiket ke rekap.');
	const requestIds = [...new Set(requestIdsInput)];
	if (requestIds.length !== requestIdsInput.length || requestIds.length === 0 || requestIds.length > 500) throw new RecapError(400, 'Pilih antara 1 sampai 500 tiket sumber.');
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const { signature } = await loadRecapTemplate(access, recapId, connection, true);
		const eligible = await loadEligibleSources(access, null, connection, true, requestIds);
		if (eligible.length !== requestIds.length) throw new RecapError(409, 'Sebagian tiket sudah tidak memenuhi syarat atau berada di luar cakupan Divisi. Muat ulang sumber.');
		if (eligible.some((ticket) => templateSignature(ticket.definition_json) !== signature)) throw new RecapError(409, 'Tiket harus memakai template form yang sama dengan rekap ini.');
		const assignedIds = await loadAssignedSourceIds(connection, requestIds, true);
		if (eligible.some((ticket) => assignedIds.has(Number(ticket.id)))) throw new RecapError(409, 'Tiket sumber sudah masuk ke rekap dan tidak dapat ditambahkan lagi.');
		let rowCount = 0;
		for (const ticket of eligible) rowCount += await insertRecapTicketRows(connection, recapId, ticket);
		await connection.commit();
		return { source_request_count: eligible.length, row_count: rowCount };
	} catch (error) { await connection.rollback().catch(() => undefined); throw error; }
	finally { connection.release(); }
}

async function getRecapForAccess(employeeId: string, recapId: number, connection?: PoolConnection) {
	const access = await resolveAccess(employeeId);
	const db = connection ?? mysqlPool;
	const [rows] = await db.execute<Array<RowDataPacket & {
		id: number; division_id: number; work_catalog_id: number; title: string; status: 'published' | 'archived';
		source_fields_json: unknown; visible_source_keys_json: unknown; tracking_fields_json: unknown;
		nama_pekerjaan: string; nama_divisi: string; division_code: string; creator_name: string;
	}>>(
		`SELECT recap.*, catalog.nama_pekerjaan, division.nama_divisi, division.kode AS division_code, creator.full_name AS creator_name
		FROM request_recaps recap INNER JOIN work_catalogs catalog ON catalog.id = recap.work_catalog_id
		INNER JOIN master_divisi division ON division.id = recap.division_id
		INNER JOIN users creator ON creator.id = recap.created_by_user_id WHERE recap.id = ? LIMIT 1`, [recapId]
	);
	const recap = rows[0];
	if (!recap) throw new RecapError(404, 'Rekap tidak ditemukan.');
	const isDivision = access.role === 'division_staff' && access.divisionId === Number(recap.division_id) && access.divisionCode === recap.division_code;
	const isBranch = access.role === 'branch_user' && recap.status === 'published';
	if (!isDivision && !isBranch) throw new RecapError(403, 'Rekap berada di luar cakupan akses kamu.');
	if (isBranch) {
		const [ownRows] = await db.execute<RowDataPacket[]>(
			'SELECT 1 FROM request_recap_rows WHERE recap_id = ? AND kode_kantor = ? LIMIT 1', [recapId, access.officeCode]
		);
		if (!ownRows.length) throw new RecapError(404, 'Rekap belum memuat pengajuan dari kantor kamu.');
	}
	return { access, recap, isDivision, branchOfficeCode: isBranch ? access.officeCode : null };
}

export async function getRecapDetail(employeeId: string, recapId: number) {
	const { access, recap, isDivision, branchOfficeCode } = await getRecapForAccess(employeeId, recapId);
	const [rows] = await mysqlPool.execute<RecapRow[]>(
		`SELECT recap_row.id, recap_row.recap_id, recap_row.source_request_id, request.request_number, request.subject,
			request.status, catalog.nama_pekerjaan, recap_row.kode_kantor, office.nama_kantor, recap_row.form_entry_index,
			recap_row.source_values_json, recap_row.tracking_values_json, recap_row.created_at, recap_row.updated_at
		FROM request_recap_rows recap_row INNER JOIN service_requests request ON request.id = recap_row.source_request_id
		INNER JOIN work_catalogs catalog ON catalog.id = request.work_catalog_id
		INNER JOIN master_kantor office ON office.kode_kantor = recap_row.kode_kantor
		WHERE recap_row.recap_id = ?${branchOfficeCode ? ' AND recap_row.kode_kantor = ?' : ''}
		ORDER BY recap_row.source_request_id DESC, recap_row.source_entry_key`,
		branchOfficeCode ? [recapId, branchOfficeCode] : [recapId]
	);
	const rowIds = rows.map((row) => Number(row.id));
	type ProposalRow = RowDataPacket & {
		id: number; recap_row_id: number; proposed_changes_json: unknown; note: string; status: string;
		review_note: string | null; created_at: Date; reviewed_at: Date | null; proposer_name: string; reviewer_name: string | null;
	};
	let proposalRows: ProposalRow[] = [];
	if (rowIds.length) {
		const placeholders = rowIds.map(() => '?').join(',');
		const [loadedProposals] = await mysqlPool.execute<ProposalRow[]>(
			`SELECT proposal.id, proposal.recap_row_id, proposal.proposed_changes_json, proposal.note, proposal.status,
				proposal.review_note, proposal.created_at, proposal.reviewed_at,
				proposer.full_name AS proposer_name, reviewer.full_name AS reviewer_name
			FROM request_recap_proposals proposal INNER JOIN users proposer ON proposer.id = proposal.proposed_by_user_id
			LEFT JOIN users reviewer ON reviewer.id = proposal.reviewed_by_user_id
			WHERE proposal.recap_row_id IN (${placeholders}) ORDER BY proposal.created_at DESC, proposal.id DESC`, rowIds
		);
		proposalRows = loadedProposals;
	}
	const proposalsByRow = new Map<number, typeof proposalRows>();
	for (const proposal of proposalRows) {
		const list = proposalsByRow.get(Number(proposal.recap_row_id)) ?? [];
		list.push(proposal);
		proposalsByRow.set(Number(proposal.recap_row_id), list);
	}
	const sourceFields = decodeJson<SourceField[]>(recap.source_fields_json, []);
	const visibleKeys = decodeJson<string[]>(recap.visible_source_keys_json, []);
	const trackingFields = decodeJson<TrackingField[]>(recap.tracking_fields_json, []);
	return {
		recap: {
			id: Number(recap.id), title: recap.title, status: recap.status, work_catalog_id: Number(recap.work_catalog_id),
			nama_pekerjaan: recap.nama_pekerjaan, nama_divisi: recap.nama_divisi, created_at: recap.created_at,
			published_at: recap.published_at, source_fields: sourceFields, visible_source_keys: visibleKeys,
			tracking_fields: trackingFields, is_division: isDivision,
			branch_editable_keys: isDivision ? [] : trackingFields.filter((field) => field.editable_by_branch).map((field) => field.key)
		},
		rows: rows.map((row) => ({
			id: Number(row.id), source_request_id: Number(row.source_request_id), request_number: row.request_number,
			subject: row.subject, status: row.status, nama_pekerjaan: row.nama_pekerjaan,
			kode_kantor: row.kode_kantor, nama_kantor: row.nama_kantor,
			form_entry_index: row.form_entry_index === null ? null : Number(row.form_entry_index),
			source_values: (() => {
				const values = decodeJson<Record<string, unknown>>(row.source_values_json, {});
				return isDivision ? values : Object.fromEntries(visibleKeys.filter((key) => key in values).map((key) => [key, values[key]]));
			})(),
			tracking_values: decodeJson<Record<string, string | number | null>>(row.tracking_values_json, {}),
			updated_at: row.updated_at,
			proposals: (proposalsByRow.get(Number(row.id)) ?? []).map((proposal) => ({
				id: Number(proposal.id), changes: decodeJson<Record<string, string | number | null>>(proposal.proposed_changes_json, {}),
				note: proposal.note, status: proposal.status, review_note: proposal.review_note,
				created_at: proposal.created_at, reviewed_at: proposal.reviewed_at,
				proposer_name: proposal.proposer_name, reviewer_name: proposal.reviewer_name
			}))
		}))
	};
}

export async function updateRecapSettings(employeeId: string, recapId: number, input: {
	title: string; visible_source_keys: string[]; tracking_fields: TrackingField[];
}) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const access = await resolveAccess(employeeId);
		if (access.role !== 'division_staff' || access.divisionId === null || access.divisionCode === null) {
			throw new RecapError(403, 'Hanya Divisi yang dapat mengubah pengaturan rekap.');
		}
		const [recaps] = await connection.execute<Array<RowDataPacket & {
			id: number; division_id: number; division_code: string; status: 'published' | 'archived';
			source_fields_json: unknown; tracking_fields_json: unknown;
		}>>(
			`SELECT recap.id, recap.division_id, division.kode AS division_code, recap.status,
				recap.source_fields_json, recap.tracking_fields_json
			FROM request_recaps recap INNER JOIN master_divisi division ON division.id = recap.division_id
			WHERE recap.id = ? LIMIT 1 FOR UPDATE`, [recapId]
		);
		const recap = recaps[0];
		if (!recap) throw new RecapError(404, 'Rekap tidak ditemukan.');
		if (Number(recap.division_id) !== access.divisionId || recap.division_code !== access.divisionCode) {
			throw new RecapError(403, 'Rekap berada di luar cakupan Divisi kamu.');
		}
		if (recap.status !== 'published') throw new RecapError(409, 'Rekap yang sudah diarsipkan tidak dapat diubah.');
		const title = input.title.trim();
		if (!title || title.length > 160) throw new RecapError(400, 'Nama rekap wajib diisi dan maksimal 160 karakter.');
		const sourceFields = decodeJson<SourceField[]>(recap.source_fields_json, []);
		const allowedSourceKeys = new Set(sourceFields.map((field) => field.key));
		if (input.visible_source_keys.length === 0 || new Set(input.visible_source_keys).size !== input.visible_source_keys.length ||
			input.visible_source_keys.some((key) => !allowedSourceKeys.has(key))) {
			throw new RecapError(400, 'Kolom form yang ditampilkan tidak cocok dengan snapshot rekap.');
		}
		const currentFields = decodeJson<TrackingField[]>(recap.tracking_fields_json, []);
		const nextFields = validateEditedTrackingFields(input.tracking_fields, currentFields);
		const nextByKey = new Map(nextFields.map((field) => [field.key, field]));
		const [rowValues] = await connection.execute<Array<RowDataPacket & { tracking_values_json: unknown }>>(
			'SELECT tracking_values_json FROM request_recap_rows WHERE recap_id = ?', [recapId]
		);
		const [pendingRows] = await connection.execute<Array<RowDataPacket & { proposed_changes_json: unknown }>>(
			`SELECT proposal.proposed_changes_json FROM request_recap_proposals proposal
			INNER JOIN request_recap_rows recap_row ON recap_row.id = proposal.recap_row_id
			WHERE recap_row.recap_id = ? AND proposal.status = 'pending'`, [recapId]
		);
		const pendingChanges = pendingRows.map((row) => decodeJson<Record<string, unknown>>(row.proposed_changes_json, {}));
		for (const current of currentFields) {
			const next = nextByKey.get(current.key);
			if (!next) continue;
			if (next.editable_by_branch !== current.editable_by_branch && pendingChanges.some((changes) => current.key in changes)) {
				throw new RecapError(409, `Izin Cabang untuk ${current.label} tidak dapat diubah selama ada usulan yang menunggu.`);
			}
			if (current.type !== 'select' || next.type !== 'select' || JSON.stringify(current.options ?? []) === JSON.stringify(next.options ?? [])) continue;
			const options = new Set(next.options ?? []);
			for (const row of rowValues) {
				const values = decodeJson<Record<string, unknown>>(row.tracking_values_json, {});
				const value = values[current.key];
				if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !options.has(value))) {
					throw new RecapError(409, `Pilihan yang digunakan pada kolom ${current.label} tidak dapat dihapus.`);
				}
			}
			for (const changes of pendingChanges) {
				const value = changes[current.key];
				if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !options.has(value))) {
					throw new RecapError(409, `Pilihan pada usulan yang menunggu untuk kolom ${current.label} tidak dapat dihapus.`);
				}
			}
		}
		await connection.execute(
			'UPDATE request_recaps SET title = ?, visible_source_keys_json = ?, tracking_fields_json = ? WHERE id = ?',
			[title, JSON.stringify(input.visible_source_keys), JSON.stringify(nextFields), recapId]
		);
		await connection.commit();
		return { id: recapId, title, visible_source_keys: input.visible_source_keys, tracking_fields: nextFields };
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		throw error;
	} finally { connection.release(); }
}

async function loadRowForUpdate(connection: PoolConnection, employeeId: string, recapId: number, rowId: number) {
	const access = await resolveAccess(employeeId);
	const [rows] = await connection.execute<Array<RowDataPacket & {
		id: number; recap_id: number; kode_kantor: string; status: 'published' | 'archived';
		division_id: number; division_code: string; tracking_fields_json: unknown; tracking_values_json: unknown;
	}>>(
		`SELECT recap_row.id, recap_row.recap_id, recap_row.kode_kantor, recap.status,
			recap.division_id, division.kode AS division_code, recap.tracking_fields_json, recap_row.tracking_values_json
		FROM request_recap_rows recap_row INNER JOIN request_recaps recap ON recap.id = recap_row.recap_id
		INNER JOIN master_divisi division ON division.id = recap.division_id
		WHERE recap_row.id = ? AND recap_row.recap_id = ? FOR UPDATE`, [rowId, recapId]
	);
	const row = rows[0];
	if (!row) throw new RecapError(404, 'Baris rekap tidak ditemukan.');
	const isDivision = access.role === 'division_staff' && access.divisionId === Number(row.division_id) && access.divisionCode === row.division_code;
	const isBranch = access.role === 'branch_user' && access.officeCode === row.kode_kantor && row.status === 'published';
	if (!isDivision && !isBranch) throw new RecapError(403, 'Baris rekap berada di luar cakupan akses kamu.');
	if (row.status !== 'published') throw new RecapError(409, 'Rekap yang sudah diarsipkan tidak dapat diubah.');
	return { row, isDivision, fields: decodeJson<TrackingField[]>(row.tracking_fields_json, []), current: decodeJson<Record<string, string | number | null>>(row.tracking_values_json, {}) };
}

export async function updateRecapRow(employeeId: string, recapId: number, rowId: number, rawChanges: Record<string, unknown>) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const { row, isDivision, fields, current } = await loadRowForUpdate(connection, employeeId, recapId, rowId);
		if (!isDivision) throw new RecapError(403, 'Hanya Divisi yang dapat mengubah nilai rekap langsung.');
		const changes = validateTrackingChanges(rawChanges, fields, false);
		const [userRows] = await connection.execute<Array<RowDataPacket & { id: number }>>('SELECT id FROM users WHERE employee_id = ? AND is_active = 1 LIMIT 1', [employeeId]);
		const [result] = await connection.execute<ResultSetHeader>(
			'UPDATE request_recap_rows SET tracking_values_json = ? WHERE id = ?',
			[JSON.stringify({ ...current, ...changes }), row.id]
		);
		if (result.affectedRows !== 1 || !userRows[0]) throw new RecapError(409, 'Nilai rekap berubah. Muat ulang sebelum menyimpan.');
		await connection.commit();
		return { row_id: rowId, tracking_values: { ...current, ...changes } };
	} catch (error) { await connection.rollback().catch(() => undefined); throw error; }
	finally { connection.release(); }
}

export async function proposeRecapRowChanges(employeeId: string, recapId: number, rowId: number, rawChanges: Record<string, unknown>, note: string) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const { row, isDivision, fields } = await loadRowForUpdate(connection, employeeId, recapId, rowId);
		if (isDivision) throw new RecapError(403, 'Pengajuan perubahan Cabang tidak tersedia untuk Divisi.');
		const changes = validateTrackingChanges(rawChanges, fields, true);
		const [pending] = await connection.execute<RowDataPacket[]>(
			"SELECT id FROM request_recap_proposals WHERE recap_row_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE", [row.id]
		);
		if (pending.length) throw new RecapError(409, 'Masih ada perubahan baris ini yang menunggu persetujuan Divisi.');
		const [users] = await connection.execute<Array<RowDataPacket & { id: number }>>('SELECT id FROM users WHERE employee_id = ? AND is_active = 1 LIMIT 1', [employeeId]);
		if (!users[0]) throw new RecapError(403, 'Akun aktif Sistem SLA belum ditemukan.');
		const [result] = await connection.execute<ResultSetHeader>(
			'INSERT INTO request_recap_proposals (recap_row_id, proposed_by_user_id, proposed_changes_json, note) VALUES (?, ?, ?, ?)',
			[row.id, users[0].id, JSON.stringify(changes), note.trim()]
		);
		await connection.commit();
		return { id: Number(result.insertId), status: 'pending' };
	} catch (error) { await connection.rollback().catch(() => undefined); throw error; }
	finally { connection.release(); }
}

export async function reviewRecapProposal(employeeId: string, recapId: number, proposalId: number, outcome: 'approved' | 'rejected', reviewNote: string | null) {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const access = await resolveAccess(employeeId);
		if (access.role !== 'division_staff' || !access.divisionId) throw new RecapError(403, 'Hanya Divisi yang dapat meninjau perubahan.');
		const [proposals] = await connection.execute<Array<RowDataPacket & {
			id: number; recap_row_id: number; status: string; proposed_changes_json: unknown;
			tracking_fields_json: unknown; tracking_values_json: unknown; division_id: number; division_code: string;
			recap_status: string;
		}>>(
			`SELECT proposal.id, proposal.recap_row_id, proposal.status, proposal.proposed_changes_json,
				recap.tracking_fields_json, recap_row.tracking_values_json, recap.division_id, division.kode AS division_code
				, recap.status AS recap_status
			FROM request_recap_proposals proposal INNER JOIN request_recap_rows recap_row ON recap_row.id = proposal.recap_row_id
			INNER JOIN request_recaps recap ON recap.id = recap_row.recap_id
			INNER JOIN master_divisi division ON division.id = recap.division_id
			WHERE proposal.id = ? AND recap.id = ? FOR UPDATE`, [proposalId, recapId]
		);
		const proposal = proposals[0];
		if (!proposal) throw new RecapError(404, 'Pengajuan perubahan tidak ditemukan.');
		if (Number(proposal.division_id) !== access.divisionId || proposal.division_code !== access.divisionCode) throw new RecapError(403, 'Perubahan berada di luar cakupan Divisi kamu.');
		if (proposal.recap_status !== 'published') throw new RecapError(409, 'Rekap yang sudah diarsipkan tidak dapat ditinjau.');
		if (proposal.status !== 'pending') throw new RecapError(409, 'Pengajuan perubahan sudah ditinjau.');
		if (outcome === 'rejected' && !reviewNote?.trim()) throw new RecapError(400, 'Isi alasan saat menolak perubahan Cabang.');
		if (outcome === 'approved') {
			const fields = decodeJson<TrackingField[]>(proposal.tracking_fields_json, []);
			const changes = validateTrackingChanges(decodeJson<Record<string, unknown>>(proposal.proposed_changes_json, {}), fields, true);
			const current = decodeJson<Record<string, string | number | null>>(proposal.tracking_values_json, {});
			await connection.execute('UPDATE request_recap_rows SET tracking_values_json = ? WHERE id = ?', [JSON.stringify({ ...current, ...changes }), proposal.recap_row_id]);
		}
		const [users] = await connection.execute<Array<RowDataPacket & { id: number }>>('SELECT id FROM users WHERE employee_id = ? AND is_active = 1 LIMIT 1', [employeeId]);
		if (!users[0]) throw new RecapError(403, 'Akun aktif Sistem SLA belum ditemukan.');
		await connection.execute(
			`UPDATE request_recap_proposals SET status = ?, review_note = ?, reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP(3)
			WHERE id = ? AND status = 'pending'`,
			[outcome, reviewNote?.trim() || null, users[0].id, proposalId]
		);
		await connection.commit();
		return { id: proposalId, status: outcome };
	} catch (error) { await connection.rollback().catch(() => undefined); throw error; }
	finally { connection.release(); }
}
