import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '::1']);

function escapeOption(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function isInsideRepository(path: string): boolean {
	const relativePath = relative(repositoryRoot, path);
	return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function runMysqldump(binary: string, args: string[]): Promise<void> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
		child.once('error', () => rejectPromise(new Error('mysqldump tidak dapat dijalankan. Pasang MySQL client atau atur MYSQLDUMP_PATH.')));
		child.once('close', (code) => {
			if (code === 0) resolvePromise();
			else rejectPromise(new Error(`mysqldump berhenti dengan kode ${code ?? 'tidak diketahui'}.`));
		});
	});
}

async function createStagingDump(): Promise<void> {
	if (env.NODE_ENV === 'production') throw new Error('Dump ini hanya boleh dibuat dari environment development atau staging lokal.');
	if (!localDatabaseHosts.has(env.DB_HOST.toLowerCase())) throw new Error('Dump ini hanya boleh mengambil database dari host lokal.');

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const outputPath = resolve(process.argv[2] ?? join(tmpdir(), `sla-pengajuan-staging-${timestamp}.sql`));
	if (isInsideRepository(outputPath)) throw new Error('Simpan dump di luar repository agar tidak ikut ter-commit.');
	if (await fileExists(outputPath)) throw new Error('File dump sudah ada. Pilih nama file lain agar tidak tertimpa.');

	await mkdir(dirname(outputPath), { recursive: true });
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'sla-staging-dump-'));
	const defaultsFile = join(temporaryDirectory, 'client.cnf');
	const defaults = [
		'[client]',
		`host="${escapeOption(env.DB_HOST)}"`,
		`port=${env.DB_PORT}`,
		`user="${escapeOption(env.DB_USER)}"`,
		`password="${escapeOption(env.DB_PASSWORD)}"`,
		'default-character-set=utf8mb4',
		''
	].join('\n');
	const defaultWindowsDumpPath = 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
	const binary = process.env.MYSQLDUMP_PATH || (
		process.platform === 'win32' && await fileExists(defaultWindowsDumpPath) ? defaultWindowsDumpPath : 'mysqldump'
	);

	try {
		await writeFile(defaultsFile, defaults, { encoding: 'utf8', mode: 0o600 });
		await chmod(defaultsFile, 0o600).catch(() => undefined);
		await runMysqldump(binary, [
			`--defaults-extra-file=${defaultsFile}`,
			'--single-transaction',
			'--routines',
			'--triggers',
			'--hex-blob',
			'--default-character-set=utf8mb4',
			`--result-file=${outputPath}`,
			env.DB_NAME
		]);
		const dump = await stat(outputPath);
		console.log(`Dump staging selesai: ${outputPath} (${dump.size} byte). Hapus file setelah restore.`);
	} catch (error) {
		await unlink(outputPath).catch(() => undefined);
		throw error;
	} finally {
		await unlink(defaultsFile).catch(() => undefined);
		const remainingFiles = await readdir(temporaryDirectory).catch(() => []);
		if (remainingFiles.length === 0) await rmdir(temporaryDirectory).catch(() => undefined);
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

createStagingDump().catch((error: unknown) => {
	console.error('Dump staging gagal:', error instanceof Error ? error.message : 'kesalahan tidak diketahui');
	process.exitCode = 1;
});
