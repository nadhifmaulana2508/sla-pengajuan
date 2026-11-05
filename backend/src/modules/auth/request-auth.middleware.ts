import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { syncSsoProfile } from './access.service.js';
import { createSsoClient, SsoAuthError } from './auth.service.js';

const sso = createSsoClient({
	baseUrl: env.SSO_BASE_URL,
	appCode: env.SSO_APP_CODE,
	timeoutMs: env.SSO_TIMEOUT_MS,
	connectIp: env.SSO_CONNECT_IP
});

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
		const profile = await sso.whoami(token);
		await syncSsoProfile(profile);
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
