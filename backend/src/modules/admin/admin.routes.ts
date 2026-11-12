import { Router } from 'express';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../../db/client.js';
import { normalizeSsoUnitName } from '../organization/sso-scope.js';
import {
	AdminUserAccessError,
	getAdminAccessOptions,
	listAdminUsers,
	updateAdminUserAccess
} from './admin-users.service.js';
import { requireSlaAdmin } from '../auth/admin.middleware.js';
import { DEFAULT_SLA_MINUTES } from '../../shared/sla.js';

type DivisionRow = RowDataPacket & {
	id: number;
	kode: string;
	nama_divisi: string;
	is_active: number;
};

type DivisionAliasRow = RowDataPacket & { division_id: number; unit_kerja: string };

type WorkCatalogRow = RowDataPacket & {
	id: number;
	divisi_id: number;
	kode_divisi: string;
	nama_divisi: string;
	nama_pekerjaan: string;
	deskripsi: string | null;
	target_sla_minutes: number | null;
	routing_flow: 'branch_korwil_central' | 'branch_central';
	is_active: number;
	updated_at: Date;
};

const workCatalogSchema = z.object({
	divisi_id: z.number().int().positive(),
	nama_pekerjaan: z.string().trim().min(1).max(160),
	deskripsi: z.string().trim().max(500).nullable(),
	target_sla_minutes: z.number().int().positive().nullable(),
	routing_flow: z.enum(['branch_korwil_central', 'branch_central']),
	is_active: z.boolean()
});

const divisionUpdateSchema = z.object({
	nama_divisi: z.string().trim().min(1).max(120),
	sso_unit_kerja_aliases: z.array(z.string().trim().min(1).max(150)).max(30)
}).strict();

const userAssignmentSchema = z.object({
	role_id: z.number().int().positive(),
	scope_type: z.enum(['global', 'office', 'korwil', 'division']),
	kode_kantor: z.string().length(3).nullable().default(null),
	korwil: z.string().trim().min(1).max(20).nullable(),
	divisi_id: z.number().int().positive().nullable(),
	can_manage_forms: z.boolean().default(false)
}).strict();

const userAccessSchema = z.object({
	is_active: z.boolean(),
	assignments: z.array(userAssignmentSchema).max(20)
}).strict();

export const adminRouter = Router();
adminRouter.use(requireSlaAdmin);

adminRouter.get('/master-data', async (_request, response) => {
	try {
		const [divisions] = await mysqlPool.execute<DivisionRow[]>(
			`SELECT id, kode, nama_divisi, is_active
			FROM master_divisi
			ORDER BY nama_divisi`
		);
		const [divisionAliases] = await mysqlPool.execute<DivisionAliasRow[]>(
			`SELECT division_id, unit_kerja FROM division_sso_unit_aliases
			ORDER BY unit_kerja`
		);
		const [workCatalogs] = await mysqlPool.execute<WorkCatalogRow[]>(
			`SELECT catalog.id, catalog.divisi_id, division.kode AS kode_divisi,
				division.nama_divisi, catalog.nama_pekerjaan, catalog.deskripsi,
				catalog.target_sla_minutes, catalog.routing_flow, catalog.is_active, catalog.updated_at
			FROM work_catalogs catalog
			INNER JOIN master_divisi division ON division.id = catalog.divisi_id
			ORDER BY division.nama_divisi, catalog.nama_pekerjaan`
		);

		response.status(200).json({
			status: 200,
			message: 'Master divisi dan pekerjaan berhasil dimuat.',
			data: {
				divisions: divisions.map((division) => ({
					...division,
					is_active: Number(division.is_active) === 1,
					sso_unit_kerja_aliases: divisionAliases
						.filter((alias) => Number(alias.division_id) === Number(division.id))
						.map((alias) => alias.unit_kerja)
				})),
				work_catalogs: workCatalogs.map((catalog) => ({
					...catalog,
					target_sla_minutes: catalog.target_sla_minutes === null
						? DEFAULT_SLA_MINUTES
						: Number(catalog.target_sla_minutes),
					is_active: Number(catalog.is_active) === 1
				}))
			}
		});
	} catch {
		response.status(500).json({
			status: 500,
			message: 'Master belum dapat dimuat. Coba muat ulang halaman.',
			data: null
		});
	}
});

adminRouter.put('/divisions/:id', async (request, response) => {
	const id = Number(request.params.id);
	const parsed = divisionUpdateSchema.safeParse(request.body);
	if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
		response.status(400).json({ status: 400, message: 'Nama divisi dan daftar unit SSO belum valid.', data: null });
		return;
	}

	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		const [divisionRows] = await connection.execute<Array<RowDataPacket & {
			id: number; nama_divisi: string;
		}>>(
			'SELECT id, nama_divisi FROM master_divisi WHERE id = ? LIMIT 1 FOR UPDATE', [id]
		);
		const existing = divisionRows[0];
		if (!existing) {
			await connection.rollback();
			response.status(404).json({ status: 404, message: 'Divisi tidak ditemukan.', data: null });
			return;
		}

		const aliasMap = new Map<string, string>();
		for (const alias of parsed.data.sso_unit_kerja_aliases) {
			const unitName = alias.replace(/\s+/g, ' ').trim();
			const key = normalizeSsoUnitName(unitName);
			if (key) aliasMap.set(key, unitName);
		}
		const oldNameKey = normalizeSsoUnitName(existing.nama_divisi);
		if (oldNameKey && !aliasMap.has(oldNameKey)) aliasMap.set(oldNameKey, existing.nama_divisi);
		const newName = parsed.data.nama_divisi.replace(/\s+/g, ' ').trim();
		const newNameKey = normalizeSsoUnitName(newName);
		if (!newNameKey) {
			await connection.rollback();
			response.status(400).json({ status: 400, message: 'Nama divisi harus memuat huruf atau angka.', data: null });
			return;
		}
		if (!aliasMap.has(newNameKey)) aliasMap.set(newNameKey, newName);
		const aliases = [...aliasMap.entries()].map(([unit_kerja_key, unit_kerja]) => ({ unit_kerja_key, unit_kerja }));
		const keys = aliases.map((alias) => alias.unit_kerja_key);
		const [conflicts] = keys.length
			? await connection.execute<RowDataPacket[]>(
				`SELECT id FROM division_sso_unit_aliases
				WHERE division_id <> ? AND unit_kerja_key IN (${keys.map(() => '?').join(', ')}) LIMIT 1`,
				[id, ...keys]
			)
			: [[], []];
		if (conflicts.length > 0) {
			await connection.rollback();
			response.status(409).json({ status: 409, message: 'Nama unit SSO sudah dipetakan ke divisi lain.', data: null });
			return;
		}

		await connection.execute('UPDATE master_divisi SET nama_divisi = ? WHERE id = ?', [newName, id]);
		await connection.execute('DELETE FROM division_sso_unit_aliases WHERE division_id = ?', [id]);
		for (const alias of aliases) {
			await connection.execute(
				`INSERT INTO division_sso_unit_aliases (division_id, unit_kerja, unit_kerja_key)
				VALUES (?, ?, ?)`,
				[id, alias.unit_kerja, alias.unit_kerja_key]
			);
		}
		await connection.commit();
		response.status(200).json({ status: 200, message: 'Divisi dan pemetaan unit SSO berhasil diperbarui.', data: { id } });
	} catch (error) {
		await connection.rollback();
		if (isDuplicateEntry(error)) {
			response.status(409).json({ status: 409, message: 'Nama divisi atau unit SSO sudah digunakan.', data: null });
			return;
		}
		response.status(500).json({ status: 500, message: 'Perubahan divisi belum dapat disimpan. Coba lagi.', data: null });
	} finally {
		connection.release();
	}
});

adminRouter.get('/users', async (_request, response) => {
	try {
		const users = await listAdminUsers();
		response.status(200).json({
			status: 200,
			message: 'Daftar pengguna berhasil dimuat.',
			data: { users }
		});
	} catch {
		response.status(500).json({ status: 500, message: 'Daftar pengguna belum dapat dimuat. Coba lagi.', data: null });
	}
});

adminRouter.get('/users/workspace', async (_request, response) => {
	try {
		const [users, options] = await Promise.all([listAdminUsers(), getAdminAccessOptions()]);
		response.status(200).json({
			status: 200,
			message: 'Workspace akses pegawai berhasil dimuat.',
			data: { profile: response.locals.slaAdminProfile, users, ...options }
		});
	} catch {
		response.status(500).json({ status: 500, message: 'Data akses pegawai belum dapat dimuat. Coba lagi.', data: null });
	}
});

adminRouter.get('/access-options', async (_request, response) => {
	try {
		const options = await getAdminAccessOptions();
		response.status(200).json({
			status: 200,
			message: 'Pilihan peran dan cakupan berhasil dimuat.',
			data: options
		});
	} catch {
		response.status(500).json({ status: 500, message: 'Pilihan akses belum dapat dimuat. Coba lagi.', data: null });
	}
});

adminRouter.put('/users/:id/access', async (request, response) => {
	const userId = Number(request.params.id);
	const parsed = userAccessSchema.safeParse(request.body);
	const actorEmployeeId = response.locals.slaAdminEmployeeId;
	if (!Number.isSafeInteger(userId) || userId < 1 || !parsed.success || typeof actorEmployeeId !== 'string') {
		response.status(400).json({ status: 400, message: 'Data akses pegawai belum valid.', data: null });
		return;
	}

	try {
		await updateAdminUserAccess(userId, actorEmployeeId, parsed.data);
		response.status(200).json({ status: 200, message: 'Status dan akses pegawai berhasil diperbarui.', data: { id: userId } });
	} catch (error) {
		if (error instanceof AdminUserAccessError) {
			response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
			return;
		}
		response.status(500).json({ status: 500, message: 'Perubahan akses belum dapat disimpan. Coba lagi.', data: null });
	}
});

adminRouter.post('/work-catalogs', async (request, response) => {
	const parsed = workCatalogSchema.safeParse(request.body);
	if (!parsed.success) {
		response.status(400).json({
			status: 400,
			message: 'Periksa kembali nama pekerjaan, divisi, dan target SLA.',
			data: null
		});
		return;
	}
	if (parsed.data.nama_pekerjaan.toLocaleLowerCase('id-ID').startsWith('pengajuan kredit')) {
		response.status(409).json({ status: 409, message: 'Nama Pengajuan Kredit disediakan untuk katalog routing otomatis.', data: null });
		return;
	}

	try {
		const [divisions] = await mysqlPool.execute<DivisionRow[]>(
			'SELECT id, kode, nama_divisi, is_active FROM master_divisi WHERE id = ? LIMIT 1',
			[parsed.data.divisi_id]
		);
		if (!divisions[0] || Number(divisions[0].is_active) !== 1) {
			response.status(400).json({
				status: 400,
				message: 'Divisi tujuan tidak ditemukan atau sedang nonaktif.',
				data: null
			});
			return;
		}

		const [result] = await mysqlPool.execute<ResultSetHeader>(
			`INSERT INTO work_catalogs
				(divisi_id, nama_pekerjaan, deskripsi, target_sla_minutes, routing_flow, is_active)
			VALUES (?, ?, ?, ?, ?, ?)`,
			[
				parsed.data.divisi_id,
				parsed.data.nama_pekerjaan,
				parsed.data.deskripsi || null,
				parsed.data.target_sla_minutes ?? DEFAULT_SLA_MINUTES,
				parsed.data.routing_flow,
				parsed.data.is_active ? 1 : 0
			]
		);

		response.status(201).json({
			status: 201,
			message: 'Pekerjaan berhasil ditambahkan.',
			data: { id: result.insertId }
		});
	} catch (error) {
		if (isDuplicateEntry(error)) {
			response.status(409).json({
				status: 409,
				message: 'Nama pekerjaan tersebut sudah terdaftar pada divisi ini.',
				data: null
			});
			return;
		}
		response.status(500).json({
			status: 500,
			message: 'Pekerjaan belum dapat disimpan. Coba lagi.',
			data: null
		});
	}
});

adminRouter.put('/work-catalogs/:id', async (request, response) => {
	const id = Number(request.params.id);
	const parsed = workCatalogSchema.safeParse(request.body);
	if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
		response.status(400).json({
			status: 400,
			message: 'Data pekerjaan belum valid. Periksa kembali isian form.',
			data: null
		});
		return;
	}

	try {
		const [existing] = await mysqlPool.execute<Array<RowDataPacket & { id: number; system_key: string | null }>>(
			'SELECT id, system_key FROM work_catalogs WHERE id = ? LIMIT 1',
			[id]
		);
		if (!existing[0]) {
			response.status(404).json({ status: 404, message: 'Pekerjaan tidak ditemukan.', data: null });
			return;
		}

		const [divisions] = await mysqlPool.execute<DivisionRow[]>(
			'SELECT id, kode, nama_divisi, is_active FROM master_divisi WHERE id = ? LIMIT 1',
			[parsed.data.divisi_id]
		);
		if (!divisions[0] || Number(divisions[0].is_active) !== 1) {
			response.status(400).json({
				status: 400,
				message: 'Divisi tujuan tidak ditemukan atau sedang nonaktif.',
				data: null
			});
			return;
		}
		const isCreditCatalog = existing[0].system_key === 'credit_application';
		if ((!isCreditCatalog && parsed.data.nama_pekerjaan.toLocaleLowerCase('id-ID').startsWith('pengajuan kredit')) ||
			(isCreditCatalog && (divisions[0].kode !== 'pemasaran' || !parsed.data.is_active))) {
			response.status(409).json({ status: 409, message: 'Katalog Pengajuan Kredit harus tetap aktif di Divisi Pemasaran dan tidak dapat digandakan.', data: null });
			return;
		}

		await mysqlPool.execute(
			`UPDATE work_catalogs
			SET divisi_id = ?, nama_pekerjaan = ?, deskripsi = ?,
				target_sla_minutes = ?, routing_flow = ?, is_active = ?
			WHERE id = ?`,
			[
				parsed.data.divisi_id,
				parsed.data.nama_pekerjaan,
				parsed.data.deskripsi || null,
				parsed.data.target_sla_minutes ?? DEFAULT_SLA_MINUTES,
				parsed.data.routing_flow,
				parsed.data.is_active ? 1 : 0,
				id
			]
		);

		response.status(200).json({ status: 200, message: 'Pekerjaan berhasil diperbarui.', data: { id } });
	} catch (error) {
		if (isDuplicateEntry(error)) {
			response.status(409).json({
				status: 409,
				message: 'Nama pekerjaan tersebut sudah terdaftar pada divisi ini.',
				data: null
			});
			return;
		}
		response.status(500).json({
			status: 500,
			message: 'Perubahan pekerjaan belum dapat disimpan. Coba lagi.',
			data: null
		});
	}
});

function isDuplicateEntry(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}
