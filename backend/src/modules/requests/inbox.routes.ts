import { Router } from 'express';
import { z } from 'zod';
import multer, { MulterError } from 'multer';
import path from 'node:path';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import {
	claimCentralRequest, claimKorwilRequest, finishCentralRequest, finishKorwilRequest,
	forwardKorwilRequestToCentral, listCentralHistory, listCentralInbox, listKorwilHistory, listKorwilInbox, RequestWorkflowError,
	returnCentralRequestForDocuments, returnKorwilRequestForDocuments
} from './requests.service.js';

export const inboxRouter = Router();
inboxRouter.use(requireRequestIdentity);

const decisionUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2, fieldSize: 1024 * 1024 }
}).single('berita_acara');

const revisionFieldSchema = z.object({
	kind: z.enum(['subject', 'description', 'inoffice_letter_number', 'inoffice_letter_date', 'form_field']),
	key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
	entry_index: z.number().int().min(0).nullable().optional()
}).strict();
const requestDocumentsSchema = z.object({
	note: z.string().trim().min(3).max(1000),
	fields: z.array(revisionFieldSchema).max(100).default([]),
	documents: z.array(z.enum(['inoffice_letter', 'supporting_document'])).max(2).default([])
}).strict();
const actionSchema = z.object({
	note: z.string().trim().min(3).max(1000),
	approval_confirmed: z.boolean().optional().default(false),
	rejection_reason_id: z.number().int().positive().optional()
}).strict();

function sendError(response: import('express').Response, error: unknown, fallback: string) {
	if (error instanceof RequestWorkflowError) {
		response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
		return;
	}
	response.status(500).json({ status: 500, message: fallback, data: null });
}

function parsePayload(request: import('express').Request): unknown {
	if (!request.is('multipart/form-data')) return request.body;
	if (typeof request.body?.payload !== 'string') return null;
	try { return JSON.parse(request.body.payload) as unknown; } catch { return null; }
}

function isValidPdf(file: Express.Multer.File): boolean {
	return path.extname(file.originalname).toLocaleLowerCase('en-US') === '.pdf' &&
		file.mimetype.toLocaleLowerCase('en-US') === 'application/pdf' && file.size > 0 &&
		file.size <= 10 * 1024 * 1024 && file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function privatePdf(file?: Express.Multer.File) {
	return file ? { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size } : null;
}

inboxRouter.get('/korwil', async (_request, response) => {
	try {
		const requests = await listKorwilInbox(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Antrean Korwil berhasil dimuat.', data: { requests } });
	} catch (error) { sendError(response, error, 'Antrean Korwil belum dapat dimuat. Coba lagi.'); }
});

inboxRouter.get('/korwil/history', async (_request, response) => {
	try {
		const requests = await listKorwilHistory(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Riwayat Korwil berhasil dimuat.', data: { requests } });
	} catch (error) { sendError(response, error, 'Riwayat Korwil belum dapat dimuat. Coba lagi.'); }
});

inboxRouter.post('/korwil/:id/claim', async (request, response) => {
	const id = Number(request.params.id);
	if (!Number.isSafeInteger(id) || id < 1) { response.status(400).json({ status: 400, message: 'Nomor pengajuan tidak valid.', data: null }); return; }
	try {
		const data = await claimKorwilRequest(response.locals.slaEmployeeId, id);
		response.status(200).json({ status: 200, message: 'Pengajuan berhasil diambil; waktu pengambilan dicatat.', data });
	} catch (error) { sendError(response, error, 'Pengajuan belum dapat diambil. Coba lagi.'); }
});

for (const unit of ['korwil', 'central'] as const) {
	inboxRouter.post(`/${unit}/:id/request-documents`, async (request, response) => {
		const id = Number(request.params.id);
		const parsed = requestDocumentsSchema.safeParse(request.body);
		if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
			response.status(400).json({ status: 400, message: 'Pilih kolom atau dokumen yang harus dilengkapi, lalu tuliskan catatan.', data: null });
			return;
		}
		try {
			const data = unit === 'korwil'
				? await returnKorwilRequestForDocuments(response.locals.slaEmployeeId, id, parsed.data)
				: await returnCentralRequestForDocuments(response.locals.slaEmployeeId, id, parsed.data);
			response.status(200).json({ status: 200, message: 'Daftar kelengkapan dikirim ke Cabang.', data });
		} catch (error) { sendError(response, error, 'Permintaan kelengkapan belum dapat disimpan. Coba lagi.'); }
	});
}

inboxRouter.post('/korwil/:id/forward', (request, response) => {
	decisionUpload(request, response, (uploadError: unknown) => {
		if (uploadError) {
			const tooLarge = uploadError instanceof MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
			response.status(tooLarge ? 413 : 400).json({ status: tooLarge ? 413 : 400, message: tooLarge ? 'Ukuran Berita Acara maksimal 10 MB.' : 'Unggah satu file PDF Berita Acara.', data: null });
			return;
		}
		void (async () => {
			const id = Number(request.params.id);
			const parsed = actionSchema.safeParse(parsePayload(request));
			if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) { response.status(400).json({ status: 400, message: 'Periksa catatan dan konfirmasi penerusan.', data: null }); return; }
			if (request.file && !isValidPdf(request.file)) { response.status(400).json({ status: 400, message: 'Berita Acara harus berupa file PDF yang valid.', data: null }); return; }
			try {
				const data = await forwardKorwilRequestToCentral(response.locals.slaEmployeeId, id, parsed.data.note, {
					approvalConfirmed: parsed.data.approval_confirmed, beritaAcara: privatePdf(request.file)
				});
				response.status(200).json({ status: 200, message: 'Pengajuan disetujui untuk diteruskan ke Divisi Pusat.', data });
			} catch (error) { sendError(response, error, 'Pengajuan belum dapat diteruskan. Coba lagi.'); }
		})().catch((error: unknown) => sendError(response, error, 'Pengajuan belum dapat diteruskan. Coba lagi.'));
	});
});

for (const unit of ['korwil', 'central'] as const) {
	for (const outcome of ['completed', 'rejected'] as const) {
		inboxRouter.post(`/${unit}/:id/${outcome === 'completed' ? 'complete' : 'reject'}`, (request, response) => {
			decisionUpload(request, response, (uploadError: unknown) => {
				if (uploadError) {
					const tooLarge = uploadError instanceof MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
					response.status(tooLarge ? 413 : 400).json({ status: tooLarge ? 413 : 400, message: tooLarge ? 'Ukuran Berita Acara maksimal 10 MB.' : 'Unggah satu file PDF Berita Acara.', data: null });
					return;
				}
				void (async () => {
					const id = Number(request.params.id);
					const parsed = actionSchema.safeParse(parsePayload(request));
					if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) { response.status(400).json({ status: 400, message: 'Periksa catatan hasil, alasan penolakan, dan konfirmasi.', data: null }); return; }
					if (request.file && !isValidPdf(request.file)) { response.status(400).json({ status: 400, message: 'Berita Acara harus berupa file PDF yang valid.', data: null }); return; }
					try {
						const options = {
							approvalConfirmed: parsed.data.approval_confirmed,
							rejectionReasonId: parsed.data.rejection_reason_id,
							beritaAcara: privatePdf(request.file)
						};
						const data = unit === 'korwil'
							? await finishKorwilRequest(response.locals.slaEmployeeId, id, outcome, parsed.data.note, options)
							: await finishCentralRequest(response.locals.slaEmployeeId, id, outcome, parsed.data.note, options);
						response.status(200).json({ status: 200, message: outcome === 'completed' ? 'Persetujuan dan penyelesaian dicatat.' : 'Penolakan dicatat.', data });
					} catch (error) { sendError(response, error, 'Status pengajuan belum dapat diubah. Coba lagi.'); }
				})().catch((error: unknown) => sendError(response, error, 'Status pengajuan belum dapat diubah. Coba lagi.'));
			});
		});
	}
}

inboxRouter.get('/central', async (_request, response) => {
	try {
		const requests = await listCentralInbox(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Antrean Divisi Pusat berhasil dimuat.', data: { requests } });
	} catch (error) { sendError(response, error, 'Antrean Divisi Pusat belum dapat dimuat. Coba lagi.'); }
});

inboxRouter.get('/central/history', async (_request, response) => {
	try {
		const requests = await listCentralHistory(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Riwayat Divisi Pusat berhasil dimuat.', data: { requests } });
	} catch (error) { sendError(response, error, 'Riwayat Divisi Pusat belum dapat dimuat. Coba lagi.'); }
});

inboxRouter.post('/central/:id/claim', async (request, response) => {
	const id = Number(request.params.id);
	if (!Number.isSafeInteger(id) || id < 1) { response.status(400).json({ status: 400, message: 'Nomor pengajuan tidak valid.', data: null }); return; }
	try {
		const data = await claimCentralRequest(response.locals.slaEmployeeId, id);
		response.status(200).json({ status: 200, message: 'Pengajuan berhasil diambil oleh Divisi Pusat.', data });
	} catch (error) { sendError(response, error, 'Pengajuan belum dapat diambil. Coba lagi.'); }
});
