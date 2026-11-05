import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../../db/client.js';
import { resolveSlaAccess } from '../auth/access.service.js';

export type NotificationUnit = 'branch' | 'korwil' | 'central';

const visibleNotificationFilter = `AND EXISTS (
	SELECT 1 FROM users account
	INNER JOIN user_role_scopes scope ON scope.user_id = account.id AND scope.is_active = 1
	INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1
	LEFT JOIN master_kantor account_office ON account_office.kode_kantor = account.kode_kantor
	LEFT JOIN master_kantor scoped_office ON scoped_office.kode_kantor = scope.kode_kantor
	LEFT JOIN master_divisi scope_division ON scope_division.id = scope.divisi_id AND scope_division.is_active = 1
	WHERE account.id = notification.recipient_user_id AND account.is_active = 1 AND (
		(role.kode = 'branch_user' AND scope.scope_type = 'office'
			AND scope.kode_kantor = request.kode_kantor
			AND account.kode_kantor = request.kode_kantor AND account.kode_kantor <> '000'
			AND account_office.is_active = 1 AND scoped_office.is_active = 1)
		OR (role.kode IN ('korwil_staff', 'korwil_approver') AND scope.scope_type = 'korwil'
			AND scope.korwil = request.korwil)
		OR (role.kode = 'division_staff' AND scope.scope_type = 'division'
			AND scope.divisi_id = request.central_division_id
			AND account.divisi_id = request.central_division_id
			AND scope_division.is_active = 1)
	)
)`;

export async function notifyUnitMembers(connection: PoolConnection, input: {
	requestId: number;
	historyId: number;
	unitType: NotificationUnit;
	unitCode: string;
	eventType: string;
	title: string;
	body: string;
}): Promise<void> {
	const recipientQuery = input.unitType === 'branch'
		? {
			sql: `SELECT DISTINCT recipient.id FROM users recipient
				INNER JOIN user_role_scopes scope ON scope.user_id = recipient.id AND scope.is_active = 1
				INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1
				INNER JOIN master_kantor scoped_office ON scoped_office.kode_kantor = scope.kode_kantor
					AND scoped_office.is_active = 1
				WHERE recipient.is_active = 1 AND recipient.kode_kantor = scope.kode_kantor
					AND recipient.kode_kantor <> '000' AND role.kode = 'branch_user'
					AND scope.scope_type = 'office' AND scope.kode_kantor = ?`,
			values: [input.unitCode]
		}
		: input.unitType === 'korwil'
			? {
				sql: `SELECT DISTINCT recipient.id FROM users recipient
					INNER JOIN user_role_scopes scope ON scope.user_id = recipient.id AND scope.is_active = 1
					INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1
					WHERE recipient.is_active = 1 AND role.kode IN ('korwil_staff', 'korwil_approver')
						AND scope.scope_type = 'korwil' AND scope.korwil = ?`,
				values: [input.unitCode]
			}
			: {
				sql: `SELECT DISTINCT recipient.id FROM users recipient
					INNER JOIN user_role_scopes scope ON scope.user_id = recipient.id AND scope.is_active = 1
					INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1
					INNER JOIN master_divisi division ON division.id = scope.divisi_id AND division.is_active = 1
					WHERE recipient.is_active = 1 AND recipient.divisi_id = scope.divisi_id
						AND role.kode = 'division_staff'
						AND scope.scope_type = 'division' AND division.kode = ?`,
				values: [input.unitCode]
			};
	const [recipients] = await connection.execute<Array<RowDataPacket & { id: number }>>(
		recipientQuery.sql,
		recipientQuery.values
	);
	if (recipients.length === 0) return;

	for (const recipient of recipients) {
		await connection.execute(
			`INSERT INTO notifications
				(recipient_user_id, request_id, history_id, event_type, title, body)
			VALUES (?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE id = id`,
			[recipient.id, input.requestId, input.historyId, input.eventType, input.title, input.body]
		);
	}
}

export async function notifyUser(connection: PoolConnection, input: {
	recipientUserId: number;
	requestId: number;
	historyId: number;
	eventType: string;
	title: string;
	body: string;
}): Promise<void> {
	await connection.execute(
		`INSERT INTO notifications
			(recipient_user_id, request_id, history_id, event_type, title, body)
		SELECT id, ?, ?, ?, ?, ? FROM users
		WHERE id = ? AND is_active = 1
		ON DUPLICATE KEY UPDATE id = notifications.id`,
		[input.requestId, input.historyId, input.eventType, input.title, input.body, input.recipientUserId]
	);
}

export async function listNotifications(employeeId: string) {
	const userId = await getActiveUserId(employeeId);
	const [[rows], [counts]] = await Promise.all([
		mysqlPool.execute<Array<RowDataPacket & {
			id: number; request_id: number; request_number: string; event_type: string;
			title: string; body: string; read_at: Date | null; created_at: Date;
		}>>(
			`SELECT notification.id, notification.request_id, request.request_number,
				notification.event_type, notification.title, notification.body,
				notification.read_at, notification.created_at
			FROM notifications notification
			INNER JOIN service_requests request ON request.id = notification.request_id
			WHERE notification.recipient_user_id = ? ${visibleNotificationFilter}
			ORDER BY notification.created_at DESC, notification.id DESC LIMIT 30`,
			[userId]
		),
		mysqlPool.execute<Array<RowDataPacket & { unread_count: number }>>(
			`SELECT COUNT(*) AS unread_count FROM notifications notification
			INNER JOIN service_requests request ON request.id = notification.request_id
			WHERE notification.recipient_user_id = ? AND notification.read_at IS NULL ${visibleNotificationFilter}`,
			[userId]
		)
	]);
	return { notifications: rows, unread_count: Number(counts[0]?.unread_count ?? 0) };
}

export async function markNotificationRead(employeeId: string, notificationId: number): Promise<boolean> {
	const userId = await getActiveUserId(employeeId);
	const [ownedRows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		`SELECT notification.id FROM notifications notification
		INNER JOIN service_requests request ON request.id = notification.request_id
		WHERE notification.id = ? AND notification.recipient_user_id = ? ${visibleNotificationFilter} LIMIT 1`,
		[notificationId, userId]
	);
	if (!ownedRows[0]) return false;
	await mysqlPool.execute(
		`UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(3))
		WHERE id = ? AND recipient_user_id = ?`,
		[notificationId, userId]
	);
	return true;
}

export async function markAllNotificationsRead(employeeId: string): Promise<void> {
	const userId = await getActiveUserId(employeeId);
	await mysqlPool.execute(
		`UPDATE notifications notification
		INNER JOIN service_requests request ON request.id = notification.request_id
		SET notification.read_at = CURRENT_TIMESTAMP(3)
		WHERE notification.recipient_user_id = ? AND notification.read_at IS NULL ${visibleNotificationFilter}`,
		[userId]
	);
}

async function getActiveUserId(employeeId: string): Promise<number> {
	const access = await resolveSlaAccess(employeeId);
	if (!access.enabled) throw new NotificationAccessError();
	const [rows] = await mysqlPool.execute<Array<RowDataPacket & { id: number }>>(
		'SELECT id FROM users WHERE employee_id = ? AND is_active = 1 LIMIT 1',
		[employeeId]
	);
	const userId = rows[0]?.id;
	if (!userId) throw new NotificationAccessError();
	return Number(userId);
}

export class NotificationAccessError extends Error {
	constructor() {
		super('Akses Sistem SLA belum aktif. Hubungi Admin Sistem SLA.');
		this.name = 'NotificationAccessError';
	}
}
