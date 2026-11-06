import { Router } from 'express';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import { formDefinitionSchema, parseFormDefinition, type FormFieldDefinition } from './form-schema.js';

type ManagerAccess = { userId: number; divisionId: number | null; isAdmin: boolean };

class FormManagementError extends Error {
	constructor(public readonly statusCode: number, message: string) {
		super(message);
		this.name = 'FormManagementError';
	}
}

const editorFieldSchema = z.object({
	label: z.string().trim().min(1).max(160),
	type: z.enum(['text', 'textarea', 'number', 'currency', 'date', 'select']),
	required: z.boolean(),
	options: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
	min_value: z.number().finite().optional(),
	max_value: z.number().finite().optional()
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
});

const publishSchema = z.object({ fields: z.array(editorFieldSchema).max(39) }).strict();

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

function normalizePublisherFields(fields: z.infer<typeof publishSchema>['fields'], isCredit: boolean): FormFieldDefinition[] {
	const used = new Set<string>(isCredit ? ['credit_amount'] : []);
	const customFields = fields.map((field, index) => ({
		key: makeFieldKey(field.label, index, used),
		...field,
		options: field.type === 'select' ? field.options : undefined
	}));
	if (!isCredit) return customFields;
	return [{
		key: 'credit_amount',
		label: 'Nilai pengajuan kredit (Rp)',
		type: 'currency',
		required: true,
		min_value: 250000000,
		system: true
	}, ...customFields];
}

export const formsRouter = Router();
formsRouter.use(requireRequestIdentity);

formsRouter.get('/manage', async (_request, response) => {
	try {
		const manager = await getManagerAccess(response.locals.slaEmployeeId);
		const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
			id: number; divisi_id: number; kode_divisi: string; nama_divisi: string;
			nama_pekerjaan: string; deskripsi: string | null; target_sla_minutes: number | null;
			is_active: number; system_key: string | null; form_version_id: number | null;
			version_number: number | null; definition_json: unknown;
		}>>(
			`SELECT catalog.id, catalog.divisi_id, division.kode AS kode_divisi, division.nama_divisi,
				catalog.nama_pekerjaan, catalog.deskripsi, catalog.target_sla_minutes, catalog.is_active,
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
		response.status(200).json({
			status: 200,
			message: 'Daftar form pekerjaan berhasil dimuat.',
			data: {
				can_manage_all: manager.isAdmin,
				division_id: manager.divisionId,
				work_catalogs: rows.map((row) => ({
					...row,
					is_active: Number(row.is_active) === 1,
					target_sla_minutes: row.target_sla_minutes === null ? null : Number(row.target_sla_minutes),
					form_version_id: row.form_version_id === null ? null : Number(row.form_version_id),
					version_number: row.version_number === null ? null : Number(row.version_number),
					form_fields: parseFormDefinition(row.definition_json).fields
				}))
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

formsRouter.post('/manage/:catalogId/publish', async (request, response) => {
	const catalogId = Number(request.params.catalogId);
	const parsed = publishSchema.safeParse(request.body);
	if (!Number.isSafeInteger(catalogId) || catalogId < 1 || !parsed.success) {
		response.status(400).json({ status: 400, message: 'Periksa kembali field form yang akan diterbitkan.', data: null });
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

		const definition = formDefinitionSchema.parse({ fields: normalizePublisherFields(parsed.data.fields, catalog.system_key === 'credit_application') });
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
