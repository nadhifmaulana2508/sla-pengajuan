import type { RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { resolveSlaAccessDetails, type SlaAccess } from '../auth/access.service.js';
import { DEFAULT_SLA_MINUTES, getSlaStatus, SLA_WARNING_MINUTES, type SlaStatus } from '../../shared/sla.js';

export class DashboardError extends Error {
	constructor(public readonly statusCode: number, message: string) {
		super(message);
		this.name = 'DashboardError';
	}
}

type DashboardView = 'branch' | 'korwil' | 'division' | 'admin';
type DashboardAccess = {
	view: DashboardView;
	role: NonNullable<SlaAccess['role']>;
	scopeType: 'global' | 'office' | 'korwil' | 'division';
	kodeKantor: string | null;
	namaKantor: string | null;
	korwil: string | null;
	divisiId: number | null;
	divisiKode: string | null;
	namaDivisi: string | null;
};

type DashboardFilters = { from: string | null; to: string | null; korwil: string | null; divisionId: number | null };
export type BranchFollowUpFilters = { kodeKantor: string | null };
export const MANAGEMENT_REQUEST_STATUSES = [
	'waiting_korwil', 'in_progress_korwil', 'waiting_central', 'in_progress_central',
	'waiting_branch_revision', 'waiting_korwil_revision', 'completed', 'rejected'
] as const;
export type ManagementRequestStatus = typeof MANAGEMENT_REQUEST_STATUSES[number];
export type ManagementRequestFilters = {
	kodeKantor: string | null;
	korwil: string | null;
	divisionId: number | null;
	status: ManagementRequestStatus | null;
	slaStatus: SlaStatus | null;
	from: string | null;
	to: string | null;
	page: number;
	pageSize: number;
};
type DbParam = string | number | null;
type NumberRow = RowDataPacket & { value: number | string | null };
type RequestRow = RowDataPacket & {
	id: number;
	request_number: string;
	kode_kantor: string;
	nama_kantor: string;
	korwil: string;
	authority_type: 'korwil' | 'central';
	nama_divisi: string | null;
	nama_pekerjaan: string | null;
	subject: string;
	status: string;
	current_unit_type: string;
	current_unit_code: string;
	submitted_at: Date;
	closed_at: Date | null;
	overall_elapsed_seconds: number | string;
	active_elapsed_seconds: number | string | null;
	revision_count: number | string;
	sla_target_minutes?: number | string | null;
	sla_status?: SlaStatus;
};

const emptySummary = () => ({
	total: 0,
	waiting: 0,
	in_progress: 0,
	waiting_branch: 0,
	completed: 0,
	rejected: 0,
	revision_count: 0,
	total_age_seconds: 0,
	average_age_seconds: 0,
	total_process_seconds: 0
});

function asNumber(value: number | string | null | undefined): number {
	const result = Number(value ?? 0);
	return Number.isFinite(result) ? result : 0;
}

function queryValue(query: unknown): string | null {
	if (typeof query !== 'string' || query.trim().length === 0) return null;
	return query.trim();
}

function appendCondition(where: { sql: string; params: DbParam[] }, condition: string, params: DbParam[] = []) {
	return {
		sql: `${where.sql ? `${where.sql} AND ` : 'WHERE '}${condition}`,
		params: [...where.params, ...params]
	};
}

function buildScopeWhere(access: DashboardAccess, filters: DashboardFilters) {
	let where = { sql: '', params: [] as DbParam[] };
	if (access.view === 'branch' && access.kodeKantor) {
		where = appendCondition(where, 'request.kode_kantor = ?', [access.kodeKantor]);
	} else if (access.view === 'korwil' && access.korwil) {
		where = appendCondition(where, 'request.korwil = ?', [access.korwil]);
	} else if (access.view === 'division' && access.divisiId) {
		where = appendCondition(where, `EXISTS (
			SELECT 1 FROM request_status_histories division_history
			INNER JOIN master_divisi history_division ON history_division.id = ?
			WHERE division_history.request_id = request.id
				AND division_history.unit_to_type = 'central'
				AND division_history.unit_to_code = history_division.kode
		)`, [access.divisiId]);
	}
	if (access.view === 'admin' && filters.korwil) {
		where = appendCondition(where, 'request.korwil = ?', [filters.korwil]);
	}
	if (access.view === 'admin' && filters.divisionId !== null) {
		where = appendCondition(where, 'request.central_division_id = ?', [filters.divisionId]);
	}
	if (filters.from) where = appendCondition(where, 'request.submitted_at >= ?', [filters.from]);
	if (filters.to) where = appendCondition(where, 'request.submitted_at < DATE_ADD(?, INTERVAL 1 DAY)', [filters.to]);
	return where;
}

async function getDashboardAccess(employeeId: string): Promise<DashboardAccess> {
	const resolution = await resolveSlaAccessDetails(employeeId);
	const access = resolution.access;
	if (!access.enabled || !access.role || !access.scope) {
		throw new DashboardError(403, 'Akun aktif dengan peran dan cakupan dashboard belum ditetapkan.');
	}
	const assignment = resolution.assignment;
	if (!assignment) throw new DashboardError(403, 'Cakupan dashboard pada akun belum dapat dipetakan.');

	const view: DashboardView = access.role === 'branch_user'
		? 'branch'
		: access.role === 'korwil_staff' || access.role === 'korwil_approver'
			? 'korwil'
			: access.role === 'division_staff'
				? 'division'
				: 'admin';
	if (view === 'admin' && access.scope !== 'all') {
		throw new DashboardError(403, 'Dashboard global hanya tersedia untuk assignment global.');
	}
	const expectedScope = assignment.scopeType;
	let kodeKantor: string | null = assignment.kodeKantor;
	let namaKantor: string | null = null;
	let korwil: string | null = assignment.korwil;
	let divisiId: number | null = assignment.divisiId;
	let divisiKode: string | null = null;
	let namaDivisi: string | null = null;

	if (view === 'branch') {
		const [officeRows] = await mysqlPool.execute<Array<RowDataPacket & {
			kode_kantor: string;
			nama_kantor: string;
			korwil: string;
		}>>(
			`SELECT kode_kantor, nama_kantor, korwil FROM master_kantor
			WHERE kode_kantor = ? AND is_active = 1 LIMIT 1`, [assignment.kodeKantor]
		);
		const office = officeRows[0];
		if (!office) throw new DashboardError(403, 'Cakupan kantor pada akun belum dapat dipetakan.');
		kodeKantor = office.kode_kantor;
		namaKantor = office.nama_kantor;
		korwil = office.korwil;
	} else if (view === 'division') {
		const [divisionRows] = await mysqlPool.execute<Array<RowDataPacket & {
			id: number;
			kode: string;
			nama_divisi: string;
		}>>(
			`SELECT id, kode, nama_divisi FROM master_divisi
			WHERE id = ? AND is_active = 1 LIMIT 1`, [assignment.divisiId]
		);
		const division = divisionRows[0];
		if (!division) throw new DashboardError(403, 'Cakupan Divisi Pusat pada akun belum dapat dipetakan.');
		divisiId = division.id;
		divisiKode = division.kode;
		namaDivisi = division.nama_divisi;
	}
	return {
		view,
		role: access.role,
		scopeType: expectedScope,
		kodeKantor,
		namaKantor,
		korwil,
		divisiId,
		divisiKode,
		namaDivisi
	};
}

async function countRequests(where: { sql: string; params: DbParam[] }): Promise<number> {
	const [rows] = await mysqlPool.execute<NumberRow[]>(
		`SELECT COUNT(*) AS value FROM service_requests request ${where.sql}`, where.params
	);
	return asNumber(rows[0]?.value);
}

async function sumAge(where: { sql: string; params: DbParam[] }): Promise<number> {
	const [rows] = await mysqlPool.execute<NumberRow[]>(
		`SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, request.submitted_at,
			COALESCE(request.closed_at, CURRENT_TIMESTAMP(3)))), 0) AS value
		FROM service_requests request ${where.sql}`,
		where.params
	);
	return asNumber(rows[0]?.value);
}

async function countRevisions(where: { sql: string; params: DbParam[] }): Promise<number> {
	const revisionWhere = appendCondition(where, `EXISTS (
		SELECT 1 FROM request_status_histories revision
		WHERE revision.request_id = request.id AND revision.action_name = 'branch_revision_submitted'
	)`);
	return countRequests(revisionWhere);
}

async function getStatusCounts(where: { sql: string; params: DbParam[] }) {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { status: string; count: number | string }>>(
		`SELECT request.status, COUNT(*) AS count
		FROM service_requests request ${where.sql}
		GROUP BY request.status ORDER BY count DESC, request.status`,
		where.params
	);
	return rows.map((row) => ({ status: row.status, count: asNumber(row.count) }));
}

async function getUnitDuration(where: { sql: string; params: DbParam[] }, unitType: 'korwil' | 'central', unitCode: string | null) {
	if (!unitCode) return 0;
	const [rows] = await mysqlPool.execute<NumberRow[]>(
		`SELECT COALESCE(SUM(CASE WHEN session.unit_type = ? AND session.unit_code = ? AND session.started_at IS NOT NULL
			THEN TIMESTAMPDIFF(SECOND, session.started_at, COALESCE(session.ended_at, CURRENT_TIMESTAMP(3))) ELSE 0 END), 0) AS value
		FROM service_requests request
		LEFT JOIN request_sla_sessions session ON session.request_id = request.id
		${where.sql}`,
		[unitType, unitCode, ...where.params]
	);
	return asNumber(rows[0]?.value);
}

function latestDocumentsCondition(unitType: 'korwil' | 'central', unitCode: string) {
	return {
		condition: `request.status = 'waiting_branch_revision' AND request.current_unit_type = 'branch' AND EXISTS (
			SELECT 1 FROM request_status_histories latest_documents
			WHERE latest_documents.request_id = request.id
				AND latest_documents.action_name = 'request_documents'
				AND latest_documents.unit_from_type = ?
				AND latest_documents.unit_from_code = ?
				AND NOT EXISTS (
					SELECT 1 FROM request_status_histories newer_documents
					WHERE newer_documents.request_id = latest_documents.request_id
						AND newer_documents.action_name = 'request_documents'
						AND newer_documents.id > latest_documents.id
				)
		)`,
		params: [unitType, unitCode]
	};
}

async function getRequests(where: { sql: string; params: DbParam[] }, limit = 100, offset = 0) {
	const [rows] = await mysqlPool.execute<RequestRow[]>(
		`SELECT request.id, request.request_number, request.kode_kantor, office.nama_kantor,
			request.korwil, request.authority_type, division.nama_divisi, catalog.nama_pekerjaan,
			request.subject, request.status, request.current_unit_type, request.current_unit_code,
			request.submitted_at, request.closed_at,
			COALESCE(catalog.target_sla_minutes, ${DEFAULT_SLA_MINUTES}) AS sla_target_minutes,
			TIMESTAMPDIFF(SECOND, request.submitted_at, COALESCE(request.closed_at, CURRENT_TIMESTAMP(3))) AS overall_elapsed_seconds,
			(SELECT TIMESTAMPDIFF(SECOND, timer.started_at, COALESCE(timer.ended_at, CURRENT_TIMESTAMP(3)))
				FROM request_sla_sessions timer
				WHERE timer.request_id = request.id AND timer.ended_at IS NULL AND timer.started_at IS NOT NULL
				ORDER BY timer.id DESC LIMIT 1) AS active_elapsed_seconds,
			(SELECT COUNT(*) FROM request_status_histories revision
			WHERE revision.request_id = request.id AND revision.action_name = 'branch_revision_submitted') AS revision_count
		FROM service_requests request
		INNER JOIN master_kantor office ON office.kode_kantor = request.kode_kantor
		LEFT JOIN master_divisi division ON division.id = request.central_division_id
		LEFT JOIN work_catalogs catalog ON catalog.id = request.work_catalog_id
		${where.sql}
		ORDER BY request.updated_at DESC, request.id DESC LIMIT ? OFFSET ?`,
		[...where.params, limit, offset]
	);
	return rows.map((row) => ({
		...row,
		overall_elapsed_seconds: asNumber(row.overall_elapsed_seconds),
		active_elapsed_seconds: row.active_elapsed_seconds === null ? null : asNumber(row.active_elapsed_seconds),
		revision_count: asNumber(row.revision_count),
		sla_target_minutes: asNumber(row.sla_target_minutes) || DEFAULT_SLA_MINUTES,
		sla_status: getSlaStatus(asNumber(row.overall_elapsed_seconds), asNumber(row.sla_target_minutes) || DEFAULT_SLA_MINUTES)
	}));
}

async function getSlaCounts(where: { sql: string; params: DbParam[] }) {
	const elapsed = 'TIMESTAMPDIFF(SECOND, request.submitted_at, COALESCE(request.closed_at, CURRENT_TIMESTAMP(3)))';
	const target = `COALESCE(catalog.target_sla_minutes, ${DEFAULT_SLA_MINUTES}) * 60`;
	const warning = `LEAST(${SLA_WARNING_MINUTES * 60}, ${target})`;
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
		safe_count: number | string | null;
		warning_count: number | string | null;
		overdue_count: number | string | null;
	}>>(
		`SELECT
			SUM(CASE WHEN ${elapsed} < ${warning} THEN 1 ELSE 0 END) AS safe_count,
			SUM(CASE WHEN ${elapsed} >= ${warning} AND ${elapsed} <= ${target} THEN 1 ELSE 0 END) AS warning_count,
			SUM(CASE WHEN ${elapsed} > ${target} THEN 1 ELSE 0 END) AS overdue_count
		FROM service_requests request
		LEFT JOIN work_catalogs catalog ON catalog.id = request.work_catalog_id
		${where.sql}`,
		where.params
	);
	return {
		target_minutes: DEFAULT_SLA_MINUTES,
		warning_minutes: SLA_WARNING_MINUTES,
		counts: {
			safe: asNumber(rows[0]?.safe_count),
			warning: asNumber(rows[0]?.warning_count),
			overdue: asNumber(rows[0]?.overdue_count)
		}
	};
}

async function getManagementFilterOptions() {
	const [[korwilRows], [divisionRows]] = await Promise.all([
		mysqlPool.execute<Array<RowDataPacket & { korwil: string }>>(
			`SELECT DISTINCT korwil FROM master_kantor WHERE is_active = 1 AND korwil <> 'pusat' ORDER BY korwil`
		),
		mysqlPool.execute<Array<RowDataPacket & { id: number; nama_divisi: string }>>(
			`SELECT id, nama_divisi FROM master_divisi WHERE is_active = 1 ORDER BY nama_divisi`
		)
	]);
	return {
		korwils: korwilRows.map((row) => row.korwil),
		divisions: divisionRows.map((row) => ({ id: Number(row.id), nama_divisi: row.nama_divisi }))
	};
}

async function getBranchFilterOptions() {
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
		kode_kantor: string; nama_kantor: string; korwil: string;
	}>>(
		`SELECT kode_kantor, nama_kantor, korwil
		FROM master_kantor WHERE is_active = 1 AND kode_kantor <> '000'
		ORDER BY kode_kantor`
	);
	return rows.map((row) => ({ kode_kantor: row.kode_kantor, nama_kantor: row.nama_kantor, korwil: row.korwil }));
}

async function getBreakdown(where: { sql: string; params: DbParam[] }, kind: 'korwil' | 'division') {
	if (kind === 'korwil') {
		const [rows] = await mysqlPool.execute<Array<RowDataPacket & { key: string; count: number | string }>>(
			`SELECT request.korwil AS \`key\`, COUNT(*) AS count
			FROM service_requests request ${where.sql}
			GROUP BY request.korwil ORDER BY count DESC, \`key\``, where.params
		);
		return rows.map((row) => ({ korwil: row.key, count: asNumber(row.count) }));
	}
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & {
		id: number; nama_divisi: string; count: number | string;
	}>>(
		`SELECT division.id, division.nama_divisi, COUNT(*) AS count
		FROM service_requests request
		INNER JOIN master_divisi division ON division.id = request.central_division_id
		${where.sql ? `${where.sql} AND` : 'WHERE'} request.central_division_id IS NOT NULL
		GROUP BY division.id, division.nama_divisi ORDER BY count DESC, division.nama_divisi`,
		where.params
	);
	return rows.map((row) => ({ id: Number(row.id), nama_divisi: row.nama_divisi, count: asNumber(row.count) }));
}

function scopeLabel(access: DashboardAccess) {
	if (access.view === 'branch') return access.namaKantor ? `${access.namaKantor} (${access.kodeKantor})` : 'Kantor Cabang';
	if (access.view === 'korwil') return access.korwil ? `Korwil ${access.korwil}` : 'Korwil';
	if (access.view === 'division') return access.namaDivisi ?? 'Divisi Pusat';
	return 'Seluruh Sistem';
}

export async function getDashboard(employeeId: string, filters: DashboardFilters) {
	const access = await getDashboardAccess(employeeId);
	const where = buildScopeWhere(access, filters);
	const [total, statusCounts, totalAge, revisionCount, requests, sla] = await Promise.all([
		countRequests(where),
		getStatusCounts(where),
		sumAge(where),
		countRevisions(where),
		getRequests(where),
		getSlaCounts(where)
	]);
	const summary = emptySummary();
	summary.total = total;
	summary.revision_count = revisionCount;
	summary.total_age_seconds = totalAge;
	summary.average_age_seconds = total > 0 ? Math.round(totalAge / total) : 0;
	summary.completed = statusCounts.find((item) => item.status === 'completed')?.count ?? 0;
	summary.rejected = statusCounts.find((item) => item.status === 'rejected')?.count ?? 0;

	if (access.view === 'branch') {
		return {
			view: access.view,
			scope: { label: scopeLabel(access), kode_kantor: access.kodeKantor, nama_kantor: access.namaKantor, korwil: access.korwil },
			filters,
			sla,
			summary,
			status_counts: statusCounts,
			requests
		};
	}

	if (access.view === 'korwil' || access.view === 'division') {
		const unitType = access.view === 'korwil' ? 'korwil' : 'central';
		const unitCode = access.view === 'korwil' ? access.korwil : access.divisiKode;
		const [waiting, inProgress, waitingDocuments, processSeconds] = await Promise.all([
			countRequests(appendCondition(where,
				access.view === 'korwil'
					? "request.current_unit_type = 'korwil' AND request.status = 'waiting_korwil'"
					: "request.current_unit_type = 'central' AND request.status = 'waiting_central'")),
			countRequests(appendCondition(where,
				access.view === 'korwil'
					? "request.current_unit_type = 'korwil' AND request.status = 'in_progress_korwil'"
					: "request.current_unit_type = 'central' AND request.status = 'in_progress_central'")),
			(() => {
				if (!unitCode) return Promise.resolve(0);
				const waitingCondition = latestDocumentsCondition(unitType, unitCode);
				return countRequests(appendCondition(where, waitingCondition.condition, waitingCondition.params));
			})(),
			getUnitDuration(where, unitType, unitCode)
		]);
		summary.waiting = waiting;
		summary.in_progress = inProgress;
		summary.waiting_branch = waitingDocuments;
		summary.total_process_seconds = processSeconds;
		return {
			view: access.view,
			scope: access.view === 'korwil'
				? { label: scopeLabel(access), korwil: access.korwil }
				: { label: scopeLabel(access), divisi_id: access.divisiId, nama_divisi: access.namaDivisi },
			filters,
			sla,
			summary,
			status_counts: statusCounts,
			requests
		};
	}

	const [korwilCounts, divisionCounts] = await Promise.all([
		getBreakdown(where, 'korwil'),
		getBreakdown(where, 'division')
	]);
	return {
		view: access.view,
		scope: { label: scopeLabel(access) },
		filters,
		sla,
		summary,
		status_counts: statusCounts,
		filter_options: await getManagementFilterOptions(),
		korwil_counts: korwilCounts,
		division_counts: divisionCounts,
		requests
	};
}

export function parseDashboardFilters(from: unknown, to: unknown, korwil: unknown, divisionId: unknown): DashboardFilters {
	const fromValue = queryValue(from);
	const toValue = queryValue(to);
	const korwilValue = queryValue(korwil);
	const divisionValue = queryValue(divisionId);
	for (const value of [fromValue, toValue]) {
		if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			throw new DashboardError(400, 'Format tanggal harus YYYY-MM-DD.');
		}
	}
	if (fromValue && toValue && fromValue > toValue) {
		throw new DashboardError(400, 'Tanggal mulai tidak boleh setelah tanggal akhir.');
	}
	let parsedDivisionId: number | null = null;
	if (divisionValue !== null) {
		parsedDivisionId = Number(divisionValue);
		if (!Number.isSafeInteger(parsedDivisionId) || parsedDivisionId < 1) {
			throw new DashboardError(400, 'Divisi dashboard tidak valid.');
		}
	}
	return { from: fromValue, to: toValue, korwil: korwilValue, divisionId: parsedDivisionId };
}

export function parseBranchFollowUpFilters(kodeKantor: unknown): BranchFollowUpFilters {
	const value = queryValue(kodeKantor);
	if (value !== null && !/^\d{3}$/.test(value)) {
		throw new DashboardError(400, 'Kode Cabang harus terdiri dari tiga angka.');
	}
	return { kodeKantor: value };
}

function parsePositiveInteger(value: unknown, fallback: number, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
	const raw = queryValue(value);
	if (raw === null) return fallback;
	if (!/^\d+$/.test(raw)) throw new DashboardError(400, `${label} harus berupa bilangan bulat positif.`);
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
		throw new DashboardError(400, `${label} tidak valid.`);
	}
	return parsed;
}

export function parseManagementRequestFilters(
	kodeKantor: unknown, korwil: unknown, divisionId: unknown, status: unknown,
	from: unknown, to: unknown, slaStatus: unknown, page: unknown, pageSize: unknown
): ManagementRequestFilters {
	const office = parseBranchFollowUpFilters(kodeKantor).kodeKantor;
	const korwilValue = queryValue(korwil);
	const divisionValue = queryValue(divisionId);
	const statusValue = queryValue(status);
	const fromValue = queryValue(from);
	const toValue = queryValue(to);
	const slaValue = queryValue(slaStatus);
	for (const value of [fromValue, toValue]) {
		if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			throw new DashboardError(400, 'Format tanggal harus YYYY-MM-DD.');
		}
		if (value !== null) {
			const parsed = new Date(`${value}T00:00:00.000Z`);
			if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
				throw new DashboardError(400, 'Tanggal tidak valid.');
			}
		}
	}
	if (fromValue && toValue && fromValue > toValue) {
		throw new DashboardError(400, 'Tanggal mulai tidak boleh setelah tanggal akhir.');
	}
	let parsedDivisionId: number | null = null;
	if (divisionValue !== null) {
		parsedDivisionId = Number(divisionValue);
		if (!Number.isSafeInteger(parsedDivisionId) || parsedDivisionId < 1) {
			throw new DashboardError(400, 'Divisi tidak valid.');
		}
	}
	if (statusValue !== null && statusValue !== 'all' && !MANAGEMENT_REQUEST_STATUSES.includes(statusValue as ManagementRequestStatus)) {
		throw new DashboardError(400, 'Status tiket tidak valid.');
	}
	if (slaValue !== null && slaValue !== 'all' && !['safe', 'warning', 'overdue'].includes(slaValue)) {
		throw new DashboardError(400, 'Kondisi SLA tidak valid.');
	}
	const parsedPage = parsePositiveInteger(page, 1, 'Halaman');
	const parsedPageSize = parsePositiveInteger(pageSize, 25, 'Jumlah tiket per halaman', 100);
	if (!Number.isSafeInteger((parsedPage - 1) * parsedPageSize)) {
		throw new DashboardError(400, 'Halaman tidak valid.');
	}
	return {
		kodeKantor: office,
		korwil: korwilValue === 'all' ? null : korwilValue,
		divisionId: parsedDivisionId,
		status: statusValue && statusValue !== 'all' ? statusValue as ManagementRequestStatus : null,
		slaStatus: slaValue && slaValue !== 'all' ? slaValue as SlaStatus : null,
		from: fromValue,
		to: toValue,
		page: parsedPage,
		pageSize: parsedPageSize
	};
}

export async function getManagementRequests(employeeId: string, filters: ManagementRequestFilters) {
	const access = await getDashboardAccess(employeeId);
	if (access.view !== 'admin') {
		throw new DashboardError(403, 'Pemantauan semua tiket hanya tersedia untuk Manajemen, Supervisor, atau Admin global.');
	}
	let baseWhere = buildScopeWhere(access, { from: filters.from, to: filters.to, korwil: filters.korwil, divisionId: filters.divisionId });
	if (filters.kodeKantor) baseWhere = appendCondition(baseWhere, 'request.kode_kantor = ?', [filters.kodeKantor]);
	let where = filters.status ? appendCondition(baseWhere, 'request.status = ?', [filters.status]) : baseWhere;
	if (filters.slaStatus) {
		const elapsed = 'TIMESTAMPDIFF(SECOND, request.submitted_at, COALESCE(request.closed_at, CURRENT_TIMESTAMP(3)))';
		const target = `(COALESCE((SELECT sla_filter_catalog.target_sla_minutes FROM work_catalogs sla_filter_catalog WHERE sla_filter_catalog.id = request.work_catalog_id LIMIT 1), ${DEFAULT_SLA_MINUTES}) * 60)`;
		const warning = `LEAST(${SLA_WARNING_MINUTES * 60}, ${target})`;
		const condition = filters.slaStatus === 'safe'
			? `${elapsed} < ${warning}`
			: filters.slaStatus === 'warning'
				? `${elapsed} >= ${warning} AND ${elapsed} <= ${target}`
				: `${elapsed} > ${target}`;
		where = appendCondition(where, condition);
	}
	const offset = (filters.page - 1) * filters.pageSize;
	const [total, statusCounts, requests, sla, offices, managementOptions] = await Promise.all([
		countRequests(where),
		getStatusCounts(baseWhere),
		getRequests(where, filters.pageSize, offset),
		getSlaCounts(where),
		getBranchFilterOptions(),
		getManagementFilterOptions()
	]);
	return {
		filters: {
			kode_kantor: filters.kodeKantor,
			korwil: filters.korwil,
			division_id: filters.divisionId,
			status: filters.status,
			sla_status: filters.slaStatus,
			from: filters.from,
			to: filters.to,
			page: filters.page,
			page_size: filters.pageSize
		},
		options: { offices, korwils: managementOptions.korwils, divisions: managementOptions.divisions },
		sla,
		summary: { total },
		status_counts: statusCounts,
		pagination: {
			page: filters.page,
			page_size: filters.pageSize,
			total_pages: Math.ceil(total / filters.pageSize)
		},
		requests
	};
}

export async function getBranchFollowUp(employeeId: string, filters: BranchFollowUpFilters) {
	const access = await getDashboardAccess(employeeId);
	if (access.view !== 'admin') {
		throw new DashboardError(403, 'Halaman tindak lanjut Cabang hanya tersedia untuk Manajemen, Supervisor, atau Admin global.');
	}
	let where = buildScopeWhere(access, { from: null, to: null, korwil: null, divisionId: null });
	where = appendCondition(where, "request.status = 'waiting_branch_revision' AND request.current_unit_type = 'branch'");
	if (filters.kodeKantor) where = appendCondition(where, 'request.kode_kantor = ?', [filters.kodeKantor]);
	const [requests, sla] = await Promise.all([getRequests(where), getSlaCounts(where)]);
	return {
		filters,
		options: { offices: await getBranchFilterOptions() },
		sla,
		summary: { total: requests.length },
		requests
	};
}
