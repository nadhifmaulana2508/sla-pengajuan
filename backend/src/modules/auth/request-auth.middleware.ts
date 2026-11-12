import type { RequestHandler } from 'express';
import { SsoAuthError } from './auth.service.js';
import { resolveBearerIdentity } from './identity.service.js';

function getBearerToken(header: string | undefined): string | null {
	const match = header?.match(/^Bearer\s+([^\s]+)$/i);
	return match?.[1] ?? null;
}

export const requireRequestIdentity: RequestHandler = async (request, response, next) => {
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
		response.locals.slaEmployeeId = profile.employee_id;
		next();
	} catch (error) {
		if (error instanceof SsoAuthError) {
			response.status(error.statusCode).json({ status: error.statusCode, message: error.message, data: null });
			return;
		}
		response.status(500).json({
			status: 500,
			message: 'Identitas pegawai belum dapat diverifikasi oleh Sistem SLA. Coba lagi.',
			data: null
		});
	}
};
