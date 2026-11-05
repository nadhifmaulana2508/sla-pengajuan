import { Router } from 'express';
import { checkDatabaseConnection } from '../../db/client.js';

export const healthRouter = Router();

healthRouter.get('/health', (_request, response) => {
	response.status(200).json({
		status: 'ok',
		data: { service: 'sla-pengajuan-api' }
	});
});

healthRouter.get('/health/database', async (_request, response) => {
	try {
		await checkDatabaseConnection();
		response.status(200).json({
			status: 'ok',
			data: { database: 'connected' }
		});
	} catch {
		response.status(503).json({
			status: 'error',
			message: 'Database is unavailable',
			data: { database: 'disconnected' }
		});
	}
});
