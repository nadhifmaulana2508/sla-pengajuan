import { Router } from 'express';
import { z } from 'zod';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import {
	claimCentralRequest, claimKorwilRequest, finishCentralRequest, finishKorwilRequest,
	forwardKorwilRequestToCentral, listCentralHistory, listCentralInbox, listKorwilHistory, listKorwilInbox, RequestWorkflowError,
	returnCentralRequestForDocuments, returnKorwilRequestForDocuments
} from './requests.service.js';

export const inboxRouter = Router();
inboxRouter.use(requireRequestIdentity);

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

function sendError(response: import('express').Response, error: unknown, fallback: string) {
	if (error instanceof RequestWorkflowError) {
		response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
		return;
	}
	response.status(500).json({ status: 500, message: fallback, data: null });
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
	if (!Number.isSafeInteger(id) || id < 1) {
		response.status(400).json({ status: 400, message: 'Nomor pengajuan tidak valid.', data: null });
		return;
	}
	try {
		const data = await claimKorwilRequest(response.locals.slaEmployeeId, id);
		response.status(200).json({ status: 200, message: 'Pengajuan berhasil diambil; waktu pengambilan dicatat.', data });
	} catch (error) { sendError(response, error, 'Pengajuan belum dapat diambil. Coba lagi.'); }
});

inboxRouter.post('/korwil/:id/request-documents', async (request, response) => {
	const id = Number(request.params.id);
	const parsed = reasonSchema.safeParse(request.body);
	if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
		response.status(400).json({ status: 400, message: 'Tuliskan kelengkapan yang harus dipenuhi (3–1000 karakter).', data: null });
		return;
	}
	try {
		const data = await returnKorwilRequestForDocuments(response.locals.slaEmployeeId, id, parsed.data.reason);
		response.status(200).json({ status: 200, message: 'Permintaan kelengkapan dikirim ke Cabang.', data });
	} catch (error) { sendError(response, error, 'Permintaan kelengkapan belum dapat disimpan. Coba lagi.'); }
});

inboxRouter.post('/korwil/:id/forward', async (request, response) => {
	const id = Number(request.params.id);
	const parsed = reasonSchema.safeParse(request.body);
	if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
		response.status(400).json({ status: 400, message: 'Tuliskan catatan penerusan (3–1000 karakter).', data: null });
		return;
	}
	try {
		const data = await forwardKorwilRequestToCentral(response.locals.slaEmployeeId, id, parsed.data.reason);
		response.status(200).json({ status: 200, message: 'Pengajuan diteruskan ke Divisi Pusat yang dipilih Cabang.', data });
	} catch (error) { sendError(response, error, 'Pengajuan belum dapat diteruskan. Coba lagi.'); }
});

for (const outcome of ['completed', 'rejected'] as const) {
	inboxRouter.post(`/korwil/:id/${outcome === 'completed' ? 'complete' : 'reject'}`, async (request, response) => {
		const id = Number(request.params.id);
		const parsed = reasonSchema.safeParse(request.body);
		if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
			response.status(400).json({ status: 400, message: 'Tuliskan ringkasan hasil atau alasan (3–1000 karakter).', data: null });
			return;
		}
		try {
			const data = await finishKorwilRequest(response.locals.slaEmployeeId, id, outcome, parsed.data.reason);
			response.status(200).json({ status: 200, message: outcome === 'completed' ? 'Pengajuan ditandai selesai.' : 'Pengajuan ditolak.', data });
		} catch (error) { sendError(response, error, 'Status pengajuan belum dapat diubah. Coba lagi.'); }
	});
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
	if (!Number.isSafeInteger(id) || id < 1) {
		response.status(400).json({ status: 400, message: 'Nomor pengajuan tidak valid.', data: null });
		return;
	}
	try {
		const data = await claimCentralRequest(response.locals.slaEmployeeId, id);
		response.status(200).json({ status: 200, message: 'Pengajuan berhasil diambil oleh Divisi Pusat.', data });
	} catch (error) { sendError(response, error, 'Pengajuan belum dapat diambil. Coba lagi.'); }
});

inboxRouter.post('/central/:id/request-documents', async (request, response) => {
	const id = Number(request.params.id);
	const parsed = reasonSchema.safeParse(request.body);
	if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
		response.status(400).json({ status: 400, message: 'Tuliskan kelengkapan yang harus dipenuhi (3–1000 karakter).', data: null });
		return;
	}
	try {
		const data = await returnCentralRequestForDocuments(response.locals.slaEmployeeId, id, parsed.data.reason);
		response.status(200).json({ status: 200, message: 'Permintaan kelengkapan dikirim ke Cabang.', data });
	} catch (error) { sendError(response, error, 'Permintaan kelengkapan belum dapat disimpan. Coba lagi.'); }
});

for (const outcome of ['completed', 'rejected'] as const) {
	inboxRouter.post(`/central/:id/${outcome === 'completed' ? 'complete' : 'reject'}`, async (request, response) => {
		const id = Number(request.params.id);
		const parsed = reasonSchema.safeParse(request.body);
		if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
			response.status(400).json({ status: 400, message: 'Tuliskan ringkasan hasil atau alasan (3–1000 karakter).', data: null });
			return;
		}
		try {
			const data = await finishCentralRequest(response.locals.slaEmployeeId, id, outcome, parsed.data.reason);
			response.status(200).json({ status: 200, message: outcome === 'completed' ? 'Pengajuan ditandai selesai.' : 'Pengajuan ditolak.', data });
		} catch (error) { sendError(response, error, 'Status pengajuan belum dapat diubah. Coba lagi.'); }
	});
}
