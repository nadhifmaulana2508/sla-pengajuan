import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';
import { mysqlPool } from './client.js';

type IdRow = RowDataPacket & { id: number; is_active?: number };

async function bootstrapInitialAdmin(): Promise<void> {
	const employeeId = env.SLA_INITIAL_ADMIN_EMPLOYEE_ID;
	if (!employeeId) {
		throw new Error('SLA_INITIAL_ADMIN_EMPLOYEE_ID belum diisi di backend/.env.');
	}

	const connection = await mysqlPool.getConnection();
	try {
		await connection.beginTransaction();
		await connection.execute(
			'INSERT INTO users (employee_id, is_active) VALUES (?, 1) ON DUPLICATE KEY UPDATE is_active = 1',
			[employeeId]
		);

		const [users] = await connection.execute<IdRow[]>(
			'SELECT id FROM users WHERE employee_id = ? LIMIT 1 FOR UPDATE',
			[employeeId]
		);
		const [roles] = await connection.execute<IdRow[]>(
			"SELECT id FROM roles WHERE kode = 'admin' AND is_active = 1 LIMIT 1"
		);
		const user = users[0];
		const role = roles[0];
		if (!user || !role) throw new Error('Data pengguna atau role admin belum tersedia. Jalankan migrasi terlebih dahulu.');

		const [assignments] = await connection.execute<IdRow[]>(
			`SELECT id, is_active FROM user_role_scopes
			WHERE user_id = ? AND role_id = ? AND scope_type = 'global'
				AND kode_kantor IS NULL AND korwil IS NULL AND divisi_id IS NULL
			LIMIT 1 FOR UPDATE`,
			[user.id, role.id]
		);
		if (assignments[0]) {
			if (Number(assignments[0].is_active) !== 1) {
				await connection.execute('UPDATE user_role_scopes SET is_active = 1 WHERE id = ?', [assignments[0].id]);
			}
		} else {
			await connection.execute(
				`INSERT INTO user_role_scopes (user_id, role_id, scope_type)
				VALUES (?, ?, 'global')`,
				[user.id, role.id]
			);
		}

		await connection.commit();
		console.log('Bootstrap admin lokal tersimpan di database.');
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
		await mysqlPool.end();
	}
}

bootstrapInitialAdmin().catch((error: unknown) => {
	console.error('Bootstrap admin gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
