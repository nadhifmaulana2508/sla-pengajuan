import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mysqlPool } from './client.js';

const seedersDirectory = fileURLToPath(new URL('./seeders/', import.meta.url));

async function runSeeders(): Promise<void> {
	const connection = await mysqlPool.getConnection();
	try {
		const files = (await readdir(seedersDirectory))
			.filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
			.sort();

		for (const file of files) {
			const sql = await readFile(new URL(`./seeders/${file}`, import.meta.url), 'utf8');
			const statements = sql
				.split(';')
				.map((statement) => statement.trim())
				.filter(Boolean);

			await connection.beginTransaction();
			try {
				for (const statement of statements) await connection.query(statement);
				await connection.commit();
				console.log(`Seed data master diterapkan: ${file}`);
			} catch (error) {
				await connection.rollback();
				throw error;
			}
		}
	} finally {
		connection.release();
		await mysqlPool.end();
	}
}

runSeeders().catch((error: unknown) => {
	console.error('Seed data master gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
