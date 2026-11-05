import { Router } from 'express';
import { z } from 'zod';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import {
	getRequestDetail, getRequestOptions, listBranchRequests, RequestWorkflowError, submitBranchRevision, submitRequest
} from './requests.service.js';

const submitSchema = z.object({
	authority_type: z.enum(['korwil', 'central']),
	central_division_id: z.number().int().positive().nullable(),
	work_catalog_id: z.number().int().positive().nullable(),
	subject: z.string().trim().min(3).max(200),
	description: z.string().trim().min(3).max(5000)
}).strict();
const revisionSchema = z.object({ response: z.string().trim().min(3).max(5000) }).strict();

export const requestRouter = Router();
requestRouter.use(requireRequestIdentity);

function sendError(response: import('express').Response, error: unknown, fallback: string) {
	if (error instanceof RequestWorkflowError) {
		response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
		return;
	}
	response.status(500).json({ status: 500, message: fallback, data: null });
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

requestRouter.post('/', async (request, response) => {
	const parsed = submitSchema.safeParse(request.body);
	if (!parsed.success) {
		response.status(400).json({ status: 400, message: 'Lengkapi perihal dan uraian. Pengajuan ke Pusat wajib memilih divisi dan jenis pekerjaan.', data: null });
		return;
	}
	try {
		const data = await submitRequest(response.locals.slaEmployeeId, parsed.data);
		response.status(201).json({ status: 201, message: 'Pengajuan berhasil dikirim ke antrean Korwil.', data });
	} catch (error) { sendError(response, error, 'Pengajuan belum dapat disimpan. Coba lagi.'); }
});

requestRouter.post('/:id/revision', async (request, response) => {
	const id = Number(request.params.id);
	const parsed = revisionSchema.safeParse(request.body);
	if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
		response.status(400).json({ status: 400, message: 'Tuliskan jawaban atau uraian pelengkapan (3–5000 karakter).', data: null });
		return;
	}
	try {
		const data = await submitBranchRevision(response.locals.slaEmployeeId, id, parsed.data.response);
		const message = data.resumed_to_previous_handler
			? 'Pelengkapan dikirim kembali kepada petugas yang meminta.'
			: 'Pelengkapan dikirim ke antrean unit tujuan karena petugas sebelumnya tidak tersedia.';
		response.status(200).json({ status: 200, message, data });
	} catch (error) { sendError(response, error, 'Pelengkapan belum dapat dikirim. Coba lagi.'); }
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
