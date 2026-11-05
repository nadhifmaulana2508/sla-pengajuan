export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

type ApiRequestOptions = {
	method?: 'GET' | 'POST' | 'PUT';
	body?: unknown;
	token?: string | null;
};

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
	const headers = new Headers({ accept: 'application/json' });
	if (options.body !== undefined) headers.set('content-type', 'application/json');
	if (options.token) headers.set('authorization', `Bearer ${options.token}`);

	const baseUrl = import.meta.env.VITE_API_BASE_URL;
	if (!baseUrl) throw new ApiError(0, 'Alamat backend belum diatur di file .env frontend.');

	let response: Response;
	try {
		response = await fetch(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body)
		});
	} catch {
		throw new ApiError(0, 'Permintaan ke backend gagal. Periksa koneksi API dan konfigurasi CORS.');
	}

	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const message =
			typeof payload === 'object' && payload !== null && 'message' in payload &&
			typeof payload.message === 'string'
				? payload.message
				: 'Permintaan belum berhasil. Silakan coba lagi.';
		throw new ApiError(response.status, message);
	}

	return payload as T;
}
