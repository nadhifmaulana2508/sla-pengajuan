import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';
import { mysqlPool } from './client.js';

const snapshotUrl = new URL('./dev-seeders/local-snapshot.json', import.meta.url);
const fixtureUploads = fileURLToPath(new URL('./dev-seeders/private-uploads/', import.meta.url));
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

type Snapshot = { version: number; tables: Record<string, { rows: Array<Record<string, unknown>> }> };

function decodeValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(decodeValue);
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		if (record.__seed_type === 'buffer' && typeof record.value === 'string') return Buffer.from(record.value, 'base64');
		if (record.__seed_type === 'date' && typeof record.value === 'string') return new Date(record.value);
		return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decodeValue(item)]));
	}
	return value;
}

function quoteIdentifier(value: string): string {
	return `\`${value.replace(/`/g, '``')}\``;
}

async function runDevelopmentSeed(): Promise<void> {
	if (env.NODE_ENV !== 'development' || !env.DUMMY_AUTH_ENABLED) {
		throw new Error('Seed development hanya boleh dijalankan dengan NODE_ENV=development dan DUMMY_AUTH_ENABLED=true.');
	}
	const localDatabase = localHosts.has(env.DB_HOST.toLowerCase());
	if (!localDatabase && !/_staging$/i.test(env.DB_NAME)) {
		throw new Error('Seed remote hanya diizinkan untuk database dengan akhiran _staging.');
	}
	const uploadTarget = resolve(env.PRIVATE_UPLOAD_DIR);
	if (uploadTarget === parse(uploadTarget).root || !basename(uploadTarget).toLowerCase().includes('upload')) {
		throw new Error('PRIVATE_UPLOAD_DIR tidak aman untuk seed. Arahkan ke folder khusus bernama uploads/private-uploads.');
	}

	const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as Snapshot;
	if (snapshot.version !== 1) throw new Error('Versi snapshot seed development tidak didukung.');
	const connection = await mysqlPool.getConnection();
	try {
		const [tableRows] = await connection.query<RowDataPacket[]>('SHOW FULL TABLES');
		const availableTables = new Set(tableRows
			.filter((row) => Object.values(row).includes('BASE TABLE'))
			.map((row) => String(Object.entries(row).find(([key]) => key.toLowerCase() !== 'table_type')?.[1] ?? '')));
		const seedTables = Object.keys(snapshot.tables);
		for (const table of seedTables) {
			if (!availableTables.has(table)) throw new Error(`Tabel seed ${table} belum ada. Jalankan db:upgrade terlebih dahulu.`);
		}

		await connection.query('SET FOREIGN_KEY_CHECKS = 0');
		for (const table of availableTables) {
			if (table !== 'schema_migrations') await connection.query(`TRUNCATE TABLE ${quoteIdentifier(table)}`);
		}

		let insertedRows = 0;
		for (const table of seedTables) {
			const rows = snapshot.tables[table]?.rows ?? [];
			if (!rows.length) continue;
			const columns = Object.keys(rows[0] ?? {});
			if (!columns.length) continue;
			const batchSize = Math.max(1, Math.floor(8000 / columns.length));
			for (let offset = 0; offset < rows.length; offset += batchSize) {
				const batch = rows.slice(offset, offset + batchSize);
				const values = batch.flatMap((row) => columns.map((column) => decodeValue(row[column])));
				const rowPlaceholders = `(${columns.map(() => '?').join(', ')})`;
				const sql = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES ${batch.map(() => rowPlaceholders).join(', ')}`;
				await connection.query(sql, values);
				insertedRows += batch.length;
			}
		}
		await connection.query('SET FOREIGN_KEY_CHECKS = 1');

		await rm(uploadTarget, { recursive: true, force: true });
		await mkdir(uploadTarget, { recursive: true });
		for (const entry of await readdir(fixtureUploads, { withFileTypes: true }).catch(() => [])) {
			await cp(resolve(fixtureUploads, entry.name), resolve(uploadTarget, entry.name), { recursive: true, force: true });
		}
		console.log(`Seed development siap: ${seedTables.length} tabel, ${insertedRows} baris, lampiran fixture disalin.`);
	} finally {
		connection.release();
		await mysqlPool.end();
	}
}

runDevelopmentSeed().catch((error: unknown) => {
	console.error('Seed development gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
