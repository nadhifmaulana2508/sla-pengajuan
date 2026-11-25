import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { z } from 'zod';

export interface SsoConfig {
	baseUrl: string;
	appCode: string;
	appToken: string;
	timeoutMs: number;
	connectIp?: string;
}

export type SsoEmployee = {
	employee_id: string;
	full_name: string;
	kode: string | null;
	job_position: string | null;
	unit_kerja?: string | null;
	branch_name?: string | null;
};

const profileSchema = z.object({
	kode: z.string().nullable().optional(),
	employee_id: z.string().min(1),
	full_name: z.string().min(1),
	email: z.string().nullable().optional(),
	telp: z.string().nullable().optional(),
	branch_name: z.string().nullable().optional(),
	unit_kerja: z.string().nullable().optional(),
	job_position: z.string().nullable().optional(),
	level: z.string().nullable().optional(),
	group_jabatan: z.string().nullable().optional()
});

const loginResponseSchema = z.object({
	status: z.number(),
	data: z.object({ token: z.string().min(1) })
});

const profileResponseSchema = z.object({
	status: z.number(),
	data: profileSchema
});

const employeeSchema = z.object({
	employee_id: z.string().trim().min(1).max(80),
	full_name: z.string().trim().min(1).max(160),
	kode: z.union([z.string(), z.number().transform(String)]).nullable().optional(),
	job_position: z.string().nullable().optional(),
	unit_kerja: z.string().nullable().optional(),
	branch_name: z.string().nullable().optional()
}).transform((employee) => ({
	employee_id: employee.employee_id,
	full_name: employee.full_name,
	kode: employee.kode === undefined || employee.kode === null ? null : String(employee.kode),
	job_position: employee.job_position ?? null,
	unit_kerja: employee.unit_kerja ?? null,
	branch_name: employee.branch_name ?? null
}));

const employeeSearchResponseSchema = z.object({
	status: z.number(),
	data: z.array(employeeSchema).max(50)
});

export type SsoProfile = z.infer<typeof profileSchema>;

export class SsoAuthError extends Error {
	constructor(
		public readonly statusCode: 401 | 403 | 502,
		message: string
	) {
		super(message);
		this.name = 'SsoAuthError';
	}
}

function getSsoStatus(body: unknown): number | undefined {
	if (typeof body !== 'object' || body === null || !('status' in body)) return undefined;
	const status = body.status;
	return typeof status === 'number' ? status : undefined;
}

function createIpPinnedFetcher(connectIp: string): typeof fetch {
	const lookup: LookupFunction = (_hostname, options, callback) => {
		if (options.all) {
			callback(null, [{ address: connectIp, family: 4 }]);
			return;
		}
		callback(null, connectIp, 4);
	};

	return async (input, init = {}) => {
		const url = input instanceof URL ? input : new URL(String(input));
		if (url.protocol !== 'https:') return fetch(input, init);

		const headers = new Headers(init.headers);
		const body = typeof init.body === 'string' ? Buffer.from(init.body) : undefined;

		return new Promise<Response>((resolve, reject) => {
			const requestOptions: https.RequestOptions = {
				hostname: url.hostname,
				port: url.port || '443',
				path: `${url.pathname}${url.search}`,
				method: init.method ?? 'GET',
				headers: Object.fromEntries(headers.entries()),
				servername: url.hostname,
				lookup,
				signal: init.signal ?? undefined
			};
			const request = https.request(requestOptions, (response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => {
					const responseHeaders = new Headers();
					for (const [name, value] of Object.entries(response.headers)) {
						if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
						else if (value !== undefined) responseHeaders.set(name, value);
					}
					resolve(new Response(Buffer.concat(chunks), {
						status: response.statusCode ?? 502,
						statusText: response.statusMessage,
						headers: responseHeaders
					}));
				});
			});

			request.on('error', reject);
			if (body) request.write(body);
			request.end();
		});
	};
}

export function createSsoClient(config: SsoConfig, fetcher: typeof fetch = config.connectIp ? createIpPinnedFetcher(config.connectIp) : fetch) {
	const baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`;

	async function request(path: string, init: RequestInit, failureMessage: string): Promise<unknown> {
		if (!config.appToken) {
			throw new SsoAuthError(502, 'Token aplikasi SSO belum diatur pada environment backend.');
		}
		let response: Response;

		try {
			response = await fetcher(new URL(path, baseUrl), {
				...init,
				headers: {
					accept: 'application/json',
					App: config.appCode,
					...(config.appToken ? { 'X-App-Token': config.appToken } : {}),
					...init.headers
				},
				signal: AbortSignal.timeout(config.timeoutMs)
			});
		} catch {
			throw new SsoAuthError(502, 'Layanan SSO tidak dapat dihubungi. Coba lagi beberapa saat.');
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new SsoAuthError(502, 'Respons dari layanan SSO tidak dapat dibaca.');
		}

		const ssoStatus = getSsoStatus(body);
		if (!response.ok || (ssoStatus !== undefined && ssoStatus !== 200)) {
			if ([400, 401, 403].includes(response.status) || [400, 401, 403].includes(ssoStatus ?? 0)) {
				throw new SsoAuthError(401, failureMessage);
			}
			throw new SsoAuthError(502, 'Layanan SSO sedang tidak tersedia. Coba lagi beberapa saat.');
		}

		return body;
	}

	return {
		async login(idPeg: string, password: string): Promise<{ token: string; profile: SsoProfile }> {
			const body = await request(
				'api/auth/login',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id_peg: idPeg, password })
				},
				'ID pegawai, password, atau akses aplikasi SSO tidak sesuai.'
			);

			const loginResult = loginResponseSchema.safeParse(body);
			if (!loginResult.success || loginResult.data.status !== 200) {
				throw new SsoAuthError(502, 'Respons login dari layanan SSO tidak sesuai.');
			}

			const profile = await this.whoami(loginResult.data.data.token);
			return { token: loginResult.data.data.token, profile };
		},

		async loginDummy(idPeg: string): Promise<{ token: string; profile: SsoProfile }> {
			const body = await request(
				'api/auth/login-dummy',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id_peg: idPeg })
				},
				'ID pegawai tidak tersedia untuk uji login dummy SSO.'
			);

			const loginResult = loginResponseSchema.safeParse(body);
			if (!loginResult.success || loginResult.data.status !== 200) {
				throw new SsoAuthError(502, 'Respons login dummy SSO tidak sesuai.');
			}

			const profile = await this.whoami(loginResult.data.data.token);
			return { token: loginResult.data.data.token, profile };
		},

		async searchEmployees(query: string): Promise<SsoEmployee[]> {
			const trimmed = query.trim();
			const isEmployeeId = /^[\d-]+$/.test(trimmed) && /\d/.test(trimmed);
			const params = new URLSearchParams(isEmployeeId ? { id_peg: trimmed } : { nama: trimmed });
			const body = await request(
				`api/simpeg/pegawai/search?${params.toString()}`,
				{ method: 'GET' },
				'Pencarian pegawai di SSO belum berhasil.'
			);

			const result = employeeSearchResponseSchema.safeParse(body);
			if (!result.success || result.data.status !== 200) {
				throw new SsoAuthError(502, 'Respons pencarian pegawai dari SSO tidak sesuai.');
			}
			return result.data.data;
		},

		async whoami(token: string): Promise<SsoProfile> {
			const body = await request(
				'api/auth/whoami',
				{ method: 'GET', headers: { authorization: `Bearer ${token}` } },
				'Sesi SSO tidak valid atau sudah berakhir. Silakan masuk kembali.'
			);

			const profileResult = profileResponseSchema.safeParse(body);
			if (!profileResult.success || profileResult.data.status !== 200) {
				throw new SsoAuthError(502, 'Profil dari layanan SSO tidak sesuai.');
			}

			return profileResult.data.data;
		}
	};
}
