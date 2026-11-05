import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import { mysqlPool } from './client.js';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

async function runMigrations(): Promise<void> {
	const connection = await mysqlPool.getConnection();
	try {
		await connection.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				name VARCHAR(190) NOT NULL,
				applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (name)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);

		const files = (await readdir(migrationsDirectory))
			.filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
			.sort();

		for (const file of files) {
			const [rows] = await connection.execute<RowDataPacket[]>(
				'SELECT name FROM schema_migrations WHERE name = ? LIMIT 1',
				[file]
			);
			if (rows.length > 0) continue;

			const sql = await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8');
			const statements = sql
				.split(';')
				.map((statement) => statement.trim())
				.filter(Boolean);

			for (const statement of statements) await connection.query(statement);
			await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
			console.log(`Migrasi diterapkan: ${file}`);
		}
	} finally {
		connection.release();
		await mysqlPool.end();
	}
}

runMigrations().catch((error: unknown) => {
	console.error('Migrasi database gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
