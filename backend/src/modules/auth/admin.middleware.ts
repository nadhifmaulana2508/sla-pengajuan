import type { RequestHandler } from 'express';
import { resolveSlaAccess } from './access.service.js';
import { SsoAuthError } from './auth.service.js';
import { resolveBearerIdentity } from './identity.service.js';

function getBearerToken(header: string | undefined): string | null {
	const match = header?.match(/^Bearer\s+([^\s]+)$/i);
	return match?.[1] ?? null;
}

export const requireSlaAdmin: RequestHandler = async (request, response, next) => {
	const token = getBearerToken(request.header('authorization'));
	if (!token) {
		response.status(401).json({
			status: 401,
			message: 'Token sesi tidak ditemukan. Silakan masuk kembali.',
			data: null
		});
		return;
	}

	try {
		const profile = await resolveBearerIdentity(token);
		const access = await resolveSlaAccess(profile.employee_id);

		if (!access.enabled || access.role !== 'admin' || access.scope !== 'all') {
			response.status(403).json({
				status: 403,
				message: 'Fitur ini hanya tersedia untuk Admin Sistem SLA.',
				data: null
			});
			return;
		}

		response.locals.slaAdminEmployeeId = profile.employee_id;
		response.locals.slaAdminProfile = { ...profile, sla_access: access };
		next();
	} catch (error) {
		if (error instanceof SsoAuthError) {
			response.status(error.statusCode).json({
				status: error.statusCode,
				message: error.message,
				data: null
			});
			return;
		}

		response.status(500).json({
			status: 500,
			message: 'Hak akses admin belum dapat diverifikasi. Coba lagi.',
			data: null
		});
	}
};
