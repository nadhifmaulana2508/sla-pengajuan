import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';
import { mysqlPool } from './client.js';

const seedDirectory = fileURLToPath(new URL('./dev-seeders/', import.meta.url));
const fixtureFile = new URL('./dev-seeders/local-snapshot.json', import.meta.url);
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

type SeedTable = { rows: Array<Record<string, unknown>> };
type DatabaseRow = RowDataPacket & Record<string, unknown>;

function encodeValue(value: unknown): unknown {
	if (Buffer.isBuffer(value)) return { __seed_type: 'buffer', value: value.toString('base64') };
	if (value instanceof Date) return { __seed_type: 'date', value: value.toISOString() };
	if (typeof value === 'bigint') return value.toString();
	if (Array.isArray(value)) return value.map(encodeValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
	}
	return value;
}

function sanitizeUsers(rows: DatabaseRow[], dummyUserIds: Set<number>): void {
	let sequence = 0;
	for (const row of rows) {
		if (dummyUserIds.has(Number(row.id))) continue;
		sequence += 1;
		const label = String(sequence).padStart(3, '0');
		row.employee_id = `DEV-SEED-${label}`;
		row.full_name = `Pegawai Uji ${label}`;
		row.email = null;
		row.telp = null;
		row.job_position = null;
		row.level = null;
		row.group_jabatan = null;
	}
}

async function exportDevelopmentSeed(): Promise<void> {
	if (env.NODE_ENV !== 'development' || !env.DUMMY_AUTH_ENABLED) {
		throw new Error('Export seed hanya boleh dijalankan pada development dengan DUMMY_AUTH_ENABLED=true.');
	}
	if (!localHosts.has(env.DB_HOST.toLowerCase())) {
		throw new Error('Export seed hanya boleh mengambil database dari host lokal.');
	}

	const connection = await mysqlPool.getConnection();
	try {
		const [tableRows] = await connection.query<RowDataPacket[]>('SHOW FULL TABLES');
		const tables = tableRows
			.filter((row) => Object.values(row).includes('BASE TABLE'))
			.map((row) => String(Object.entries(row).find(([key]) => key.toLowerCase() !== 'table_type')?.[1] ?? ''))
			.filter((table) => table && table !== 'schema_migrations')
			.sort((a, b) => a.localeCompare(b));
		const [dummyRows] = await connection.query<Array<RowDataPacket & { user_id: number }>>('SELECT user_id FROM dummy_users');
		const dummyUserIds = new Set(dummyRows.map((row) => Number(row.user_id)));
		const seed: Record<string, SeedTable> = {};
		let rowCount = 0;

		for (const table of tables) {
			const [rows] = await connection.query<DatabaseRow[]>(`SELECT * FROM \`${table.replace(/`/g, '``')}\``);
			if (table === 'users') sanitizeUsers(rows, dummyUserIds);
			seed[table] = { rows: rows.map((row) => encodeValue(row) as Record<string, unknown>) };
			rowCount += rows.length;
		}

		await mkdir(seedDirectory, { recursive: true });
		await writeFile(fixtureFile, `${JSON.stringify({ version: 1, tables: seed }, null, 2)}\n`, 'utf8');

		const sourceUploads = resolve(env.PRIVATE_UPLOAD_DIR);
		const fixtureUploads = fileURLToPath(new URL('./dev-seeders/private-uploads/', import.meta.url));
		if (sourceUploads === resolve(fixtureUploads)) throw new Error('PRIVATE_UPLOAD_DIR tidak boleh menunjuk ke folder fixture seed.');
		await rm(fixtureUploads, { recursive: true, force: true });
		await mkdir(fixtureUploads, { recursive: true });
		for (const entry of await readdir(sourceUploads, { withFileTypes: true }).catch(() => [])) {
			await cp(resolve(sourceUploads, entry.name), resolve(fixtureUploads, entry.name), { recursive: true, force: true });
		}

		console.log(`Seed development diperbarui: ${tables.length} tabel, ${rowCount} baris, dan file lampiran lokal.`);
	} finally {
		connection.release();
		await mysqlPool.end();
	}
}

exportDevelopmentSeed().catch((error: unknown) => {
	console.error('Export seed development gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
