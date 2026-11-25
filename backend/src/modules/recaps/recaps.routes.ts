import { Router } from 'express';
import { z } from 'zod';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import {
	appendRecapSources, createRecap, getRecapDetail, listAppendableRecapSources, listRecapCatalogs, listRecapSources, listRecaps,
	proposeRecapRowChanges, RecapError, reviewRecapProposal, updateRecapRow, updateRecapSettings
} from './recaps.service.js';

const trackingFieldSchema = z.object({
	key: z.string().regex(/^tracking_[a-z0-9_]{1,56}$/),
	label: z.string().trim().min(1).max(100),
	type: z.enum(['text', 'number', 'date', 'select']),
	options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
	editable_by_branch: z.boolean()
}).strict();
const createSchema = z.object({
	title: z.string().trim().min(1).max(160),
	work_catalog_id: z.number().int().positive(),
	request_ids: z.array(z.number().int().positive()).min(1).max(500),
	visible_source_keys: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).min(1).max(40),
	tracking_fields: z.array(trackingFieldSchema).max(40)
}).strict();
const appendSourcesSchema = z.object({ request_ids: z.array(z.number().int().positive()).min(1).max(500) }).strict();
const editSettingsSchema = z.object({
	title: z.string().trim().min(1).max(160),
	visible_source_keys: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).min(1).max(40),
	tracking_fields: z.array(trackingFieldSchema).max(40)
}).strict();
const changesSchema = z.record(z.string().regex(/^tracking_[a-z0-9_]{1,56}$/), z.union([z.string().max(1000), z.number().finite(), z.null()])).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 40);
const proposalSchema = z.object({ changes: changesSchema, note: z.string().trim().min(3).max(1000) }).strict();
const updateSchema = z.object({ changes: changesSchema }).strict();
const reviewSchema = z.object({ outcome: z.enum(['approved', 'rejected']), review_note: z.string().trim().max(1000).nullable().optional() }).strict();

export const recapsRouter = Router();
recapsRouter.use(requireRequestIdentity);

function sendError(response: import('express').Response, error: unknown, fallback: string): void {
	const status = error instanceof RecapError ? error.statusCode : 500;
	response.status(status).json({
		status,
		message: error instanceof RecapError ? error.message : fallback,
		data: null
	});
}

function positiveId(raw: string | undefined): number | null {
	const value = Number(raw);
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}

recapsRouter.get('/', async (_request, response) => {
	try {
		const data = await listRecaps(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Daftar rekap berhasil dimuat.', data });
	} catch (error) { sendError(response, error, 'Daftar rekap belum dapat dimuat. Coba lagi.'); }
});

recapsRouter.get('/catalogs', async (_request, response) => {
	try {
		const data = await listRecapCatalogs(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Jenis pekerjaan sumber berhasil dimuat.', data });
	} catch (error) { sendError(response, error, 'Jenis pekerjaan sumber belum dapat dimuat. Coba lagi.'); }
});

recapsRouter.get('/catalogs/:catalogId/sources', async (request, response) => {
	const catalogId = positiveId(request.params.catalogId);
	if (!catalogId) { response.status(400).json({ status: 400, message: 'Jenis pekerjaan tidak valid.', data: null }); return; }
	try {
		const data = await listRecapSources(response.locals.slaEmployeeId, catalogId);
		response.status(200).json({ status: 200, message: 'Tiket sumber berhasil dimuat.', data });
	} catch (error) { sendError(response, error, 'Tiket sumber belum dapat dimuat. Coba lagi.'); }
});

recapsRouter.get('/:recapId/sources', async (request, response) => {
	const recapId = positiveId(request.params.recapId);
	if (!recapId) { response.status(400).json({ status: 400, message: 'Rekap tidak valid.', data: null }); return; }
	try {
		const data = await listAppendableRecapSources(response.locals.slaEmployeeId, recapId);
		response.status(200).json({ status: 200, message: 'Tiket dengan template form yang sama berhasil dimuat.', data });
	} catch (error) { sendError(response, error, 'Tiket yang dapat ditambahkan belum dapat dimuat. Coba lagi.'); }
});

recapsRouter.post('/', async (request, response) => {
	const parsed = createSchema.safeParse(request.body);
	if (!parsed.success) { response.status(400).json({ status: 400, message: 'Periksa judul, tiket sumber, kolom, dan aturan rekap.', data: null }); return; }
	try {
		const data = await createRecap(response.locals.slaEmployeeId, parsed.data);
		response.status(201).json({ status: 201, message: 'Rekap berhasil diterbitkan.', data });
	} catch (error) { sendError(response, error, 'Rekap belum dapat diterbitkan. Coba lagi.'); }
});

recapsRouter.post('/:recapId/sources', async (request, response) => {
	const recapId = positiveId(request.params.recapId);
	const parsed = appendSourcesSchema.safeParse(request.body);
	if (!recapId || !parsed.success) { response.status(400).json({ status: 400, message: 'Pilih tiket sumber yang valid.', data: null }); return; }
	try {
		const data = await appendRecapSources(response.locals.slaEmployeeId, recapId, parsed.data.request_ids);
		response.status(201).json({ status: 201, message: 'Tiket berhasil ditambahkan ke rekap.', data });
	} catch (error) { sendError(response, error, 'Tiket belum dapat ditambahkan. Coba lagi.'); }
});

recapsRouter.patch('/:recapId', async (request, response) => {
	const recapId = positiveId(request.params.recapId);
	const parsed = editSettingsSchema.safeParse(request.body);
	if (!recapId || !parsed.success) { response.status(400).json({ status: 400, message: 'Periksa nama rekap dan pengaturan kolom.', data: null }); return; }
	try {
		const data = await updateRecapSettings(response.locals.slaEmployeeId, recapId, parsed.data);
		response.status(200).json({ status: 200, message: 'Pengaturan rekap berhasil disimpan.', data });
	} catch (error) { sendError(response, error, 'Pengaturan rekap belum dapat disimpan. Coba lagi.'); }
});

recapsRouter.get('/:recapId', async (request, response) => {
	const recapId = positiveId(request.params.recapId);
	if (!recapId) { response.status(400).json({ status: 400, message: 'Rekap tidak valid.', data: null }); return; }
	try {
		const data = await getRecapDetail(response.locals.slaEmployeeId, recapId);
		response.status(200).json({ status: 200, message: 'Isi rekap berhasil dimuat.', data });
	} catch (error) { sendError(response, error, 'Isi rekap belum dapat dimuat. Coba lagi.'); }
});

recapsRouter.patch('/:recapId/rows/:rowId', async (request, response) => {
	const recapId = positiveId(request.params.recapId);
	const rowId = positiveId(request.params.rowId);
	const parsed = updateSchema.safeParse(request.body);
	if (!recapId || !rowId || !parsed.success) { response.status(400).json({ status: 400, message: 'Perubahan kolom rekap tidak valid.', data: null }); return; }
	try {
		const data = await updateRecapRow(response.locals.slaEmployeeId, recapId, rowId, parsed.data.changes);
		response.status(200).json({ status: 200, message: 'Rekap berhasil diperbarui.', data });
	} catch (error) { sendError(response, error, 'Rekap belum dapat diperbarui. Coba lagi.'); }
});

recapsRouter.post('/:recapId/rows/:rowId/proposals', async (request, response) => {
	const recapId = positiveId(request.params.recapId);
	const rowId = positiveId(request.params.rowId);
	const parsed = proposalSchema.safeParse(request.body);
	if (!recapId || !rowId || !parsed.success) { response.status(400).json({ status: 400, message: 'Perubahan dan alasan pengajuan belum valid.', data: null }); return; }
	try {
		const data = await proposeRecapRowChanges(response.locals.slaEmployeeId, recapId, rowId, parsed.data.changes, parsed.data.note);
		response.status(201).json({ status: 201, message: 'Perubahan dikirim untuk persetujuan Divisi.', data });
	} catch (error) { sendError(response, error, 'Perubahan belum dapat diajukan. Coba lagi.'); }
});

recapsRouter.post('/:recapId/proposals/:proposalId/review', async (request, response) => {
	const recapId = positiveId(request.params.recapId);
	const proposalId = positiveId(request.params.proposalId);
	const parsed = reviewSchema.safeParse(request.body);
	if (!recapId || !proposalId || !parsed.success) { response.status(400).json({ status: 400, message: 'Keputusan perubahan belum valid.', data: null }); return; }
	try {
		const data = await reviewRecapProposal(response.locals.slaEmployeeId, recapId, proposalId, parsed.data.outcome, parsed.data.review_note ?? null);
		response.status(200).json({ status: 200, message: parsed.data.outcome === 'approved' ? 'Perubahan disetujui dan diterapkan.' : 'Perubahan ditolak.', data });
	} catch (error) { sendError(response, error, 'Perubahan belum dapat ditinjau. Coba lagi.'); }
});
