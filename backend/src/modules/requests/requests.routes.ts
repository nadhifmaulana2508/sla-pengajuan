import { Router } from 'express';
import { z } from 'zod';
import multer, { MulterError } from 'multer';
import path from 'node:path';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import {
	getRequestAttachmentForDownload, getRequestDetail, getRequestOptions, listBranchRequests, listRequestRejectionReasons,
	RequestWorkflowError, submitBranchRevision, submitRequest, type FormUploadInput
} from './requests.service.js';
import type { RevisionDocumentCategory } from './requests.service.js';
import { readPrivateFormFile, readPrivatePdf } from './private-attachments.js';

const MAX_INOFFICE_PDF_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 40;
const requestUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_INOFFICE_PDF_BYTES, files: MAX_UPLOAD_FILES, fields: 1, parts: MAX_UPLOAD_FILES + 1, fieldSize: 1024 * 1024 }
}).any();
const revisionUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_INOFFICE_PDF_BYTES, files: MAX_UPLOAD_FILES, fields: 1, parts: MAX_UPLOAD_FILES + 1, fieldSize: 1024 * 1024 }
}).any();

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
	const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return year >= 1000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}, 'Tanggal surat tidak valid.');

const submitSchema = z.object({
	authority_type: z.enum(['korwil', 'central']),
	central_division_id: z.number().int().positive().nullable(),
	work_catalog_id: z.number().int().positive().nullable(),
	form_version_id: z.number().int().positive().nullable().optional().default(null),
	form_answers: z.record(z.string(), z.unknown()).optional().default({}),
	inoffice_letter_number: z.string().trim().max(100).nullable().optional().default(null),
	inoffice_letter_date: isoDateSchema.nullable().optional().default(null),
	subject: z.string().trim().min(3).max(200),
	description: z.string().trim().min(3).max(5000)
}).strict();
const revisionSchema = z.object({
	response: z.string().trim().min(3).max(5000),
	updates: z.array(z.object({
		kind: z.enum(['subject', 'description', 'inoffice_letter_number', 'inoffice_letter_date', 'form_field']),
		key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
		entry_index: z.number().int().min(0).nullable().optional(),
		value: z.union([z.string().max(5000), z.number().finite()])
	}).strict()).max(100).default([])
}).strict();

export const requestRouter = Router();
requestRouter.use(requireRequestIdentity);

function sendError(response: import('express').Response, error: unknown, fallback: string) {
	if (error instanceof RequestWorkflowError) {
		response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
		return;
	}
	response.status(500).json({ status: 500, message: fallback, data: null });
}

function submitValidationMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) return 'Periksa kembali seluruh isian pengajuan.';
	const labels: Record<string, string> = {
		authority_type: 'Kewenangan tujuan',
		central_division_id: 'Divisi Pusat',
		work_catalog_id: 'Jenis pekerjaan',
		form_version_id: 'Versi form',
		form_answers: 'Isian form',
		inoffice_letter_number: 'Nomor surat InOffice',
		inoffice_letter_date: 'Tanggal surat InOffice',
		subject: 'Perihal',
		description: 'Uraian'
	};
	const field = typeof issue.path[0] === 'string' ? labels[issue.path[0]] : undefined;
	return field ? `${field}: ${issue.message}` : 'Periksa kembali seluruh isian pengajuan.';
}

function isValidInOfficePdf(file: Express.Multer.File): boolean {
	return path.extname(file.originalname).toLocaleLowerCase('en-US') === '.pdf' &&
		file.mimetype.toLocaleLowerCase('en-US') === 'application/pdf' &&
		file.size > 0 && file.size <= MAX_INOFFICE_PDF_BYTES &&
		file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function toPrivateFile(file: Express.Multer.File) {
	return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size };
}

function parseFormUploads(files: Express.Multer.File[]): FormUploadInput[] | null {
	const uploads: FormUploadInput[] = [];
	for (const file of files) {
		const match = /^form_file:(s|\d{1,2}):([a-z][a-z0-9_]{1,63})$/.exec(file.fieldname);
		if (!match) return null;
		const entryIndex = match[1] === 's' ? null : Number(match[1]);
		if (entryIndex !== null && (!Number.isSafeInteger(entryIndex) || entryIndex > 19)) return null;
		uploads.push({ fieldKey: match[2]!, entryIndex, file: toPrivateFile(file) });
	}
	return uploads;
}

requestRouter.get('/options', async (_request, response) => {
	try {
		const data = await getRequestOptions(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Pilihan pengajuan berhasil dimuat.', data });
	} catch (error) { sendError(response, error, 'Pilihan pengajuan belum dapat dimuat. Coba lagi.'); }
});

requestRouter.get('/', async (_request, response) => {
	try {
		const requests = await listBranchRequests(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Daftar pengajuan berhasil dimuat.', data: { requests } });
	} catch (error) { sendError(response, error, 'Daftar pengajuan belum dapat dimuat. Coba lagi.'); }
});

async function createRequestHandler(request: import('express').Request, response: import('express').Response): Promise<void> {
	let payload: unknown = request.body;
	if (request.is('multipart/form-data')) {
		const encodedPayload = request.body?.payload;
		if (typeof encodedPayload !== 'string') {
			response.status(400).json({ status: 400, message: 'Data pengajuan tidak terbaca. Muat ulang form lalu coba lagi.', data: null });
			return;
		}
		try { payload = JSON.parse(encodedPayload) as unknown; }
		catch {
			response.status(400).json({ status: 400, message: 'Data pengajuan tidak valid.', data: null });
			return;
		}
	}
	const parsed = submitSchema.safeParse(payload);
	if (!parsed.success) {
		response.status(400).json({ status: 400, message: submitValidationMessage(parsed.error), data: null });
		return;
	}
	const uploadedFiles = Array.isArray(request.files) ? request.files as Express.Multer.File[] : [];
	const inofficeLetter = uploadedFiles.find((file) => file.fieldname === 'inoffice_letter');
	if (uploadedFiles.filter((file) => file.fieldname === 'inoffice_letter').length > 1) {
		response.status(400).json({ status: 400, message: 'Unggah maksimal satu surat InOffice.', data: null });
		return;
	}
	const formUploads = parseFormUploads(uploadedFiles.filter((file) => file.fieldname !== 'inoffice_letter'));
	if (uploadedFiles.length > MAX_UPLOAD_FILES || formUploads === null) {
		response.status(400).json({ status: 400, message: 'Nama kolom lampiran tidak valid atau jumlah file melebihi batas.', data: null });
		return;
	}
	if (inofficeLetter && !isValidInOfficePdf(inofficeLetter)) {
		response.status(400).json({ status: 400, message: 'Lampiran surat InOffice harus berupa file PDF yang valid.', data: null });
		return;
	}
	try {
		const data = await submitRequest(response.locals.slaEmployeeId, {
			...parsed.data,
			inoffice_letter: inofficeLetter ? toPrivateFile(inofficeLetter) : null,
			form_files: formUploads
		});
		response.status(201).json({
			status: 201,
			message: data.routed_to === 'central'
				? 'Pengajuan berhasil dikirim langsung ke antrean Divisi Pusat.'
				: 'Pengajuan berhasil dikirim ke antrean Korwil.',
			data
		});
	} catch (error) { sendError(response, error, 'Pengajuan belum dapat disimpan. Coba lagi.'); }
}

requestRouter.post('/', (request, response) => {
	requestUpload(request, response, (uploadError: unknown) => {
		if (uploadError) {
			const tooLarge = uploadError instanceof MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
			const payloadTooLarge = uploadError instanceof MulterError && uploadError.code === 'LIMIT_FIELD_VALUE';
			const message = tooLarge
				? 'Ukuran setiap file maksimal 10 MB.'
				: payloadTooLarge
					? 'Data pengajuan terlalu besar. Periksa kolom form lalu coba lagi.'
					: 'Periksa jumlah dan nama file yang diunggah. Maksimal 40 file per pengajuan.';
			response.status(tooLarge || payloadTooLarge ? 413 : 400).json({
				status: tooLarge || payloadTooLarge ? 413 : 400,
				message,
				data: null
			});
			return;
		}
		void createRequestHandler(request, response).catch((error: unknown) => {
			sendError(response, error, 'Pengajuan belum dapat disimpan. Coba lagi.');
		});
	});
});

requestRouter.post('/:id/revision', (request, response) => {
	revisionUpload(request, response, (uploadError: unknown) => {
		if (uploadError) {
			const tooLarge = uploadError instanceof MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
			const message = tooLarge ? 'Ukuran setiap file maksimal 10 MB.' : 'Periksa jumlah dan nama file revisi. Maksimal 40 file.';
			response.status(tooLarge ? 413 : 400).json({ status: tooLarge ? 413 : 400, message, data: null });
			return;
		}
		void submitRevisionHandler(request, response).catch((error: unknown) => sendError(response, error, 'Pelengkapan belum dapat dikirim. Coba lagi.'));
	});
});

async function submitRevisionHandler(request: import('express').Request, response: import('express').Response): Promise<void> {
	const id = Number(request.params.id);
	let payload: unknown = request.body;
	if (request.is('multipart/form-data')) {
		if (typeof request.body?.payload !== 'string') {
			response.status(400).json({ status: 400, message: 'Data pelengkapan tidak terbaca. Muat ulang tiket lalu coba lagi.', data: null });
			return;
		}
		try { payload = JSON.parse(request.body.payload) as unknown; }
		catch { response.status(400).json({ status: 400, message: 'Data pelengkapan tidak valid.', data: null }); return; }
	}
	const parsed = revisionSchema.safeParse(payload);
	if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
		response.status(400).json({ status: 400, message: 'Periksa kembali catatan dan kolom revisi yang dikirim.', data: null });
		return;
	}
	const uploadedFiles = Array.isArray(request.files) ? request.files as Express.Multer.File[] : [];
	const fileRows: Partial<Record<RevisionDocumentCategory, Express.Multer.File>> = {
		inoffice_letter: uploadedFiles.find((file) => file.fieldname === 'inoffice_letter'),
		supporting_document: uploadedFiles.find((file) => file.fieldname === 'supporting_document')
	};
	if (uploadedFiles.filter((file) => file.fieldname === 'inoffice_letter').length > 1 ||
		uploadedFiles.filter((file) => file.fieldname === 'supporting_document').length > 1) {
		response.status(400).json({ status: 400, message: 'Unggah maksimal satu file untuk setiap dokumen standar.', data: null });
		return;
	}
	const standardFieldNames = new Set(['inoffice_letter', 'supporting_document']);
	const formUploadFiles = uploadedFiles.filter((file) => !standardFieldNames.has(file.fieldname));
	const formUploads = parseFormUploads(formUploadFiles);
	if (formUploads === null || uploadedFiles.length > MAX_UPLOAD_FILES) {
		response.status(400).json({ status: 400, message: 'Nama kolom lampiran tidak valid atau jumlah file melebihi batas.', data: null });
		return;
	}
	for (const file of Object.values(fileRows)) {
		if (file && !isValidInOfficePdf(file)) {
			response.status(400).json({ status: 400, message: 'Setiap lampiran revisi harus berupa file PDF yang valid.', data: null });
			return;
		}
	}
	const files = Object.fromEntries(Object.entries(fileRows).filter((entry): entry is [RevisionDocumentCategory, Express.Multer.File] => Boolean(entry[1]))) as Partial<Record<RevisionDocumentCategory, {
		buffer: Buffer; originalname: string; mimetype: string; size: number;
	}>>;
	try {
		const data = await submitBranchRevision(response.locals.slaEmployeeId, id, {
			response: parsed.data.response,
			updates: parsed.data.updates,
			files,
			form_files: formUploads
		});
		const message = data.returned_to_korwil
			? 'Perubahan nilai kredit dikirim ke antrean Korwil untuk diperiksa ulang.'
			: data.resumed_to_previous_handler
				? 'Pelengkapan dikirim kembali kepada petugas yang meminta.'
				: 'Pelengkapan dikirim ke antrean unit tujuan karena petugas sebelumnya tidak tersedia.';
		response.status(200).json({ status: 200, message, data });
	} catch (error) { sendError(response, error, 'Pelengkapan belum dapat dikirim. Coba lagi.'); }
}

requestRouter.get('/:id/rejection-reasons', async (request, response) => {
	const id = Number(request.params.id);
	if (!Number.isSafeInteger(id) || id < 1) { response.status(400).json({ status: 400, message: 'Nomor pengajuan tidak valid.', data: null }); return; }
	try {
		const reasons = await listRequestRejectionReasons(response.locals.slaEmployeeId, id);
		response.status(200).json({ status: 200, message: 'Pilihan alasan penolakan berhasil dimuat.', data: { reasons } });
	} catch (error) { sendError(response, error, 'Pilihan alasan penolakan belum dapat dimuat. Coba lagi.'); }
});

requestRouter.get('/:id', async (request, response) => {
	const id = Number(request.params.id);
	if (!Number.isSafeInteger(id) || id < 1) {
		response.status(400).json({ status: 400, message: 'Nomor pengajuan tidak valid.', data: null });
		return;
	}
	try {
		const data = await getRequestDetail(response.locals.slaEmployeeId, id);
		response.status(200).json({ status: 200, message: 'Detail pengajuan berhasil dimuat.', data });
	} catch (error) { sendError(response, error, 'Detail pengajuan belum dapat dimuat. Coba lagi.'); }
});

requestRouter.get('/:id/attachments/:attachmentId', async (request, response) => {
	const requestId = Number(request.params.id);
	const attachmentId = Number(request.params.attachmentId);
	if (!Number.isSafeInteger(requestId) || requestId < 1 || !Number.isSafeInteger(attachmentId) || attachmentId < 1) {
		response.status(400).json({ status: 400, message: 'Nomor tiket atau lampiran tidak valid.', data: null });
		return;
	}
	try {
		const attachment = await getRequestAttachmentForDownload(response.locals.slaEmployeeId, requestId, attachmentId);
		const file = attachment.category === 'form_field'
			? await readPrivateFormFile(attachment.storage_key, attachment.storage_encoding)
			: await readPrivatePdf(attachment.storage_key);
		const safeFallback = attachment.original_filename.replace(/[^\x20-\x7e]|["\\;]/g, '_').slice(0, 150) || 'lampiran';
		const encodedName = encodeURIComponent(attachment.original_filename).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
		response.setHeader('Content-Type', attachment.category === 'form_field' ? attachment.mime_type : 'application/pdf');
		response.setHeader('Content-Disposition', `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodedName}`);
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Cache-Control', 'private, no-store');
		response.send(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			response.status(404).json({ status: 404, message: 'File lampiran tidak ditemukan di penyimpanan privat.', data: null });
			return;
		}
		sendError(response, error, 'Lampiran belum dapat diunduh.');
	}
});
