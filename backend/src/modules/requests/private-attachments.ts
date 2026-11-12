import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

const privateStorageRoot = path.resolve(env.PRIVATE_UPLOAD_DIR);
const storageKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PrivatePdfFile = {
	buffer: Buffer;
	originalname: string;
	mimetype: string;
	size: number;
};

export type StoredPrivatePdf = {
	storageKey: string;
	originalFilename: string;
	mimeType: 'application/pdf';
	sizeBytes: number;
	sha256: string;
};

function getStoragePath(storageKey: string): string {
	if (!storageKeyPattern.test(storageKey)) throw new Error('Invalid private attachment key.');
	return path.join(privateStorageRoot, `${storageKey}.pdf`);
}

function safeOriginalFilename(filename: string): string {
	const baseName = filename.split(/[\\/]/).at(-1) ?? 'surat-inoffice.pdf';
	const safeName = baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
	return safeName || 'surat-inoffice.pdf';
}

export async function storePrivatePdf(file: PrivatePdfFile): Promise<StoredPrivatePdf> {
	await mkdir(privateStorageRoot, { recursive: true, mode: 0o700 });
	const storageKey = randomUUID();
	await writeFile(getStoragePath(storageKey), file.buffer, { flag: 'wx', mode: 0o600 });
	return {
		storageKey,
		originalFilename: safeOriginalFilename(file.originalname),
		mimeType: 'application/pdf',
		sizeBytes: file.size,
		sha256: createHash('sha256').update(file.buffer).digest('hex')
	};
}

export async function readPrivatePdf(storageKey: string): Promise<Buffer> {
	return readFile(getStoragePath(storageKey));
}

export async function removePrivatePdf(storageKey: string): Promise<void> {
	try {
		await unlink(getStoragePath(storageKey));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}
