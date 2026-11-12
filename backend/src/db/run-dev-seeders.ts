import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';
import { mysqlPool } from './client.js';

const snapshotUrl = new URL('./dev-seeders/local-snapshot.json', import.meta.url);
const fixtureUploads = fileURLToPath(new URL('./dev-seeders/private-uploads/', import.meta.url));
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const replaceStaging = process.argv.includes('--replace-staging');

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

async function runSnapshotSeed(): Promise<void> {
	if (replaceStaging) {
		if (env.NODE_ENV === 'test') {
			throw new Error('db:replace:prod tidak boleh dijalankan pada NODE_ENV=test.');
		}
		if (!/_staging$/i.test(env.DB_NAME)) {
			throw new Error('db:replace:prod hanya boleh dijalankan pada database staging dengan nama berakhiran _staging.');
		}
	} else if (env.NODE_ENV !== 'development' || !env.DUMMY_AUTH_ENABLED) {
		throw new Error('Seed development hanya boleh dijalankan pada development dengan DUMMY_AUTH_ENABLED=true.');
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
		const databaseTables = [...availableTables].filter((table) => table !== 'schema_migrations');
		if (seedTables.includes('schema_migrations')) {
			throw new Error('Fixture tidak boleh mengganti tabel riwayat migrasi schema_migrations.');
		}
		const missingFromSnapshot = databaseTables.filter((table) => !Object.hasOwn(snapshot.tables, table));
		const missingFromDatabase = seedTables.filter((table) => !availableTables.has(table));
		if (missingFromSnapshot.length || missingFromDatabase.length) {
			throw new Error(
				'Daftar tabel fixture dan database berbeda. Tidak ada tabel yang diubah. ' +
				'Kurang di fixture: ' + (missingFromSnapshot.join(', ') || '-') +
				'; tidak ada di database: ' + (missingFromDatabase.join(', ') || '-') + '.'
			);
		}

		const generatedColumnsByTable = new Map<string, Set<string>>();
		for (const table of databaseTables) {
			const rows = snapshot.tables[table]?.rows ?? [];
			if (!rows.length) continue;
			const fixtureColumns = new Set(Object.keys(rows[0] ?? {}));
			const [columnRows] = await connection.query<Array<RowDataPacket & { Field: string; Null: string; Default: unknown; Extra: string }>>(
				`SHOW COLUMNS FROM ${quoteIdentifier(table)}`
			);
			const databaseColumns = new Set(columnRows.map((column) => column.Field));
			const unknownFixtureColumns = [...fixtureColumns].filter((column) => !databaseColumns.has(column));
			const generatedColumns = new Set(columnRows
				.filter((column) => /generated/i.test(column.Extra))
				.map((column) => column.Field));
			generatedColumnsByTable.set(table, generatedColumns);
			const columnsMissingFromFixture = columnRows
				.filter((column) => !generatedColumns.has(column.Field))
				.filter((column) => !fixtureColumns.has(column.Field))
				.map((column) => column.Field);
			if (unknownFixtureColumns.length || columnsMissingFromFixture.length) {
				throw new Error(
					'Kolom fixture tidak cocok pada tabel ' + table + '. Tidak ada tabel yang diubah. ' +
					'Kolom fixture tidak dikenal: ' + (unknownFixtureColumns.join(', ') || '-') +
					'; kolom database tidak ada di fixture: ' + (columnsMissingFromFixture.join(', ') || '-') + '.'
				);
			}
		}

		await connection.query('SET FOREIGN_KEY_CHECKS = 0');
		for (const table of databaseTables) {
			await connection.query(`TRUNCATE TABLE ${quoteIdentifier(table)}`);
		}

		let insertedRows = 0;
		for (const table of seedTables) {
			const rows = snapshot.tables[table]?.rows ?? [];
			if (!rows.length) continue;
			const generatedColumns = generatedColumnsByTable.get(table) ?? new Set<string>();
			const columns = Object.keys(rows[0] ?? {}).filter((column) => !generatedColumns.has(column));
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
		const action = replaceStaging ? 'Penggantian staging' : 'Seed development';
		console.log(`${action} siap: ${seedTables.length} tabel, ${insertedRows} baris, lampiran fixture disalin.`);
	} finally {
		connection.release();
		await mysqlPool.end();
	}
}

runSnapshotSeed().catch((error: unknown) => {
	console.error('Seed database gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
