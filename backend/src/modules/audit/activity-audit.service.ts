import type { RequestHandler } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';

export type AdminActivityLogFilters = {
	q: string | null;
	method: string | null;
	from: string | null;
	to: string | null;
	page: number;
	pageSize: number;
};

type ActivityCountRow = RowDataPacket & { total: number | string };
type ActivityLogRow = RowDataPacket & {
	id: number | string;
	source: 'api' | 'access';
	created_at: Date;
	http_method: string;
	path: string;
	status_code: number | string;
	action: string | null;
	actor_employee_id: string;
	actor_name: string | null;
	target_employee_id: string | null;
	target_name: string | null;
};

const activityRowsSql = `
	SELECT activity.id, 'api' AS source, activity.created_at, activity.http_method, activity.path,
		activity.status_code, actor.employee_id AS actor_employee_id, actor.full_name AS actor_name,
		CAST(NULL AS CHAR(80)) AS target_employee_id, CAST(NULL AS CHAR(160)) AS target_name,
		CAST(NULL AS CHAR(40)) AS action
	FROM user_activity_audit_logs activity
	INNER JOIN users actor ON actor.id = activity.actor_user_id
	UNION ALL
	SELECT access_log.id, 'access' AS source, access_log.created_at,
		CASE access_log.action WHEN 'sso_scope_synced' THEN 'SSO' ELSE 'PUT' END AS http_method,
		CASE access_log.action WHEN 'sso_scope_synced' THEN 'Sinkronisasi cakupan SSO'
			ELSE '/api/v1/admin/users/{id}/access' END AS path, 200 AS status_code,
		actor.employee_id AS actor_employee_id, actor.full_name AS actor_name,
		target.employee_id AS target_employee_id, target.full_name AS target_name, access_log.action
	FROM user_access_audit_logs access_log
	INNER JOIN users actor ON actor.id = access_log.actor_user_id
	INNER JOIN users target ON target.id = access_log.target_user_id`;

function buildActivityWhere(filters: AdminActivityLogFilters) {
	const conditions: string[] = [];
	const params: Array<string | number> = [];
	if (filters.method) {
		conditions.push('activity.http_method = ?');
		params.push(filters.method);
	}
	if (filters.from) {
		conditions.push('activity.created_at >= ?');
		params.push(`${filters.from} 00:00:00`);
	}
	if (filters.to) {
		conditions.push('activity.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
		params.push(`${filters.to} 00:00:00`);
	}
	if (filters.q) {
		conditions.push(`LOWER(CONCAT_WS(' ', activity.path, activity.actor_employee_id, activity.actor_name,
			activity.target_employee_id, activity.target_name)) LIKE ?`);
		params.push(`%${filters.q.toLocaleLowerCase('id-ID')}%`);
	}
	return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export async function recordUserActivity(employeeId: string, method: string, path: string, statusCode: number): Promise<void> {
	try {
		await mysqlPool.execute(
			`INSERT INTO user_activity_audit_logs (actor_user_id, http_method, path, status_code)
			SELECT id, ?, ?, ? FROM users WHERE employee_id = ? LIMIT 1`,
			[method.slice(0, 10), path.slice(0, 500), statusCode, employeeId]
		);
	} catch {
		console.error('Aktivitas pengguna gagal dicatat ke audit log.');
	}
}

export const auditApiActivity: RequestHandler = (request, response, next) => {
	response.on('finish', () => {
		const employeeId = response.locals.slaEmployeeId ?? response.locals.slaAdminEmployeeId;
		if (typeof employeeId !== 'string' || !request.originalUrl.startsWith('/api/v1/')) return;
		const path = request.originalUrl.split('?', 1)[0] ?? request.originalUrl;
		void recordUserActivity(employeeId, request.method, path, response.statusCode);
	});
	next();
};

export async function listAdminActivityLogs(filters: AdminActivityLogFilters) {
	const where = buildActivityWhere(filters);
	const filteredSql = `SELECT * FROM (${activityRowsSql}) activity ${where.sql}`;
	const [[countRows], [rows]] = await Promise.all([
		mysqlPool.execute<ActivityCountRow[]>(`SELECT COUNT(*) AS total FROM (${filteredSql}) filtered_activity`, where.params),
		mysqlPool.execute<ActivityLogRow[]>(
			`${filteredSql} ORDER BY activity.created_at DESC, activity.id DESC LIMIT ? OFFSET ?`,
			[...where.params, filters.pageSize, (filters.page - 1) * filters.pageSize]
		)
	]);
	const total = Number(countRows[0]?.total ?? 0);
	return {
		filters,
		pagination: {
			page: filters.page,
			page_size: filters.pageSize,
			total,
			total_pages: Math.ceil(total / filters.pageSize)
		},
		logs: rows.map((row) => ({
			id: Number(row.id),
			source: row.source,
			created_at: row.created_at,
			method: row.http_method,
			path: row.path,
			status_code: Number(row.status_code),
			action: row.action,
			actor: { employee_id: row.actor_employee_id, full_name: row.actor_name },
			target: row.target_employee_id
				? { employee_id: row.target_employee_id, full_name: row.target_name }
				: null
		}))
	};
}
