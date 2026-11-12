import { Router } from 'express';
import { z } from 'zod';
import { resolveSlaAccess } from './access.service.js';
import { SsoAuthError } from './auth.service.js';
import { isDummyAuthAvailable, listDummyUsers, loginAsDummy, loginWithSso, resolveBearerIdentity } from './identity.service.js';

export const authRouter = Router();

const loginSchema = z.object({
	id_peg: z.string().trim().min(1).max(80),
	password: z.string().min(1).max(256)
});
const dummyLoginSchema = z.object({ employee_id: z.string().trim().min(1).max(80) });

async function addSlaAccess(profile: Awaited<ReturnType<typeof resolveBearerIdentity>>) {
	return {
		...profile,
		sla_access: await resolveSlaAccess(profile.employee_id)
	};
}

function getBearerToken(header: string | undefined): string | null {
	const match = header?.match(/^Bearer\s+([^\s]+)$/i);
	return match?.[1] ?? null;
}

function sendAuthError(error: unknown, response: Parameters<Parameters<typeof authRouter.post>[1]>[1]): void {
	if (error instanceof SsoAuthError) {
		response.status(error.statusCode).json({
			status: error.statusCode,
			message: error.message,
			data: null
		});
		return;
	}

	response.status(502).json({
		status: 502,
		message: 'Sistem SLA gagal memproses profil atau hak akses. Coba lagi beberapa saat.',
		data: null
	});
}

authRouter.post('/login', async (request, response) => {
	const parsed = loginSchema.safeParse(request.body);
	if (!parsed.success) {
		response.status(400).json({
			status: 400,
			message: 'ID pegawai dan password wajib diisi.',
			data: null
		});
		return;
	}

	try {
		const result = await loginWithSso(parsed.data.id_peg, parsed.data.password);
		const profile = await addSlaAccess(result.profile);
		response.status(200).json({
			status: 200,
			message: 'Login berhasil.',
			data: { ...result, profile }
		});
	} catch (error) {
		sendAuthError(error, response);
	}
});

authRouter.get('/dummy-users', async (_request, response) => {
	if (!isDummyAuthAvailable()) {
		response.status(404).json({ status: 404, message: 'Route not found', data: null });
		return;
	}
	try {
		response.status(200).json({ status: 200, message: 'OK', data: await listDummyUsers() });
	} catch {
		response.status(500).json({ status: 500, message: 'Daftar akun dummy belum dapat dimuat.', data: null });
	}
});

authRouter.post('/dummy-login', async (request, response) => {
	if (!isDummyAuthAvailable()) {
		response.status(404).json({ status: 404, message: 'Route not found', data: null });
		return;
	}
	const parsed = dummyLoginSchema.safeParse(request.body);
	if (!parsed.success) {
		response.status(400).json({ status: 400, message: 'Pilih akun dummy yang tersedia.', data: null });
		return;
	}
	try {
		const result = await loginAsDummy(parsed.data.employee_id);
		response.status(200).json({ status: 200, message: 'Login akun dummy berhasil.', data: result });
	} catch (error) {
		sendAuthError(error, response);
	}
});

authRouter.get('/whoami', async (request, response) => {
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
		response.status(200).json({ status: 200, message: 'OK', data: await addSlaAccess(profile) });
	} catch (error) {
		sendAuthError(error, response);
	}
});
