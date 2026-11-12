import { Router } from 'express';
import { requireRequestIdentity } from '../auth/request-auth.middleware.js';
import {
	DashboardError, getBranchFollowUp, getDashboard, getManagementRequests,
	parseBranchFollowUpFilters, parseDashboardFilters, parseManagementRequestFilters
} from './dashboard.service.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireRequestIdentity);

dashboardRouter.get('/management-requests', async (request, response) => {
	try {
		const filters = parseManagementRequestFilters(
			request.query.kode_kantor,
			request.query.korwil,
			request.query.division_id,
			request.query.status,
			request.query.from,
			request.query.to,
			request.query.sla_status,
			request.query.page,
			request.query.page_size
		);
		const data = await getManagementRequests(response.locals.slaEmployeeId, filters);
		response.status(200).json({ status: 200, message: 'Pemantauan tiket berhasil dimuat.', data });
	} catch (error) {
		if (error instanceof DashboardError) {
			response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
			return;
		}
		response.status(500).json({ status: 500, message: 'Pemantauan tiket belum dapat dimuat. Coba lagi.', data: null });
	}
});

dashboardRouter.get('/branch-follow-up', async (request, response) => {
	try {
		const filters = parseBranchFollowUpFilters(request.query.kode_kantor);
		const data = await getBranchFollowUp(response.locals.slaEmployeeId, filters);
		response.status(200).json({ status: 200, message: 'Tiket yang menunggu tindak lanjut Cabang berhasil dimuat.', data });
	} catch (error) {
		if (error instanceof DashboardError) {
			response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
			return;
		}
		response.status(500).json({ status: 500, message: 'Daftar tindak lanjut Cabang belum dapat dimuat. Coba lagi.', data: null });
	}
});

dashboardRouter.get('/', async (request, response) => {
	try {
		const filters = parseDashboardFilters(request.query.from, request.query.to, request.query.korwil, request.query.division_id);
		const dashboard = await getDashboard(response.locals.slaEmployeeId, filters);
		response.status(200).json({ status: 200, message: 'Dashboard berhasil dimuat.', data: dashboard });
	} catch (error) {
		if (error instanceof DashboardError) {
			response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
			return;
		}
		response.status(500).json({ status: 500, message: 'Dashboard belum dapat dimuat. Coba lagi.', data: null });
	}
});
