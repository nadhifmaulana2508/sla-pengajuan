import { Router } from 'express';
import { z } from 'zod';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import { NotificationAccessError, listNotifications, markAllNotificationsRead, markNotificationRead } from './notifications.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireRequestIdentity);

notificationsRouter.get('/', async (_request, response) => {
	try {
		const data = await listNotifications(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Notifikasi berhasil dimuat.', data });
	} catch (error) {
		sendNotificationError(response, error);
	}
});

notificationsRouter.post('/read-all', async (_request, response) => {
	try {
		await markAllNotificationsRead(response.locals.slaEmployeeId);
		response.status(200).json({ status: 200, message: 'Semua notifikasi ditandai sudah dibaca.', data: null });
	} catch (error) {
		sendNotificationError(response, error);
	}
});

notificationsRouter.post('/:id/read', async (request, response) => {
	const parsed = z.coerce.number().int().positive().safeParse(request.params.id);
	if (!parsed.success) {
		response.status(400).json({ status: 400, message: 'Notifikasi tidak valid.', data: null });
		return;
	}
	try {
		const updated = await markNotificationRead(response.locals.slaEmployeeId, parsed.data);
		if (!updated) {
			response.status(404).json({ status: 404, message: 'Notifikasi tidak ditemukan.', data: null });
			return;
		}
		response.status(200).json({ status: 200, message: 'Notifikasi ditandai sudah dibaca.', data: null });
	} catch (error) {
		sendNotificationError(response, error);
	}
});

function sendNotificationError(response: import('express').Response, error: unknown): void {
	if (error instanceof NotificationAccessError) {
		response.status(403).json({ status: 403, message: error.message, data: null });
		return;
	}
	response.status(500).json({ status: 500, message: 'Notifikasi belum dapat dimuat. Coba lagi.', data: null });
}
