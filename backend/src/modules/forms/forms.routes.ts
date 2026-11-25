import { Router } from 'express';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import {
	DEFAULT_CREDIT_ROUTING_CONFIG, creditRoutingSchema, formDefinitionSchema, parseFormDefinition,
	repeatableFormSchema, type FormFieldDefinition
} from './form-schema.js';

type ManagerAccess = { userId: number; divisionId: number | null; isAdmin: boolean };

class FormManagementError extends Error {
	constructor(public readonly statusCode: number, message: string) {
		super(message);
		this.name = 'FormManagementError';
	}
}

const legacyEditorFieldSchema = z.object({
	label: z.string().trim().min(1).max(160),
	type: z.enum(['text', 'textarea', 'number', 'currency', 'date', 'select', 'document', 'image', 'images']),
	required: z.boolean(),
	options: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
	min_value: z.number().finite().optional(),
	max_value: z.number().finite().optional(),
	requires_korwil_review: z.boolean().default(false)
}).strict().superRefine((field, context) => {
	if (field.type === 'select' && !field.options?.length) {
		context.addIssue({ code: 'custom', message: 'Tambahkan pilihan untuk field bertipe pilihan.', path: ['options'] });
	}
	if (field.type !== 'select' && field.options?.length) {
		context.addIssue({ code: 'custom', message: 'Pilihan hanya berlaku untuk field bertipe pilihan.', path: ['options'] });
	}
	if (field.min_value !== undefined && field.max_value !== undefined && field.min_value > field.max_value) {
		context.addIssue({ code: 'custom', message: 'Nilai minimum tidak boleh lebih besar dari maksimum.', path: ['min_value'] });
	}
	if (field.type === 'select' && field.options) {
		const normalizedOptions = field.options.map((option) => option.toLocaleLowerCase('id-ID'));
		if (new Set(normalizedOptions).size !== normalizedOptions.length) {
			context.addIssue({ code: 'custom', message: 'Opsi dalam satu field pilihan tidak boleh sama.', path: ['options'] });
		}
	}
});

const catalogFieldSelectionSchema = z.object({
	catalog_field_id: z.number().int().positive(),
	required: z.boolean(),
	requires_korwil_review: z.boolean().default(false),
	min_value: z.number().finite().optional(),
	max_value: z.number().finite().optional()
}).strict().superRefine((field, context) => {
	if (field.min_value !== undefined && field.max_value !== undefined && field.min_value > field.max_value) {
		context.addIssue({ code: 'custom', message: 'Nilai minimum tidak boleh lebih besar dari maksimum.', path: ['min_value'] });
	}
});

const editorFieldSchema = z.union([catalogFieldSelectionSchema, legacyEditorFieldSchema]);

const publishSchema = z.object({
	fields: z.array(editorFieldSchema).max(40, 'Form hanya dapat memuat maksimal 40 kolom tambahan.'),
	repeatable: repeatableFormSchema.nullable().optional(),
	credit_routing: creditRoutingSchema.nullable().optional()
}).strict();
const customFieldCreateSchema = z.object({
	label: z.string().trim().min(1).max(160),
	type: z.enum(['text', 'textarea', 'number', 'currency', 'date', 'select', 'document', 'image', 'images']),
	options: z.array(z.string().trim().min(1).max(160)).max(50).optional()
}).strict().superRefine((field, context) => {
	if (field.type === 'select' && !field.options?.length) {
		context.addIssue({ code: 'custom', message: 'Tambahkan pilihan untuk field bertipe pilihan.', path: ['options'] });
	}
	if (field.type !== 'select' && field.options?.length) {
		context.addIssue({ code: 'custom', message: 'Pilihan hanya berlaku untuk field bertipe pilihan.', path: ['options'] });
	}
	if (field.type === 'select' && field.options) {
		const normalizedOptions = field.options.map((option) => option.toLocaleLowerCase('id-ID'));
		if (new Set(normalizedOptions).size !== normalizedOptions.length) {
			context.addIssue({ code: 'custom', message: 'Opsi dalam satu field pilihan tidak boleh sama.', path: ['options'] });
		}
	}
});
const rejectionReasonCreateSchema = z.object({
	catalog_id: z.number().int().positive(),
	scope_type: z.enum(['system', 'division', 'catalog']),
	label: z.string().trim().min(3).max(160)
}).strict();
const rejectionReasonActiveSchema = z.object({ is_active: z.boolean() }).strict();

function validationIssueMessage(error: z.ZodError, fieldOffset = 0): string {
	const issue = error.issues[0];
	if (!issue) return 'Periksa kembali field form yang akan diterbitkan.';
	const fieldIndex = issue.path[0] === 'fields' ? issue.path[1] : undefined;
	if (typeof fieldIndex === 'number') return `Kolom ${Math.max(1, fieldIndex + 1 - fieldOffset)}: ${issue.message}`;
	return issue.message;
}

async function getManagerAccess(employeeId: string): Promise<ManagerAccess> {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
		user_id: number; user_active: number; user_division_id: number | null;
		role_code: string; scope_type: string; scope_division_id: number | null; can_manage_forms: number;
	}>>(
		`SELECT user.id AS user_id, user.is_active AS user_active, user.divisi_id AS user_division_id,
			role.kode AS role_code, scope.scope_type, scope.divisi_id AS scope_division_id,
			scope.can_manage_forms
		FROM users user
		INNER JOIN user_role_scopes scope ON scope.user_id = user.id AND scope.is_active = 1
		INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1
		WHERE user.employee_id = ? AND user.is_active = 1
		ORDER BY CASE WHEN role.kode = 'admin' AND scope.scope_type = 'global' THEN 0 ELSE 1 END, scope.id`,
		[employeeId]
	);
	const admin = rows.find((row) => row.role_code === 'admin' && row.scope_type === 'global');
	if (admin) return { userId: Number(admin.user_id), divisionId: null, isAdmin: true };
	const divisionManager = rows.find((row) =>
		row.role_code === 'division_staff' && row.scope_type === 'division' &&
		Number(row.can_manage_forms) === 1 && row.user_division_id !== null &&
		Number(row.user_division_id) === Number(row.scope_division_id)
	);
	if (!divisionManager || divisionManager.scope_division_id === null) {
		throw new FormManagementError(403, 'Akses kelola form belum diberikan oleh Admin untuk divisi pada profil SSO kamu.');
	}
	const [divisionRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM master_divisi WHERE id = ? AND is_active = 1 LIMIT 1',
		[divisionManager.scope_division_id]
	);
	if (!divisionRows[0]) throw new FormManagementError(403, 'Divisi pada profil SSO belum aktif atau belum dapat dipetakan.');
	return {
		userId: Number(divisionManager.user_id),
		divisionId: Number(divisionManager.scope_division_id),
		isAdmin: false
	};
}

function makeFieldKey(label: string, index: number, used: Set<string>): string {
	const base = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US')
		.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 52);
	const stem = /^[a-z]/.test(base) ? base : `field_${base || index + 1}`;
	let key = stem;
	let suffix = 2;
	while (used.has(key)) key = `${stem.slice(0, 60 - String(suffix).length)}_${suffix++}`;
	used.add(key);
	return key;
}

type CatalogFieldRow = RowDataPacket & {
	id: number; division_id: number | null; field_key: string; label: string; field_type: string;
	options_json: unknown; calculation_json: unknown; is_standard: number; is_derived: number;
};

function decodeJsonValue<T>(value: unknown, fallback: T): T {
	if (typeof value === 'string') {
		try { return JSON.parse(value) as T; } catch { return fallback; }
	}
	return value !== null && typeof value === 'object' ? value as T : fallback;
}

function catalogFieldResponse(row: CatalogFieldRow) {
	return {
		id: Number(row.id),
		division_id: row.division_id === null ? null : Number(row.division_id),
		key: row.field_key,
		label: row.label,
		type: row.field_type,
		options: decodeJsonValue<string[] | null>(row.options_json, null),
		calculation: decodeJsonValue<FormFieldDefinition['calculation'] | null>(row.calculation_json, null),
		is_standard: Number(row.is_standard) === 1,
		is_derived: Number(row.is_derived) === 1
	};
}

async function normalizePublisherFields(
	connection: Awaited<ReturnType<typeof mysqlPool.getConnection>>,
	divisionId: number,
	fields: z.infer<typeof publishSchema>['fields'],
	isCredit: boolean
): Promise<FormFieldDefinition[]> {
	const selectedCatalogIds = fields.flatMap((field) => 'catalog_field_id' in field ? [field.catalog_field_id] : []);
	if (new Set(selectedCatalogIds).size !== selectedCatalogIds.length) {
		throw new FormManagementError(400, 'Field katalog yang sama tidak boleh dipilih lebih dari satu kali.');
	}
	const catalogFieldsById = new Map<number, CatalogFieldRow>();
	if (selectedCatalogIds.length > 0) {
		const placeholders = selectedCatalogIds.map(() => '?').join(', ');
		const [rows] = await connection.execute<CatalogFieldRow[]>(
			`SELECT id, division_id, field_key, label, field_type, options_json, calculation_json, is_standard, is_derived
			FROM form_field_catalog WHERE id IN (${placeholders})
				AND (division_id IS NULL OR division_id = ?)`,
			[...selectedCatalogIds, divisionId]
		);
		for (const row of rows) catalogFieldsById.set(Number(row.id), row);
	}
	if (catalogFieldsById.size !== selectedCatalogIds.length) {
		throw new FormManagementError(400, 'Field katalog tidak tersedia untuk jenis pekerjaan ini. Muat ulang form lalu pilih kembali.');
	}

	const used = new Set<string>(isCredit ? ['credit_amount'] : []);
	for (const row of catalogFieldsById.values()) used.add(row.field_key);
	const selectedKeys = new Set([...catalogFieldsById.values()].map((row) => row.field_key));
	if (selectedKeys.has('tunggakan_pokok') && selectedKeys.has('tunggakan_bunga')) used.add('total_tunggakan');
	const resolvedFields: FormFieldDefinition[] = [];
	for (const [index, field] of fields.entries()) {
		if ('catalog_field_id' in field) {
			const row = catalogFieldsById.get(field.catalog_field_id)!;
			const options = decodeJsonValue<string[] | null>(row.options_json, null) ?? undefined;
			const calculation = decodeJsonValue<FormFieldDefinition['calculation'] | null>(row.calculation_json, null) ?? undefined;
			resolvedFields.push({
				key: row.field_key,
				catalog_field_id: Number(row.id),
				label: row.label,
				type: row.field_type as FormFieldDefinition['type'],
				required: calculation ? false : field.required,
				requires_korwil_review: calculation ? false : field.requires_korwil_review,
				...(options ? { options } : {}),
				...(field.min_value === undefined ? {} : { min_value: field.min_value }),
				...(field.max_value === undefined ? {} : { max_value: field.max_value }),
				...(calculation ? { calculation } : {})
			});
			continue;
		}
		resolvedFields.push({
			key: makeFieldKey(field.label, index, used),
			...field,
			options: field.type === 'select' ? field.options : undefined
		});
	}

	const hasPrincipalArrears = resolvedFields.some((field) => field.key === 'tunggakan_pokok');
	const hasInterestArrears = resolvedFields.some((field) => field.key === 'tunggakan_bunga');
	if (hasPrincipalArrears && hasInterestArrears && !resolvedFields.some((field) => field.calculation?.operation === 'sum' && field.key === 'total_tunggakan')) {
		const [totalFields] = await connection.execute<CatalogFieldRow[]>(
			`SELECT id, division_id, field_key, label, field_type, options_json, calculation_json, is_standard, is_derived
			FROM form_field_catalog WHERE field_key = 'total_tunggakan' AND division_id IS NULL AND is_derived = 1 LIMIT 1`
		);
		const totalField = totalFields[0];
		if (!totalField) throw new FormManagementError(500, 'Field hitung Total Tunggakan belum tersedia di katalog.');
		resolvedFields.push({
			key: totalField.field_key,
			catalog_field_id: Number(totalField.id),
			label: totalField.label,
			type: 'currency',
			required: false,
			options: undefined,
			calculation: decodeJsonValue<FormFieldDefinition['calculation']>(totalField.calculation_json, { operation: 'sum', fields: ['tunggakan_pokok', 'tunggakan_bunga'] })
		});
	}
	if (resolvedFields.some((field) => field.calculation && field.key !== 'total_tunggakan')) {
		throw new FormManagementError(400, 'Field turunan hanya dapat ditambahkan oleh sistem dari field sumber yang dipilih.');
	}
	if (resolvedFields.some((field) => field.key === 'total_tunggakan' && field.calculation) && (!hasPrincipalArrears || !hasInterestArrears)) {
		throw new FormManagementError(400, 'Total Tunggakan memerlukan Tunggakan Pokok dan Tunggakan Bunga.');
	}

	if (!isCredit) return resolvedFields;
	return [{
		key: 'credit_amount',
		label: 'Nilai pengajuan kredit (Rp)',
		type: 'currency',
		required: true,
		min_value: 200000000,
		system: true,
		requires_korwil_review: true
	}, ...resolvedFields];
}

export const formsRouter = Router();
formsRouter.use(requireRequestIdentity);

formsRouter.get('/manage', async (_request, response) => {
	try {
		const manager = await getManagerAccess(response.locals.slaEmployeeId);
		const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
			id: number; divisi_id: number; kode_divisi: string; nama_divisi: string;
			nama_pekerjaan: string; deskripsi: string | null; target_sla_minutes: number | null;
			routing_flow: 'branch_korwil_central' | 'branch_central';
			is_active: number; system_key: string | null; form_version_id: number | null;
			version_number: number | null; definition_json: unknown;
		}>>(
			`SELECT catalog.id, catalog.divisi_id, division.kode AS kode_divisi, division.nama_divisi,
				catalog.nama_pekerjaan, catalog.deskripsi, catalog.target_sla_minutes, catalog.routing_flow, catalog.is_active,
				catalog.system_key, current_form.id AS form_version_id,
				current_form.version_number, current_form.definition_json
			FROM work_catalogs catalog
			INNER JOIN master_divisi division ON division.id = catalog.divisi_id
			LEFT JOIN work_catalog_form_versions current_form ON current_form.id = (
				SELECT form_version.id FROM work_catalog_form_versions form_version
				WHERE form_version.work_catalog_id = catalog.id
				ORDER BY form_version.version_number DESC LIMIT 1
			)
			WHERE (? IS NULL OR catalog.divisi_id = ?)
			ORDER BY division.nama_divisi, catalog.nama_pekerjaan`,
			[manager.divisionId, manager.divisionId]
		);
		const divisionIds = [...new Set(rows.map((row) => Number(row.divisi_id)))];
		let fieldRows: CatalogFieldRow[] = [];
		const divisionPlaceholders = divisionIds.map(() => '?').join(', ');
		[fieldRows] = await mysqlPool.execute<CatalogFieldRow[]>(
			`SELECT id, division_id, field_key, label, field_type, options_json, calculation_json, is_standard, is_derived
			FROM form_field_catalog
			WHERE division_id IS NULL${divisionIds.length ? ` OR division_id IN (${divisionPlaceholders})` : ''}
			ORDER BY is_standard DESC, label`, divisionIds
		);
		response.status(200).json({
			status: 200,
			message: 'Daftar form pekerjaan berhasil dimuat.',
			data: {
				can_manage_all: manager.isAdmin,
				division_id: manager.divisionId,
				work_catalogs: rows.map((row) => {
					const definition = parseFormDefinition(row.definition_json);
					return {
						...row,
						is_active: Number(row.is_active) === 1,
						target_sla_minutes: row.target_sla_minutes === null ? null : Number(row.target_sla_minutes),
						form_version_id: row.form_version_id === null ? null : Number(row.form_version_id),
						version_number: row.version_number === null ? null : Number(row.version_number),
						form_fields: definition.fields,
						form_repeatable: definition.repeatable ?? null,
						form_credit_routing: definition.credit_routing ?? null,
						available_fields: fieldRows
							.filter((field) => field.division_id === null || Number(field.division_id) === Number(row.divisi_id))
							.map(catalogFieldResponse)
					};
				})
			}
		});
	} catch (error) {
		const status = error instanceof FormManagementError ? error.statusCode : 500;
		response.status(status).json({
			status,
			message: error instanceof FormManagementError ? error.message : 'Daftar form belum dapat dimuat. Coba lagi.',
			data: null
		});
	}
});

formsRouter.post('/manage/:catalogId/fields', async (request, response) => {
	const catalogId = Number(request.params.catalogId);
	const parsed = customFieldCreateSchema.safeParse(request.body);
	if (!Number.isSafeInteger(catalogId) || catalogId < 1) {
		response.status(400).json({ status: 400, message: 'Jenis pekerjaan tidak valid.', data: null });
		return;
	}
	if (!parsed.success) {
		response.status(400).json({ status: 400, message: validationIssueMessage(parsed.error), data: null });
		return;
	}
	try {
		const manager = await getManagerAccess(response.locals.slaEmployeeId);
		const [catalogRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number; divisi_id: number }>>(
			`SELECT id, divisi_id FROM work_catalogs WHERE id = ? LIMIT 1`, [catalogId]
		);
		const catalog = catalogRows[0];
		if (!catalog) throw new FormManagementError(404, 'Jenis pekerjaan tidak ditemukan.');
		if (!manager.isAdmin && Number(catalog.divisi_id) !== manager.divisionId) {
			throw new FormManagementError(403, 'Kamu hanya dapat menambah field untuk divisi pada profil SSO kamu.');
		}
		const [duplicateRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
			`SELECT id FROM form_field_catalog
			WHERE label = ? AND (division_id IS NULL OR division_id = ?) LIMIT 1`,
			[parsed.data.label, catalog.divisi_id]
		);
		if (duplicateRows.length) throw new FormManagementError(409, 'Nama field sudah tersedia di katalog Divisi ini. Pilih nama lain.');
		const [existingKeys] = await mysqlPool.execute<Array<RowDataPacket & { field_key: string }>>(
			'SELECT field_key FROM form_field_catalog'
		);
		const used = new Set(existingKeys.map((field) => field.field_key));
		const fieldKey = makeFieldKey(parsed.data.label, 0, used);
		const options = parsed.data.type === 'select' ? parsed.data.options ?? [] : null;
		const [insert] = await mysqlPool.execute<ResultSetHeader>(
			`INSERT INTO form_field_catalog
				(division_id, field_key, label, field_type, options_json, is_standard, is_derived, created_by_user_id)
			VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
			[catalog.divisi_id, fieldKey, parsed.data.label, parsed.data.type, options === null ? null : JSON.stringify(options), manager.userId]
		);
		response.status(201).json({ status: 201, message: 'Field khusus berhasil ditambahkan ke katalog Divisi.', data: {
			id: Number(insert.insertId), division_id: Number(catalog.divisi_id), key: fieldKey, label: parsed.data.label,
			type: parsed.data.type, options, calculation: null, is_standard: false, is_derived: false
		} });
	} catch (error) {
		const duplicateField = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
		const status = error instanceof FormManagementError ? error.statusCode : duplicateField ? 409 : 500;
		response.status(status).json({
			status,
			message: error instanceof FormManagementError ? error.message : duplicateField ? 'Nama field sudah tersedia di katalog Divisi ini. Pilih nama lain.' : 'Field khusus belum dapat ditambahkan. Coba lagi.',
			data: null
		});
	}
});

formsRouter.get('/manage/rejection-reasons', async (request, response) => {
	const catalogId = Number(request.query.catalog_id);
	if (!Number.isSafeInteger(catalogId) || catalogId < 1) {
		response.status(400).json({ status: 400, message: 'Pilih jenis pekerjaan untuk mengelola alasan penolakan.', data: null });
		return;
	}
	try {
		const manager = await getManagerAccess(response.locals.slaEmployeeId);
		const [catalogRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number; divisi_id: number }>>(
			'SELECT id, divisi_id FROM work_catalogs WHERE id = ? LIMIT 1', [catalogId]
		);
		const catalog = catalogRows[0];
		if (!catalog) throw new FormManagementError(404, 'Jenis pekerjaan tidak ditemukan.');
		if (!manager.isAdmin && Number(catalog.divisi_id) !== manager.divisionId) throw new FormManagementError(403, 'Kamu hanya dapat mengelola alasan untuk divisi pada profil SSO kamu.');
		const [reasons] = await mysqlPool.execute<Array<RowDataPacket & {
			id: number; scope_type: string; division_id: number | null; work_catalog_id: number | null;
			code: string; label: string; is_active: number; sort_order: number;
		}>>(
			`SELECT id, scope_type, division_id, work_catalog_id, code, label, is_active, sort_order
			FROM rejection_reasons
			WHERE scope_type = 'system' OR (scope_type = 'division' AND division_id = ?)
				OR (scope_type = 'catalog' AND division_id = ? AND work_catalog_id = ?)
			ORDER BY FIELD(scope_type, 'system', 'division', 'catalog'), sort_order, label`,
			[catalog.divisi_id, catalog.divisi_id, catalogId]
		);
		response.status(200).json({ status: 200, message: 'Pengaturan alasan penolakan berhasil dimuat.', data: {
			can_manage_system: manager.isAdmin,
			reasons: reasons.map((reason) => ({ ...reason, id: Number(reason.id), is_active: Number(reason.is_active) === 1 }))
		} });
	} catch (error) {
		const status = error instanceof FormManagementError ? error.statusCode : 500;
		response.status(status).json({ status, message: error instanceof FormManagementError ? error.message : 'Pengaturan alasan belum dapat dimuat. Coba lagi.', data: null });
	}
});

formsRouter.post('/manage/rejection-reasons', async (request, response) => {
	const parsed = rejectionReasonCreateSchema.safeParse(request.body);
	if (!parsed.success) { response.status(400).json({ status: 400, message: 'Periksa jenis alasan dan nama yang dimasukkan.', data: null }); return; }
	try {
		const manager = await getManagerAccess(response.locals.slaEmployeeId);
		const [catalogRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number; divisi_id: number }>>(
			'SELECT id, divisi_id FROM work_catalogs WHERE id = ? LIMIT 1', [parsed.data.catalog_id]
		);
		const catalog = catalogRows[0];
		if (!catalog) throw new FormManagementError(404, 'Jenis pekerjaan tidak ditemukan.');
		if (parsed.data.scope_type === 'system' && !manager.isAdmin) throw new FormManagementError(403, 'Hanya Admin global yang dapat mengelola alasan sistem.');
		if (parsed.data.scope_type !== 'system' && !manager.isAdmin && Number(catalog.divisi_id) !== manager.divisionId) {
			throw new FormManagementError(403, 'Kamu hanya dapat menambahkan alasan untuk divisi pada profil SSO kamu.');
		}
		const scope = parsed.data.scope_type;
		const divisionId = scope === 'system' ? null : Number(catalog.divisi_id);
		const workCatalogId = scope === 'catalog' ? parsed.data.catalog_id : null;
		const [duplicates] = await mysqlPool.execute<RowDataPacket[]>(
			`SELECT id FROM rejection_reasons WHERE scope_type = ? AND division_id <=> ? AND work_catalog_id <=> ?
				AND LOWER(label) = LOWER(?) LIMIT 1`, [scope, divisionId, workCatalogId, parsed.data.label]
		);
		if (duplicates.length) throw new FormManagementError(409, 'Alasan dengan nama yang sama sudah ada pada cakupan ini.');
		const code = parsed.data.label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
			.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'custom_reason';
		const [result] = await mysqlPool.execute<ResultSetHeader>(
			`INSERT INTO rejection_reasons (scope_type, division_id, work_catalog_id, code, label, sort_order, created_by_user_id)
			VALUES (?, ?, ?, ?, ?, 200, ?)`,
			[scope, divisionId, workCatalogId, code, parsed.data.label, manager.userId]
		);
		response.status(201).json({ status: 201, message: 'Alasan penolakan berhasil ditambahkan.', data: { id: Number(result.insertId) } });
	} catch (error) {
		const status = error instanceof FormManagementError ? error.statusCode : 500;
		response.status(status).json({ status, message: error instanceof FormManagementError ? error.message : 'Alasan penolakan belum dapat ditambahkan. Coba lagi.', data: null });
	}
});

formsRouter.patch('/manage/rejection-reasons/:reasonId', async (request, response) => {
	const reasonId = Number(request.params.reasonId);
	const parsed = rejectionReasonActiveSchema.safeParse(request.body);
	if (!Number.isSafeInteger(reasonId) || reasonId < 1 || !parsed.success) { response.status(400).json({ status: 400, message: 'Perubahan status alasan tidak valid.', data: null }); return; }
	try {
		const manager = await getManagerAccess(response.locals.slaEmployeeId);
		const [reasonRows] = await mysqlPool.execute<Array<RowDataPacket & {
			id: number; scope_type: string; division_id: number | null; work_catalog_id: number | null;
		}>>('SELECT id, scope_type, division_id, work_catalog_id FROM rejection_reasons WHERE id = ? LIMIT 1', [reasonId]);
		const reason = reasonRows[0];
		if (!reason) throw new FormManagementError(404, 'Alasan penolakan tidak ditemukan.');
		if (reason.scope_type === 'system' ? !manager.isAdmin : !manager.isAdmin && Number(reason.division_id) !== manager.divisionId) {
			throw new FormManagementError(403, 'Kamu tidak dapat mengubah alasan pada cakupan ini.');
		}
		await mysqlPool.execute('UPDATE rejection_reasons SET is_active = ? WHERE id = ?', [parsed.data.is_active ? 1 : 0, reasonId]);
		response.status(200).json({ status: 200, message: parsed.data.is_active ? 'Alasan penolakan diaktifkan.' : 'Alasan penolakan dinonaktifkan.', data: { id: reasonId } });
	} catch (error) {
		const status = error instanceof FormManagementError ? error.statusCode : 500;
		response.status(status).json({ status, message: error instanceof FormManagementError ? error.message : 'Status alasan belum dapat diperbarui. Coba lagi.', data: null });
	}
});

formsRouter.post('/manage/:catalogId/publish', async (request, response) => {
	const catalogId = Number(request.params.catalogId);
	const parsed = publishSchema.safeParse(request.body);
	if (!Number.isSafeInteger(catalogId) || catalogId < 1) {
		response.status(400).json({ status: 400, message: 'Jenis pekerjaan tidak valid.', data: null });
		return;
	}
	if (!parsed.success) {
		response.status(400).json({ status: 400, message: validationIssueMessage(parsed.error), data: null });
		return;
	}

	const connection = await mysqlPool.getConnection();
	try {
		const manager = await getManagerAccess(response.locals.slaEmployeeId);
		await connection.beginTransaction();
		const [catalogRows] = await connection.execute<Array<RowDataPacket & {
			id: number; divisi_id: number; system_key: string | null;
		}>>(
			`SELECT catalog.id, catalog.divisi_id, catalog.system_key
			FROM work_catalogs catalog
			INNER JOIN master_divisi division ON division.id = catalog.divisi_id AND division.is_active = 1
			WHERE catalog.id = ? FOR UPDATE`,
			[catalogId]
		);
		const catalog = catalogRows[0];
		if (!catalog) throw new FormManagementError(404, 'Jenis pekerjaan tidak ditemukan.');
		if (!manager.isAdmin && Number(catalog.divisi_id) !== manager.divisionId) {
			throw new FormManagementError(403, 'Kamu hanya dapat menerbitkan form untuk divisi pada profil SSO kamu.');
		}
		const isCredit = catalog.system_key === 'credit_application';
		if (!isCredit && parsed.data.credit_routing) {
			throw new FormManagementError(400, 'Pengaturan ambang kredit hanya berlaku untuk katalog Pengajuan Kredit.');
		}
		const maxCustomFields = catalog.system_key === 'credit_application' ? 39 : 40;
		if (parsed.data.fields.length > maxCustomFields) {
			throw new FormManagementError(400, `Form ini maksimal memiliki ${maxCustomFields} kolom tambahan${catalog.system_key === 'credit_application' ? ' karena nilai kredit dihitung sebagai kolom sistem' : ''}.`);
		}
		if (catalog.system_key === 'credit_application' && parsed.data.repeatable) {
			throw new FormManagementError(400, 'Form Pengajuan Kredit tidak dapat diatur sebagai data berulang.');
		}

		const normalizedFields = await normalizePublisherFields(connection, Number(catalog.divisi_id), parsed.data.fields, catalog.system_key === 'credit_application');
		if (normalizedFields.filter((field) => !field.system).length > maxCustomFields) {
			throw new FormManagementError(400, `Form ini maksimal memiliki ${maxCustomFields} kolom tambahan${catalog.system_key === 'credit_application' ? ' karena nilai kredit dihitung sebagai kolom sistem' : ''}.`);
		}
		const parsedDefinition = formDefinitionSchema.safeParse({
			fields: normalizedFields,
			...(parsed.data.repeatable ? { repeatable: parsed.data.repeatable } : {}),
			...(isCredit ? { credit_routing: DEFAULT_CREDIT_ROUTING_CONFIG } : {})
		});
		if (!parsedDefinition.success) {
			throw new FormManagementError(400, validationIssueMessage(parsedDefinition.error, catalog.system_key === 'credit_application' ? 1 : 0));
		}
		const definition = parsedDefinition.data;
		const [versionRows] = await connection.execute<Array<RowDataPacket & { next_version: number }>>(
			'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM work_catalog_form_versions WHERE work_catalog_id = ?',
			[catalogId]
		);
		const versionNumber = Number(versionRows[0]?.next_version ?? 1);
		const [insert] = await connection.execute<ResultSetHeader>(
			`INSERT INTO work_catalog_form_versions
				(work_catalog_id, version_number, definition_json, published_by_user_id)
			VALUES (?, ?, ?, ?)`,
			[catalogId, versionNumber, JSON.stringify(definition), manager.userId]
		);
		await connection.commit();
		response.status(201).json({
			status: 201,
			message: `Form berhasil diterbitkan sebagai versi ${versionNumber}.`,
			data: { id: Number(insert.insertId), version_number: versionNumber }
		});
	} catch (error) {
		await connection.rollback();
		const status = error instanceof FormManagementError ? error.statusCode : 500;
		response.status(status).json({
			status,
			message: error instanceof FormManagementError ? error.message : 'Form belum dapat diterbitkan. Coba lagi.',
			data: null
		});
	} finally {
		connection.release();
	}
});
